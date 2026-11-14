/**
 * Medien von einer Adresse übernehmen (slidemedia.php, action=url): Der Server lädt die Datei und legt sie wie ein
 * Hochladen ab. Damit niemand über die Pinnwand ins Schulnetz greift, sind nur öffentliche Adressen erlaubt; die
 * geprüfte IP wird für die Verbindung festgehalten (kein Umweg über DNS-Rebinding), Weiterleitungen werden einzeln
 * geprüft. Grenzen: höchstens 3 Weiterleitungen, 30 Sekunden, maxBytes.
 */
import { lookup } from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import { BlockList, isIP } from 'node:net';

const blocked = new BlockList();
for (const [net, bits] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 3],
] as const)
  blocked.addSubnet(net, bits, 'ipv4');
for (const [net, bits] of [
  ['::', 128],
  ['::1', 128],
  ['64:ff9b::', 96],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const)
  blocked.addSubnet(net, bits, 'ipv6');

export const isPublicAddress = (raw: string) => {
  // IPv4 in IPv6 (::ffff:10.0.0.1) wie IPv4 prüfen
  const ip = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(raw)?.[1] ?? raw;
  const v = isIP(ip);
  if (v === 6 && /^::ffff:/i.test(ip)) return false;
  return v !== 0 && !blocked.check(ip, v === 4 ? 'ipv4' : 'ipv6');
};

export type FetchError = 'invalid' | 'download' | 'toolarge';
export type Fetched = { data: Buffer; mime: string; name: string } | { error: FetchError };

async function resolvePublic(host: string, ok: (ip: string) => boolean): Promise<{ address: string; family: number } | null> {
  const h = host.replace(/^\[|\]$/g, '');
  const all = isIP(h) ? [{ address: h, family: isIP(h) }] : await lookup(h, { all: true }).catch(() => []);
  if (!all.length || !all.every((a) => ok(a.address))) return null;
  return all[0];
}

function getOnce(url: URL, addr: { address: string; family: number }, maxBytes: number, deadline: number): Promise<{ status: number; location?: string; mime: string; data?: Buffer; error?: FetchError }> {
  return new Promise((resolve) => {
    const mod = url.protocol === 'https:' ? https : http;
    const req = mod.get(
      url,
      {
        headers: { 'user-agent': 'Collegare-Pinnwand', accept: 'image/*,audio/*,video/*;q=0.9,*/*;q=0.1' },
        timeout: Math.max(1000, deadline - Date.now()),
        // geprüfte Adresse festhalten
        lookup: ((_h: string, opts: { all?: boolean }, cb: (...a: unknown[]) => void) =>
          opts?.all ? cb(null, [{ address: addr.address, family: addr.family }]) : cb(null, addr.address, addr.family)) as never,
      },
      (res) => {
        const status = res.statusCode ?? 0;
        const mime = String(res.headers['content-type'] ?? '');
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume();
          return resolve({ status, location: res.headers.location, mime });
        }
        if (status !== 200) {
          res.resume();
          return resolve({ status, mime, error: 'download' });
        }
        if (Number(res.headers['content-length'] ?? 0) > maxBytes) {
          res.destroy();
          return resolve({ status, mime, error: 'toolarge' });
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (ch: Buffer) => {
          size += ch.length;
          if (size > maxBytes) {
            res.destroy();
            resolve({ status, mime, error: 'toolarge' });
          } else chunks.push(ch);
        });
        res.on('end', () => resolve({ status, mime, data: Buffer.concat(chunks) }));
        res.on('error', () => resolve({ status, mime, error: 'download' }));
      },
    );
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve({ status: 0, mime: '', error: 'download' }));
  });
}

/** allowed ist nur für Tests austauschbar */
export async function fetchMedia(raw: string, maxBytes: number, allowed: (ip: string) => boolean = isPublicAddress): Promise<Fetched> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { error: 'invalid' };
  }
  const deadline = Date.now() + 30_000;
  for (let hop = 0; hop <= 3; hop++) {
    if (!/^https?:$/.test(url.protocol) || url.username || url.password) return { error: 'invalid' };
    const addr = await resolvePublic(url.hostname, allowed);
    if (!addr) return { error: 'invalid' };
    const r = await getOnce(url, addr, maxBytes, deadline);
    if (r.location) {
      try {
        url = new URL(r.location, url);
      } catch {
        return { error: 'download' };
      }
      continue;
    }
    if (r.error || !r.data) return { error: r.error ?? 'download' };
    const name = decodeURIComponent(url.pathname.split('/').pop() || 'download').replace(/[^\w.-]+/g, '_').slice(0, 100) || 'download';
    return { data: r.data, mime: r.mime, name };
  }
  return { error: 'download' };
}

/** MIME aus der Dateiendung, wenn der Server keinen passenden Typ schickt (wie mimeinfo in Moodle) */
const BY_EXT: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif',
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', oga: 'audio/ogg', m4a: 'audio/mp4', aac: 'audio/aac', flac: 'audio/flac', opus: 'audio/opus',
  mp4: 'video/mp4', webm: 'video/webm', ogv: 'video/ogg', mov: 'video/quicktime', m4v: 'video/mp4',
};
export function mediaMime(mime: string, name: string): string {
  const m = mime.toLowerCase().split(';')[0].trim();
  if (/^(image|audio|video)\//.test(m)) return m;
  return BY_EXT[/\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase() ?? ''] ?? m;
}
