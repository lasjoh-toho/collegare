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

  it('Startseite erfährt ohne Anmeldung, ob das offene Office angeboten wird', async () => {
    expect((await call('GET', '/api/public')).json).toEqual({ openOffice: false });
    await s.frame.set({ ...(await s.frame.get()), openOffice: true });
    expect((await call('GET', '/api/public')).json).toEqual({ openOffice: true });
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
    expect(joined).toMatchObject({ ok: true, role: 'student', scope: 'g' + g1, scopes: [{ scope: 'g' + g1, title: 'Inflation' }] });
    expect((joined.people as J[]).map((p) => p.name).sort()).toEqual(['Anna', 'Ben']);

    const st = connect(t);
    const tj = await emit(st, 'map:join', { projectId: project, scope: 'g' + g1 });
    expect(tj.scopes).toHaveLength(2);
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
    await add('clus1', { kind: 'cluster', title: 'Ursachen' });
    await add('karteA', { parent: 'clus1', title: 'Reparationen', owner: ids[0] });
    await add('karteB', { parent: 'clus1', y: 120, title: 'Ruhrbesetzung', owner: ids[1] });
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

