import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp, type App } from '../src/app.js';

// Auslieferung der gebauten Oberflächen wie im Release-Paket
let app: App;
beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cg-static-'));
  const office = join(dir, 'office');
  const client = join(dir, 'client');
  mkdirSync(join(office, 'editor'), { recursive: true });
  mkdirSync(join(office, 'x2t'), { recursive: true });
  mkdirSync(join(client, 'projekt'), { recursive: true });
  writeFileSync(join(office, 'index.html'), 'office-start');
  writeFileSync(join(office, 'editor.html'), 'editor-seite');
  writeFileSync(join(office, 'editor', 'x.txt'), 'rsc');
  writeFileSync(join(office, 'x2t', 'x2t.wasm'), 'wasm');
  writeFileSync(join(client, 'index.html'), 'start');
  writeFileSync(join(client, 'projekt', 'index.html'), 'projekt');
  app = await buildApp({ officeDir: office, clientDir: client });
});
afterAll(() => app.http.close());

describe('statische Dateien', () => {
  it('liefert Seiten der Office-Editoren ohne .html', async () => {
    for (const url of ['/office/editor', '/office/editor/', '/office/editor?file=a.docx']) {
      const r = await app.http.inject({ url });
      expect(r.statusCode, url).toBe(200);
      expect(r.body).toBe('editor-seite');
    }
    expect((await app.http.inject({ url: '/office/' })).body).toBe('office-start');
  });

  it('setzt Content-Encoding br für x2t', async () => {
    const r = await app.http.inject({ url: '/office/x2t/x2t.wasm' });
    expect(r.headers['content-encoding']).toBe('br');
  });

  it('liefert die Projektoberfläche', async () => {
    expect((await app.http.inject({ url: '/' })).body).toBe('start');
    expect((await app.http.inject({ url: '/projekt/?id=1' })).body).toBe('projekt');
  });
});
