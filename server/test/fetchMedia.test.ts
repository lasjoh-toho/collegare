import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fetchMedia, isPublicAddress, mediaMime } from '../src/pinnwand/fetchMedia.js';

describe('Medien von einer Adresse (Pinnwand)', () => {
  let srv: http.Server;
  let base = '';
  beforeAll(async () => {
    srv = http.createServer((req, res) => {
      if (req.url === '/weiter') return res.writeHead(302, { location: '/bild.png' }).end();
      if (req.url === '/ins-netz') return res.writeHead(302, { location: 'http://10.0.0.1/geheim.png' }).end();
      if (req.url === '/gross.mp3') return res.writeHead(200, { 'content-type': 'audio/mpeg' }).end(Buffer.alloc(5000));
      if (req.url === '/bild.png') return res.writeHead(200, { 'content-type': 'application/octet-stream' }).end(Buffer.from([137, 80, 78, 71]));
      res.writeHead(404).end();
    });
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((r) => srv.close(() => r())));

  const loopback = (ip: string) => ip === '127.0.0.1';

  it('nur öffentliche Adressen', async () => {
    expect(isPublicAddress('8.8.8.8')).toBe(true);
    for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.0.5', '172.20.0.1', '169.254.169.254', '::1', 'fd00::1', '::ffff:127.0.0.1', '::ffff:7f00:1']) expect(isPublicAddress(ip)).toBe(false);
    expect(await fetchMedia(base + '/bild.png', 1000)).toEqual({ error: 'invalid' });
    expect(await fetchMedia('file:///etc/passwd', 1000)).toEqual({ error: 'invalid' });
  });

  it('lädt, folgt Weiterleitungen und prüft jede Station', async () => {
    const r = await fetchMedia(base + '/weiter', 1000, loopback);
    expect(r).toMatchObject({ name: 'bild.png' });
    expect('data' in r && r.data.length).toBe(4);
    expect(mediaMime('application/octet-stream', 'bild.png')).toBe('image/png');
    expect(await fetchMedia(base + '/ins-netz', 1000, loopback)).toEqual({ error: 'invalid' });
    expect(await fetchMedia(base + '/gross.mp3', 1000, loopback)).toEqual({ error: 'toolarge' });
    expect(await fetchMedia(base + '/fehlt', 1000, loopback)).toEqual({ error: 'download' });
  });
});
