import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { io as ioc, type Socket } from 'socket.io-client';
import type { AddressInfo } from 'node:net';
import { buildApp, type App } from '../src/app.js';
import { createServices, type Services } from '../src/services.js';

let app: App;
let s: Services;
let base: string;
const sockets: Socket[] = [];

beforeEach(async () => {
  s = await createServices({ databaseUrl: 'sqlite::memory:', appUrl: 'http://localhost/collegare', cookieSecure: false, accessCodeDays: 14 });
  app = await buildApp({ services: s });
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

  it('Editor-Verbindung braucht eine Sitzung, die Person kommt aus der Sitzung', async () => {
    const { t } = await setup();
    const anon = ioc(base + '/collab', { path: '/socket.io', query: { docId: 'x', userId: 'gefälscht' }, transports: ['websocket'], forceNew: true });
    sockets.push(anon);
    const err = await new Promise<Error>((r) => anon.on('connect_error', r));
    expect(err.message).toMatch(/Nicht angemeldet/);

    const ok = ioc(base + '/collab', { path: '/socket.io', query: { docId: 'x', userId: 'gefälscht' }, auth: { token: t }, transports: ['websocket'], forceNew: true });
    sockets.push(ok);
    const auth = await new Promise<J>((r) => {
      ok.on('message', (m: J) => m.type === 'auth' && r(m));
      ok.emit('message', { type: 'auth' });
    });
    expect(auth.participants[0].username).toBe('Frau Müller');
    expect(auth.participants[0].id).not.toBe('gefälscht');
  });

  it('Protokollkette bleibt unversehrt', async () => {
    await setup();
    expect(await s.audit.verify()).toEqual({ ok: true });
    await s.db.updateTable('audit_log').set({ action: 'manipuliert' }).where('id', '=', 2).execute();
    expect((await s.audit.verify()).ok).toBe(false);
  });
});
