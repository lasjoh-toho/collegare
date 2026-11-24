import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { answerJson } from '../src/ai/ocr.js';
import { buildApp, type App } from '../src/app.js';
import { createServices, type Services } from '../src/services.js';

type J = Record<string, any>;
const JPEG = Buffer.from('ffd8ffe000104a46494600010100000100010000ffd9', 'hex');

describe('Antwort der KI lesen', () => {
  it('JSON aus Denkteil und Codeblock lösen', () => {
    expect(answerJson('<think>hm</think>\n```json\n{"text":"Hallo"}\n```')).toEqual({ text: 'Hallo' });
    expect(answerJson('Hier: {"text":"a\\nb"} fertig')).toEqual({ text: 'a\nb' });
    expect(answerJson('kein json')).toBeNull();
  });
});

describe('KI-Modellkarten und Texterkennung', () => {
  let app: App;
  let s: Services;
  let base: string;
  const calls: { url: string; body: J; auth?: string }[] = [];
  let answer: () => Response = () => new Response(JSON.stringify({ choices: [{ message: { content: '{"text":"Liebe Tante,\\nwie geht es dir?"}' } }], usage: { prompt_tokens: 900, completion_tokens: 12 } }));
  const fakeFetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    if (u.startsWith('http://127.0.0.1')) return fetch(url, init);
    calls.push({ url: u, body: JSON.parse(String(init?.body)), auth: (init?.headers as Record<string, string>)?.authorization });
    return answer();
  }) as typeof fetch;

  beforeEach(async () => {
    calls.length = 0;
    s = await createServices({ databaseUrl: 'sqlite::memory:', appUrl: 'http://localhost/collegare', cookieSecure: false, accessCodeDays: 14 }, Date.now, fakeFetch);
    app = await buildApp({ services: s });
    await app.http.listen({ port: 0, host: '127.0.0.1' });
    base = `http://127.0.0.1:${(app.http.server.address() as AddressInfo).port}`;
  });
  afterEach(async () => {
    await app.http.close();
  });

  async function call(method: string, path: string, token?: string, body?: unknown, raw?: Buffer) {
    const res = await fetch(base + path, {
      method,
      headers: { ...(raw ? { 'content-type': 'application/octet-stream' } : body !== undefined ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: 'Bearer ' + token } : {}) },
      body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined),
    });
    return { status: res.status, json: (await res.json().catch(() => ({}))) as J };
  }

  async function setup() {
    const aid = await s.accounts.create('admin', 'Admin', 'geheim-geheim');
    await s.users.grant(aid, await s.contexts.system(), 'admin');
    const at = (await call('POST', '/api/auth/login', undefined, { login: 'admin', password: 'geheim-geheim' })).json.token as string;
    await call('POST', '/api/admin/teachers', at, { login: 'mue', name: 'Frau Müller', password: 'passwort-123' });
    const t = (await call('POST', '/api/auth/login', undefined, { login: 'mue', password: 'passwort-123' })).json.token as string;
    const course = (await call('POST', '/api/courses', t, { title: 'S1' })).json.id as number;
    const project = (await call('POST', '/api/projects', t, { courseId: course, title: 'Weimar' })).json.id as number;
    const ids = (await call('POST', `/api/projects/${project}/students`, t, { names: ['Anna'] })).json.ids as number[];
    const g = (await call('POST', `/api/projects/${project}/groups`, t, { title: 'Inflation' })).json.id;
    await call('POST', `/api/projects/${project}/moves`, t, { userId: ids[0], groupId: g, position: 0 });
    const codes = (await call('POST', `/api/projects/${project}/access-codes`, t, { userIds: ids })).json.codes as J[];
    const anna = (await call('POST', '/api/access/redeem', undefined, { code: codes[0].code })).json.token as string;
    return { at, t, project, anna, scope: 'g' + g };
  }

  it('Karten anlegen, Schlüssel bleibt geheim, Export und Import wie Autogra.fi', async () => {
    const { at, t } = await setup();
    expect((await call('GET', '/api/admin/ki-karten', t)).status).toBe(403);
    expect((await call('POST', '/api/admin/ki-karten', at, { name: 'Gemini', type: 'gemini', model: 'gemini-2.5-flash' })).json.error).toMatch(/Schlüssel/);
    expect((await call('POST', '/api/admin/ki-karten', at, { name: 'X', type: 'openai', url: 'http://mistral.example/v1', model: 'm' })).json.error).toMatch(/Verschlüsselung/);
    const g = await call('POST', '/api/admin/ki-karten', at, { name: 'Gemini', type: 'gemini', model: 'gemini-2.5-flash', apiKey: 'geheim123', uses: ['ocr'] });
    expect(g.json.card).toMatchObject({ hasKey: true, region: 'other', url: 'https://generativelanguage.googleapis.com/v1beta/openai' });
    expect(JSON.stringify(g.json)).not.toContain('geheim123');
    // Ändern ohne Schlüssel lässt ihn stehen
    const u = await call('PUT', `/api/admin/ki-karten/${g.json.card.id}`, at, { name: 'Gemini Flash', type: 'gemini', model: 'gemini-2.5-flash', uses: ['ocr'] });
    expect(u.json.card).toMatchObject({ name: 'Gemini Flash', hasKey: true });

    const exp = (await call('GET', '/api/admin/ki-karten/export', at)).json;
    expect(exp).toMatchObject({ format: 'autografi-modellkarten', version: 1, assigned: { ocr: 0 } });
    expect(JSON.stringify(exp)).not.toContain('geheim123');

    // Datei aus Autogra.fi: LanguageTool fällt weg, Ollama kommt mit, Zuordnung ocr über den Index
    const file = {
      format: 'autografi-modellkarten',
      version: 1,
      cards: [
        { name: 'LT', type: 'languagetool', url: 'http://lt:8010', model: 'LanguageTool', uses: ['languagetool'] },
        { name: 'Qwen', type: 'ollama', url: 'http://ollama.schule:11434', model: 'qwen2.5vl:7b', region: 'self-hosted', uses: ['ocr', 'grading'] },
        { name: 'Gemini Flash', type: 'gemini', url: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-2.5-flash', uses: [] },
      ],
      assigned: { ocr: 1 },
    };
    const imp = (await call('POST', '/api/admin/ki-karten/import', at, { file })).json;
    expect(imp).toMatchObject({ created: 1, skipped: 2 });
    expect(imp.cards.map((c: J) => [c.name, c.uses])).toEqual([
      ['Gemini Flash', ['ocr']],
      ['Qwen', ['ocr']],
    ]);
    // Vorrang: Qwen nach oben
    const up = (await call('POST', `/api/admin/ki-karten/${imp.cards[1].id}/hoch`, at)).json;
    expect(up.cards[0].name).toBe('Qwen');
    expect((await s.aiCards.forUse('ocr'))?.name).toBe('Qwen');
  });

  it('erkennt Text eines Bildes, Lehrkraft kann abschalten, Herkunft im Einfüge-Protokoll', async () => {
    const { at, t, project, anna, scope } = await setup();
    expect((await call('GET', `/api/projects/${project}/texterkennung`, anna)).json).toMatchObject({ available: false, reason: expect.stringMatching(/KI-Dienst/) });
    expect((await call('POST', `/api/projects/${project}/notizen/erkennen`, anna, undefined, JPEG)).status).toBe(403);

    await call('POST', '/api/admin/ki-karten', at, { name: 'Mistral', type: 'openai', url: 'https://api.mistral.ai/v1/chat/completions', model: 'pixtral', apiKey: 'k1', uses: ['ocr'] });
    expect((await call('GET', `/api/projects/${project}/texterkennung`, anna)).json).toEqual({ available: true });
    const r = await call('POST', `/api/projects/${project}/notizen/erkennen`, anna, undefined, JPEG);
    expect(r).toMatchObject({ status: 200, json: { text: 'Liebe Tante,\nwie geht es dir?' } });
    expect(calls[0].url).toBe('https://api.mistral.ai/v1/chat/completions');
    expect(calls[0].auth).toBe('Bearer k1');
    expect(calls[0].body.messages[1].content[1].image_url.url).toMatch(/^data:image\/jpeg;base64,/);
    // kein Bild
    expect((await call('POST', `/api/projects/${project}/notizen/erkennen`, anna, undefined, Buffer.from('hallo'))).status).toBe(415);

    // Fehler des Dienstes kommen lesbar an
    answer = () => new Response(JSON.stringify({ error: { message: 'quota exceeded' } }), { status: 429 });
    expect((await call('POST', `/api/projects/${project}/notizen/erkennen`, anna, undefined, JPEG)).json.error).toMatch(/ausgelastet/);
    answer = () => new Response(JSON.stringify({ choices: [{ message: { content: 'Ich kann das nicht lesen.' } }] }));
    expect((await call('POST', `/api/projects/${project}/notizen/erkennen`, anna, undefined, JPEG)).json.error).toMatch(/keinen Text/);

    // Notiz speichern und Erkennung als Herkunft protokollieren
    const note = await s.notes.add(project, scope, (await s.sessions.resolve(anna))!.userId, { kind: 'note', title: 'Brief', body: 'Liebe Tante', source: '', url: null, credit: '', license: '', origin: null } as any);
    expect((await call('POST', `/api/projects/${project}/notizen/${note.id}/erkannt`, anna, { text: 'Liebe Tante,\nwie geht es dir?' })).status).toBe(200);
    const spur = (await call('GET', `/api/projects/${project}/einfuegen/spur?ziel=note:${note.id}`, t)).json;
    expect(spur.pastes).toMatchObject([{ origin: 'hand', text: 'Liebe Tante,\nwie geht es dir?' }]);
    // fremde Notiz: nein
    expect((await call('POST', `/api/projects/${project}/notizen/${note.id}/erkannt`, t, { text: 'x' })).status).toBe(404);

    // Lehrkraft schaltet ab
    const put = await call('PATCH', `/api/projects/${project}`, t, { settings: { notesOcr: false } });
    expect(put.status).toBe(200);
    expect((await call('GET', `/api/projects/${project}/texterkennung`, anna)).json).toMatchObject({ available: false, reason: expect.stringMatching(/Lehrkraft/) });
  });
});
