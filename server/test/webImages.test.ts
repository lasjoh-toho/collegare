import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { io as ioc, type Socket } from 'socket.io-client';
import { buildApp, type App } from '../src/app.js';
import { createServices, type Services } from '../src/services.js';
import { ccName, parsePage, sniffImage, wikimediaFile } from '../src/projects/webImport.js';

type J = Record<string, any>;
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8cfc0f01f0005000201ffa6b1e5a50000000049454e44ae426082', 'hex');

describe('Seiten lesen ohne DOM', () => {
  it('Metadaten, Lizenz, Bilder mit Bildunterschrift; Zählpixel und data: fallen weg', () => {
    const html = `<!doctype html><html><head><title>Inflation &amp; Not</title>
      <meta property="og:site_name" content="LeMO"><meta name="author" content="Anna Autorin">
      <meta property="og:image" content="/bilder/titel.jpg"><link rel="license" href="https://creativecommons.org/licenses/by-sa/4.0/">
      </head><body><figure><img src="geld.jpg" alt="Geldscheine" width="800"><figcaption>Banknoten, <b>1923</b></figcaption></figure>
      <img src="/px.gif" width="1" height="1"><img src="data:image/png;base64,xx"><img data-src="https://cdn.example/b.png" srcset="https://cdn.example/b-400.png 400w, https://cdn.example/b-1200.png 1200w" alt="Brot"></body></html>`;
    const p = parsePage(html, 'https://www.dhm.de/lemo/kapitel/inflation.html');
    expect(p).toMatchObject({ title: 'Inflation & Not', site: 'LeMO', author: 'Anna Autorin', license: 'CC BY-SA 4.0' });
    expect(p.images.map((i) => i.url)).toEqual(['https://www.dhm.de/bilder/titel.jpg', 'https://www.dhm.de/lemo/kapitel/geld.jpg', 'https://cdn.example/b-1200.png']);
    expect(p.images[1]).toMatchObject({ alt: 'Geldscheine', caption: 'Banknoten, 1923', width: 800 });
  });

  it('Wikimedia-Dateien aus Bild- und Seitenadressen', () => {
    expect(wikimediaFile('https://upload.wikimedia.org/wikipedia/commons/thumb/a/a1/Banknote_1923.jpg/800px-Banknote_1923.jpg')).toEqual({ host: 'commons.wikimedia.org', file: 'Banknote_1923.jpg' });
    expect(wikimediaFile('https://upload.wikimedia.org/wikipedia/de/0/0b/Logo.png')).toEqual({ host: 'de.wikipedia.org', file: 'Logo.png' });
    expect(wikimediaFile('https://de.m.wikipedia.org/wiki/Deutsche_Inflation_1914_bis_1923#/media/Datei:Geld_als_Tapete.jpg')).toEqual({ host: 'de.wikipedia.org', file: 'Geld als Tapete.jpg' });
    expect(wikimediaFile('https://commons.wikimedia.org/wiki/File:A_b.png')).toEqual({ host: 'commons.wikimedia.org', file: 'A b.png' });
    expect(wikimediaFile('https://de.wikipedia.org/wiki/Inflation')).toBeNull();
    expect(ccName('https://creativecommons.org/publicdomain/zero/1.0/')).toBe('CC0 1.0');
  });

  it('erkennt Bilder an den Bytes, nicht am Content-Type', () => {
    expect(sniffImage(PNG)).toBe('image/png');
    expect(sniffImage(Buffer.from('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBe('image/svg+xml');
    expect(sniffImage(Buffer.from('<html><body>kein Bild</body></html>'))).toBeNull();
  });
});

describe('Bilder aus dem Netz in Notizen und Quellen', () => {
  let srv: http.Server;
  let web = '';
  beforeAll(async () => {
    srv = http.createServer((req, res) => {
      if (req.url === '/bild.png') return res.writeHead(200, { 'content-type': 'application/octet-stream' }).end(PNG);
      if (req.url === '/seite.html')
        return res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(`<title>Brot und Geld</title><meta name="author" content="Ben Bild"><a rel="license" href="https://creativecommons.org/licenses/by/4.0/">CC</a><figure><img src="/bild.png" width="400"><figcaption>Bäckerei 1923</figcaption></figure>`);
      res.writeHead(404).end();
    });
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
    web = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((r) => srv.close(() => r())));

  let app: App;
  let s: Services;
  let base: string;
  const sockets: Socket[] = [];
  beforeEach(async () => {
    s = await createServices({ databaseUrl: 'sqlite::memory:', appUrl: 'http://localhost/collegare', cookieSecure: false, accessCodeDays: 14 });
    app = await buildApp({ services: s, webAllowed: (ip) => ip === '127.0.0.1' });
    await app.http.listen({ port: 0, host: '127.0.0.1' });
    base = `http://127.0.0.1:${(app.http.server.address() as AddressInfo).port}`;
  });
  afterEach(async () => {
    sockets.splice(0).forEach((x) => x.disconnect());
    await app.http.close();
  });

  async function call(method: string, path: string, token?: string, body?: unknown, raw?: Buffer) {
    const res = await fetch(base + path, {
      method,
      headers: { ...(raw ? { 'content-type': 'application/octet-stream' } : body !== undefined ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: 'Bearer ' + token } : {}) },
      body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined),
    });
    const buf = Buffer.from(await res.arrayBuffer());
    let json: J = {};
    try {
      json = JSON.parse(buf.toString('utf8'));
    } catch {
      /* Bild */
    }
    return { status: res.status, json, buf, type: res.headers.get('content-type'), csp: res.headers.get('content-security-policy') };
  }
  const emit = (sock: Socket, ev: string, msg: unknown) => new Promise<J>((r) => sock.emit(ev, msg, r));

  async function setup() {
    const aid = await s.accounts.create('admin', 'Admin', 'geheim-geheim');
    await s.users.grant(aid, await s.contexts.system(), 'admin');
    const at = (await call('POST', '/api/auth/login', undefined, { login: 'admin', password: 'geheim-geheim' })).json.token;
    await call('POST', '/api/admin/teachers', at, { login: 'mue', name: 'Frau Müller', password: 'passwort-123' });
    const t = (await call('POST', '/api/auth/login', undefined, { login: 'mue', password: 'passwort-123' })).json.token as string;
    const course = (await call('POST', '/api/courses', t, { title: 'S1' })).json.id as number;
    const project = (await call('POST', '/api/projects', t, { courseId: course, title: 'Weimar' })).json.id as number;
    const ids = (await call('POST', `/api/projects/${project}/students`, t, { names: ['Anna', 'Clara'] })).json.ids as number[];
    const g1 = (await call('POST', `/api/projects/${project}/groups`, t, { title: 'Inflation' })).json.id;
    const g2 = (await call('POST', `/api/projects/${project}/groups`, t, { title: 'Kultur' })).json.id;
    await call('POST', `/api/projects/${project}/moves`, t, { userId: ids[0], groupId: g1, position: 0 });
    await call('POST', `/api/projects/${project}/moves`, t, { userId: ids[1], groupId: g2, position: 0 });
    const codes = (await call('POST', `/api/projects/${project}/access-codes`, t, { userIds: ids })).json.codes as J[];
    const anna = (await call('POST', '/api/access/redeem', undefined, { code: codes[0].code })).json.token as string;
    const clara = (await call('POST', '/api/access/redeem', undefined, { code: codes[1].code })).json.token as string;
    return { t, project, anna, clara, scope: 'g' + g1 };
  }

  it('holt Bilder über den Server, liest Seiten, legt Bildquellen mit Datei an', async () => {
    const { t, project, anna, clara, scope } = await setup();
    expect((await call('GET', '/api/bild-holen?url=' + encodeURIComponent(web + '/bild.png'))).status).toBe(401);
    const img = await call('GET', '/api/bild-holen?url=' + encodeURIComponent(web + '/bild.png'), anna);
    expect(img).toMatchObject({ status: 200, type: 'image/png' });
    expect(img.csp).toMatch(/sandbox/);
    const notImg = await call('GET', '/api/bild-holen?url=' + encodeURIComponent(web + '/seite.html'), anna);
    expect(notImg).toMatchObject({ status: 415, json: { code: 'notimage', page: true } });
    expect((await call('GET', '/api/bild-holen?url=' + encodeURIComponent('http://10.0.0.1/x.png'), anna)).status).toBe(400);

    const page = (await call('GET', '/api/seite-lesen?url=' + encodeURIComponent(web + '/seite.html'), anna)).json;
    expect(page).toMatchObject({ title: 'Brot und Geld', author: 'Ben Bild', license: 'CC BY 4.0', images: [{ url: web + '/bild.png', caption: 'Bäckerei 1923' }] });
    const info = (await call('GET', `/api/bild-info?url=${encodeURIComponent(web + '/bild.png')}&seite=${encodeURIComponent(web + '/seite.html')}`, anna)).json;
    expect(info).toMatchObject({ title: 'Bäckerei 1923', credit: 'Ben Bild', license: 'CC BY 4.0', origin: web + '/seite.html', via: 'page' });

    // Datei: vom Server geholt oder hochgeladen; fremde Gruppe und Nicht-Bilder abgewiesen
    const up = (await call('POST', `/api/projects/${project}/notizen/datei`, anna, { scope, url: web + '/bild.png' })).json;
    expect(up).toMatchObject({ mime: 'image/png', size: PNG.length });
    expect((await call('POST', `/api/projects/${project}/notizen/datei?scope=${scope}`, clara, undefined, PNG)).status).toBe(403);
    expect((await call('POST', `/api/projects/${project}/notizen/datei?scope=${scope}`, anna, undefined, Buffer.from('<html>'))).status).toBe(415);
    const up2 = (await call('POST', `/api/projects/${project}/notizen/datei?scope=${scope}&name=foto.png`, anna, undefined, PNG)).json;
    expect(up2.file).toMatch(/foto\.png$/);

    const sa = ioc(base + '/project', { path: '/socket.io', auth: { token: anna }, transports: ['websocket'], forceNew: true });
    sockets.push(sa);
    await emit(sa, 'notes:join', { projectId: project });
    expect((await emit(sa, 'notes:add', { projectId: project, scope, note: { kind: 'image', title: 'ohne Datei' } })).error).toBe('Bild fehlt');
    expect((await emit(sa, 'notes:add', { projectId: project, scope, note: { kind: 'image', file: '../../etc/passwd' } })).ok).toBe(false);
    const add = await emit(sa, 'notes:add', { projectId: project, scope, note: { kind: 'image', title: 'Bäckerei 1923', file: up.file, credit: 'Ben Bild', license: 'CC BY 4.0', url: web + '/bild.png', origin: web + '/seite.html' } });
    expect(add.ok).toBe(true);
    // dieselbe Datei an zweiter Notiz: nein
    expect((await emit(sa, 'notes:add', { projectId: project, scope, note: { kind: 'image', file: up.file } })).ok).toBe(false);
    const notes = (await emit(sa, 'notes:join', { projectId: project })).notes as J[];
    expect(notes[0]).toMatchObject({ kind: 'image', credit: 'Ben Bild', license: 'CC BY 4.0', origin: web + '/seite.html', file: { mime: 'image/png', size: PNG.length } });
    const file = await call('GET', `/api/projects/${project}/notizen/${add.id}/datei`, anna);
    expect(file).toMatchObject({ status: 200, type: 'image/png' });
    expect(file.buf.equals(PNG)).toBe(true);
    expect((await call('GET', `/api/projects/${project}/notizen/${add.id}/datei`, clara)).status).toBe(404);

    // Datei tauschen: die alte verschwindet
    expect((await emit(sa, 'notes:update', { projectId: project, id: add.id, note: { kind: 'image', title: 'Bäckerei', file: up2.file } })).ok).toBe(true);
    expect(await s.notes.files!.read(up.file)).toBeNull();
    expect((await emit(sa, 'notes:delete', { projectId: project, id: add.id })).ok).toBe(true);
    expect(await s.notes.files!.read(up2.file)).toBeNull();

    // Tonaufnahme (MediaRecorder-WebM) und Handschrift (Konzept 8e.5)
    const WEBM = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(2000, 7)]);
    const au = (await call('POST', `/api/projects/${project}/notizen/datei?scope=${scope}&name=aufnahme.webm`, anna, undefined, WEBM)).json;
    expect(au).toMatchObject({ mime: 'video/webm', size: WEBM.length });
    expect((await emit(sa, 'notes:add', { projectId: project, scope, note: { kind: 'audio', title: 'ohne' } })).error).toBe('Tonaufnahme fehlt');
    expect((await emit(sa, 'notes:add', { projectId: project, scope, note: { kind: 'hand', file: au.file } })).error).toBe('Die Datei passt nicht zu dieser Art');
    const audio = await emit(sa, 'notes:add', { projectId: project, scope, note: { kind: 'audio', title: 'Interview Oma', file: au.file } });
    expect(audio.ok).toBe(true);
    const part = await fetch(base + `/api/projects/${project}/notizen/${audio.id}/datei`, { headers: { authorization: 'Bearer ' + anna, range: 'bytes=0-99' } });
    expect(part.status).toBe(206);
    expect(part.headers.get('content-type')).toMatch(/^audio\/webm/);
    expect(part.headers.get('content-range')).toBe(`bytes 0-99/${WEBM.length}`);
    expect((await part.arrayBuffer()).byteLength).toBe(100);
    expect((await emit(sa, 'notes:add', { projectId: project, scope, note: { kind: 'video', title: 'Film', url: 'https://example.org/film' } })).ok).toBe(true);
    // Ton und Video lassen sich ausschalten (Wunsch Jo, 20. November 2026); Video-Links bleiben
    expect((await call('PATCH', `/api/projects/${project}`, t, { settings: { notesVideo: false } })).status).toBe(200);
    const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypisom'), Buffer.alloc(2000, 1)]);
    expect((await call('POST', `/api/projects/${project}/notizen/datei?scope=${scope}&name=film.mp4`, anna, undefined, MP4)).json).toMatchObject({ code: 'off' });
    expect((await call('POST', `/api/projects/${project}/notizen/datei?scope=${scope}&name=a.webm&art=audio`, anna, undefined, WEBM)).status).toBe(200);
    expect((await call('PATCH', `/api/projects/${project}`, t, { settings: { notesAudio: false, notesMediaMb: 1 } })).status).toBe(200);
    expect((await call('POST', `/api/projects/${project}/notizen/datei?scope=${scope}&name=a.webm&art=audio`, anna, undefined, WEBM)).status).toBe(403);
    const ph = (await call('POST', `/api/projects/${project}/notizen/datei?scope=${scope}&name=zettel.png`, anna, undefined, PNG)).json;
    expect((await emit(sa, 'notes:add', { projectId: project, scope, note: { kind: 'hand', body: 'Ursachen der Inflation: Kriegsschulden', file: ph.file } })).ok).toBe(true);
  });
});
