/**
 * Bilder aus dem Netz übernehmen (Wunsch Jo, 17. November 2026): Der Browser darf Bilder fremder Seiten zwar zeigen,
 * aber ihre Bytes nicht lesen, solange die fremde Seite das nicht per CORS erlaubt. Der Server unterliegt dieser
 * Sperre nicht: Er holt das Bild (fetchMedia, nur öffentliche Adressen) und reicht es als eigene Adresse weiter.
 *
 * Dazu die Angaben für die Quelle: Urheber, Lizenz und Ursprungsseite. Der Browser verrät beim Ziehen nur die
 * Adresse des Bildes (und ggf. den Link drumherum), nicht die Seite, von der es kommt. Deshalb:
 *  - Wikimedia (Wikipedia, Commons): Urheber und Lizenz kommen aus der Programmierschnittstelle der Seite.
 *  - sonst, wenn die Seite bekannt ist (Link um das Bild, eingefügte Seitenadresse): Titel, Autor, Lizenz aus den
 *    Metadaten der Seite, Bildunterschrift aus <figcaption> oder alt.
 * HTML wird ohne DOM gelesen (reguläre Ausdrücke über die Tags): Es geht nur um Metadaten und <img>-Angaben.
 */
import { fetchMedia, isPublicAddress, type FetchError } from '../pinnwand/fetchMedia.js';

export const IMAGE_MAX_BYTES = 15 * 1024 * 1024;
const PAGE_MAX_BYTES = 3 * 1024 * 1024;
const UA = 'Collegare/1.0 (Schulserver; Bilder fuer Quellenangaben)';
/** höchstens so viele Bilder je Seite in der Auswahl */
export const PAGE_MAX_IMAGES = 60;

export type Allowed = (ip: string) => boolean;

/** Bildtyp aus den ersten Bytes (der Server vertraut nicht dem Content-Type der fremden Seite) */
export function sniffImage(b: Buffer): string | null {
  if (b.length >= 8 && b.readUInt32BE(0) === 0x89504e47) return 'image/png';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 6 && /^GIF8[79]a/.test(b.subarray(0, 6).toString('latin1'))) return 'image/gif';
  if (b.length >= 12 && b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  if (b.length >= 12 && b.subarray(4, 8).toString('latin1') === 'ftyp' && /^avi[fs]/.test(b.subarray(8, 12).toString('latin1'))) return 'image/avif';
  const head = b.subarray(0, 1024).toString('utf8').replace(/^﻿/, '').trimStart();
  if (/^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE svg[^>]*>\s*)?<svg[\s>]/i.test(head)) return 'image/svg+xml';
  return null;
}

export type ImageFetch = { data: Buffer; mime: string; name: string; finalUrl: string } | { error: FetchError | 'notimage'; page?: boolean };

/** Bild holen; ist es eine HTML-Seite, sagt page: true das dem Aufrufer (dann „Bilder dieser Seite“ anbieten) */
export async function fetchImage(url: string, allowed: Allowed = isPublicAddress): Promise<ImageFetch> {
  const r = await fetchMedia(url, IMAGE_MAX_BYTES, allowed, { userAgent: UA, accept: 'image/avif,image/webp,image/png,image/jpeg,image/gif,image/svg+xml,image/*;q=0.9,*/*;q=0.1' });
  if ('error' in r) return r;
  const mime = sniffImage(r.data);
  if (!mime) return { error: 'notimage', page: /text\/html|application\/xhtml/i.test(r.mime) };
  const ext = mime.split('/')[1].replace('svg+xml', 'svg').replace('jpeg', 'jpg');
  const name = /\.[a-z0-9]{2,5}$/i.test(r.name) ? r.name : `${r.name || 'bild'}.${ext}`;
  return { data: r.data, mime, name, finalUrl: r.finalUrl };
}

export interface ImageInfo {
  /** Titel oder Bildunterschrift */
  title: string;
  /** Urheber (Fotografin, Zeichner, Rechteinhaber) */
  credit: string;
  /** Lizenz, z. B. „CC BY-SA 4.0“ oder „gemeinfrei“ */
  license: string;
  licenseUrl: string | null;
  /** Ursprungsseite: wo das Bild erschienen ist (nicht die Bilddatei) */
  origin: string | null;
  /** Adresse einer handlichen Größe, wenn das Original sehr groß ist (Wikimedia) */
  imageUrl?: string;
  /** Herkunft der Angaben: Wikimedia, Seite, nichts gefunden */
  via: 'wikimedia' | 'page' | 'none';
}

export interface PageImage {
  url: string;
  alt: string;
  caption: string;
  width: number | null;
  height: number | null;
}
export interface PageInfo {
  url: string;
  title: string;
  site: string;
  author: string;
  license: string;
  licenseUrl: string | null;
  images: PageImage[];
}

// --- HTML ohne DOM ----------------------------------------------------------------------------------------------

const ENT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', auml: 'ä', ouml: 'ö', uuml: 'ü', Auml: 'Ä', Ouml: 'Ö', Uuml: 'Ü', szlig: 'ß', copy: '©', ndash: '–', mdash: '—' };
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    }
    return ENT[e] ?? m;
  });
}
/** Text aus HTML: Tags weg, Entitäten aufgelöst, Leerraum zusammengefasst */
export function textOf(html: string): string {
  return decodeEntities(html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}
/** Attribute eines Tags als Objekt (Namen klein) */
export function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  const inner = tag.replace(/^<\s*[a-zA-Z0-9]+/, '').replace(/\/?>$/, '');
  let m: RegExpExecArray | null;
  while ((m = re.exec(inner))) out[m[1].toLowerCase()] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? '');
  return out;
}
const abs = (u: string, base: string): string | null => {
  try {
    const x = new URL(u.trim(), base);
    return /^https?:$/.test(x.protocol) ? x.href : null;
  } catch {
    return null;
  }
};
/** größtes Bild aus srcset */
function fromSrcset(srcset: string): string | null {
  let best: { u: string; w: number } | null = null;
  for (const part of srcset.split(/,\s+(?=\S)/)) {
    const [u, d] = part.trim().split(/\s+/);
    if (!u) continue;
    const w = d ? parseFloat(d) * (d.endsWith('x') ? 1000 : 1) : 1;
    if (!best || w > best.w) best = { u, w };
  }
  return best?.u ?? null;
}

/** „CC BY-SA 4.0“ aus einer Creative-Commons-Adresse */
export function ccName(url: string): string {
  const m = /creativecommons\.org\/(licenses|publicdomain)\/([a-z-]+)\/(\d\.\d)?/i.exec(url);
  if (!m) return '';
  if (m[1].toLowerCase() === 'publicdomain') return m[2].toLowerCase() === 'zero' ? 'CC0 1.0' : 'gemeinfrei (Public Domain Mark)';
  return `CC ${m[2].toUpperCase()}${m[3] ? ' ' + m[3] : ''}`;
}

export function parsePage(html: string, pageUrl: string): PageInfo {
  const metas = [...html.matchAll(/<meta\b[^>]*>/gi)].map((m) => attrs(m[0]));
  const meta = (...keys: string[]) => {
    for (const k of keys) {
      const hit = metas.find((a) => (a.property ?? a.name ?? a.itemprop ?? '').toLowerCase() === k && a.content?.trim());
      if (hit) return hit.content.trim();
    }
    return '';
  };
  const links = [...html.matchAll(/<(?:link|a)\b[^>]*>/gi)].map((m) => attrs(m[0]));
  const licLink = links.find((a) => /(^|\s)license(\s|$)/i.test(a.rel ?? '') && a.href)?.href ?? null;
  const ccLink = licLink ?? /https?:\/\/creativecommons\.org\/(?:licenses|publicdomain)\/[a-z-]+\/(?:\d\.\d\/)?/i.exec(html)?.[0] ?? null;
  const licenseUrl = ccLink ? abs(ccLink, pageUrl) : null;
  const license = meta('dcterms.license', 'dc.rights', 'license') || (licenseUrl ? ccName(licenseUrl) : '');
  const title = meta('og:title', 'twitter:title') || textOf(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '');
  const site = meta('og:site_name', 'application-name') || new URL(pageUrl).hostname.replace(/^www\./, '');
  const author = meta('author', 'article:author', 'dc.creator', 'dcterms.creator', 'citation_author', 'twitter:creator');

  const images: PageImage[] = [];
  const seen = new Set<string>();
  const push = (raw: string | null | undefined, alt: string, caption: string, w: number | null, h: number | null) => {
    const u = raw ? abs(raw, pageUrl) : null;
    if (!u || seen.has(u) || images.length >= PAGE_MAX_IMAGES) return;
    // Zählpixel, Platzhalter und Symbole weglassen
    if ((w !== null && w < 80) || (h !== null && h < 80)) return;
    if (/\b(pixel|spacer|blank|tracking|beacon)\b|\/1x1\.|sprite/i.test(u)) return;
    seen.add(u);
    images.push({ url: u, alt: alt.slice(0, 300), caption: caption.slice(0, 500), width: w, height: h });
  };
  const og = meta('og:image', 'og:image:url', 'twitter:image');
  if (og) push(og, meta('og:image:alt'), '', null, null);

  // Bildunterschriften: <figure> … <img> … <figcaption>
  const captionOf = new Map<number, string>();
  for (const f of html.matchAll(/<figure\b[\s\S]*?<\/figure>/gi)) {
    const cap = textOf(/<figcaption[^>]*>([\s\S]*?)<\/figcaption>/i.exec(f[0])?.[1] ?? '');
    if (!cap) continue;
    for (const im of f[0].matchAll(/<img\b[^>]*>/gi)) captionOf.set((f.index ?? 0) + (im.index ?? 0), cap);
  }
  for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
    const a = attrs(m[0]);
    const src = (a.srcset && fromSrcset(a.srcset)) || (a['data-srcset'] && fromSrcset(a['data-srcset'])) || a['data-src'] || a['data-original'] || a['data-lazy-src'] || a.src;
    if (!src || src.startsWith('data:')) continue;
    const num = (v?: string) => (v && /^\d+$/.test(v) ? Number(v) : null);
    push(src, a.alt ?? a.title ?? '', captionOf.get(m.index ?? -1) ?? '', num(a.width), num(a.height));
  }
  return { url: pageUrl, title: title.slice(0, 300), site: site.slice(0, 200), author: author.slice(0, 300), license: license.slice(0, 200), licenseUrl, images };
}

function decodeHtml(data: Buffer, mime: string): string {
  const cs = (/charset=([\w-]+)/i.exec(mime)?.[1] ?? /<meta[^>]+charset=["']?([\w-]+)/i.exec(data.subarray(0, 4096).toString('latin1'))?.[1] ?? 'utf-8').toLowerCase();
  try {
    return new TextDecoder(cs === 'iso-8859-1' || cs === 'latin1' ? 'windows-1252' : cs).decode(data);
  } catch {
    return data.toString('utf8');
  }
}

// --- Wikimedia --------------------------------------------------------------------------------------------------

/** Wiki und Dateiname zu einer Bild- oder Dateiseiten-Adresse von Wikipedia/Commons */
export function wikimediaFile(raw: string): { host: string; file: string } | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  // upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Name.jpg/800px-Name.jpg
  const up = /^\/(wikipedia|wikibooks|wikinews|wikiquote|wikisource|wikiversity|wikivoyage|wiktionary)\/([a-z-]+)\/(?:thumb\/)?[0-9a-f]\/[0-9a-f]{2}\/([^/]+)/.exec(u.pathname);
  if (u.hostname === 'upload.wikimedia.org' && up) {
    const host = up[2] === 'commons' ? 'commons.wikimedia.org' : `${up[2]}.${up[1]}.org`;
    return { host, file: decodeURIComponent(up[3]) };
  }
  if (!/(^|\.)(wikipedia|wikimedia|wikibooks|wikiversity|wikivoyage|wiktionary)\.org$/.test(u.hostname)) return null;
  // /wiki/Datei:Name.jpg, /wiki/File:…, Artikel mit #/media/Datei:…
  const hash = /#\/media\/([^/]+)$/.exec(u.hash)?.[1];
  const page = hash ?? /^\/wiki\/(.+)$/.exec(u.pathname)?.[1];
  const m = page ? /^(?:Datei|File|Bild|Image|Fichier|Archivo):(.+)$/i.exec(decodeURIComponent(page)) : null;
  return m ? { host: u.hostname.replace(/^([a-z-]+)\.m\./, '$1.'), file: m[1].replace(/_/g, ' ') } : null;
}

async function getJson(url: string, allowed: Allowed): Promise<any | null> {
  const r = await fetchMedia(url, 1024 * 1024, allowed, { userAgent: UA, accept: 'application/json' });
  if ('error' in r) return null;
  try {
    return JSON.parse(r.data.toString('utf8'));
  } catch {
    return null;
  }
}

export async function wikimediaInfo(w: { host: string; file: string }, allowed: Allowed = isPublicAddress): Promise<ImageInfo | null> {
  const q = new URLSearchParams({ action: 'query', format: 'json', prop: 'imageinfo', iiprop: 'url|extmetadata|size', iiurlwidth: '2000', titles: 'File:' + w.file });
  const j = await getJson(`https://${w.host}/w/api.php?${q}`, allowed);
  const page = j?.query?.pages ? (Object.values(j.query.pages)[0] as any) : null;
  const ii = page?.imageinfo?.[0];
  if (!ii) return null;
  const md = (ii.extmetadata ?? {}) as Record<string, { value?: string }>;
  const v = (k: string) => textOf(String(md[k]?.value ?? ''));
  const licenseUrl = String(md.LicenseUrl?.value ?? '') || null;
  const big = Number(ii.width) > 2000 && ii.thumburl;
  return {
    title: (v('ObjectName') || w.file.replace(/\.[a-z0-9]+$/i, '')).slice(0, 300),
    credit: (v('Artist') || v('Credit')).slice(0, 300),
    license: (v('LicenseShortName') || (licenseUrl ? ccName(licenseUrl) : '')).slice(0, 200),
    licenseUrl,
    origin: ii.descriptionurl ?? null,
    ...(big ? { imageUrl: String(ii.thumburl) } : {}),
    via: 'wikimedia',
  };
}

// --- öffentlich --------------------------------------------------------------------------------------------------

export async function readPage(url: string, allowed: Allowed = isPublicAddress): Promise<PageInfo | { error: FetchError | 'notpage' }> {
  const r = await fetchMedia(url, PAGE_MAX_BYTES, allowed, { userAgent: UA, accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1' });
  if ('error' in r) return r;
  if (!/html|xml/i.test(r.mime) && !/^\s*</.test(r.data.subarray(0, 200).toString('utf8'))) return { error: 'notpage' };
  return parsePage(decodeHtml(r.data, r.mime), r.finalUrl);
}

/**
 * Angaben zu einem Bild: Wikimedia über die Schnittstelle, sonst über die Seite (wenn bekannt). Ohne Seite bleibt
 * nur die Bildadresse; die Ursprungsseite tragen die Lernenden dann selbst nach.
 */
export async function imageInfo(imageUrl: string, pageUrl: string | null, allowed: Allowed = isPublicAddress): Promise<ImageInfo> {
  const none: ImageInfo = { title: '', credit: '', license: '', licenseUrl: null, origin: pageUrl, via: 'none' };
  const w = wikimediaFile(imageUrl) ?? (pageUrl ? wikimediaFile(pageUrl) : null);
  if (w) return (await wikimediaInfo(w, allowed)) ?? none;
  if (!pageUrl) return none;
  const p = await readPage(pageUrl, allowed);
  if ('error' in p) return none;
  const same = (a: string) => {
    try {
      const x = new URL(a), y = new URL(imageUrl);
      return x.href === y.href || (x.hostname === y.hostname && x.pathname.split('/').pop() === y.pathname.split('/').pop());
    } catch {
      return false;
    }
  };
  const hit = p.images.find((i) => same(i.url));
  return { title: (hit?.caption || hit?.alt || p.title).slice(0, 300), credit: p.author, license: p.license, licenseUrl: p.licenseUrl, origin: p.url, via: 'page' };
}
