/**
 * Collegare als Kontodienst (Konzept 8c): OpenID-Connect-Anbieter für angebundene Apps wie Autogra.fi.
 *
 * - Nur von der Administration eingetragene Clients (keine offene Registrierung), Geheimnis nur als Hash.
 * - Autorisierungscode mit PKCE (S256 Pflicht), einmal gültig, 60 s; Zugriffstoken 10 min, nur für /oidc/userinfo.
 * - Wenige Angaben: sub (feste Kennung), Name, Rollen. Keine E-Mail, keine Klassen (die kommen über die
 *   Dienstschnittstelle, Konzept 8a).
 * - Signatur mit dem Schlüssel aus ToolKeyStore (derselbe öffentliche Schlüssel wie /lti/jwks).
 */
import { SignJWT } from 'jose';
import { createHash, timingSafeEqual } from 'node:crypto';
import type { Db } from '../db/index.js';
import type { ToolKeyStore } from '../lti/toolKey.js';
import { randomToken, sha256 } from '../security/crypto.js';
import type { Users } from './users.js';
import type { Contexts } from './contexts.js';

const KEY = 'oidc_clients';
const CODE_MS = 60_000;
const ACCESS_MS = 10 * 60_000;
const ID_TOKEN_S = 5 * 60;

export interface OidcClient {
  clientId: string;
  title: string;
  secretHash: string;
  redirectUris: string[];
  createdAt: number;
}

export class OidcError extends Error {
  constructor(public code: string, message: string, public status = 400) {
    super(message);
  }
}

interface PendingCode {
  clientId: string;
  redirectUri: string;
  userId: number;
  nonce: string | null;
  challenge: string;
  scope: string;
  expires: number;
}

export interface AuthorizeParams {
  response_type?: string;
  client_id?: string;
  redirect_uri?: string;
  scope?: string;
  state?: string;
  nonce?: string;
  code_challenge?: string;
  code_challenge_method?: string;
}

export class OidcProvider {
  private codes = new Map<string, PendingCode>();
  private access = new Map<string, { userId: number; clientId: string; expires: number }>();

  constructor(private db: Db, private keys: ToolKeyStore, private users: Users, private contexts: Contexts, private issuer: string, private now: () => number = Date.now) {}

  // ---- Clients (Verwaltung) ----

  async clients(): Promise<OidcClient[]> {
    const row = await this.db.selectFrom('kv').select('v').where('k', '=', KEY).executeTakeFirst();
    try {
      return row ? (JSON.parse(row.v) as OidcClient[]) : [];
    } catch {
      return [];
    }
  }

  private async saveClients(list: OidcClient[]) {
    const v = JSON.stringify(list);
    const has = await this.db.selectFrom('kv').select('k').where('k', '=', KEY).executeTakeFirst();
    if (has) await this.db.updateTable('kv').set({ v }).where('k', '=', KEY).execute();
    else await this.db.insertInto('kv').values({ k: KEY, v }).execute();
  }

  /** Legt einen Client an; das Geheimnis wird nur jetzt einmal zurückgegeben. */
  async addClient(title: string, redirectUris: string[]): Promise<{ client: OidcClient; secret: string }> {
    for (const u of redirectUris) {
      let url: URL;
      try {
        url = new URL(u);
      } catch {
        throw new OidcError('invalid_request', `Keine gültige Adresse: ${u}`);
      }
      if (url.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(url.hostname)) throw new OidcError('invalid_request', 'Rücksprung-Adressen müssen mit https:// beginnen');
      if (url.hash) throw new OidcError('invalid_request', 'Rücksprung-Adressen dürfen kein # enthalten');
    }
    if (!redirectUris.length) throw new OidcError('invalid_request', 'Mindestens eine Rücksprung-Adresse');
    const secret = randomToken(32);
    const client: OidcClient = { clientId: 'app-' + randomToken(9), title: title.trim().slice(0, 80), secretHash: sha256(secret), redirectUris, createdAt: this.now() };
    await this.saveClients([...(await this.clients()), client]);
    return { client, secret };
  }

  async removeClient(clientId: string): Promise<void> {
    await this.saveClients((await this.clients()).filter((c) => c.clientId !== clientId));
  }

  async newSecret(clientId: string): Promise<string> {
    const list = await this.clients();
    const c = list.find((x) => x.clientId === clientId);
    if (!c) throw new OidcError('invalid_client', 'App nicht gefunden', 404);
    const secret = randomToken(32);
    c.secretHash = sha256(secret);
    await this.saveClients(list);
    return secret;
  }

  // ---- Protokoll ----

  discovery() {
    const i = this.issuer;
    return {
      issuer: i,
      authorization_endpoint: `${i}/oidc/authorize`,
      token_endpoint: `${i}/oidc/token`,
      userinfo_endpoint: `${i}/oidc/userinfo`,
      jwks_uri: `${i}/oidc/jwks`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code'],
      subject_types_supported: ['public'],
      id_token_signing_alg_values_supported: ['RS256'],
      scopes_supported: ['openid', 'profile'],
      token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'],
      code_challenge_methods_supported: ['S256'],
      claims_supported: ['sub', 'name', 'roles', 'nonce'],
    };
  }

  /** Prüft die Anfrage, bevor jemand angemeldet wird. Fehler mit gültiger Rücksprung-Adresse gehen dorthin zurück. */
  async check(p: AuthorizeParams): Promise<{ client: OidcClient; redirectUri: string }> {
    const client = (await this.clients()).find((c) => c.clientId === p.client_id);
    if (!client) throw new OidcError('invalid_client', 'Diese App ist in Collegare nicht eingetragen.');
    if (!p.redirect_uri || !client.redirectUris.includes(p.redirect_uri)) throw new OidcError('invalid_request', 'Die Rücksprung-Adresse ist für diese App nicht eingetragen.');
    return { client, redirectUri: p.redirect_uri };
  }

  /** Stellt den Code aus (Person ist angemeldet). Gibt die Rücksprung-Adresse zurück. */
  async authorize(p: AuthorizeParams, userId: number): Promise<string> {
    const { redirectUri } = await this.check(p);
    const back = new URL(redirectUri);
    if (p.state) back.searchParams.set('state', p.state);
    const fail = (error: string, description: string) => {
      back.searchParams.set('error', error);
      back.searchParams.set('error_description', description);
      return back.toString();
    };
    if (p.response_type !== 'code') return fail('unsupported_response_type', 'Nur response_type=code');
    if (!(p.scope ?? '').split(' ').includes('openid')) return fail('invalid_scope', 'scope muss openid enthalten');
    if (p.code_challenge_method !== 'S256' || !p.code_challenge || !/^[A-Za-z0-9_-]{43,128}$/.test(p.code_challenge)) return fail('invalid_request', 'PKCE mit S256 ist Pflicht');
    this.sweep();
    const code = randomToken(32);
    this.codes.set(sha256(code), { clientId: p.client_id!, redirectUri, userId, nonce: p.nonce ?? null, challenge: p.code_challenge, scope: p.scope ?? 'openid', expires: this.now() + CODE_MS });
    back.searchParams.set('code', code);
    return back.toString();
  }

  private async authClient(clientId: string | undefined, secret: string | undefined): Promise<OidcClient> {
    const c = (await this.clients()).find((x) => x.clientId === clientId);
    const a = Buffer.from(sha256(secret ?? ''));
    const b = Buffer.from(c?.secretHash ?? sha256('—'));
    if (!c || !secret || a.length !== b.length || !timingSafeEqual(a, b)) throw new OidcError('invalid_client', 'App-Anmeldung fehlgeschlagen', 401);
    return c;
  }

  async token(body: Record<string, string | undefined>, basic: { id: string; secret: string } | null) {
    const client = await this.authClient(basic?.id ?? body.client_id, basic?.secret ?? body.client_secret);
    if (body.grant_type !== 'authorization_code') throw new OidcError('unsupported_grant_type', 'Nur authorization_code');
    const key = sha256(body.code ?? '');
    const pending = this.codes.get(key);
    this.codes.delete(key); // einmal gültig, auch bei Fehlern
    if (!pending || pending.expires < this.now() || pending.clientId !== client.clientId) throw new OidcError('invalid_grant', 'Code ungültig oder abgelaufen');
    if (body.redirect_uri !== pending.redirectUri) throw new OidcError('invalid_grant', 'redirect_uri passt nicht');
    const verifier = body.code_verifier ?? '';
    const expected = createHash('sha256').update(verifier).digest('base64url');
    if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier) || expected !== pending.challenge) throw new OidcError('invalid_grant', 'PKCE-Prüfung fehlgeschlagen');

    const claims = await this.claims(pending.userId);
    const k = await this.keys.get();
    const now = Math.floor(this.now() / 1000);
    const idToken = await new SignJWT({ ...claims, ...(pending.nonce ? { nonce: pending.nonce } : {}) })
      .setProtectedHeader({ alg: 'RS256', kid: k.kid, typ: 'JWT' })
      .setIssuer(this.issuer)
      .setAudience(client.clientId)
      .setSubject(claims.sub)
      .setIssuedAt(now)
      .setExpirationTime(now + ID_TOKEN_S)
      .sign(k.privateKey);
    const accessToken = randomToken(32);
    this.access.set(sha256(accessToken), { userId: pending.userId, clientId: client.clientId, expires: this.now() + ACCESS_MS });
    return { access_token: accessToken, token_type: 'Bearer', expires_in: ACCESS_MS / 1000, id_token: idToken, scope: pending.scope };
  }

  async userinfo(accessToken: string) {
    const a = this.access.get(sha256(accessToken));
    if (!a || a.expires < this.now()) throw new OidcError('invalid_token', 'Zugriffstoken ungültig', 401);
    return this.claims(a.userId);
  }

  async jwks() {
    return { keys: [(await this.keys.get()).publicJwk] };
  }

  private async claims(userId: number) {
    const user = await this.users.byId(userId);
    if (!user) throw new OidcError('invalid_grant', 'Konto nicht gefunden');
    const sys = await this.contexts.system();
    const roles = await this.users.rolesIn(userId, sys);
    const teaches = await this.db.selectFrom('memberships').select('context_id').where('user_id', '=', userId).where('role', 'in', ['teacher', 'admin']).executeTakeFirst();
    const out: string[] = [];
    if (teaches) out.push('teacher');
    if (roles.has('admin')) out.push('admin');
    if (!out.length) out.push('student');
    return { sub: String(userId), name: user.name, roles: out };
  }

  private sweep() {
    const t = this.now();
    for (const [k, v] of this.codes) if (v.expires < t) this.codes.delete(k);
    for (const [k, v] of this.access) if (v.expires < t) this.access.delete(k);
  }
}
