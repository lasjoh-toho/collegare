import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { io as ioc, type Socket } from 'socket.io-client';
import type { AddressInfo } from 'node:net';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { checkMedia, moveBlobs } from '../src/pinnwand/media.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp, type App } from '../src/app.js';
import { createServices, type Services } from '../src/services.js';

// Oberfläche mit den Dateien von mod_pinnwand, die der Export der Präsentation braucht
const clientDir = mkdtempSync(join(tmpdir(), 'cg-client-'));
mkdirSync(join(clientDir, 'pinnwand/mod/pinnwand/js'), { recursive: true });
writeFileSync(join(clientDir, 'pinnwand/mod/pinnwand/js/presentation-player.js'), 'var PinnwandPresentation = {}; // "</script>" darf nicht durchkommen');
mkdirSync(join(clientDir, 'bento'), { recursive: true });
writeFileSync(join(clientDir, 'bento/Bento_Slides.bento.html'), '<!doctype html><html><head><title>Bento</title></head><body><script type="application/bento+json" id="bento-doc"></script></body></html>');
writeFileSync(join(clientDir, 'pinnwand/mod/pinnwand/strings.json'), JSON.stringify({ present_show: 'Einblenden', nothreadtoexport: 'Kein Faden' }));

let app: App;
let s: Services;
let base: string;
const sockets: Socket[] = [];

beforeEach(async () => {
  s = await createServices({ databaseUrl: 'sqlite::memory:', appUrl: 'http://localhost/collegare', cookieSecure: false, accessCodeDays: 14 });
  app = await buildApp({ services: s, clientDir });
  await app.http.listen({ port: 0, host: '127.0.0.1' });
  base = `http://127.0.0.1:${(app.http.server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  sockets.splice(0).forEach((x) => x.disconnect());
  await app.http.close();
});

type J = Record<string, any>;

async function call(method: string, path: string, token?: string, body?: unknown): Promise<{ status: number; json: J; cookie?: string | null }> {
  const res = await fetch(base + path, {
    method,
    headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: 'Bearer ' + token } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as J, cookie: res.headers.get('set-cookie') };
}

async function admin(): Promise<string> {
  const id = await s.accounts.create('admin', 'Admin', 'geheim-geheim');
  await s.users.grant(id, await s.contexts.system(), 'admin');
  return (await call('POST', '/api/auth/login', undefined, { login: 'admin', password: 'geheim-geheim' })).json.token;
}

/** Lehrkraft über die Verwaltung anlegen, anmelden, Kurs und Projekt mit drei Lernenden. */
async function setup() {
  const at = await admin();
  expect((await call('POST', '/api/admin/teachers', at, { login: 'mue', name: 'Frau Müller', password: 'passwort-123' })).status).toBe(200);
  const t = (await call('POST', '/api/auth/login', undefined, { login: 'MUE', password: 'passwort-123' })).json.token as string;
  const course = (await call('POST', '/api/courses', t, { title: 'S1 Geschichte' })).json.id as number;
  const project = (await call('POST', '/api/projects', t, { courseId: course, title: 'Weimarer Republik' })).json.id as number;
  const ids = (await call('POST', `/api/projects/${project}/students`, t, { names: ['Anna', 'Ben', 'Clara'] })).json.ids as number[];
  return { at, t, course, project, ids };
}

describe('Anmeldung', () => {
  it('meldet mit Kürzel und Passwort an, setzt das Cookie im Unterordner und meldet ab', async () => {
    await admin();
    const r = await call('POST', '/api/auth/login', undefined, { login: 'admin', password: 'geheim-geheim' });
    expect(r.status).toBe(200);
    expect(r.cookie).toMatch(/cg_session=.*Path=\/collegare/);
    expect(r.cookie).toMatch(/HttpOnly/);
    const me = await call('GET', '/api/me', r.json.token);
    expect(me.json).toMatchObject({ name: 'Admin', admin: true, projectId: null });
    await call('POST', '/api/auth/logout', r.json.token);
    expect((await call('GET', '/api/me', r.json.token)).status).toBe(401);
  });

  it('Startseite erfährt ohne Anmeldung, ob das offene Office angeboten wird', async () => {
    expect((await call('GET', '/api/public')).json).toMatchObject({ openOffice: false });
    await s.frame.set({ ...(await s.frame.get()), openOffice: true });
    expect((await call('GET', '/api/public')).json).toMatchObject({ openOffice: true });
  });

  it('Kontodienst: Autogra.fi meldet sich per OpenID Connect mit PKCE an', async () => {
    const { at, t: teacherToken } = await setup();
    const disc = (await call('GET', '/.well-known/openid-configuration')).json;
    expect(disc.issuer).toBe('http://localhost/collegare');
    expect(disc.code_challenge_methods_supported).toEqual(['S256']);
    expect((await call('POST', '/api/admin/apps', teacherToken, { title: 'X', redirectUris: ['https://a.example/cb'] })).status).toBe(403);
    expect((await call('POST', '/api/admin/apps', at, { title: 'Autogra.fi', redirectUris: ['http://evil.example/cb'] })).status).toBe(400);
    const reg = (await call('POST', '/api/admin/apps', at, { title: 'Autogra.fi', redirectUris: ['https://autografi.example/oidc/callback'] })).json;
    const cid = reg.app.clientId as string;
    const { createHash } = await import('node:crypto');
    const verifier = 'v'.repeat(50);
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const q = new URLSearchParams({ response_type: 'code', client_id: cid, redirect_uri: 'https://autografi.example/oidc/callback', scope: 'openid profile', state: 'st1', nonce: 'n1', code_challenge: challenge, code_challenge_method: 'S256' });
    const get = (token?: string, query = q) => fetch(`${base}/oidc/authorize?${query}`, { redirect: 'manual', headers: token ? { authorization: 'Bearer ' + token } : {} });

    // ohne Anmeldung: zur Startseite mit Rücksprung
    let r = await get();
    expect(r.status).toBe(302);
    expect(r.headers.get('location')).toMatch(/^http:\/\/localhost\/collegare\/\?weiter=%2Foidc%2Fauthorize%3F/);
    // fremde Rücksprung-Adresse: Fehlerseite, keine Weiterleitung
    const bad = new URLSearchParams(q);
    bad.set('redirect_uri', 'https://evil.example/cb');
    expect((await get(teacherToken, bad)).status).toBe(400);

    r = await get(teacherToken);
    const back = new URL(r.headers.get('location')!);
    expect(back.origin + back.pathname).toBe('https://autografi.example/oidc/callback');
    expect(back.searchParams.get('state')).toBe('st1');
    const code = back.searchParams.get('code')!;

    const tok = async (body: Record<string, string>) => {
      const res = await fetch(`${base}/oidc/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body).toString() });
      return { status: res.status, json: (await res.json()) as J };
    };
    const ok = { grant_type: 'authorization_code', code, redirect_uri: 'https://autografi.example/oidc/callback', client_id: cid, client_secret: reg.secret, code_verifier: verifier };
    expect((await tok({ ...ok, client_secret: 'falsch' })).status).toBe(401);
    const res = await tok(ok);
    expect(res.status).toBe(200);
    const { jwtVerify, createLocalJWKSet } = await import('jose');
    const jwks = (await call('GET', '/oidc/jwks')).json;
    const { payload } = await jwtVerify(res.json.id_token, createLocalJWKSet(jwks as any), { issuer: 'http://localhost/collegare', audience: cid });
    expect(payload).toMatchObject({ name: 'Frau Müller', roles: ['teacher'], nonce: 'n1' });
    const info = await fetch(`${base}/oidc/userinfo`, { headers: { authorization: 'Bearer ' + res.json.access_token } });
    expect(await info.json()).toMatchObject({ sub: payload.sub, name: 'Frau Müller' });
    // Code nur einmal gültig
    expect((await tok(ok)).json.error).toBe('invalid_grant');

    // falscher PKCE-Verifier
    const back2 = new URL((await get(teacherToken)).headers.get('location')!);
    expect((await tok({ ...ok, code: back2.searchParams.get('code')!, code_verifier: 'w'.repeat(50) })).json.error).toBe('invalid_grant');
  });

  it('Lehrende: Projektzahl, Löschen nur ohne Projekte und nie das eigene Konto', async () => {
    const { at, project } = await setup();
    const list = (await call('GET', '/api/admin/teachers', at)).json.teachers as J[];
    const mue = list.find((x) => x.login === 'mue')!;
    expect(mue.projects).toBe(1);
    expect((await call('DELETE', `/api/admin/teachers/${mue.id}`, at)).status).toBe(409);
    const self = list.find((x) => x.login === 'admin')!;
    expect((await call('DELETE', `/api/admin/teachers/${self.id}`, at)).status).toBe(400);
    await s.db.updateTable('projects').set({ archived_at: Date.now() }).where('id', '=', project).execute();
    expect((await call('DELETE', `/api/admin/teachers/${mue.id}`, at)).status).toBe(200);
    expect((await call('POST', '/api/auth/login', undefined, { login: 'mue', password: 'passwort-123' })).status).toBe(401);
  });

  it('Administration legt selbst Kurs und Projekt an (eigener Bereich beim ersten Mal)', async () => {
    const { at } = await setup();
    const c1 = await call('POST', '/api/courses', at, { title: 'Admin-Kurs' });
    expect(c1.status).toBe(200);
    const c2 = await call('POST', '/api/courses', at, { title: 'Zweiter Kurs' });
    expect(c2.status).toBe(200);
    const courses = (await call('GET', '/api/courses', at)).json.courses as J[];
    expect(courses.map((c) => c.title)).toEqual(expect.arrayContaining(['Admin-Kurs', 'Zweiter Kurs']));
    const p = await call('POST', '/api/projects', at, { courseId: c1.json.id, title: 'Admin-Projekt' });
    expect(p.status).toBe(200);
    expect((await call('GET', '/api/me', at)).json).toMatchObject({ admin: true, teacher: true });
  });

  it('Lehrkraft nur mit Kurs (z. B. aus Moodle) bekommt beim ersten eigenen Kurs einen Bereich', async () => {
    const { course } = await setup();
    const id = await s.accounts.create('moo', 'Herr Moodle', 'passwort-123');
    await s.users.grant(id, course, 'teacher');
    const t = (await call('POST', '/api/auth/login', undefined, { login: 'moo', password: 'passwort-123' })).json.token as string;
    expect((await call('POST', '/api/courses', t, { title: 'Eigener Kurs' })).status).toBe(200);
    const sid = await s.accounts.create('lern', 'Lernende', 'passwort-123');
    const st = (await call('POST', '/api/auth/login', undefined, { login: 'lern', password: 'passwort-123' })).json.token as string;
    expect((await call('POST', '/api/courses', st, { title: 'Nein' })).status).toBe(403);
    expect(sid).toBeGreaterThan(0);
  });

  it('Material: Lehrkraft veröffentlicht Link und Datei, Lernende lesen, Fremde nicht', async () => {
    const { t, project, ids } = await setup();
    expect((await call('POST', `/api/projects/${project}/materials`, t, { kind: 'video', title: 'Einführung', url: 'https://www.youtube.com/watch?v=abc' })).status).toBe(200);
    expect((await call('POST', `/api/projects/${project}/materials`, t, { kind: 'link', url: 'javascript:alert(1)' })).status).toBe(400);
    const pdf = Buffer.from('%PDF-1.4 Testdatei');
    const up = await fetch(`${base}/api/projects/${project}/materials/file?name=${encodeURIComponent('Quelle 1.pdf')}&title=Quelle`, { method: 'POST', headers: { authorization: 'Bearer ' + t, 'content-type': 'application/octet-stream' }, body: pdf });
    expect(up.status).toBe(200);
    const fid = ((await up.json()) as J).id;
    const bad = await fetch(`${base}/api/projects/${project}/materials/file?name=x.html`, { method: 'POST', headers: { authorization: 'Bearer ' + t, 'content-type': 'application/octet-stream' }, body: Buffer.from('<script>') });
    expect(bad.status).toBe(400);
    const codes = (await call('POST', `/api/projects/${project}/access-codes`, t, { userIds: [ids[0]] })).json.codes as J[];
    const anna = (await call('POST', '/api/access/redeem', undefined, { code: codes[0].code })).json.token as string;
    const list = await call('GET', `/api/projects/${project}/materials`, anna);
    expect(list.json).toMatchObject({ canEdit: false, materials: [{ kind: 'video', title: 'Einführung' }, { kind: 'file', title: 'Quelle', fileName: 'Quelle 1.pdf' }] });
    const f = await fetch(`${base}/api/projects/${project}/materials/${fid}/datei`, { headers: { authorization: 'Bearer ' + anna } });
    expect(f.headers.get('content-type')).toBe('application/pdf');
    expect(Buffer.from(await f.arrayBuffer()).toString()).toBe('%PDF-1.4 Testdatei');
    const part = await fetch(`${base}/api/projects/${project}/materials/${fid}/datei`, { headers: { authorization: 'Bearer ' + anna, range: 'bytes=0-3' } });
    expect(part.status).toBe(206);
    expect(await part.text()).toBe('%PDF');
    expect((await call('POST', `/api/projects/${project}/materials`, anna, { kind: 'link', url: 'https://example.org' })).status).toBe(403);
    // Lernseite: anlegen, ändern, lesen
    const pg = await call('POST', `/api/projects/${project}/materials/page`, t, { title: 'Die Inflation 1923', body: '# Einstieg\n\nText^[Randnotiz]' });
    expect(pg.status).toBe(200);
    expect((await call('PATCH', `/api/projects/${project}/materials/${pg.json.id}`, t, { body: 'Neu' })).status).toBe(200);
    expect((await call('GET', `/api/projects/${project}/materials/${pg.json.id}`, anna)).json).toMatchObject({ canEdit: false, page: { title: 'Die Inflation 1923', body: 'Neu' } });
    expect((await call('PATCH', `/api/projects/${project}/materials/${pg.json.id}`, anna, { body: 'x' })).status).toBe(403);
    // unsichtbar vorbereiten: Lernende sehen es weder in der Liste noch direkt, bis es freigegeben ist
    const hid = await call('POST', `/api/projects/${project}/materials/page`, t, { title: 'Entwurf', body: 'geheim', visible: false });
    expect((await call('GET', `/api/projects/${project}/materials`, anna)).json.materials.some((m: J) => m.title === 'Entwurf')).toBe(false);
    expect((await call('GET', `/api/projects/${project}/materials/${hid.json.id}`, anna)).status).toBe(404);
    expect((await call('GET', `/api/projects/${project}/materials`, t)).json.materials.find((m: J) => m.title === 'Entwurf')).toMatchObject({ visible: false });
    const hf = await fetch(`${base}/api/projects/${project}/materials/file?name=x.pdf&sichtbar=0`, { method: 'POST', headers: { authorization: 'Bearer ' + t, 'content-type': 'application/octet-stream' }, body: pdf });
    expect((await fetch(`${base}/api/projects/${project}/materials/${((await hf.json()) as J).id}/datei`, { headers: { authorization: 'Bearer ' + anna } })).status).toBe(404);
    expect((await call('PATCH', `/api/projects/${project}/materials/${hid.json.id}`, t, { visible: true })).status).toBe(200);
    expect((await call('GET', `/api/projects/${project}/materials/${hid.json.id}`, anna)).json).toMatchObject({ page: { title: 'Entwurf' } });
    // ohne Anmeldung nichts
    expect((await fetch(`${base}/api/projects/${project}/materials/${fid}/datei`)).status).toBe(401);
  });

  it('Werkstatt: eigene Materialien mit Schlagworten, als Kopie für eine Gruppe oder Einzelne ins Projekt übernehmen', async () => {
    const { at, t, project, ids } = await setup();
    const w = (await call('GET', '/api/werkstatt', t)).json.projectId as number;
    expect((await call('GET', '/api/werkstatt', t)).json.projectId).toBe(w);
    // erscheint in keiner Projektliste und zählt nicht als offenes Projekt
    expect((await call('GET', '/api/projects', t)).json.projects.map((p: J) => p.id)).toEqual([project]);
    expect((await call('GET', '/api/admin/teachers', at)).json.teachers.find((x: J) => x.name === 'Frau Müller').projects).toBe(1);
    // die Administration sieht fremde Werkstätten nicht
    expect((await call('GET', `/api/projects/${w}/materials`, at)).status).toBe(404);
    const pg = (await call('POST', `/api/projects/${w}/materials/page`, t, { title: 'Quellenarbeit', body: 'Text' })).json.id;
    expect((await call('PATCH', `/api/projects/${w}/materials/${pg}`, t, { tags: ['Einführung', ' Quellen ', 'Einführung'] })).status).toBe(200);
    expect((await call('GET', `/api/projects/${w}/materials`, t)).json.materials[0]).toMatchObject({ title: 'Quellenarbeit', tags: ['Einführung', 'Quellen'], audience: null });
    const ziele = (await call('GET', '/api/werkstatt/ziele', t)).json.projects;
    expect(ziele.map((p: J) => p.id)).toEqual([project]);
    const g1 = (await call('POST', `/api/projects/${project}/groups`, t, { title: 'A' })).json.id;
    await call('POST', `/api/projects/${project}/moves`, t, { userId: ids[0], groupId: g1, position: 0 });
    const cp = await call('POST', `/api/projects/${w}/materials/${pg}/kopieren`, t, { to: project, visible: true, audience: { groups: [g1], users: [ids[2], 99999] } });
    expect(cp.status).toBe(200);
    const inProject = (await call('GET', `/api/projects/${project}/materials`, t)).json.materials[0];
    expect(inProject).toMatchObject({ title: 'Quellenarbeit', sourceId: pg, audience: { groups: [g1], users: [ids[2]] } });
    const codes = (await call('POST', `/api/projects/${project}/access-codes`, t, { userIds: ids })).json.codes as J[];
    const tok = async (i: number) => (await call('POST', '/api/access/redeem', undefined, { code: codes[i].code })).json.token as string;
    const [anna, ben, clara] = [await tok(0), await tok(1), await tok(2)];
    expect((await call('GET', `/api/projects/${project}/materials`, anna)).json.materials).toHaveLength(1);
    expect((await call('GET', `/api/projects/${project}/materials`, ben)).json.materials).toHaveLength(0);
    expect((await call('GET', `/api/projects/${project}/materials/${cp.json.id}`, ben)).status).toBe(404);
    expect((await call('GET', `/api/projects/${project}/materials/${cp.json.id}`, clara)).json.page).toMatchObject({ body: 'Text' });
    // Lernende kommen nicht in die Werkstatt, und ins fremde Projekt kopiert niemand
    expect((await call('GET', `/api/projects/${w}/materials`, anna)).status).toBe(403);
    expect((await call('POST', `/api/projects/${w}/materials/${pg}/kopieren`, t, { to: w + 1000 })).status).toBe(403);
    // für alle: Auswahl leeren
    expect((await call('PATCH', `/api/projects/${project}/materials/${cp.json.id}`, t, { audience: null })).status).toBe(200);
    expect((await call('GET', `/api/projects/${project}/materials`, ben)).json.materials).toHaveLength(1);
  });

  it('sperrt nach zu vielen Fehlversuchen', async () => {
    await admin();
    for (let i = 0; i < 10; i++) expect((await call('POST', '/api/auth/login', undefined, { login: 'admin', password: 'falsch' })).status).toBe(401);
    expect((await call('POST', '/api/auth/login', undefined, { login: 'admin', password: 'geheim-geheim' })).status).toBe(429);
  });

  it('Verwaltung nur für Administration', async () => {
    const { t } = await setup();
    expect((await call('GET', '/api/admin/teachers', t)).status).toBe(403);
    expect((await call('GET', '/api/admin/teachers')).status).toBe(401);
  });

  it('Ansehen als Lehrkraft ist als solches erkennbar', async () => {
    const { at } = await setup();
    const list = (await call('GET', '/api/admin/teachers', at)).json.teachers as J[];
    const mue = list.find((x) => x.login === 'mue')!;
    const res = await fetch(`${base}/api/admin/teachers/${mue.id}/impersonate`, { method: 'POST', headers: { authorization: 'Bearer ' + at } });
    const token = /cg_session=([^;]+)/.exec(res.headers.get('set-cookie') ?? '')![1];
    const me = await call('GET', '/api/me', token);
    expect(me.json).toMatchObject({ name: 'Frau Müller', impersonated: true, teacher: true });
    // zurück zur Administration; die fremde Sitzung ist danach ungültig
    const back = await call('POST', '/api/auth/unimpersonate', token);
    expect(back.status).toBe(200);
    expect((await call('GET', '/api/me', back.json.token)).json).toMatchObject({ admin: true, impersonated: false });
    expect((await call('GET', '/api/me', token)).status).toBe(401);
    expect((await call('POST', '/api/auth/unimpersonate', at)).status).toBe(400);
  });
});

describe('Projekte und Kanban', () => {
  it('Lehrkraft bildet Gruppen, verschiebt Lernende und vergibt Rollen', async () => {
    const { t, project, ids } = await setup();
    const g1 = (await call('POST', `/api/projects/${project}/groups`, t, { title: 'Inflation 1923' })).json.id;
    const g2 = (await call('POST', `/api/projects/${project}/groups`, t, { title: '' })).json.id;
    expect((await call('POST', `/api/projects/${project}/moves`, t, { userId: ids[0], groupId: g1, position: 0 })).status).toBe(200);
    await call('POST', `/api/projects/${project}/moves`, t, { userId: ids[1], groupId: g1, position: 0 });
    await call('POST', `/api/projects/${project}/moves`, t, { userId: ids[2], groupId: g2, position: 0 });
    await call('POST', `/api/projects/${project}/roles`, t, { userId: ids[0], label: 'Zeitwächterin' });
    const p = (await call('GET', `/api/projects/${project}`, t)).json;
    expect(p.role).toBe('teacher');
    const inG1 = p.board.members.filter((m: J) => m.groupId === g1).sort((a: J, b: J) => a.position - b.position);
    expect(inG1.map((m: J) => m.name)).toEqual(['Ben', 'Anna']);
    expect(inG1[1].roleLabel).toBe('Zeitwächterin');
    // Gruppe löschen: Mitglieder zurück in den Pool
    await call('DELETE', `/api/projects/${project}/groups/${g2}`, t);
    const b = (await call('GET', `/api/projects/${project}`, t)).json.board;
    expect(b.members.find((m: J) => m.userId === ids[2]).groupId).toBeNull();
    expect(b.groups.map((g: J) => g.id)).toEqual([g1]);
  });

  it('Zugangscode bindet die Sitzung an das Projekt; Lernende setzen nur das eigene Thema', async () => {
    const { t, project, ids } = await setup();
    const g1 = (await call('POST', `/api/projects/${project}/groups`, t, {})).json.id;
    const g2 = (await call('POST', `/api/projects/${project}/groups`, t, {})).json.id;
    await call('POST', `/api/projects/${project}/moves`, t, { userId: ids[0], groupId: g1, position: 0 });
    await call('POST', `/api/projects/${project}/moves`, t, { userId: ids[1], groupId: g2, position: 0 });
    const codes = (await call('POST', `/api/projects/${project}/access-codes`, t, { userIds: [ids[0], ids[1]] })).json;
    expect(codes.codes[0].url).toMatch(/^http:\/\/localhost\/collegare\/zugang#k=/);
    expect(codes.codes[0].code).toMatch(/^[A-Z2-9]{6}$/);

    const anna = (await call('POST', '/api/access/redeem', undefined, { code: codes.codes[0].code.toLowerCase() })).json;
    expect(anna).toMatchObject({ ok: true, projectId: project, name: 'Anna' });
    const ben = (await call('POST', '/api/access/redeem', undefined, { secret: codes.codes[1].secret })).json;
    expect(ben.name).toBe('Ben');

    // Anna sieht das Projekt als Lernende, aber keine Verwaltung
    const view = (await call('GET', `/api/projects/${project}`, anna.token)).json;
    expect(view).toMatchObject({ role: 'student', myGroupId: g1 });
    expect(view.codesValidUntil).toBeUndefined();
    expect((await call('POST', `/api/projects/${project}/moves`, anna.token, { userId: ids[0], groupId: g2, position: 0 })).status).toBe(403);
    expect((await call('POST', `/api/projects/${project}/access-codes`, anna.token, { userIds: [ids[1]] })).status).toBe(403);
    expect((await call('GET', '/api/admin/teachers', anna.token)).status).toBe(403);

    expect((await call('PATCH', `/api/projects/${project}/groups/${g1}`, anna.token, { title: 'Hyperinflation' })).status).toBe(200);
    expect((await call('PATCH', `/api/projects/${project}/groups/${g2}`, anna.token, { title: 'Fremd' })).status).toBe(403);
    expect((await call('POST', `/api/projects/${project}/roles`, anna.token, { userId: ids[1], label: 'X' })).status).toBe(403);
    // Lehrkraft schaltet das Themensetzen ab
    await call('PATCH', `/api/projects/${project}`, t, { settings: { studentsSetTopic: false } });
    expect((await call('PATCH', `/api/projects/${project}/groups/${g1}`, anna.token, { title: 'Doch anders' })).status).toBe(403);

    // gesperrte Codes gehen nicht mehr
    await call('POST', `/api/projects/${project}/access-codes/revoke`, t, {});
    expect((await call('POST', '/api/access/redeem', undefined, { code: codes.codes[0].code })).status).toBe(404);
  });

  it('Zugangscodes: Ende mit Uhrzeit oder solange das Projekt freigegeben ist', async () => {
    const { t, project, ids } = await setup();
    const at = Date.now() + 3 * 3600_000;
    const timed = (await call('POST', `/api/projects/${project}/access-codes`, t, { userIds: [ids[0]], until: at })).json.codes[0];
    expect(timed).toMatchObject({ expiresAt: at, followRelease: false });
    expect((await call('POST', `/api/projects/${project}/access-codes`, t, { userIds: [ids[0]], until: Date.now() - 1000 })).status).toBe(400);

    const phases = (await call('GET', `/api/projects/${project}`, t)).json.settings.phases;
    const end = Date.now() + 5 * 86_400_000;
    const scheduled = Object.fromEntries(Object.keys(phases).map((k) => [k, { state: k === 'research' ? 'scheduled' : 'off', from: null, to: k === 'research' ? end : null }]));
    await call('PATCH', `/api/projects/${project}`, t, { settings: { phases: scheduled } });
    const rel = (await call('POST', `/api/projects/${project}/access-codes`, t, { userIds: [ids[1]], release: true })).json.codes[0];
    expect(rel).toMatchObject({ expiresAt: end, followRelease: true });
    const view = (await call('GET', `/api/projects/${project}`, t)).json;
    expect(view.codesFollowRelease).toEqual([ids[1]]);
    expect(view.codesValidUntil[ids[1]]).toBe(end);

    // Lehrkraft verlängert die Phase: der Code zieht mit
    const later = end + 2 * 86_400_000;
    await call('PATCH', `/api/projects/${project}`, t, { settings: { phases: { ...scheduled, research: { state: 'scheduled', from: null, to: later } } } });
    expect((await call('GET', `/api/projects/${project}`, t)).json.codesValidUntil[ids[1]]).toBe(later);
    // alles geschlossen: Code gilt nicht mehr; wieder freigegeben: gilt wieder
    await call('PATCH', `/api/projects/${project}`, t, { settings: { phases: { ...scheduled, research: { state: 'closed', from: null, to: null } } } });
    expect((await call('POST', '/api/access/redeem', undefined, { code: rel.code })).status).toBe(404);
    await call('PATCH', `/api/projects/${project}`, t, { settings: { phases: { ...scheduled, research: { state: 'on', from: null, to: null } } } });
    expect((await call('POST', '/api/access/redeem', undefined, { code: rel.code })).status).toBe(200);
    expect((await call('GET', `/api/projects/${project}`, t)).json.codesValidUntil[ids[1]]).toBeGreaterThan(Date.now() + 170 * 86_400_000);
    // der Code mit fester Uhrzeit bleibt unberührt
    expect((await call('GET', `/api/projects/${project}`, t)).json.codesValidUntil[ids[0]]).toBe(at);
  });

  it('Korrektur: Übersicht nach Gruppen, Note je Person, nur für Lehrkräfte', async () => {
    const { t, project, ids } = await setup();
    const g1 = (await call('POST', `/api/projects/${project}/groups`, t, {})).json.id;
    await call('POST', `/api/projects/${project}/moves`, t, { userId: ids[0], groupId: g1, position: 0 });
    await call('POST', `/api/projects/${project}/moves`, t, { userId: ids[1], groupId: g1, position: 1 });
    const o = (await call('GET', `/api/projects/${project}/korrektur`, t)).json;
    expect(o.scopes).toHaveLength(1);
    expect(o.scopes[0].people.map((p: J) => p.name)).toEqual(['Anna', 'Ben']);
    expect(o.scopes[0].products.map((p: J) => [p.key, p.state])).toEqual([['map', 'missing'], ['outline', 'missing']]);
    expect(o.unassigned.map((p: J) => p.name)).toEqual(['Clara']);

    expect((await call('PUT', `/api/projects/${project}/gradings/${ids[0]}`, t, { points: 16 })).status).toBe(400);
    const g = (await call('PUT', `/api/projects/${project}/gradings/${ids[0]}`, t, { points: 12, feedback: '<p>Gut</p>', notes: 'privat' })).json.grading;
    expect(g).toMatchObject({ points: 12, final: false });
    await call('PUT', `/api/projects/${project}/gradings/${ids[0]}`, t, { final: true });
    const o2 = (await call('GET', `/api/projects/${project}/korrektur`, t)).json;
    expect(o2.gradings[ids[0]]).toMatchObject({ points: 12, feedback: '<p>Gut</p>', notes: 'privat', final: true });
    expect(o2.gradings[ids[1]]).toBeUndefined();
    expect((await call('PUT', `/api/projects/${project}/gradings/999`, t, { points: 3 })).status).toBe(404);

    const code = (await call('POST', `/api/projects/${project}/access-codes`, t, { userIds: [ids[0]] })).json.codes[0].code;
    const anna = (await call('POST', '/api/access/redeem', undefined, { code })).json.token;
    expect((await call('GET', `/api/projects/${project}/korrektur`, anna)).status).toBe(403);
    expect((await call('PUT', `/api/projects/${project}/gradings/${ids[0]}`, anna, { points: 15 })).status).toBe(403);
  });

  it('fremde Lehrkraft und fremdes Projekt bleiben unsichtbar', async () => {
    const { at, project } = await setup();
    await call('POST', '/api/admin/teachers', at, { login: 'sch', name: 'Herr Schulz', password: 'passwort-456' });
    const t2 = (await call('POST', '/api/auth/login', undefined, { login: 'sch', password: 'passwort-456' })).json.token;
    expect((await call('GET', `/api/projects/${project}`, t2)).status).toBe(404);
    expect((await call('GET', '/api/projects', t2)).json.projects).toEqual([]);
  });

  it('Einzelbetrieb: jede Person bekommt eine eigene Karte', async () => {
    const { t, course } = await setup();
    const p = (await call('POST', '/api/projects', t, { courseId: course, title: 'Facharbeit', mode: 'single' })).json.id;
    await call('POST', `/api/projects/${p}/students`, t, { names: ['Dora', 'Emil'] });
    const b = (await call('GET', `/api/projects/${p}`, t)).json.board;
    expect(b.groups).toHaveLength(2);
    expect(new Set(b.members.map((m: J) => m.groupId)).size).toBe(2);
  });

  it('Board-Änderungen kommen in Echtzeit an', async () => {
    const { t, project, ids } = await setup();
    const sock = ioc(base + '/project', { path: '/socket.io', auth: { token: t }, transports: ['websocket'], forceNew: true });
    sockets.push(sock);
    const boards: J[] = [];
    sock.on('board', (b: J) => boards.push(b));
    const ack = await new Promise<J>((r) => sock.emit('join', project, r));
    expect(ack.ok).toBe(true);
    const g = (await call('POST', `/api/projects/${project}/groups`, t, { title: 'Neu' })).json.id;
    await call('POST', `/api/projects/${project}/moves`, t, { userId: ids[2], groupId: g, position: 0 });
    await new Promise((r) => setTimeout(r, 100));
    const last = boards.at(-1)!;
    expect(last.members.find((m: J) => m.userId === ids[2]).groupId).toBe(g);

    const bad = ioc(base + '/project', { path: '/socket.io', auth: { token: 'falsch' }, transports: ['websocket'], forceNew: true });
    sockets.push(bad);
    const err = await new Promise<Error>((r) => bad.on('connect_error', r));
    expect(err.message).toBe('Bitte anmelden');
  });

  it('Editor-Verbindung braucht eine Sitzung und ein Dokument der eigenen Gruppe', async () => {
    const { t } = await setup();
    const anon = ioc(base + '/collab', { path: '/socket.io', query: { docId: 'cg1', userId: 'gefälscht' }, transports: ['websocket'], forceNew: true });
    sockets.push(anon);
    expect((await new Promise<Error>((r) => anon.on('connect_error', r))).message).toMatch(/Nicht angemeldet/);
    // beliebige Dokument-IDs gibt es nicht mehr
    const other = ioc(base + '/collab', { path: '/socket.io', query: { docId: 'x' }, auth: { token: t }, transports: ['websocket'], forceNew: true });
    sockets.push(other);
    expect((await new Promise<Error>((r) => other.on('connect_error', r))).message).toMatch(/kein Zugriff/);
  });

  it('Protokollkette bleibt unversehrt', async () => {
    await setup();
    expect(await s.audit.verify()).toEqual({ ok: true });
    await s.db.updateTable('audit_log').set({ action: 'manipuliert' }).where('id', '=', 2).execute();
    expect((await s.audit.verify()).ok).toBe(false);
  });
});

describe('Mindmap in Echtzeit', () => {
  const emit = (sock: Socket, ev: string, msg: unknown) => new Promise<J>((r) => sock.emit(ev, msg, r));
  const connect = (token: string) => {
    const sock = ioc(base + '/project', { path: '/socket.io', auth: { token }, transports: ['websocket'], forceNew: true });
    sockets.push(sock);
    return sock;
  };

  it('nur die eigene Gruppe und die Lehrkraft, Änderungen kommen bei allen an', async () => {
    const { t, project, ids } = await setup();
    const g1 = (await call('POST', `/api/projects/${project}/groups`, t, { title: 'Inflation' })).json.id;
    const g2 = (await call('POST', `/api/projects/${project}/groups`, t, { title: 'Kultur' })).json.id;
    await call('POST', `/api/projects/${project}/moves`, t, { userId: ids[0], groupId: g1, position: 0 });
    await call('POST', `/api/projects/${project}/moves`, t, { userId: ids[1], groupId: g1, position: 1 });
    await call('POST', `/api/projects/${project}/moves`, t, { userId: ids[2], groupId: g2, position: 0 });
    const codes = (await call('POST', `/api/projects/${project}/access-codes`, t, { userIds: [ids[0], ids[2]] })).json.codes as J[];
    const anna = (await call('POST', '/api/access/redeem', undefined, { code: codes[0].code })).json.token as string;
    const clara = (await call('POST', '/api/access/redeem', undefined, { code: codes[1].code })).json.token as string;

    const sa = connect(anna);
    const joined = await emit(sa, 'map:join', { projectId: project });
    expect(joined).toMatchObject({ ok: true, role: 'student', scope: 'g' + g1, scopes: [{ scope: 'p' }, { scope: 'g' + g1, title: 'Inflation' }] });
    expect((joined.people as J[]).map((p) => p.name).sort()).toEqual(['Anna', 'Ben']);

    const st = connect(t);
    const tj = await emit(st, 'map:join', { projectId: project, scope: 'g' + g1 });
    // Thema, zwei Gruppen und der Testbereich der Lehrkraft (für Lernende unsichtbar, siehe oben)
    expect(tj.scopes).toHaveLength(4);
    expect(tj.scopes[3]).toMatchObject({ scope: expect.stringMatching(/^t\d+$/), title: expect.stringContaining('Test / Demo') });
    const seen = new Promise<J>((r) => st.on('map', r));

    const ok = await emit(sa, 'map:op', { projectId: project, scope: 'g' + g1, op: { type: 'add', card: { id: 'karte1', kind: 'card', title: 'Hyperinflation', x: 10, y: 10, w: 160, h: 90, owner: ids[1] } } });
    expect(ok).toMatchObject({ ok: true, version: 1 });
    const m = await seen;
    expect(m.map.cards.karte1).toMatchObject({ title: 'Hyperinflation', owner: ids[1] });

    // Clara (andere Gruppe) darf weder sehen noch ändern; Person außerhalb der Gruppe nicht zuordnen
    const sc = connect(clara);
    expect((await emit(sc, 'map:join', { projectId: project, scope: 'g' + g1 })).scope).toBeNull();
    expect((await emit(sc, 'map:join', { projectId: project })).scope).toBe('g' + g2);
    expect((await emit(sc, 'map:op', { projectId: project, scope: 'g' + g1, op: { type: 'remove', ids: ['karte1'] } })).ok).toBe(false);
    const wrong = await emit(sa, 'map:op', { projectId: project, scope: 'g' + g1, op: { type: 'update', id: 'karte1', patch: { owner: ids[2] } } });
    expect(wrong).toMatchObject({ ok: false, error: 'Diese Person gehört nicht zur Gruppe' });
    expect((await emit(sa, 'map:op', { projectId: project, scope: 'g' + g1, op: { type: 'add', card: { id: 'x', kind: 'card' } } })).error).toBe('Ungültige Änderung');
  });

  it('Folien in Bento: Oberfläche mit Präsentation, Speichern mit Version, Import für Lernende erst nach Freigabe', async () => {
    const { t, project, ids } = await setup();
    const g1 = (await call('POST', `/api/projects/${project}/groups`, t, { title: 'Inflation' })).json.id;
    await call('POST', `/api/projects/${project}/moves`, t, { userId: ids[0], groupId: g1, position: 0 });
    const codes = (await call('POST', `/api/projects/${project}/access-codes`, t, { userIds: [ids[0], ids[2]] })).json.codes as J[];
    const anna = (await call('POST', '/api/access/redeem', undefined, { code: codes[0].code })).json.token as string;
    const clara = (await call('POST', '/api/access/redeem', undefined, { code: codes[1].code })).json.token as string;
    const deck = (await call('GET', `/api/projects/${project}/folien`, anna)).json.doc as J;
    const page = async (tok: string) => {
      const r = await fetch(`${base}/api/documents/${deck.id}/bento`, { headers: { authorization: 'Bearer ' + tok } });
      const html = await r.text();
      const cfg = html.match(/name="bento-host-config" data-bento-transient content="([^"]*)"/);
      const data = html.match(/id="bento-doc">([\s\S]*?)<\/script>/);
      return { status: r.status, cfg: cfg ? JSON.parse(cfg[1].replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')) : null, doc: data ? JSON.parse(data[1]) : null };
    };
    const first = await page(anna);
    expect(first.status).toBe(200);
    expect(first.cfg).toMatchObject({ saveUrl: `/collegare/api/documents/${deck.id}/bento`, version: 0, readOnly: false, canImport: false, ribbon: true });
    expect(first.doc).toMatchObject({ format: 'bento/slides', slides: [{ id: 's-titel' }] });

    // Speichern: `<` landet nie roh im Datenblock, alte Version ergibt 409, Live-Zugangsdaten fallen weg
    const doc = { ...first.doc, title: 'Inflation 1923', collab: { key: 'x' }, slides: [{ ...first.doc.slides[0], notes: '</script><b>' }] };
    expect((await call('PUT', `/api/documents/${deck.id}/bento`, anna, { doc, version: 0 })).json).toEqual({ version: 1 });
    expect((await call('PUT', `/api/documents/${deck.id}/bento`, anna, { doc, version: 0 })).status).toBe(409);
    expect((await call('PUT', `/api/documents/${deck.id}/bento`, anna, { doc: { format: 'x' }, version: 1 })).status).toBe(400);
    const again = await page(anna);
    expect(again.cfg.version).toBe(1);
    expect(again.doc.slides[0].notes).toBe('</script><b>');
    expect(again.doc.collab).toBeUndefined();
    expect((await call('GET', `/api/projects/${project}/folien`, anna)).json.doc.title).toBe('Inflation 1923');

    // Lehrkraft sieht die Gruppe nur lesend, Clara (andere bzw. keine Gruppe) gar nicht
    expect((await page(t)).cfg).toMatchObject({ readOnly: true, canImport: false });
    expect((await call('PUT', `/api/documents/${deck.id}/bento`, t, { doc, version: 1 })).status).toBe(403);
    expect((await page(clara)).status).toBe(403);

    // Import für Lernende erst, wenn die Lehrkraft ihn einschaltet
    expect((await call('PATCH', `/api/projects/${project}`, t, { settings: { slidesImportStudents: true } })).status).toBe(200);
    expect((await page(anna)).cfg.canImport).toBe(true);

    // Für alle freischalten: Clara (andere Gruppe) sieht sie dann lesend, mit dem Titel der Präsentation
    expect((await call('POST', `/api/documents/${deck.id}/freigabe`, clara, { shared: true })).status).toBe(403);
    expect((await call('POST', `/api/documents/${deck.id}/freigabe`, anna, { shared: true })).json).toEqual({ ok: true, shared: true });
    const seen = (await call('GET', `/api/projects/${project}/folien?bereich=g${g1}`, clara)).json;
    expect(seen.decks).toContainEqual(expect.objectContaining({ scope: 'g' + g1, title: 'Inflation 1923', owner: 'Inflation', shared: true, mine: false }));
    expect(seen).toMatchObject({ scope: 'g' + g1, write: false, canShare: false });
    expect((await page(clara)).cfg.readOnly).toBe(true);

    // Bearbeitung sperren: nur Anna ändert noch, Ben (gleiche Gruppe) nicht; die Lehrkraft entsperrt
    await call('POST', `/api/projects/${project}/moves`, t, { userId: ids[1], groupId: g1, position: 1 });
    const ben = (await call('POST', '/api/access/redeem', undefined, { code: ((await call('POST', `/api/projects/${project}/access-codes`, t, { userIds: [ids[1]] })).json.codes as J[])[0].code })).json.token as string;
    expect((await call('POST', `/api/documents/${deck.id}/sperre`, anna, { locked: true })).status).toBe(200);
    expect((await page(ben)).cfg.readOnly).toBe(true);
    expect((await call('PUT', `/api/documents/${deck.id}/bento`, ben, { doc, version: 1 })).status).toBe(403);
    expect((await page(anna)).cfg.readOnly).toBe(false);
    expect((await call('GET', `/api/projects/${project}/folien`, ben)).json).toMatchObject({ write: false, canUnlock: false, decks: [expect.objectContaining({ lockedByName: 'Anna' })] });
    expect((await call('POST', `/api/documents/${deck.id}/sperre`, ben, { locked: false })).status).toBe(403);
    expect((await call('POST', `/api/documents/${deck.id}/sperre`, t, { locked: false })).status).toBe(200);
    expect((await page(ben)).cfg.readOnly).toBe(false);

    // Die Präsentation der Lehrkraft (früher „Test / Demo (Lernende sehen sie)“) über dieselbe Freigabe
    const own = (await call('GET', `/api/projects/${project}/folien`, t)).json;
    const mine = own.decks.find((d: J) => d.mine);
    expect(mine).toMatchObject({ test: true, owner: 'Nur du', shared: false });
    expect((await call('POST', `/api/documents/${mine.docId}/freigabe`, t, { shared: true })).status).toBe(200);
    expect((await call('GET', `/api/projects/${project}/folien`, ben)).json.decks.map((d: J) => d.scope)).toEqual(['g' + g1, mine.scope]);
  });

  it('Chat: je Gruppe und für alle, Lehrkraft liest alles und löscht', async () => {
    const { t, project, ids } = await setup();
    const g1 = (await call('POST', `/api/projects/${project}/groups`, t, { title: 'Inflation' })).json.id;
    const g2 = (await call('POST', `/api/projects/${project}/groups`, t, { title: 'Kultur' })).json.id;
    await call('POST', `/api/projects/${project}/moves`, t, { userId: ids[0], groupId: g1, position: 0 });
    await call('POST', `/api/projects/${project}/moves`, t, { userId: ids[2], groupId: g2, position: 0 });
    const codes = (await call('POST', `/api/projects/${project}/access-codes`, t, { userIds: [ids[0], ids[2]] })).json.codes as J[];
    const anna = (await call('POST', '/api/access/redeem', undefined, { code: codes[0].code })).json.token as string;
    const clara = (await call('POST', '/api/access/redeem', undefined, { code: codes[1].code })).json.token as string;
    const sa = connect(anna);
    const sc = connect(clara);
    const st = connect(t);
    expect(await emit(sa, 'chat:join', { projectId: project })).toMatchObject({ ok: true, scope: 'g' + g1, scopes: [{ scope: 'p' }, { scope: 'g' + g1 }] });
    expect((await emit(st, 'chat:join', { projectId: project, scope: 'g' + g1 })).scopes).toHaveLength(3);
    const seen = new Promise<J>((r) => st.on('chat', r));
    expect((await emit(sa, 'chat:send', { projectId: project, scope: 'g' + g1, text: '  Hallo Gruppe  ' })).ok).toBe(true);
    const m = await seen;
    expect(m.message).toMatchObject({ body: 'Hallo Gruppe', name: 'Anna' });
    // Clara gehört nicht zur Gruppe
    expect((await emit(sc, 'chat:join', { projectId: project, scope: 'g' + g1 })).scope).toBeNull();
    expect((await emit(sc, 'chat:send', { projectId: project, scope: 'g' + g1, text: 'x' })).ok).toBe(false);
    expect((await emit(sc, 'chat:delete', { projectId: project, id: m.message.id })).ok).toBe(false);
    // Chat für alle
    expect((await emit(sc, 'chat:send', { projectId: project, scope: 'p', text: 'Hallo alle' })).ok).toBe(true);
    expect(((await emit(sa, 'chat:join', { projectId: project, scope: 'p' })).messages as J[]).map((x) => x.body)).toEqual(['Hallo alle']);
    // Lehrkraft löscht
    expect((await emit(st, 'chat:delete', { projectId: project, id: m.message.id })).ok).toBe(true);
    expect((await emit(sa, 'chat:join', { projectId: project, scope: 'g' + g1 })).messages).toEqual([]);
    // abgeschaltet
    expect((await call('PATCH', `/api/projects/${project}`, t, { settings: { chatAll: false } })).status).toBe(200);
    expect((await emit(sa, 'chat:join', { projectId: project })).scopes).toEqual([{ scope: 'g' + g1, title: 'Inflation' }]);
  });

  it('Notizen und Quellen: Thread der Gruppe, Karte folgt der Notiz', async () => {
    const { t, project, ids } = await setup();
    const g1 = (await call('POST', `/api/projects/${project}/groups`, t, { title: 'Inflation' })).json.id;
    const g2 = (await call('POST', `/api/projects/${project}/groups`, t, { title: 'Kultur' })).json.id;
    await call('POST', `/api/projects/${project}/moves`, t, { userId: ids[0], groupId: g1, position: 0 });
    await call('POST', `/api/projects/${project}/moves`, t, { userId: ids[2], groupId: g2, position: 0 });
    const codes = (await call('POST', `/api/projects/${project}/access-codes`, t, { userIds: [ids[0], ids[2]] })).json.codes as J[];
    const anna = (await call('POST', '/api/access/redeem', undefined, { code: codes[0].code })).json.token as string;
    const clara = (await call('POST', '/api/access/redeem', undefined, { code: codes[1].code })).json.token as string;
    const sa = connect(anna);
    const sc = connect(clara);
    expect(await emit(sa, 'notes:join', { projectId: project })).toMatchObject({ ok: true, scope: 'g' + g1, notes: [] });
    const add = await emit(sa, 'notes:add', { projectId: project, scope: 'g' + g1, note: { kind: 'source', title: 'Brotpreise 1923', body: 'Im November 233 Mrd. Mark', source: 'DHM, LeMO' } });
    expect(add.ok).toBe(true);
    expect((await emit(sa, 'notes:add', { projectId: project, scope: 'g' + g1, note: { url: 'javascript:alert(1)' } })).ok).toBe(false);
    // Clara (andere Gruppe) sieht und ändert nichts
    expect((await emit(sc, 'notes:join', { projectId: project, scope: 'g' + g1 })).scope).toBeNull();
    expect((await emit(sc, 'notes:update', { projectId: project, id: add.id, note: { title: 'x' } })).ok).toBe(false);
    // Karte aus der Notiz in der Mindmap; Überarbeiten der Notiz zieht die Karte nach
    await emit(sa, 'map:join', { projectId: project, scope: 'g' + g1 });
    const card = { id: 'notiz1', kind: 'card', title: 'Brotpreise 1923', x: 0, y: 0, w: 160, h: 90, owner: null, noteId: add.id };
    expect((await emit(sa, 'map:op', { projectId: project, scope: 'g' + g1, op: { type: 'add', card } })).ok).toBe(true);
    const seen = new Promise<J>((r) => sa.on('map', r));
    expect((await emit(sa, 'notes:update', { projectId: project, id: add.id, note: { kind: 'source', title: 'Brotpreis November 1923', body: '233 Mrd. Mark', source: 'DHM' } })).ok).toBe(true);
    const m = await seen;
    expect(m.map.cards.notiz1).toMatchObject({ title: 'Brotpreis November 1923', text: '233 Mrd. Mark\n\nFundstelle: DHM' });
    expect(((await emit(sa, 'notes:join', { projectId: project })).notes as J[])[0]).toMatchObject({ kind: 'source', name: 'Anna' });
    expect((await emit(sa, 'notes:delete', { projectId: project, id: add.id })).ok).toBe(true);
  });

  it('Notizen: Privat, Gruppe, Allgemein, Melden (Konzept 8e)', async () => {
    const { t, project, ids } = await setup();
    const g1 = (await call('POST', `/api/projects/${project}/groups`, t, { title: 'Inflation' })).json.id;
    const g2 = (await call('POST', `/api/projects/${project}/groups`, t, { title: 'Kultur' })).json.id;
    await call('POST', `/api/projects/${project}/moves`, t, { userId: ids[0], groupId: g1, position: 0 });
    await call('POST', `/api/projects/${project}/moves`, t, { userId: ids[1], groupId: g1, position: 1 });
    await call('POST', `/api/projects/${project}/moves`, t, { userId: ids[2], groupId: g2, position: 0 });
    const codes = (await call('POST', `/api/projects/${project}/access-codes`, t, { userIds: [ids[0], ids[1], ids[2]] })).json.codes as J[];
    const tok = async (i: number) => (await call('POST', '/api/access/redeem', undefined, { code: codes[i].code })).json.token as string;
    const sa = connect(await tok(0));
    const sb = connect(await tok(1));
    const sc = connect(await tok(2));
    const st = connect(t);
    const g = 'g' + g1;
    await emit(sa, 'notes:join', { projectId: project });
    const priv = (await emit(sa, 'notes:add', { projectId: project, scope: g, note: { body: 'nur für mich', visibility: 'private' } })).id;
    const grp = (await emit(sa, 'notes:add', { projectId: project, scope: g, note: { body: 'für die Gruppe' } })).id;
    const tab = (await emit(sa, 'notes:add', { projectId: project, scope: g, note: { kind: 'data', title: 'Preise', rows: [['Jahr', 'Mark'], ['1923', '233 Mrd.'], ['', '']] } })).id;
    const ids2 = (l: J) => (l.notes as J[]).map((n) => n.id).sort();
    // Ben (gleiche Gruppe) sieht die private Notiz nicht, die Lehrkraft schon
    expect(ids2(await emit(sb, 'notes:join', { projectId: project }))).toEqual([grp, tab].sort());
    expect(ids2(await emit(st, 'notes:join', { projectId: project, scope: g }))).toEqual([priv, grp, tab].sort());
    expect(((await emit(st, 'notes:join', { projectId: project, scope: g })).notes as J[]).find((n) => n.id === tab).rows).toEqual([['Jahr', 'Mark'], ['1923', '233 Mrd.']]);
    // Allgemein: Clara (andere Gruppe) sieht erst nach der Freigabe
    expect((await emit(sc, 'notes:join', { projectId: project, scope: '*' })).notes).toEqual([]);
    const seen = new Promise<J>((r) => sc.on('note', r));
    expect((await emit(sa, 'notes:update', { projectId: project, id: grp, note: { body: 'für alle', visibility: 'all' } })).ok).toBe(true);
    expect((await seen).note).toMatchObject({ id: grp, visibility: 'all', scope: g });
    expect(ids2(await emit(sc, 'notes:join', { projectId: project, scope: '*' }))).toEqual([grp]);
    // Lernende schreiben unter Allgemein in die eigene Gruppe, freigegeben
    const all = (await emit(sc, 'notes:add', { projectId: project, scope: '*', note: { body: 'Kultur teilt' } })).id;
    expect(((await emit(sa, 'notes:join', { projectId: project, scope: '*' })).notes as J[]).map((n) => n.id).sort()).toEqual([grp, all].sort());
    // Lehrkraft darf auf Privat zurückstellen, aber nicht veröffentlichen
    expect((await emit(st, 'notes:update', { projectId: project, id: priv, note: { body: 'nur für mich', visibility: 'group' } })).ok).toBe(false);
    expect((await emit(st, 'notes:update', { projectId: project, id: all, note: { body: 'Kultur teilt', visibility: 'private' } })).ok).toBe(true);
    expect((await emit(sa, 'notes:join', { projectId: project, scope: '*' })).notes).toHaveLength(1);
    // Melden: Ben meldet Annas Notiz; Clara sieht sie nicht mehr, Anna sieht „gemeldet“ ohne Namen
    expect((await emit(sa, 'notes:report', { projectId: project, id: grp })).ok).toBe(false);
    expect((await emit(sb, 'notes:report', { projectId: project, id: grp, reason: 'beleidigend' })).ok).toBe(true);
    expect((await emit(sb, 'notes:report', { projectId: project, id: grp })).ok).toBe(false);
    expect((await emit(sc, 'notes:join', { projectId: project, scope: '*' })).notes).toEqual([]);
    const annas = ((await emit(sa, 'notes:join', { projectId: project })).notes as J[]).find((n) => n.id === grp);
    expect(annas).toMatchObject({ reported: true });
    expect(annas.reports).toBeUndefined();
    expect(((await emit(sb, 'notes:join', { projectId: project })).notes as J[]).find((n) => n.id === grp)).toMatchObject({ reportedByMe: true });
    const forT = ((await emit(st, 'notes:join', { projectId: project, scope: g })).notes as J[]).find((n) => n.id === grp);
    expect(forT.reports).toMatchObject([{ reason: 'beleidigend' }]);
    expect((await emit(sb, 'notes:unreport', { projectId: project, id: grp })).ok).toBe(false);
    expect((await emit(st, 'notes:unreport', { projectId: project, id: grp })).ok).toBe(true);
    expect(ids2(await emit(sc, 'notes:join', { projectId: project, scope: '*' }))).toEqual([grp]);
    // Lehrkraft schreibt unter Allgemein: alle sehen es
    await emit(st, 'notes:join', { projectId: project, scope: '*' });
    const tn = (await emit(st, 'notes:add', { projectId: project, scope: '*', note: { body: 'Hinweis an alle' } })).id;
    expect(ids2(await emit(sc, 'notes:join', { projectId: project, scope: '*' }))).toEqual([grp, tn].sort());

    // Eigene Linie (8e.7): je Person, Notizen nur aus dem Projekt
    expect(await emit(sa, 'lines:get', { projectId: project, scope: g })).toMatchObject({ ok: true, line: { stations: [] }, sections: [] });
    const line = { stations: [{ id: 's1', noteId: grp, section: null, attached: [{ noteId: tab, visible: false }] }] };
    expect((await emit(sa, 'lines:save', { projectId: project, scope: g, line })).ok).toBe(true);
    expect((await emit(sa, 'lines:get', { projectId: project, scope: g })).line).toEqual(line);
    expect((await emit(sb, 'lines:get', { projectId: project, scope: g })).line).toEqual({ stations: [] });
    expect((await emit(sa, 'lines:save', { projectId: project, scope: g, line: { stations: [{ id: 'x', noteId: 99999, section: null, attached: [] }] } })).ok).toBe(false);
    expect((await emit(sc, 'lines:get', { projectId: project, scope: g })).ok).toBe(false);
  });

  it('Einfüge-Protokoll: eigene Einträge, Antwort später, Lehrkraft sieht alle', async () => {
    const { t, project, ids } = await setup();
    const g1 = (await call('POST', `/api/projects/${project}/groups`, t, { title: 'Inflation' })).json.id;
    const g2 = (await call('POST', `/api/projects/${project}/groups`, t, { title: 'Kultur' })).json.id;
    await call('POST', `/api/projects/${project}/moves`, t, { userId: ids[0], groupId: g1, position: 0 });
    await call('POST', `/api/projects/${project}/moves`, t, { userId: ids[1], groupId: g1, position: 1 });
    await call('POST', `/api/projects/${project}/moves`, t, { userId: ids[2], groupId: g2, position: 0 });
    const codes = (await call('POST', `/api/projects/${project}/access-codes`, t, { userIds: ids })).json.codes as J[];
    const [anna, ben] = await Promise.all(codes.map(async (c) => (await call('POST', '/api/access/redeem', undefined, { code: c.code })).json.token as string));
    const text = 'Die Hyperinflation erreichte im November 1923 ihren Höhepunkt. '.repeat(10);
    expect((await call('POST', `/api/projects/${project}/einfuegen`, anna, { scope: 'g' + g2, place: 'Karte', text })).status).toBe(403);
    const id = (await call('POST', `/api/projects/${project}/einfuegen`, anna, { scope: 'g' + g1, place: 'Karte „Ursachen“', text })).json.id;
    expect(id).toEqual(expect.any(Number));
    let own = (await call('GET', `/api/projects/${project}/einfuegen`, anna)).json.pastes as J[];
    expect(own).toHaveLength(1);
    expect(own[0]).toMatchObject({ place: 'Karte „Ursachen“', chars: [...text].length, answer: null });
    expect(own[0].sample).toHaveLength(300);
    // Ben sieht Annas Einträge nicht und kann sie nicht beantworten
    expect((await call('GET', `/api/projects/${project}/einfuegen`, ben)).json.pastes).toEqual([]);
    expect((await call('POST', `/api/projects/${project}/einfuegen/${id}`, ben, { answer: 'quote', note: 'x' })).status).toBe(404);
    expect((await call('POST', `/api/projects/${project}/einfuegen/${id}`, anna, { answer: 'quote', note: 'Schulbuch S. 42' })).status).toBe(200);
    own = (await call('GET', `/api/projects/${project}/einfuegen`, t)).json.pastes as J[];
    expect(own[0]).toMatchObject({ answer: 'quote', note: 'Schulbuch S. 42', scope: 'g' + g1 });

    // Grenze je Ziel zählt zusammen, Spur im Text nur für die Lehrkraft (Wunsch Jo, 20. November 2026)
    const part = 'Inflation entsteht, wenn die Geldmenge schneller wächst als die Gütermenge einer Volkswirtschaft.';
    const r1 = (await call('POST', `/api/projects/${project}/einfuegen`, anna, { scope: 'g' + g1, place: 'Karte „Geld“', text: part, target: 'card:k1' })).json;
    expect(r1.total).toBe([...part].length);
    const r2 = (await call('POST', `/api/projects/${project}/einfuegen`, anna, { scope: 'g' + g1, place: 'Karte „Geld“', text: part, target: 'card:k1' })).json;
    expect(r2.total).toBe(2 * [...part].length);
    expect((await call('GET', `/api/projects/${project}/einfuegen/summe?ziel=card:k1`, anna)).json.total).toBe(2 * [...part].length);
    expect((await call('GET', `/api/projects/${project}/einfuegen/summe?ziel=card:k1`, ben)).json.total).toBe(0);
    expect((await call('POST', `/api/projects/${project}/einfuegen`, anna, { scope: 'g' + g1, place: 'x', text: part, target: 'karte' })).status).toBe(400);
    expect((await call('GET', `/api/projects/${project}/einfuegen/spur?ziel=card:k1`, anna)).status).toBe(403);
    const spur = (await call('GET', `/api/projects/${project}/einfuegen/spur?ziel=card:k1`, t)).json;
    expect(spur.pastes).toHaveLength(2);
    expect(spur.pastes[0]).toMatchObject({ text: part, origin: 'paste', name: expect.any(String) });
    // die Karte gibt es (noch) nicht: kein Text, aber die Einträge
    expect(spur.text).toBeNull();
    own = (await call('GET', `/api/projects/${project}/einfuegen`, t)).json.pastes as J[];
    expect(own[0]).toMatchObject({ target: 'card:k1', origin: 'paste', noteId: null });
  });

  it('Pinnwand: Präsentation als eigenständige Datei', async () => {
    const { t, project } = await setup();
    const g1 = (await call('POST', `/api/projects/${project}/groups`, t, { title: 'Inflation' })).json.id;
    const gs = 'g' + g1;
    const pin = (methodname: string, args: J = {}) => call('POST', `/api/projects/${project}/pinnwand/${gs}/call`, t, { methodname: 'mod_pinnwand_' + methodname, args: { cmid: project, ...args } });
    const start = (await call('GET', `/api/projects/${project}/pinnwand/${gs}/start`, t)).json.config;
    expect(start.exportpresentationurl).toMatch(/\/export\?v=1$/);
    const url = `/api/projects/${project}/pinnwand/${gs}/export?v=1&boardid=0&annot=0&ink=0`;
    expect((await fetch(base + url, { headers: { authorization: 'Bearer ' + t } })).status).toBe(404);
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const id = (await pin('save_photo', { imagedata: png, sourcetitle: 'Brot' })).json.data.photoid;
    await pin('update_layout', { photoid: id, x: 10, y: 20, w: 300, rot: 2, z: 1 });
    await pin('add_thread_item', { itemtype: 'photo', photoid: id });
    const res = await fetch(base + url, { headers: { authorization: 'Bearer ' + t } });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toMatch(/attachment; filename=.*praesentation\.html/);
    const html = await res.text();
    expect(html).not.toMatch(/"<\/script>"/);
    const data = JSON.parse(/<script type="application\/json" id="pinnwand-export-data">\n([\s\S]*?)\n<\/script>/.exec(html)![1]);
    expect(data).toMatchObject({ formatVersion: 1, boardWidth: 1400, labels: { show: 'Einblenden' } });
    expect(data.thread.items).toHaveLength(1);
    expect(data.thread.items[0].photo).toMatchObject({ id, canvasx: 10, canvasw: 300 });
    expect(data.boardPhotos[0].url).toMatch(/^data:image\/png;base64,/);
  });

  it('Pinnwand als Modul: Board der Gruppe, Dateien nur für die Gruppe', async () => {
    const { t, project, ids } = await setup();
    const g1 = (await call('POST', `/api/projects/${project}/groups`, t, { title: 'Inflation' })).json.id;
    const g2 = (await call('POST', `/api/projects/${project}/groups`, t, { title: 'Kultur' })).json.id;
    await call('POST', `/api/projects/${project}/moves`, t, { userId: ids[0], groupId: g1, position: 0 });
    await call('POST', `/api/projects/${project}/moves`, t, { userId: ids[1], groupId: g1, position: 1 });
    await call('POST', `/api/projects/${project}/moves`, t, { userId: ids[2], groupId: g2, position: 0 });
    const codes = (await call('POST', `/api/projects/${project}/access-codes`, t, { userIds: ids })).json.codes as J[];
    const [anna, ben, clara] = await Promise.all(codes.map(async (c) => (await call('POST', '/api/access/redeem', undefined, { code: c.code })).json.token as string));
    const pin = (tok: string, scope: string, methodname: string, args: J = {}) => call('POST', `/api/projects/${project}/pinnwand/${scope}/call`, tok, { methodname: 'mod_pinnwand_' + methodname, args: { cmid: project, ...args } });
    const gs = 'g' + g1;
    expect((await call('GET', `/api/projects/${project}/pinnwand`, anna)).json.scopes).toEqual([{ scope: gs, title: 'Inflation' }]);
    expect((await call('GET', `/api/projects/${project}/pinnwand/${gs}/start`, anna)).json.config).toMatchObject({ cmid: project, currentuserfullname: 'Inflation', canmanage: false });
    // 1×1-PNG als Objekt, Anna legt es an, Ben sieht es (gemeinsames Board der Gruppe)
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const saved = (await pin(anna, gs, 'save_photo', { imagedata: png, sourcetitle: '<b>Brot</b>preise' })).json;
    expect(saved).toMatchObject({ ok: true, data: { photoid: expect.any(Number), count: 1 } });
    const id = saved.data.photoid;
    expect((await pin(anna, gs, 'update_layout', { photoid: id, x: 10, y: 20, w: 300, rot: 2, z: 1 })).json.ok).toBe(true);
    const photos = (await pin(ben, gs, 'get_photos')).json.data.photos as J[];
    expect(photos).toHaveLength(1);
    expect(photos[0]).toMatchObject({ id, sourcetitle: 'Brotpreise', canvasx: 10, canvasw: 300, boardplaced: true, userfullname: 'Inflation' });
    // Adressen für den Browser tragen den Unterordner der Installation (der Reverse-Proxy nimmt ihn ab)
    expect(photos[0].url).toMatch(/^\/collegare\/api\//);
    const fileUrl = photos[0].url.replace(/^\/collegare/, '');
    expect((await call('GET', fileUrl, ben)).status).toBe(200);
    // Medien liegen als Dateien im Ordner der Pinnwand, die Tabelle hält nur die Angaben
    const dir = s.pinnwand.media.dirOf(project, gs);
    const row = await s.db.selectFrom('pinnwand_files').selectAll().where('item_id', '=', id).where('area', '=', 'photo').executeTakeFirstOrThrow();
    expect(row.path).toBeTruthy();
    expect(Buffer.from(row.data).length).toBe(0);
    expect(existsSync(join(s.pinnwand.media.root, row.path!))).toBe(true);
    expect(join(s.pinnwand.media.root, row.path!).startsWith(dir)).toBe(true);
    // volle Auflösung und Vorschau nachreichen (wie mod_pinnwand save_photo_hires)
    expect((await pin(anna, gs, 'save_photo_hires', { photoid: id, imagedata: png, targets: 'full,orig' })).json).toMatchObject({ ok: true, data: { success: true } });
    expect((await pin(anna, gs, 'save_photo_hires', { photoid: id, imagedata: png, targets: 'thumb' })).json.ok).toBe(true);
    const sized = ((await pin(ben, gs, 'get_photos')).json.data.photos as J[])[0];
    expect(sized.fullurl).toMatch(/photofull_/);
    expect(sized.thumburl).toMatch(/photothumb_/);
    expect(sized.origurl).toMatch(/photoorig_/);
    expect((await call('GET', sized.fullurl.replace(/^\/collegare/, ''), ben)).status).toBe(200);
    expect((await pin(clara, gs, 'save_photo_hires', { photoid: id, imagedata: png })).status).toBe(403);
    // neues Bild verwirft volle Auflösung und Vorschau
    await pin(anna, gs, 'update_photo', { photoid: id, imagedata: png });
    const fresh = ((await pin(ben, gs, 'get_photos')).json.data.photos as J[])[0];
    expect(fresh.fullurl).toBe('');
    expect(fresh.thumburl).toBe('');
    // Umzug älterer Installationen: Blob in der Tabelle wird zur Datei, gelesen wird vorher und nachher
    const blob = await s.db
      .insertInto('pinnwand_files')
      .values({ project_id: project, scope: gs, area: 'slidemedia', item_id: 0, name: 'alt.txt', mime: 'text/plain', data: Buffer.from('alter Blob'), path: null, size: null, created_at: Date.now() })
      .executeTakeFirst();
    const blobId = Number(blob.insertId);
    expect((await s.pinnwand.file(project, gs, blobId))!.data.toString()).toBe('alter Blob');
    expect((await checkMedia(s.db, s.pinnwand.media)).inDb).toBe(1);
    expect(await moveBlobs(s.db, s.pinnwand.media)).toBe(1);
    const movedRow = await s.db.selectFrom('pinnwand_files').selectAll().where('id', '=', blobId).executeTakeFirstOrThrow();
    expect(movedRow.path).toBeTruthy();
    expect(Buffer.from(movedRow.data).length).toBe(0);
    expect((await s.pinnwand.file(project, gs, blobId))!.data.toString()).toBe('alter Blob');
    const check = await checkMedia(s.db, s.pinnwand.media);
    expect(check).toMatchObject({ inDb: 0, missing: [], wrongSize: [], orphans: [] });
    // Roter Faden und Board-Namen
    expect((await pin(ben, gs, 'add_thread_item', { itemtype: 'photo', photoid: id })).json.data.items).toHaveLength(1);
    await pin(ben, gs, 'set_board_name', { boardid: 0, name: 'Ursachen' });
    expect((await pin(anna, gs, 'get_board_names')).json.data.names).toEqual([{ boardid: 0, name: 'Ursachen' }]);
    // Bilder zum Untersuchen: Lehrkraft gibt in „Test / Demo“ frei, Anna öffnet dazu ein eigenes Board
    const ts = ((await call('GET', `/api/projects/${project}/pinnwand`, t)).json.scopes as J[]).find((x) => x.scope.startsWith('t'))!.scope;
    expect((await call('GET', `/api/projects/${project}/pinnwand/${ts}/start`, t)).json.config.canstudyrelease).toBe(true);
    expect((await call('GET', `/api/projects/${project}/pinnwand/${gs}/start`, t)).json.config.canstudyrelease).toBe(false);
    const tid = (await pin(t, ts, 'save_photo', { imagedata: png, sourcetitle: 'Karte 1914' })).json.data.photoid;
    expect((await pin(anna, gs, 'set_photo_studyable', { photoid: id, studyable: true })).json.ok).toBe(false);
    expect((await pin(anna, gs, 'get_study_photos')).json.data.photos).toEqual([]);
    expect((await pin(t, ts, 'set_photo_studyable', { photoid: tid, studyable: true })).json.data).toEqual({ success: true, studyable: true });
    const sp = (await pin(anna, gs, 'get_study_photos')).json.data.photos as J[];
    expect(sp).toEqual([expect.objectContaining({ id: tid, title: 'Karte 1914', boardid: -1 })]);
    expect((await call('GET', sp[0].url.replace(/^\/collegare/, ''), anna)).status).toBe(200);
    expect((await call('GET', sp[0].url.replace(/^\/collegare/, '').replace('/' + gs + '/', '/g' + g2 + '/'), anna)).status).toBe(403);
    const opened = (await pin(anna, gs, 'open_study_board', { photoid: tid })).json.data;
    expect(opened).toMatchObject({ boardid: 1, created: true, boardbgs: [expect.objectContaining({ boardid: 1, sourcephotoid: tid })] });
    expect((await pin(ben, gs, 'open_study_board', { photoid: tid })).json.data).toMatchObject({ boardid: 1, created: false });
    expect((await pin(ben, gs, 'get_photos')).json.data.boardbgs).toHaveLength(1);
    expect((await call('GET', opened.boardbgs[0].url.replace(/^\/collegare/, ''), ben)).status).toBe(200);
    expect((await pin(anna, gs, 'get_board_names')).json.data.names).toContainEqual({ boardid: 1, name: 'Karte 1914' });
    expect((await pin(anna, gs, 'get_study_photos')).json.data.photos[0].boardid).toBe(1);
    await pin(t, ts, 'set_photo_studyable', { photoid: tid, studyable: false });
    expect((await pin(anna, gs, 'get_study_photos')).json.data.photos).toEqual([]);
    expect((await call('GET', sp[0].url.replace(/^\/collegare/, ''), anna)).status).toBe(404);
    // Clara (andere Gruppe) kommt weder an die Aufrufe noch an die Dateien
    expect((await pin(clara, gs, 'get_photos')).status).toBe(403);
    expect((await call('GET', fileUrl, clara)).status).toBe(403);
    expect((await pin(clara, 'g' + g2, 'get_photos')).json.data.photos).toEqual([]);
    // unbekannte Methoden und Fehler wie in Moodle
    expect((await pin(anna, gs, 'nicht_da')).status).toBe(400);
    expect((await pin(anna, gs, 'restore_photo', { photoid: 999999 })).json).toMatchObject({ ok: false });
    expect((await pin(anna, gs, 'save_photo', { imagedata: 'data:text/html;base64,PGI+' })).json).toEqual({ ok: false, error: 'Speichern fehlgeschlagen' });
    // Pinnwand aus der Mindmap: nur Übernommenes, erneut übernehmen ergänzt nur
    const add = (id: string, extra: J) => s.maps.apply(project, gs, { type: 'add', card: { id, kind: 'card', title: id, text: '', x: 0, y: 0, w: 160, h: 90, color: null, parent: null, owner: null, ...extra } } as never, ids[0], new Set([ids[0], ids[1]]));
    expect((await call('POST', `/api/projects/${project}/pinnwand/${gs}/aus-mindmap`, anna)).status).toBe(400);
    await add('clus1', { kind: 'cluster', title: 'Ursachen', pick: true });
    await add('k1', { parent: 'clus1', title: 'Reparationen', text: 'Versailles', pick: true });
    await add('k2', { parent: 'clus1', y: 100, title: 'nur gesammelt' });
    expect((await call('POST', `/api/projects/${project}/pinnwand/${gs}/aus-mindmap`, anna)).json).toEqual({ ok: true, frames: 1, notes: 1 });
    expect((await call('POST', `/api/projects/${project}/pinnwand/${gs}/aus-mindmap`, anna)).json).toEqual({ ok: true, frames: 0, notes: 0 });
    const th = (await pin(anna, gs, 'get_threads')).json.data.threads[0];
    expect(th.items.find((x: J) => x.itemtype === 'frame')).toMatchObject({ framelabel: 'Ursachen' });
    const notes = ((await pin(anna, gs, 'get_photos')).json.data.photos as J[]).filter((p) => p.wordfielddata);
    expect(notes).toHaveLength(1);
    expect(JSON.parse(notes[0].wordfielddata).texts[0].text).toBe('Reparationen\nVersailles');
    // Papierkorb und endgültig löschen
    expect((await pin(anna, gs, 'delete_photo', { photoid: id })).json.ok).toBe(true);
    expect((await pin(anna, gs, 'get_trash')).json.data.items).toEqual([expect.objectContaining({ kind: 'object', id })]);
    expect((await pin(anna, gs, 'permanently_delete_photo', { photoid: id })).json.ok).toBe(true);
    expect((await call('GET', fileUrl, anna)).status).toBe(404);
  });

  it('Themen-Mindmap vor den Gruppen: alle arbeiten mit, Gruppe übernimmt sie als Start', async () => {
    const { t, project, ids } = await setup();
    const codes = (await call('POST', `/api/projects/${project}/access-codes`, t, { userIds: [ids[0]] })).json.codes as J[];
    const anna = (await call('POST', '/api/access/redeem', undefined, { code: codes[0].code })).json.token as string;
    const sa = connect(anna);
    // noch keine Gruppe: Anna landet in der Themen-Mindmap und darf mitschreiben
    expect(await emit(sa, 'map:join', { projectId: project })).toMatchObject({ ok: true, scope: 'p', readOnly: false });
    const card = { id: 'idee01', kind: 'card', title: 'Hyperinflation', x: 0, y: 0, w: 160, h: 90, owner: null };
    expect((await emit(sa, 'map:op', { projectId: project, scope: 'p', op: { type: 'add', card } })).ok).toBe(true);
    expect((await emit(sa, 'map:op', { projectId: project, scope: 'p', op: { type: 'outline' } })).ok).toBe(false);
    // nur die Lehrkraft: Anna liest nur noch
    expect((await call('PATCH', `/api/projects/${project}`, t, { settings: { topicMapEdit: 'teacher' } })).status).toBe(200);
    expect(await emit(sa, 'map:join', { projectId: project, scope: 'p' })).toMatchObject({ readOnly: true });
    expect((await emit(sa, 'map:op', { projectId: project, scope: 'p', op: { type: 'remove', ids: ['idee01'] } })).ok).toBe(false);
    // Gruppen aus den Themen vorschlagen (nur Lehrkraft) und mehrere auf einmal anlegen
    expect((await call('GET', `/api/projects/${project}/groups/vorschlaege`, t)).json.suggestions).toEqual([{ title: 'Hyperinflation', kind: 'card', exists: false }]);
    expect((await call('GET', `/api/projects/${project}/groups/vorschlaege`, anna)).status).toBe(403);
    expect((await call('POST', `/api/projects/${project}/groups/viele`, t, { titles: ['Hyperinflation', 'Ruhrbesetzung'] })).json).toMatchObject({ count: 2 });
    expect((await call('GET', `/api/projects/${project}/groups/vorschlaege`, t)).json.suggestions[0]).toMatchObject({ exists: true });
    // Gruppe bilden und die Themen-Mindmap übernehmen (nur in eine leere Mindmap)
    const g = (await call('POST', `/api/projects/${project}/groups`, t, { title: 'Inflation' })).json.id;
    await call('POST', `/api/projects/${project}/moves`, t, { userId: ids[0], groupId: g, position: 0 });
    expect((await emit(sa, 'map:join', { projectId: project })).scope).toBe('g' + g);
    expect((await emit(sa, 'map:seed', { projectId: project, scope: 'g' + g })).ok).toBe(true);
    expect((await s.maps.get(project, 'g' + g)).map.cards.idee01).toMatchObject({ title: 'Hyperinflation' });
    expect((await emit(sa, 'map:seed', { projectId: project, scope: 'g' + g })).ok).toBe(false);
    // Phase aus: keine Themen-Mindmap mehr
    const phases = (await call('GET', `/api/projects/${project}`, t)).json.settings.phases;
    expect((await call('PATCH', `/api/projects/${project}`, t, { settings: { phases: { ...phases, topic: { state: 'off', from: null, to: null } } } })).status).toBe(200);
    expect(((await emit(sa, 'map:join', { projectId: project })).scopes as J[]).map((x) => x.scope)).toEqual(['g' + g]);
  });
});

describe('Ausarbeitung: Dokumente aus der Gliederung', () => {
  const emit = (sock: Socket, ev: string, msg: unknown) => new Promise<J>((r) => sock.emit(ev, msg, r));
  const editor = (token: string, docId: string) => {
    const sock = ioc(base + '/collab', { path: '/socket.io', query: { docId, userId: 'gefälscht' }, auth: { token }, transports: ['websocket'], forceNew: true });
    sockets.push(sock);
    return sock;
  };
  const auth = (sock: Socket) =>
    new Promise<{ auth: J; changes: J[] }>((r, rej) => {
      const changes: J[] = [];
      sock.on('connect_error', rej);
      sock.on('message', (m: J) => {
        if (m.type === 'authChanges') changes.push(...(m.changes as J[]));
        if (m.type === 'auth') r({ auth: m, changes });
      });
      sock.emit('message', { type: 'auth' });
    });

  it('Gruppe schreibt, Stand bleibt nach dem Schließen erhalten, Fertig sperrt', async () => {
    const { t, project, ids } = await setup();
    const g1 = (await call('POST', `/api/projects/${project}/groups`, t, { title: 'Inflation' })).json.id;
    const g2 = (await call('POST', `/api/projects/${project}/groups`, t, { title: 'Kultur' })).json.id;
    await call('POST', `/api/projects/${project}/moves`, t, { userId: ids[0], groupId: g1, position: 0 });
    await call('POST', `/api/projects/${project}/moves`, t, { userId: ids[1], groupId: g1, position: 1 });
    await call('POST', `/api/projects/${project}/moves`, t, { userId: ids[2], groupId: g2, position: 0 });
    const codes = (await call('POST', `/api/projects/${project}/access-codes`, t, { userIds: ids })).json.codes as J[];
    const [anna, ben, clara] = await Promise.all(codes.map(async (c) => (await call('POST', '/api/access/redeem', undefined, { code: c.code })).json.token as string));

    // Mindmap mit einem Cluster und zwei Karten, Gliederung übernehmen (über den Speicher, Echtzeit ist oben geprüft)
    const people = new Set([ids[0], ids[1]]);
    const add = (id: string, extra: J) => s.maps.apply(project, 'g' + g1, { type: 'add', card: { id, kind: 'card', title: id, text: '', x: 0, y: 0, w: 160, h: 90, color: null, parent: null, owner: null, ...extra } } as never, ids[0], people);
    await add('clus1', { kind: 'cluster', title: 'Ursachen', pick: true });
    await add('karteA', { parent: 'clus1', title: 'Reparationen', owner: ids[0], pick: true });
    await add('karteB', { parent: 'clus1', y: 120, title: 'Ruhrbesetzung', owner: ids[1], pick: true });
    expect((await call('POST', `/api/projects/${project}/documents/sync`, anna, { scope: 'g' + g1 })).status).toBe(400);
    await s.maps.apply(project, 'g' + g1, { type: 'outline' }, ids[0], people);
    expect((await call('POST', `/api/projects/${project}/documents/sync`, anna, { scope: 'g' + g1 })).json).toEqual({ created: 2, total: 2 });
    expect((await call('POST', `/api/projects/${project}/documents/sync`, anna, { scope: 'g' + g1 })).json).toEqual({ created: 0, total: 2 });
    const list = (await call('GET', `/api/projects/${project}/documents`, anna)).json;
    expect(list.docs.map((d: J) => [d.sectionTitle, d.title, d.ownerId])).toEqual([['Ursachen', 'Reparationen', ids[0]], ['Ursachen', 'Ruhrbesetzung', ids[1]]]);
    const docA = 'cg' + list.docs[0].id;

    // Clara (andere Gruppe) kommt nicht hinein, auch nicht über die Liste
    expect((await call('GET', `/api/projects/${project}/documents?bereich=g${g1}`, clara)).json.scope).toBeNull();
    await expect(auth(editor(clara, docA))).rejects.toThrow(/kein Zugriff/);

    // Anna schreibt; Ben öffnet später und bekommt alles
    const ea = editor(anna, docA);
    expect((await auth(ea)).auth.participants[0].username).toBe('Anna');
    ea.emit('message', { type: 'saveChanges', changes: JSON.stringify([{ t: 'eins' }, { t: 'zwei' }]), startSaveChanges: true, endSaveChanges: true, deleteIndex: -1 });
    await new Promise((r) => ea.on('message', (m: J) => m.type === 'unSaveLock' && r(m)));
    ea.disconnect();
    await new Promise((r) => setTimeout(r, 100));
    expect(app.co.docs.peek(docA)).toBeUndefined(); // aus dem Speicher genommen
    const eb = editor(ben, docA);
    expect((await auth(eb)).changes.map((c) => JSON.parse(c.change as string).t)).toEqual(['eins', 'zwei']);

    // Ben ist nicht zuständig; Anna meldet fertig, Bens Editor wird getrennt und öffnet danach nur lesend
    expect((await call('POST', `/api/documents/${list.docs[0].id}/done`, ben)).status).toBe(403);
    const dropped = new Promise((r) => eb.on('disconnect', r));
    expect((await call('POST', `/api/documents/${list.docs[0].id}/done`, anna)).status).toBe(200);
    await dropped;
    const eb2 = editor(ben, docA);
    const again = await auth(eb2);
    expect(again.auth.participants.find((p: J) => p.username === 'Ben').view).toBe(true);
    eb2.emit('message', { type: 'saveChanges', changes: JSON.stringify([{ t: 'heimlich' }]), startSaveChanges: true, endSaveChanges: true, deleteIndex: -1 });
    await new Promise((r) => setTimeout(r, 100));
    expect((await s.docStore.load(docA)).map((c) => JSON.parse(c.change).t)).toEqual(['eins', 'zwei']);

    // Wieder öffnen: laut Voreinstellung nur die Lehrkraft
    expect((await call('POST', `/api/documents/${list.docs[0].id}/reopen`, anna)).status).toBe(403);
    expect((await call('POST', `/api/documents/${list.docs[0].id}/reopen`, t)).status).toBe(200);
    expect((await call('GET', `/api/projects/${project}/documents?bereich=g${g1}`, t)).json.docs[0].doneAt).toBeNull();
  });
});

