/**
 * LTI 1.3 Core (Resource Link Launch) und NRPS, nach dem Vorbild von Autogra.fi (src/Lti/LtiService.php):
 * OIDC-Login-Initiierung → Weiterleitung zur Plattform → id_token per form_post → Prüfung → Sitzung.
 * Grundlage laut Entscheidung 10.7: nur LTI 1.3 mit AGS und NRPS, kein Moodle-Plugin.
 */
import { createRemoteJWKSet, jwtVerify, SignJWT, type JWTPayload } from 'jose';
import type { Db } from '../db/index.js';
import type { AuditLog } from '../audit/auditLog.js';
import type { Contexts } from '../identity/contexts.js';
import type { Users } from '../identity/users.js';
import { randomToken } from '../security/crypto.js';
import type { ToolKeyStore } from './toolKey.js';

const C = 'https://purl.imsglobal.org/spec/lti/claim/';
const NRPS_CLAIM = 'https://purl.imsglobal.org/spec/lti-nrps/claim/namesroleservice';
const AGS_CLAIM = 'https://purl.imsglobal.org/spec/lti-ags/claim/endpoint';
const STATE_TTL = 10 * 60_000;

export class LtiError extends Error {}

export interface Platform {
  id: number;
  issuer: string;
  client_id: string;
  deployment_id: string;
  auth_url: string;
  jwks_url: string;
  token_url: string | null;
  title: string;
}

export interface LaunchResult {
  userId: number;
  contextId: number;
  linkId: number;
  projectId: number | null;
  role: 'teacher' | 'student';
  platformId: number;
}

export interface LtiUrls {
  /** Öffentliche Adresse inkl. Unterordner, z. B. https://server.schule.de/collegare */
  appUrl: string;
}

type Fetch = typeof fetch;

export class Lti {
  private jwks = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

  constructor(
    private db: Db,
    private users: Users,
    private contexts: Contexts,
    private audit: AuditLog,
    private keys: ToolKeyStore,
    private urls: LtiUrls,
    private now: () => number = Date.now,
    private fetchFn: Fetch = fetch,
  ) {}

  /** Werte, die die Administration in Moodle einträgt (Seite „Moodle-Verbindung“). */
  toolConfig() {
    const a = this.urls.appUrl;
    return {
      toolUrl: `${a}/lti/launch`,
      loginUrl: `${a}/lti/login`,
      redirectUris: [`${a}/lti/launch`],
      jwksUrl: `${a}/lti/jwks`,
      keyType: 'Schlüsselsatz-URL (JWKS)',
      services: ['IMS LTI Names and Role Provisioning: Nutze diesen Dienst, um Mitgliedsinformationen abzurufen', 'IMS LTI Assignment and Grade Services: Nutze diesen Dienst für Bewertungssynchronisation und Spaltenverwaltung'],
      privacy: 'Namen der Nutzer/innen an das Tool senden: Immer; E-Mail: nie (wird nicht gebraucht)',
      launchContainer: 'Neues Fenster (sonst blockieren Browser das Anmelde-Cookie im eingebetteten Rahmen)',
    };
  }

  async platforms(): Promise<Platform[]> {
    return this.db.selectFrom('lti_platforms').select(['id', 'issuer', 'client_id', 'deployment_id', 'auth_url', 'jwks_url', 'token_url', 'title']).orderBy('title').execute();
  }

  async addPlatform(p: Omit<Platform, 'id'>): Promise<number> {
    for (const u of [p.auth_url, p.jwks_url, p.token_url].filter(Boolean) as string[]) {
      if (!/^https:\/\//.test(u) && !/^http:\/\/(localhost|127\.0\.0\.1)(:|\/)/.test(u)) throw new LtiError('Adressen der Plattform müssen mit https:// beginnen');
    }
    const dup = await this.db.selectFrom('lti_platforms').select('id').where('issuer', '=', p.issuer).where('client_id', '=', p.client_id).where('deployment_id', '=', p.deployment_id).executeTakeFirst();
    if (dup) throw new LtiError('Diese Plattform ist schon eingetragen');
    const res = await this.db.insertInto('lti_platforms').values({ ...p, created_at: this.now() }).executeTakeFirstOrThrow();
    return Number(res.insertId);
  }

  async removePlatform(id: number): Promise<void> {
    await this.db.deleteFrom('lti_platforms').where('id', '=', id).execute();
  }

  private async platformFor(issuer: string, clientId?: string | null, deploymentId?: string | null): Promise<Platform | undefined> {
    let q = this.db.selectFrom('lti_platforms').select(['id', 'issuer', 'client_id', 'deployment_id', 'auth_url', 'jwks_url', 'token_url', 'title']).where('issuer', '=', issuer);
    if (clientId) q = q.where('client_id', '=', clientId);
    if (deploymentId) q = q.where('deployment_id', '=', deploymentId);
    const rows = await q.execute();
    // mehrdeutig (gleicher Aussteller, mehrere Einträge, keine client_id): lieber ablehnen
    return rows.length === 1 ? rows[0] : undefined;
  }

  private async platformById(id: number): Promise<Platform | undefined> {
    return this.db.selectFrom('lti_platforms').select(['id', 'issuer', 'client_id', 'deployment_id', 'auth_url', 'jwks_url', 'token_url', 'title']).where('id', '=', id).executeTakeFirst();
  }

  /** Schritt 1: Login-Initiierung durch die Plattform; liefert die Weiterleitungs-URL. */
  async initiateLogin(p: Record<string, string | undefined>): Promise<string> {
    const iss = p.iss ?? '';
    const loginHint = p.login_hint ?? '';
    const target = p.target_link_uri ?? '';
    if (!iss || !loginHint || !target) throw new LtiError('Login-Initiierung unvollständig');
    const platform = await this.platformFor(iss, p.client_id, p.lti_deployment_id);
    if (!platform) throw new LtiError('Diese Moodle-Plattform ist in Collegare nicht eingetragen');
    const state = randomToken(24);
    const nonce = randomToken(24);
    await this.db.deleteFrom('lti_states').where('expires_at', '<', this.now()).execute();
    await this.db.insertInto('lti_states').values({ state, nonce, platform_id: platform.id, expires_at: this.now() + STATE_TTL }).execute();
    const q = new URLSearchParams({
      scope: 'openid',
      response_type: 'id_token',
      response_mode: 'form_post',
      prompt: 'none',
      client_id: platform.client_id,
      redirect_uri: `${this.urls.appUrl}/lti/launch`,
      login_hint: loginHint,
      state,
      nonce,
    });
    if (p.lti_message_hint) q.set('lti_message_hint', p.lti_message_hint);
    return platform.auth_url + (platform.auth_url.includes('?') ? '&' : '?') + q.toString();
  }

  /** Schritt 2: id_token prüfen, Person, Kurs und Link anlegen bzw. abgleichen. */
  async launch(p: Record<string, string | undefined>): Promise<LaunchResult> {
    const stateValue = p.state ?? '';
    const idToken = p.id_token ?? '';
    if (!stateValue || !idToken) throw new LtiError('state oder id_token fehlt');
    const state = await this.db.selectFrom('lti_states').selectAll().where('state', '=', stateValue).executeTakeFirst();
    if (!state) throw new LtiError('Unbekannter oder bereits verwendeter Start. Bitte die Aktivität in Moodle neu öffnen.');
    const del = await this.db.deleteFrom('lti_states').where('state', '=', stateValue).executeTakeFirst();
    if (Number(del.numDeletedRows) !== 1) throw new LtiError('Start bereits verwendet');
    if (Number(state.expires_at) < this.now()) throw new LtiError('Start abgelaufen. Bitte die Aktivität in Moodle neu öffnen.');
    const platform = await this.platformById(state.platform_id);
    if (!platform) throw new LtiError('Plattform nicht mehr eingetragen');

    let c: JWTPayload & Record<string, any>;
    try {
      const res = await jwtVerify(idToken, this.jwksFor(platform.jwks_url), {
        issuer: platform.issuer,
        audience: platform.client_id,
        clockTolerance: 60,
        currentDate: new Date(this.now()),
      });
      c = res.payload as JWTPayload & Record<string, any>;
    } catch (e) {
      throw new LtiError('id_token ungültig: ' + (e instanceof Error ? e.message : String(e)));
    }
    const aud = Array.isArray(c.aud) ? c.aud : [c.aud];
    if (aud.length > 1 && c.azp !== platform.client_id) throw new LtiError('azp passt nicht');
    if (!c.exp || !c.iat) throw new LtiError('exp/iat fehlt');
    if (c.nonce !== state.nonce) throw new LtiError('Nonce passt nicht');
    await this.consumeNonce(String(c.nonce), Number(c.exp) * 1000);
    if (c[C + 'deployment_id'] !== platform.deployment_id) throw new LtiError('Deployment passt nicht');
    if (c[C + 'message_type'] !== 'LtiResourceLinkRequest') throw new LtiError('Nachrichtentyp nicht unterstützt');
    if (c[C + 'version'] !== '1.3.0') throw new LtiError('LTI-Version nicht unterstützt');
    const sub = typeof c.sub === 'string' ? c.sub : '';
    if (!sub) throw new LtiError('Anonyme Starts werden nicht unterstützt');
    const resourceLink = c[C + 'resource_link']?.id;
    if (!resourceLink) throw new LtiError('resource_link fehlt');
    const ctxClaim = c[C + 'context'];
    if (!ctxClaim?.id) throw new LtiError('Collegare muss in einem Kurs gestartet werden');

    const role = mapRole(Array.isArray(c[C + 'roles']) ? c[C + 'roles'] : []);
    if (!role) throw new LtiError('Rolle im Kurs unbekannt (weder Lehrkraft noch Lernende)');
    const name = displayName(c);

    const user = await this.users.upsert(platform.issuer, sub, name, null);
    const school = await this.platformArea(platform);
    const contextId = await this.contexts.ltiCourse(platform.id, String(ctxClaim.id), String(ctxClaim.title ?? ctxClaim.label ?? ''), school);
    const nrps = c[NRPS_CLAIM]?.context_memberships_url;
    if (typeof nrps === 'string' && /^https?:\/\//.test(nrps)) await this.db.updateTable('contexts').set({ nrps_url: nrps.slice(0, 1024) }).where('id', '=', contextId).execute();
    await this.users.grant(user.id, contextId, role);
    const ags = c[AGS_CLAIM];
    const link = await this.upsertLink(platform.id, String(resourceLink), contextId, c[C + 'resource_link']?.title ?? null, typeof ags?.lineitem === 'string' ? ags.lineitem : null);

    // Lernende kommen in das verknüpfte Projekt, auch wenn die Lehrkraft die Liste noch nicht abgeglichen hat
    if (role === 'student' && link.project_id !== null) {
      const member = await this.db.selectFrom('group_members').select('user_id').where('project_id', '=', link.project_id).where('user_id', '=', user.id).executeTakeFirst();
      if (!member) await this.addToProject(link.project_id, user.id);
    }
    await this.audit.append({ actorId: user.id, action: 'auth.lti_launch', contextId, projectId: link.project_id ?? undefined, data: { platformId: platform.id, role, resourceLink } });
    return { userId: user.id, contextId, linkId: link.id, projectId: link.project_id, role, platformId: platform.id };
  }

  async link(id: number) {
    return this.db.selectFrom('lti_links').selectAll().where('id', '=', id).executeTakeFirst();
  }

  async setLinkProject(linkId: number, projectId: number): Promise<void> {
    await this.db.updateTable('lti_links').set({ project_id: projectId }).where('id', '=', linkId).execute();
  }

  /** Teilnehmende des Moodle-Kurses (NRPS). Liefert Lernende mit Moodle-ID und Name. */
  async roster(contextId: number): Promise<{ subject: string; name: string; role: 'teacher' | 'student' }[]> {
    const ctx = await this.contexts.get(contextId);
    if (!ctx?.nrps_url || !ctx.lti_platform_id) throw new LtiError('Für diesen Kurs liefert Moodle keine Teilnehmerliste. Bitte in Moodle beim Tool den Dienst „Names and Role Provisioning“ einschalten und Collegare einmal als Lehrkraft starten.');
    const platform = await this.platformById(ctx.lti_platform_id);
    if (!platform?.token_url) throw new LtiError('Für die Plattform fehlt die Token-URL (Seite „Moodle-Verbindung“)');
    const token = await this.accessToken(platform, ['https://purl.imsglobal.org/spec/lti-nrps/scope/contextmembership.readonly']);
    const out: { subject: string; name: string; role: 'teacher' | 'student' }[] = [];
    let url: string | null = ctx.nrps_url;
    for (let page = 0; url && page < 50; page++) {
      const res: Response = await this.fetchFn(url, { headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.ims.lti-nrps.v2.membershipcontainer+json' } });
      if (!res.ok) throw new LtiError(`Moodle hat die Teilnehmerliste verweigert (${res.status})`);
      const body = (await res.json()) as { members?: { user_id: string; name?: string; given_name?: string; family_name?: string; roles?: string[]; status?: string }[] };
      for (const m of body.members ?? []) {
        if (m.status && m.status !== 'Active') continue;
        const role = mapRole(m.roles ?? []);
        if (!role) continue;
        out.push({ subject: String(m.user_id), name: displayName(m), role });
      }
      url = nextLink(res.headers.get('link'));
    }
    return out;
  }

  /** Lernende aus Moodle in ein Projekt übernehmen; liefert die Zahl der neu hinzugekommenen. */
  async importRoster(projectId: number): Promise<{ added: number; total: number }> {
    const project = await this.db.selectFrom('projects').select(['context_id']).where('id', '=', projectId).executeTakeFirstOrThrow();
    const ctx = await this.contexts.get(project.context_id);
    if (!ctx?.lti_platform_id) throw new LtiError('Dieses Projekt gehört zu keinem Moodle-Kurs');
    const platform = await this.platformById(ctx.lti_platform_id);
    if (!platform) throw new LtiError('Plattform nicht mehr eingetragen');
    const members = await this.roster(project.context_id);
    let added = 0;
    let total = 0;
    for (const m of members) {
      const user = await this.users.upsert(platform.issuer, m.subject, m.name, null);
      await this.users.grant(user.id, project.context_id, m.role);
      if (m.role !== 'student') continue;
      total++;
      const has = await this.db.selectFrom('group_members').select('user_id').where('project_id', '=', projectId).where('user_id', '=', user.id).executeTakeFirst();
      if (!has) {
        await this.addToProject(projectId, user.id);
        added++;
      }
    }
    return { added, total };
  }

  /** Hook, den die Projekte setzen (vermeidet eine Kreisabhängigkeit). */
  addToProject: (projectId: number, userId: number) => Promise<void> = async () => {
    throw new Error('addToProject nicht verbunden');
  };

  private jwksFor(url: string) {
    let set = this.jwks.get(url);
    if (!set) this.jwks.set(url, (set = createRemoteJWKSet(new URL(url), { cooldownDuration: 30_000, cacheMaxAge: 10 * 60_000 })));
    return set;
  }

  private async consumeNonce(nonce: string, expMs: number) {
    await this.db.deleteFrom('lti_nonces').where('expires_at', '<', this.now()).execute();
    try {
      await this.db.insertInto('lti_nonces').values({ nonce, expires_at: Math.max(expMs, this.now()) + 3600_000 }).execute();
    } catch {
      throw new LtiError('Nonce wurde bereits verwendet');
    }
  }

  /** Je Plattform ein Schul-Kontext, unter dem die Moodle-Kurse liegen. */
  private async platformArea(platform: Platform): Promise<number> {
    const key = `lti_area_${platform.id}`;
    const row = await this.db.selectFrom('kv').select('v').where('k', '=', key).executeTakeFirst();
    if (row) return Number(row.v);
    const id = await this.contexts.create('school', await this.contexts.system(), platform.title || 'Moodle');
    await this.db.insertInto('kv').values({ k: key, v: String(id) }).execute();
    return id;
  }

  private async upsertLink(platformId: number, resourceLinkId: string, contextId: number, title: string | null, lineitem: string | null) {
    const found = await this.db.selectFrom('lti_links').selectAll().where('platform_id', '=', platformId).where('resource_link_id', '=', resourceLinkId).executeTakeFirst();
    if (found) {
      await this.db
        .updateTable('lti_links')
        .set({ title: title ?? found.title, ags_lineitem_url: lineitem ?? found.ags_lineitem_url, context_id: contextId })
        .where('id', '=', found.id)
        .execute();
      return { ...found, context_id: contextId };
    }
    const res = await this.db
      .insertInto('lti_links')
      .values({ platform_id: platformId, resource_link_id: resourceLinkId, context_id: contextId, project_id: null, title, ags_lineitem_url: lineitem, created_at: this.now() })
      .executeTakeFirstOrThrow();
    return { id: Number(res.insertId), platform_id: platformId, resource_link_id: resourceLinkId, context_id: contextId, project_id: null as number | null, title, ags_lineitem_url: lineitem, created_at: this.now() };
  }

  /** OAuth2 client_credentials mit signierter Client-Assertion (IMS Security Framework). */
  private async accessToken(platform: Platform, scopes: string[]): Promise<string> {
    const key = await this.keys.get();
    const now = Math.floor(this.now() / 1000);
    const assertion = await new SignJWT({})
      .setProtectedHeader({ alg: 'RS256', kid: key.kid, typ: 'JWT' })
      .setIssuer(platform.client_id)
      .setSubject(platform.client_id)
      .setAudience(platform.token_url!)
      .setIssuedAt(now)
      .setExpirationTime(now + 300)
      .setJti(randomToken(16))
      .sign(key.privateKey);
    const res = await this.fetchFn(platform.token_url!, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
        client_assertion: assertion,
        scope: scopes.join(' '),
      }).toString(),
    });
    if (!res.ok) throw new LtiError(`Moodle hat kein Zugriffstoken ausgegeben (${res.status}). Ist der Dienst beim Tool eingeschaltet?`);
    const body = (await res.json()) as { access_token?: string };
    if (!body.access_token) throw new LtiError('Antwort ohne access_token');
    return body.access_token;
  }
}

/** LTI-Rollen auf Collegare-Rollen; Plattform-Admins bekommen bewusst nur Lehrkraftrechte im Kurs. */
export function mapRole(roles: string[]): 'teacher' | 'student' | null {
  const short = roles.map((r) => String(r).replace(/^.*[#/]/, ''));
  if (short.some((r) => ['Instructor', 'TeachingAssistant', 'ContentDeveloper', 'Administrator'].includes(r))) return 'teacher';
  if (short.includes('Learner')) return 'student';
  return null;
}

function displayName(c: Record<string, unknown>): string {
  const n = typeof c.name === 'string' && c.name.trim() ? c.name.trim() : [c.given_name, c.family_name].filter((x) => typeof x === 'string' && x).join(' ');
  return (n || 'Person ohne Namen').slice(0, 120);
}

function nextLink(h: string | null): string | null {
  if (!h) return null;
  for (const part of h.split(',')) {
    const m = /<([^>]+)>\s*;\s*rel="?next"?/.exec(part);
    if (m) return m[1];
  }
  return null;
}
