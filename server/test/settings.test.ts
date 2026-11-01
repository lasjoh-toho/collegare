import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import { buildApp, type App } from '../src/app.js';
import { createServices, type Services } from '../src/services.js';
import { DEFAULT_SETTINGS, allowedExtensions, parseSettings } from '../src/projects/settings.js';

let app: App;
let s: Services;
let base: string;
type J = Record<string, any>;

beforeEach(async () => {
  s = await createServices({ databaseUrl: 'sqlite::memory:', appUrl: 'http://localhost/collegare', cookieSecure: false, accessCodeDays: 14 });
  app = await buildApp({ services: s });
  await app.http.listen({ port: 0, host: '127.0.0.1' });
  base = `http://127.0.0.1:${(app.http.server.address() as AddressInfo).port}`;
});
afterEach(async () => {
  await app.http.close();
});

async function call(method: string, path: string, token?: string, body?: unknown) {
  const res = await fetch(base + path, {
    method,
    headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: 'Bearer ' + token } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as J };
}

async function setup() {
  const aid = await s.accounts.create('admin', 'Admin', 'geheim-geheim');
  await s.users.grant(aid, await s.contexts.system(), 'admin');
  const at = (await call('POST', '/api/auth/login', undefined, { login: 'admin', password: 'geheim-geheim' })).json.token as string;
  await call('POST', '/api/admin/teachers', at, { login: 'mue', name: 'Frau Müller', password: 'passwort-123' });
  const t = (await call('POST', '/api/auth/login', undefined, { login: 'mue', password: 'passwort-123' })).json.token as string;
  const course = (await call('POST', '/api/courses', t, { title: 'S1' })).json.id;
  const project = (await call('POST', '/api/projects', t, { courseId: course, title: 'Projekt' })).json.id as number;
  const ids = (await call('POST', `/api/projects/${project}/students`, t, { names: ['Anna', 'Ben', 'Clara'] })).json.ids as number[];
  const codes = (await call('POST', `/api/projects/${project}/access-codes`, t, { userIds: ids })).json.codes as J[];
  const st: string[] = [];
  for (const c of codes) st.push((await call('POST', '/api/access/redeem', undefined, { code: c.code })).json.token);
  return { at, t, project, ids, st };
}

describe('Einstellungen lesen', () => {
  it('füllt fehlende Felder auf und verwirft ungültige', () => {
    const s1 = parseSettings(JSON.stringify({ studentsSetTopic: false, groupMax: 'viele', docTypes: { sheet: true }, revision: 3 }));
    expect(s1.studentsSetTopic).toBe(false);
    expect(s1.groupMax).toBe(DEFAULT_SETTINGS.groupMax);
    expect(s1.docTypes).toEqual({ ...DEFAULT_SETTINGS.docTypes, sheet: true });
    expect(s1.revision).toBe(3);
    expect(parseSettings('kaputt').revision).toBe(0);
  });

  it('leitet erlaubte Dateiendungen ab', () => {
    const ext = allowedExtensions({ ...DEFAULT_SETTINGS, importTypes: { text: true, slides: false, sheets: false, pdf: false, images: false, bib: true } });
    expect(ext).toEqual(['docx', 'odt', 'rtf', 'txt', 'md', 'bib', 'ris']);
  });
});

describe('Einstellungsseite', () => {
  it('speichert mit Revision und meldet gleichzeitiges Speichern', async () => {
    const { t, project } = await setup();
    const page = (await call('GET', `/api/projects/${project}/settings`, t)).json;
    expect(page.revision).toBe(0);
    expect(page.presets.map((p: J) => p.id)).toContain('facharbeit');
    const r1 = await call('PATCH', `/api/projects/${project}`, t, { settings: { groupFormation: 'choice', groupMax: 2 }, revision: 0 });
    expect(r1.status).toBe(200);
    expect(r1.json.revision).toBe(1);
    const r2 = await call('PATCH', `/api/projects/${project}`, t, { settings: { groupMax: 3 }, revision: 0 });
    expect(r2.status).toBe(409);
    expect((await call('PATCH', `/api/projects/${project}`, t, { settings: { groupMin: 5, groupMax: 3 } })).status).toBe(400);
    expect((await call('PATCH', `/api/projects/${project}`, t, { settings: { groupFormation: 'chaos' } })).status).toBe(400);
  });

  it('der Rahmen der Administration schaltet ab, was er nicht zulässt', async () => {
    const { at, t, project } = await setup();
    const frame = (await call('GET', '/api/admin/frame', at)).json.frame;
    expect((await call('PUT', '/api/admin/frame', at, { ...frame, docTypes: { ...frame.docTypes, sheet: false }, ai: false, maxFileMb: 10 })).status).toBe(200);
    expect((await call('PUT', '/api/admin/frame', t, frame)).status).toBe(403);
    const r = await call('PATCH', `/api/projects/${project}`, t, { settings: { docTypes: { ...DEFAULT_SETTINGS.docTypes, sheet: true }, aiFeedback: true, maxFileMb: 100 } });
    expect(r.json.settings.docTypes.sheet).toBe(false);
    expect(r.json.settings.aiFeedback).toBe(false);
    expect(r.json.settings.maxFileMb).toBe(10);
  });

  it('Lernende sehen die Einstellungsseite nicht', async () => {
    const { project, st } = await setup();
    expect((await call('GET', `/api/projects/${project}/settings`, st[0])).status).toBe(403);
    expect((await call('PATCH', `/api/projects/${project}`, st[0], { settings: { groupFormation: 'open' } })).status).toBe(403);
  });
});

describe('Gruppenbildung durch Lernende', () => {
  it('Lehrkraft-Modus: Lernende können nicht wählen', async () => {
    const { t, project, st } = await setup();
    const g = (await call('POST', `/api/projects/${project}/groups`, t, { title: 'A' })).json.id;
    expect((await call('POST', `/api/projects/${project}/choose`, st[0], { groupId: g })).status).toBe(403);
    expect((await call('POST', `/api/projects/${project}/groups`, st[0], { title: 'Eigene' })).status).toBe(403);
  });

  it('Wahlmodus: Höchstzahl und Schluss-Termin gelten', async () => {
    const { t, project, ids, st } = await setup();
    await call('PATCH', `/api/projects/${project}`, t, { settings: { groupFormation: 'choice', groupMax: 2 } });
    const g = (await call('POST', `/api/projects/${project}/groups`, t, { title: 'A' })).json.id;
    expect((await call('POST', `/api/projects/${project}/choose`, st[0], { groupId: g })).status).toBe(200);
    expect((await call('POST', `/api/projects/${project}/choose`, st[1], { groupId: g })).status).toBe(200);
    // erneut wählen zählt die eigene Person nicht doppelt
    expect((await call('POST', `/api/projects/${project}/choose`, st[1], { groupId: g })).status).toBe(200);
    const full = await call('POST', `/api/projects/${project}/choose`, st[2], { groupId: g });
    expect(full.status).toBe(409);
    expect(full.json.error).toMatch(/voll/);
    // im Wahlmodus keine eigenen Gruppen
    expect((await call('POST', `/api/projects/${project}/groups`, st[2], { title: 'C' })).status).toBe(403);
    // zurück in den Pool
    expect((await call('POST', `/api/projects/${project}/choose`, st[0], { groupId: null })).status).toBe(200);
    const b = (await call('GET', `/api/projects/${project}`, t)).json.board;
    expect(b.members.find((m: J) => m.userId === ids[0]).groupId).toBeNull();

    await call('PATCH', `/api/projects/${project}`, t, { settings: { choiceDeadline: Date.now() - 1000 } });
    const late = await call('POST', `/api/projects/${project}/choose`, st[2], { groupId: g });
    expect(late.status).toBe(403);
    expect(late.json.error).toMatch(/beendet/);
  });

  it('offener Modus: Lernende legen eine Gruppe an und sind gleich drin', async () => {
    const { t, project, ids, st } = await setup();
    await call('PATCH', `/api/projects/${project}`, t, { settings: { groupFormation: 'open' } });
    const g = (await call('POST', `/api/projects/${project}/groups`, st[2], { title: 'Clara-Thema' })).json.id;
    const b = (await call('GET', `/api/projects/${project}`, t)).json.board;
    expect(b.groups.find((x: J) => x.id === g).title).toBe('Clara-Thema');
    expect(b.members.find((m: J) => m.userId === ids[2]).groupId).toBe(g);
  });
});
