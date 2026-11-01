import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import formbody from '@fastify/formbody';
import { exportJWK, generateKeyPair, SignJWT, createRemoteJWKSet, jwtVerify, type CryptoKey } from 'jose';
import type { AddressInfo } from 'node:net';
import { buildApp, type App } from '../src/app.js';
import { createServices, type Services } from '../src/services.js';
import { mapRole } from '../src/lti/lti.js';

const ISS = 'https://moodle.schule.test';
const CLIENT = 'abc123';
const DEPLOY = '7';
const C = 'https://purl.imsglobal.org/spec/lti/claim/';

let app: App;
let s: Services;
let base: string;
let platform: FastifyInstance;
let pbase: string;
let pkey: CryptoKey;
let tokenRequests: Record<string, string>[] = [];

beforeEach(async () => {
  const kp = await generateKeyPair('RS256');
  pkey = kp.privateKey;
  const pub = { ...(await exportJWK(kp.publicKey)), kid: 'moodle-1', alg: 'RS256', use: 'sig' };
  tokenRequests = [];
  platform = Fastify();
  await platform.register(formbody);
  platform.get('/jwks', async () => ({ keys: [pub] }));
  platform.post('/token', async (req) => {
    tokenRequests.push(req.body as Record<string, string>);
    return { access_token: 'tok-1', token_type: 'Bearer', expires_in: 3600 };
  });
  platform.get('/nrps', async (req, reply) => {
    if (req.headers.authorization !== 'Bearer tok-1') return reply.code(401).send({});
    const page = (req.query as { p?: string }).p;
    if (!page) {
      reply.header('link', `<${pbase}/nrps?p=2>; rel="next"`);
      return { members: [
        { user_id: 'm-anna', name: 'Anna Adler', roles: ['http://purl.imsglobal.org/vocab/lis/v2/membership#Learner'], status: 'Active' },
        { user_id: 'm-mue', name: 'Frau Müller', roles: ['http://purl.imsglobal.org/vocab/lis/v2/membership#Instructor'] },
      ] };
    }
    return { members: [
      { user_id: 'm-ben', given_name: 'Ben', family_name: 'Bauer', roles: ['http://purl.imsglobal.org/vocab/lis/v2/membership#Learner'] },
      { user_id: 'm-alt', name: 'Ausgetreten', roles: ['http://purl.imsglobal.org/vocab/lis/v2/membership#Learner'], status: 'Inactive' },
    ] };
  });
  await platform.listen({ port: 0, host: '127.0.0.1' });
  pbase = `http://127.0.0.1:${(platform.server.address() as AddressInfo).port}`;

  s = await createServices({ databaseUrl: 'sqlite::memory:', appUrl: 'https://collegare.schule.test/collegare', cookieSecure: true, accessCodeDays: 14 });
  app = await buildApp({ services: s });
  await app.http.listen({ port: 0, host: '127.0.0.1' });
  base = `http://127.0.0.1:${(app.http.server.address() as AddressInfo).port}`;

  const aid = await s.accounts.create('admin', 'Admin', 'geheim-geheim');
  await s.users.grant(aid, await s.contexts.system(), 'admin');
  const at = (await (await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ login: 'admin', password: 'geheim-geheim' }) })).json()).token;
  const r = await fetch(base + '/api/admin/lti/platforms', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + at },
    body: JSON.stringify({ title: 'Schul-Moodle', issuer: ISS, client_id: CLIENT, deployment_id: DEPLOY, auth_url: pbase + '/auth', jwks_url: pbase + '/jwks', token_url: pbase + '/token' }),
  });
  expect(r.status).toBe(200);
});

afterEach(async () => {
  await app.http.close();
  await platform.close();
});

async function startLogin() {
  const res = await fetch(`${base}/lti/login?iss=${encodeURIComponent(ISS)}&login_hint=42&target_link_uri=${encodeURIComponent('https://collegare.schule.test/collegare/lti/launch')}&client_id=${CLIENT}&lti_message_hint=xyz`, { redirect: 'manual' });
  expect(res.status).toBe(302);
  const loc = new URL(res.headers.get('location')!);
  expect(loc.origin + loc.pathname).toBe(pbase + '/auth');
  expect(loc.searchParams.get('redirect_uri')).toBe('https://collegare.schule.test/collegare/lti/launch');
  expect(loc.searchParams.get('lti_message_hint')).toBe('xyz');
  return { state: loc.searchParams.get('state')!, nonce: loc.searchParams.get('nonce')! };
}

function idToken(nonce: string, sub: string, role: 'Instructor' | 'Learner', extra: Record<string, unknown> = {}, aud = CLIENT) {
  return new SignJWT({
    nonce,
    name: role === 'Instructor' ? 'Frau Müller' : 'Anna Adler',
    [C + 'deployment_id']: DEPLOY,
    [C + 'message_type']: 'LtiResourceLinkRequest',
    [C + 'version']: '1.3.0',
    [C + 'roles']: [`http://purl.imsglobal.org/vocab/lis/v2/membership#${role}`],
    [C + 'resource_link']: { id: 'rl-1', title: 'Projekt Weimar' },
    [C + 'context']: { id: 'course-9', title: 'S1 Geschichte' },
    'https://purl.imsglobal.org/spec/lti-nrps/claim/namesroleservice': { context_memberships_url: pbase + '/nrps', service_versions: ['2.0'] },
    'https://purl.imsglobal.org/spec/lti-ags/claim/endpoint': { lineitem: pbase + '/lineitems/1', scope: [] },
    ...extra,
  })
    .setProtectedHeader({ alg: 'RS256', kid: 'moodle-1' })
    .setIssuer(ISS)
    .setAudience(aud)
    .setSubject(sub)
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(pkey);
}

async function launch(state: string, token: string) {
  const res = await fetch(base + '/lti/launch', { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ state, id_token: token }).toString() });
  const cookie = /cg_session=([^;]+)/.exec(res.headers.get('set-cookie') ?? '')?.[1];
  return { status: res.status, location: res.headers.get('location'), cookie, setCookie: res.headers.get('set-cookie'), text: res.status >= 400 ? await res.text() : '' };
}

const api = (path: string, token: string, method = 'GET', body?: unknown) =>
  fetch(base + path, { method, headers: { authorization: 'Bearer ' + token, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined }).then(async (r) => ({ status: r.status, json: await r.json() as any }));

describe('LTI 1.3', () => {
  it('Rollen: Lehrkraft schlägt Lernende, Admins nur Lehrkraft, Mentoren nichts', () => {
    expect(mapRole(['http://purl.imsglobal.org/vocab/lis/v2/membership#Instructor', 'http://purl.imsglobal.org/vocab/lis/v2/membership#Learner'])).toBe('teacher');
    expect(mapRole(['http://purl.imsglobal.org/vocab/lis/v2/institution/person#Administrator'])).toBe('teacher');
    expect(mapRole(['http://purl.imsglobal.org/vocab/lis/v2/membership#Mentor'])).toBeNull();
  });

  it('JWKS von Collegare ist öffentlich und gleich bleibend', async () => {
    const a = await (await fetch(base + '/lti/jwks')).json();
    const b = await (await fetch(base + '/lti/jwks')).json();
    expect(a.keys[0].kty).toBe('RSA');
    expect(a.keys[0].d).toBeUndefined();
    expect(a).toEqual(b);
  });

  it('Lehrkraft startet, verbindet ein neues Projekt und übernimmt die Teilnehmenden', async () => {
    const { state, nonce } = await startLogin();
    const l = await launch(state, await idToken(nonce, 'm-mue', 'Instructor'));
    expect(l.status).toBe(303);
    expect(l.location).toMatch(/^https:\/\/collegare\.schule\.test\/collegare\/lti\/\?link=\d+$/);
    expect(l.setCookie).toMatch(/Secure/);
    const linkId = Number(new URL(l.location!).searchParams.get('link'));

    const info = await api(`/api/lti/links/${linkId}`, l.cookie!);
    expect(info.json).toMatchObject({ course: 'S1 Geschichte', teacher: true, projectId: null, projects: [] });

    const created = await api(`/api/lti/links/${linkId}/project`, l.cookie!, 'POST', { title: 'Die Weimarer Republik' });
    expect(created.status).toBe(200);
    expect(created.json.imported).toEqual({ added: 2, total: 2 });
    // Client-Assertion ist mit dem Collegare-Schlüssel signiert
    const req = tokenRequests[0];
    expect(req.grant_type).toBe('client_credentials');
    expect(req.scope).toContain('contextmembership.readonly');
    const jwks = createRemoteJWKSet(new URL(base + '/lti/jwks'));
    const { payload } = await jwtVerify(req.client_assertion, jwks, { audience: pbase + '/token', issuer: CLIENT });
    expect(payload.sub).toBe(CLIENT);

    const p = await api(`/api/projects/${created.json.projectId}`, l.cookie!);
    expect(p.json.role).toBe('teacher');
    expect(p.json.course.moodle).toBe(true);
    expect(p.json.board.members.map((m: any) => m.name).sort()).toEqual(['Anna Adler', 'Ben Bauer']);

    // erneuter Abgleich fügt niemanden doppelt hinzu
    const again = await api(`/api/projects/${created.json.projectId}/moodle-import`, l.cookie!, 'POST', {});
    expect(again.json).toEqual({ added: 0, total: 2 });

    // nächster Start der Lehrkraft geht direkt ins Projekt
    const s2 = await startLogin();
    const l2 = await launch(s2.state, await idToken(s2.nonce, 'm-mue', 'Instructor'));
    expect(l2.location).toBe(`https://collegare.schule.test/collegare/projekt/?id=${created.json.projectId}`);

    // Lernende: Sitzung an das Projekt gebunden, dieselbe Person wie aus der Teilnehmerliste
    const s3 = await startLogin();
    const l3 = await launch(s3.state, await idToken(s3.nonce, 'm-anna', 'Learner'));
    expect(l3.location).toBe(`https://collegare.schule.test/collegare/projekt/?id=${created.json.projectId}`);
    const me = await api('/api/me', l3.cookie!);
    expect(me.json).toMatchObject({ name: 'Anna Adler', projectId: created.json.projectId, teacher: false });
    const view = await api(`/api/projects/${created.json.projectId}`, l3.cookie!);
    expect(view.json.role).toBe('student');
    expect(view.json.board.members.filter((m: any) => m.name === 'Anna Adler')).toHaveLength(1);
    expect((await api(`/api/lti/links/${linkId}/project`, l3.cookie!, 'POST', { title: 'X' })).status).toBe(403);
  });

  it('Lernende vor der Einrichtung landen auf der Warteseite', async () => {
    const { state, nonce } = await startLogin();
    const l = await launch(state, await idToken(nonce, 'm-ben', 'Learner'));
    expect(l.location).toMatch(/\/lti\/\?link=\d+&warten=1$/);
  });

  it('lehnt Wiederholung, falsche Zielgruppe, fremden Schlüssel und falsches Deployment ab', async () => {
    const a = await startLogin();
    const tok = await idToken(a.nonce, 'm-mue', 'Instructor');
    expect((await launch(a.state, tok)).status).toBe(303);
    const replay = await launch(a.state, tok);
    expect(replay.status).toBe(400);
    expect(replay.text).toMatch(/bereits verwendet|Unbekannter/);

    const b = await startLogin();
    expect((await launch(b.state, await idToken(b.nonce, 'm-mue', 'Instructor', {}, 'anderer-client'))).text).toMatch(/id_token ungültig/);

    const c = await startLogin();
    const other = await generateKeyPair('RS256');
    const forged = await new SignJWT({ nonce: c.nonce }).setProtectedHeader({ alg: 'RS256', kid: 'moodle-1' }).setIssuer(ISS).setAudience(CLIENT).setSubject('x').setIssuedAt().setExpirationTime('5m').sign(other.privateKey);
    expect((await launch(c.state, forged)).text).toMatch(/id_token ungültig/);

    const d = await startLogin();
    expect((await launch(d.state, await idToken(d.nonce, 'm-mue', 'Instructor', { [C + 'deployment_id']: '99' }))).text).toMatch(/Deployment/);

    const e = await startLogin();
    expect((await launch(e.state, await idToken('falsch', 'm-mue', 'Instructor'))).text).toMatch(/Nonce/);
  });

  it('unbekannte Plattform beim Login', async () => {
    const res = await fetch(`${base}/lti/login?iss=https%3A%2F%2Ffremd.test&login_hint=1&target_link_uri=x`, { redirect: 'manual' });
    expect(res.status).toBe(400);
    expect(await res.text()).toMatch(/nicht eingetragen/);
  });

  it('Moodle-Verbindung zeigt die Werte für Moodle', async () => {
    const at = (await (await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ login: 'admin', password: 'geheim-geheim' }) })).json()).token;
    const r = await api('/api/admin/lti', at);
    expect(r.json.tool.loginUrl).toBe('https://collegare.schule.test/collegare/lti/login');
    expect(r.json.platforms).toHaveLength(1);
  });
});
