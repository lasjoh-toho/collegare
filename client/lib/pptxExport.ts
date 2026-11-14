/**
 * Bento-Präsentation → PowerPoint (.pptx), im Browser (Wunsch Jo, 14. November 2026). Übernimmt Folien mit
 * Hintergrund, Textfelder (Absätze, fett/kursiv/unterstrichen/durchgestrichen, Farbe, Größe, Schrift, Ausrichtung),
 * Formen (Rechteck, abgerundet, Ellipse, Dreieck, Pfeil, Vieleck, Linie mit Pfeilspitzen), Bilder (eingebettet und
 * als asset:), SVG-Grafiken (als Bild), Tabellen, Übergänge und Sprechernotizen. Diagramme, Videos und Pfade kommen
 * als beschrifteter Platzhalter; die Liste steht in `warnings`.
 *
 * Maßstab: 1 px der Bento-Folie = 9525 EMU (1280 px = 12 192 000 EMU, die Breite einer 16:9-Folie in PowerPoint).
 */
import { makeZip, type ZipEntry } from './zip';

type J = Record<string, any>;
const EMU = 9525;
const emu = (px: number) => Math.round((Number(px) || 0) * EMU);
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
// Zeichen, die XML 1.0 nicht erlaubt
const clean = (s: string) => s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '');

const NS =
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const REL = {
  slide: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide',
  layout: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout',
  master: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster',
  theme: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme',
  image: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image',
  notes: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide',
  notesMaster: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesMaster',
};

// --- Farben -------------------------------------------------------------------------------------------------------

interface Color {
  hex: string;
  alpha: number;
}
const NAMED: Record<string, string> = { white: 'FFFFFF', black: '000000', red: 'FF0000', green: '008000', blue: '0000FF', gray: '808080', grey: '808080', orange: 'FFA500', yellow: 'FFFF00' };

export function parseColor(v: unknown): Color | null {
  if (typeof v !== 'string') return null;
  const s = v.trim().toLowerCase();
  if (!s || s === 'none' || s === 'transparent') return null;
  let m = s.match(/^#([0-9a-f]{3,8})$/);
  if (m) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join('');
    const alpha = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
    return { hex: h.slice(0, 6).toUpperCase(), alpha };
  }
  m = s.match(/^rgba?\(([^)]+)\)$/);
  if (m) {
    const p = m[1].split(/[\s,/]+/).filter(Boolean);
    const n = (x: string) => (x.endsWith('%') ? (parseFloat(x) * 255) / 100 : parseFloat(x));
    const [r, g, b] = p.slice(0, 3).map((x) => Math.max(0, Math.min(255, Math.round(n(x)))));
    const a = p[3] !== undefined ? (p[3].endsWith('%') ? parseFloat(p[3]) / 100 : parseFloat(p[3])) : 1;
    if ([r, g, b].some((x) => Number.isNaN(x))) return null;
    return { hex: [r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('').toUpperCase(), alpha: Number.isNaN(a) ? 1 : a };
  }
  if (NAMED[s]) return { hex: NAMED[s], alpha: 1 };
  return null;
}

function solid(c: Color | null, opacity = 1): string {
  if (!c) return '<a:noFill/>';
  const a = Math.round(Math.max(0, Math.min(1, c.alpha * opacity)) * 100000);
  return `<a:solidFill><a:srgbClr val="${c.hex}">${a < 100000 ? `<a:alpha val="${a}"/>` : ''}</a:srgbClr></a:solidFill>`;
}

function gradient(g: J | undefined, opacity: number): string | null {
  if (!g || !Array.isArray(g.stops) || g.stops.length < 2) return null;
  const stops = g.stops
    .map((st: J) => {
      const c = parseColor(st.color);
      if (!c) return '';
      const a = Math.round(c.alpha * opacity * 100000);
      return `<a:gs pos="${Math.round(Math.max(0, Math.min(1, Number(st.at ?? st.offset ?? 0))) * 100000)}"><a:srgbClr val="${c.hex}">${a < 100000 ? `<a:alpha val="${a}"/>` : ''}</a:srgbClr></a:gs>`;
    })
    .join('');
  // CSS-Winkel: 0° = nach oben, im Uhrzeigersinn; DrawingML: 0° = nach rechts
  const ang = (((Number(g.angle ?? 180) - 90) % 360) + 360) % 360;
  return `<a:gradFill rotWithShape="1"><a:gsLst>${stops}</a:gsLst><a:lin ang="${Math.round(ang * 60000)}" scaled="0"/></a:gradFill>`;
}

// --- Text -----------------------------------------------------------------------------------------------------------

interface Run {
  text: string;
  b?: boolean;
  i?: boolean;
  u?: boolean;
  s?: boolean;
  color?: Color | null;
  size?: number;
  font?: string;
  br?: boolean;
}
interface Para {
  runs: Run[];
  bullet?: boolean;
  align?: string;
}

const firstFamily = (stack: string) => (stack || '').split(',')[0].trim().replace(/^['"]|['"]$/g, '') || 'Calibri';

function fields(text: string, ctx: { page: number; pages: number; title: string }): string {
  return text.replace(/\{\{\s*(page|pages|title|date|time)(?::(\d+))?\s*\}\}/g, (_m, k: string, pad?: string) => {
    const now = new Date();
    const v = k === 'page' ? String(ctx.page) : k === 'pages' ? String(ctx.pages) : k === 'title' ? ctx.title : k === 'date' ? now.toLocaleDateString('de-DE') : now.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    return pad && /^\d+$/.test(v) ? v.padStart(Number(pad), '0') : v;
  });
}

/** HTML eines Textfelds in Absätze und Läufe zerlegen */
export function htmlToParas(html: string, base: Run): Para[] {
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
  const paras: Para[] = [{ runs: [] }];
  const cur = () => paras[paras.length - 1];
  const newPara = (extra: Partial<Para> = {}) => {
    if (cur().runs.length || cur().bullet) paras.push({ runs: [], ...extra });
    else Object.assign(cur(), extra);
  };
  const walk = (n: Node, st: Run) => {
    if (n.nodeType === 3) {
      const t = (n.textContent ?? '').replace(/ /g, ' ').replace(/​/g, '');
      if (t) cur().runs.push({ ...st, text: t });
      return;
    }
    if (n.nodeType !== 1) return;
    const el = n as HTMLElement;
    const tag = el.tagName.toLowerCase();
    if (tag === 'br') {
      newPara({ bullet: cur().bullet });
      if (!cur().runs.length) cur().runs.push({ ...st, text: '' });
      return;
    }
    const s2: Run = { ...st };
    if (tag === 'b' || tag === 'strong') s2.b = true;
    if (tag === 'i' || tag === 'em') s2.i = true;
    if (tag === 'u') s2.u = true;
    if (tag === 's' || tag === 'strike' || tag === 'del') s2.s = true;
    const style = el.style;
    if (style) {
      if (style.fontWeight && (style.fontWeight === 'bold' || Number(style.fontWeight) >= 600)) s2.b = true;
      if (style.fontStyle === 'italic') s2.i = true;
      if (style.textDecoration?.includes('underline')) s2.u = true;
      if (style.textDecoration?.includes('line-through')) s2.s = true;
      if (style.color) s2.color = parseColor(style.color) ?? s2.color;
      if (style.fontSize?.endsWith('px')) s2.size = parseFloat(style.fontSize);
      if (style.fontFamily) s2.font = firstFamily(style.fontFamily);
    }
    const block = ['div', 'p', 'li', 'h1', 'h2', 'h3', 'h4', 'blockquote'].includes(tag);
    if (block) newPara({ bullet: tag === 'li', align: style?.textAlign || undefined });
    if (tag === 'h1' || tag === 'h2' || tag === 'h3') s2.b = true;
    el.childNodes.forEach((c) => walk(c, s2));
    if (block) newPara();
  };
  doc.body.firstElementChild!.childNodes.forEach((c) => walk(c, base));
  const out = paras.filter((p, i) => p.runs.length || i === 0);
  // „• “ am Zeilenanfang (Bento-Aufzählung ohne Liste) als echte Aufzählung
  for (const p of out) {
    const r = p.runs[0];
    if (r && /^[•‣◦▪–-]\s/.test(r.text)) {
      p.bullet = true;
      r.text = r.text.replace(/^[•‣◦▪–-]\s+/, '');
    }
  }
  return out.length ? out : [{ runs: [] }];
}

function runXml(r: Run, opacity: number): string {
  const attrs = [`lang="de-DE"`, r.size ? `sz="${Math.max(100, Math.round(r.size * 75))}"` : '', r.b ? 'b="1"' : '', r.i ? 'i="1"' : '', r.u ? 'u="sng"' : '', r.s ? 'strike="sngStrike"' : ''].filter(Boolean).join(' ');
  const font = r.font ? `<a:latin typeface="${esc(r.font)}"/><a:cs typeface="${esc(r.font)}"/>` : '';
  return `<a:r><a:rPr ${attrs} dirty="0">${r.color ? solid(r.color, opacity) : ''}${font}</a:rPr><a:t>${esc(clean(r.text))}</a:t></a:r>`;
}

const ALGN: Record<string, string> = { left: 'l', center: 'ctr', right: 'r', justify: 'just', start: 'l', end: 'r' };

function parasXml(paras: Para[], align: string, lineHeight: number | undefined, base: Run, opacity: number): string {
  return paras
    .map((p) => {
      const al = ALGN[p.align ?? align] ?? 'l';
      const ln = lineHeight ? `<a:lnSpc><a:spcPct val="${Math.round(lineHeight * 100000 * 0.83)}"/></a:lnSpc>` : '';
      const bu = p.bullet ? `<a:buFont typeface="Arial"/><a:buChar char="•"/>` : '<a:buNone/>';
      const ind = p.bullet ? ' marL="285750" indent="-285750"' : '';
      const end = `<a:endParaRPr lang="de-DE" ${base.size ? `sz="${Math.round(base.size * 75)}"` : ''} dirty="0"/>`;
      return `<a:p><a:pPr algn="${al}"${ind}>${ln}${bu}</a:pPr>${p.runs.filter((r) => r.text).map((r) => runXml(r, opacity)).join('')}${end}</a:p>`;
    })
    .join('');
}

// --- Bilder ---------------------------------------------------------------------------------------------------------

interface Media {
  name: string;
  data: Uint8Array;
}

function dataUri(src: string): { mime: string; bytes: Uint8Array } | null {
  const m = src.match(/^data:([^;,]+)(;base64)?,(.*)$/s);
  if (!m) return null;
  try {
    if (m[2]) {
      const bin = atob(m[3]);
      const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return { mime: m[1], bytes: out };
    }
    return { mime: m[1], bytes: new TextEncoder().encode(decodeURIComponent(m[3])) };
  } catch {
    return null;
  }
}

/** SVG im Browser zu PNG rastern (PowerPoint braucht ein Rasterbild als Grundlage) */
async function svgToPng(svg: string, w: number, h: number): Promise<Uint8Array | null> {
  if (typeof document === 'undefined') return null;
  // scharf genug für den Beamer, aber eine ganzseitige Grafik nicht größer als 1920 px
  const scale = Math.max(0.5, Math.min(2, 1920 / Math.max(1, w, h)));
  let markup = svg;
  if (!/xmlns=/.test(markup)) markup = markup.replace(/<svg\b/, '<svg xmlns="http://www.w3.org/2000/svg"');
  if (!/\bwidth=/.test(markup.slice(0, markup.indexOf('>')))) markup = markup.replace(/<svg\b/, `<svg width="${w}" height="${h}"`);
  const url = URL.createObjectURL(new Blob([markup], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    await new Promise<void>((res, rej) => {
      img.onload = () => res();
      img.onerror = () => rej(new Error('svg'));
      img.src = url;
    });
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * scale));
    c.height = Math.max(1, Math.round(h * scale));
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
    const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/png'));
    return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Bildformate, die PowerPoint direkt kann; alles andere über den Browser zu PNG */
async function toOfficeImage(mime: string, bytes: Uint8Array, w: number, h: number): Promise<{ ext: string; bytes: Uint8Array } | null> {
  if (mime === 'image/png') return { ext: 'png', bytes };
  if (mime === 'image/jpeg' || mime === 'image/jpg') return { ext: 'jpeg', bytes };
  if (mime === 'image/gif') return { ext: 'gif', bytes };
  if (mime === 'image/svg+xml') {
    const png = await svgToPng(new TextDecoder().decode(bytes), w, h);
    return png ? { ext: 'png', bytes: png } : null;
  }
  if (typeof document === 'undefined' || !mime.startsWith('image/')) return null;
  // webp, avif …: über ein Canvas
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }));
  try {
    const img = new Image();
    await new Promise<void>((res, rej) => {
      img.onload = () => res();
      img.onerror = () => rej(new Error('img'));
      img.src = url;
    });
    const c = document.createElement('canvas');
    c.width = img.naturalWidth || Math.round(w);
    c.height = img.naturalHeight || Math.round(h);
    c.getContext('2d')!.drawImage(img, 0, 0);
    const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/png'));
    return blob ? { ext: 'png', bytes: new Uint8Array(await blob.arrayBuffer()) } : null;
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

// --- Folien ---------------------------------------------------------------------------------------------------------

const xfrm = (e: J, extra = '') => {
  const rot = Number(e.rotation) ? ` rot="${Math.round(Number(e.rotation) * 60000)}"` : '';
  return `<a:xfrm${rot}${extra}><a:off x="${emu(e.x)}" y="${emu(e.y)}"/><a:ext cx="${Math.max(1, emu(e.w))}" cy="${Math.max(1, emu(e.h))}"/></a:xfrm>`;
};

const PRST: Record<string, string> = { rect: 'rect', ellipse: 'ellipse', triangle: 'triangle', arrow: 'rightArrow', line: 'line' };
const POLY: Record<number, string> = { 5: 'pentagon', 6: 'hexagon', 7: 'heptagon', 8: 'octagon', 10: 'decagon', 12: 'dodecagon' };
const ENDS: Record<string, string> = { arrow: 'triangle', dot: 'oval', bar: 'diamond' };

interface Ctx {
  id: number;
  rels: string[];
  media: Media[];
  doc: J;
  warnings: Set<string>;
  page: number;
  pages: number;
  slideId: string;
  snapshots: Record<string, string>;
  /** gleiche Grafik in gleicher Größe nur einmal in der Datei */
  cache: Map<string, { name: string }>;
}

function nextId(ctx: Ctx) {
  return ++ctx.id;
}

function relFor(ctx: Ctx, name: string): string {
  const rid = `rId${ctx.rels.length + 2}`;
  ctx.rels.push(`<Relationship Id="${rid}" Type="${REL.image}" Target="../media/${name}"/>`);
  return rid;
}

function addImageRel(ctx: Ctx, ext: string, bytes: Uint8Array, cacheKey?: string): string {
  const name = `image${ctx.media.length + 1}.${ext}`;
  ctx.media.push({ name, data: bytes });
  if (cacheKey) ctx.cache.set(cacheKey, { name });
  const rid = `rId${ctx.rels.length + 2}`;
  ctx.rels.push(`<Relationship Id="${rid}" Type="${REL.image}" Target="../media/${name}"/>`);
  return rid;
}

function textShape(ctx: Ctx, e: J, name: string, paras: Para[], opts: { fill?: string; line?: string; geom?: string; align: string; valign: string; lineHeight?: number; base: Run; opacity: number; box?: boolean }): string {
  const id = nextId(ctx);
  const anchor = opts.valign === 'middle' ? 'ctr' : opts.valign === 'bottom' ? 'b' : 't';
  return (
    `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${esc(name)} ${id}"/><p:cNvSpPr${opts.box ? ' txBox="1"' : ''}/><p:nvPr/></p:nvSpPr>` +
    `<p:spPr>${xfrm(e)}<a:prstGeom prst="${opts.geom ?? 'rect'}"><a:avLst/></a:prstGeom>${opts.fill ?? '<a:noFill/>'}${opts.line ?? '<a:ln><a:noFill/></a:ln>'}</p:spPr>` +
    `<p:txBody><a:bodyPr wrap="square" lIns="45720" tIns="22860" rIns="45720" bIns="22860" anchor="${anchor}" rtlCol="0"><a:noAutofit/></a:bodyPr><a:lstStyle/>` +
    `${parasXml(paras, opts.align, opts.lineHeight, opts.base, opts.opacity)}</p:txBody></p:sp>`
  );
}

function placeholder(ctx: Ctx, e: J, label: string): string {
  return textShape(ctx, e, label, [{ runs: [{ text: label, size: 16, color: { hex: '5B6472', alpha: 1 } }] }], {
    fill: solid({ hex: 'EEF1F5', alpha: 1 }),
    line: `<a:ln w="9525"><a:solidFill><a:srgbClr val="B6BFCC"/></a:solidFill><a:prstDash val="dash"/></a:ln>`,
    align: 'center',
    valign: 'middle',
    base: { text: '', size: 16 },
    opacity: 1,
  });
}

/** SVG-Pfad (M L H V C S Q T Z, absolut und relativ) als DrawingML-Freihandform; Bögen (A) gehen nicht → null */
export function pathGeom(d: string, box: unknown, w: number, h: number): string | null {
  const toks = d.match(/[a-zA-Z]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/g);
  if (!toks || !toks.length) return null;
  const [bx, by, bw, bh] = Array.isArray(box) && box.length === 4 ? box.map(Number) : [0, 0, w, h];
  const W = Math.max(1, Math.round(bw * 100)), H = Math.max(1, Math.round(bh * 100));
  const P = (x: number, y: number) => `<a:pt x="${Math.round((x - bx) * 100)}" y="${Math.round((y - by) * 100)}"/>`;
  let i = 0, cmd = '', x = 0, y = 0, sx = 0, sy = 0, cx = 0, cy = 0, qx = 0, qy = 0;
  const out: string[] = [];
  const num = () => Number(toks[i++]);
  while (i < toks.length) {
    if (/[a-zA-Z]/.test(toks[i])) cmd = toks[i++];
    else if (!cmd) return null;
    const rel = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();
    const ax = (v: number) => (rel ? x + v : v), ay = (v: number) => (rel ? y + v : v);
    switch (C) {
      case 'M': { x = ax(num()); y = ay(num()); sx = x; sy = y; out.push(`<a:moveTo>${P(x, y)}</a:moveTo>`); cmd = rel ? 'l' : 'L'; cx = x; cy = y; break; }
      case 'L': { x = ax(num()); y = ay(num()); out.push(`<a:lnTo>${P(x, y)}</a:lnTo>`); cx = x; cy = y; break; }
      case 'H': { x = rel ? x + num() : num(); out.push(`<a:lnTo>${P(x, y)}</a:lnTo>`); cx = x; cy = y; break; }
      case 'V': { y = rel ? y + num() : num(); out.push(`<a:lnTo>${P(x, y)}</a:lnTo>`); cx = x; cy = y; break; }
      case 'C': { const x1 = ax(num()), y1 = ay(num()), x2 = ax(num()), y2 = ay(num()), nx = ax(num()), ny = ay(num()); out.push(`<a:cubicBezTo>${P(x1, y1)}${P(x2, y2)}${P(nx, ny)}</a:cubicBezTo>`); cx = x2; cy = y2; x = nx; y = ny; break; }
      case 'S': { const x1 = 2 * x - cx, y1 = 2 * y - cy, x2 = ax(num()), y2 = ay(num()), nx = ax(num()), ny = ay(num()); out.push(`<a:cubicBezTo>${P(x1, y1)}${P(x2, y2)}${P(nx, ny)}</a:cubicBezTo>`); cx = x2; cy = y2; x = nx; y = ny; break; }
      case 'Q': { qx = ax(num()); qy = ay(num()); const nx = ax(num()), ny = ay(num()); out.push(`<a:quadBezTo>${P(qx, qy)}${P(nx, ny)}</a:quadBezTo>`); x = nx; y = ny; cx = x; cy = y; break; }
      case 'T': { qx = 2 * x - qx; qy = 2 * y - qy; const nx = ax(num()), ny = ay(num()); out.push(`<a:quadBezTo>${P(qx, qy)}${P(nx, ny)}</a:quadBezTo>`); x = nx; y = ny; cx = x; cy = y; break; }
      case 'Z': { out.push('<a:close/>'); x = sx; y = sy; cx = x; cy = y; break; }
      default: return null;
    }
    if (out.length > 5000 || Number.isNaN(x) || Number.isNaN(y)) return null;
  }
  return `<a:custGeom><a:avLst/><a:gdLst/><a:ahLst/><a:cxnLst/><a:rect l="0" t="0" r="r" b="b"/><a:pathLst><a:path w="${W}" h="${H}">${out.join('')}</a:path></a:pathLst></a:custGeom>`;
}

function picXml(ctx: Ctx, e: J, rid: string, opacity: number): string {
  const id = nextId(ctx);
  let crop = '';
  if (e.crop && typeof e.crop.w === 'number') {
    const c = e.crop;
    const l = Math.round(c.x * 100000), t = Math.round(c.y * 100000);
    const r = Math.round((1 - c.x - c.w) * 100000), b = Math.round((1 - c.y - c.h) * 100000);
    if (c.w > 0 && c.w <= 1 && c.h > 0 && c.h <= 1) crop = `<a:srcRect l="${l}" t="${t}" r="${r}" b="${b}"/>`;
  }
  const alpha = opacity < 1 ? `<a:alphaModFix amt="${Math.round(opacity * 100000)}"/>` : '';
  return (
    `<p:pic><p:nvPicPr><p:cNvPr id="${id}" name="Bild ${id}" descr="${esc(clean(String(e.alt ?? '')))}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr>` +
    `<p:blipFill><a:blip r:embed="${rid}">${alpha}</a:blip>${crop}<a:stretch><a:fillRect/></a:stretch></p:blipFill>` +
    `<p:spPr>${xfrm(e)}<a:prstGeom prst="${Number(e.radius) > 0 ? 'roundRect' : 'rect'}"><a:avLst/></a:prstGeom></p:spPr></p:pic>`
  );
}

async function elementXml(ctx: Ctx, e: J): Promise<string> {
  const opacity = e.opacity === undefined ? 1 : Number(e.opacity);
  const ctxF = { page: ctx.page, pages: ctx.pages, title: String(ctx.doc.title ?? '') };
  switch (e.type) {
    case 'text': {
      if (!e.html && e.placeholder) return '';
      const base: Run = { text: '', size: Number(e.fontSize) || 24, font: firstFamily(e.fontFamily), color: parseColor(e.color) ?? undefined, b: Number(e.fontWeight) >= 600 };
      const paras = htmlToParas(fields(String(e.html ?? ''), ctxF), base);
      return textShape(ctx, e, 'Textfeld', paras, { align: e.align ?? 'left', valign: e.valign ?? 'top', lineHeight: Number(e.lineHeight) || undefined, base, opacity, box: true });
    }
    case 'shape': {
      const kind = String(e.shape);
      const id = nextId(ctx);
      const custom = kind === 'path' ? pathGeom(String(e.d ?? ''), e.pathBox, e.w, e.h) : null;
      if (kind === 'path' && !custom) {
        ctx.warnings.add('Einzelne freie Pfade kommen als Platzhalter.');
        return placeholder(ctx, e, 'Pfad');
      }
      const strokeC = parseColor(e.stroke);
      const isLine = kind === 'line';
      const lineC = isLine ? strokeC ?? parseColor(e.fill) : strokeC;
      const dash = e.strokeStyle === 'dashed' || e.strokeDash ? '<a:prstDash val="dash"/>' : e.strokeStyle === 'dotted' ? '<a:prstDash val="sysDot"/>' : '';
      const ends = isLine ? `${e.lineStart && ENDS[e.lineStart] ? `<a:headEnd type="${ENDS[e.lineStart]}"/>` : ''}${e.lineEnd && ENDS[e.lineEnd] ? `<a:tailEnd type="${ENDS[e.lineEnd]}"/>` : ''}` : '';
      const w = Number(e.strokeWidth) || (isLine ? 2 : 0);
      const ln = lineC && w > 0 ? `<a:ln w="${emu(w)}">${solid(lineC, opacity)}${dash}${ends}</a:ln>` : '<a:ln><a:noFill/></a:ln>';
      const fill = isLine ? '' : gradient(e.fillGradient, opacity) ?? solid(parseColor(e.fill), opacity);
      let geom = PRST[kind] ?? 'rect';
      let av = '<a:avLst/>';
      if (kind === 'rect' && Number(e.radius) > 0) {
        geom = 'roundRect';
        av = `<a:avLst><a:gd name="adj" fmla="val ${Math.round(Math.min(50000, (Number(e.radius) / Math.max(1, Math.min(e.w, e.h))) * 100000))}"/></a:avLst>`;
      }
      if (kind === 'polygon') geom = POLY[Number(e.sides)] ?? 'hexagon';
      // eine Linie zeichnet Bento waagrecht durch die Mitte ihres Rahmens
      const box = isLine ? { ...e, y: Number(e.y) + Number(e.h) / 2, h: 0 } : e;
      const geomXml = custom ?? `<a:prstGeom prst="${geom}">${av}</a:prstGeom>`;
      // offene Pfade (Linien, Kurven) ohne Füllung
      const pathFill = custom && !/[zZ]\s*$/.test(String(e.d ?? '').trim()) ? '<a:noFill/>' : fill;
      const pathLn = custom && lineC === null && w > 0 && parseColor(e.fill) ? `<a:ln w="${emu(w)}">${solid(parseColor(e.fill), opacity)}</a:ln>` : ln;
      return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Form ${id}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm(box)}${geomXml}${custom ? pathFill : fill}${custom ? pathLn : ln}</p:spPr></p:sp>`;
    }
    case 'image':
    case 'svg': {
      let src: string = e.type === 'image' ? String(e.src ?? '') : '';
      let svgMarkup: string | null = e.type === 'svg' && typeof e.markup === 'string' ? e.markup : null;
      const key = e.type === 'svg' ? e.asset : src.startsWith('asset:') ? src.slice(6) : null;
      if (key && ctx.doc.assets?.[key]) src = String(ctx.doc.assets[key]);
      // SVG-Grafiken liegen in Bento oft als rohes Markup in den Assets
      if (!svgMarkup && /^\s*<svg[\s>]/i.test(src)) svgMarkup = src;
      let img: { ext: string; bytes: Uint8Array } | null = null;
      const cacheKey = `${key ?? (src.length < 4096 ? src : src.slice(0, 64) + src.length)}|${svgMarkup ? `${Math.round(e.w)}x${Math.round(e.h)}` : ''}`;
      const hit = key || svgMarkup ? ctx.cache.get(cacheKey) : undefined;
      if (hit) return picXml(ctx, e, relFor(ctx, hit.name), opacity);
      if (svgMarkup) {
        const png = await svgToPng(svgMarkup, e.w, e.h);
        img = png ? { ext: 'png', bytes: png } : null;
      } else {
        const d = dataUri(src);
        if (d) img = await toOfficeImage(d.mime, d.bytes, e.w, e.h);
        else if (/^https?:/.test(src)) ctx.warnings.add('Bilder aus einer Webadresse sind nicht eingebettet und kommen als Platzhalter.');
      }
      if (!img) return placeholder(ctx, e, e.alt ? `Bild: ${e.alt}` : 'Bild');
      return picXml(ctx, e, addImageRel(ctx, img.ext, img.bytes, key || svgMarkup ? cacheKey : undefined), opacity);
    }
    case 'table': {

      const st: J = e.style ?? {};
      const cols: J[] = Array.isArray(e.columns) ? e.columns : [];
      const total = cols.reduce((n, c) => n + (Number(c.w) || 1), 0) || 1;
      const rows: J[] = Array.isArray(e.rows) ? e.rows : [];
      const rowH = Math.max(1, Math.round(emu(e.h) / Math.max(1, rows.length)));
      const border = parseColor(st.borderColor);
      const bw = emu(Number(st.borderWidth) || 1);
      const bl = (tag: string) => (border ? `<a:${tag} w="${bw}">${solid(border)}</a:${tag}>` : `<a:${tag} w="0"><a:noFill/></a:${tag}>`);
      const size = Number(st.fontSize) || 18;
      const tr = rows
        .map((row, ri) => {
          const head = !!e.header && ri === 0;
          const cells = (row.cells ?? []).map((c: J) => {
            const bg = parseColor(c.bg) ?? (head ? parseColor(st.headerBg) : st.zebra && ri % 2 === 0 ? parseColor(st.zebra) : null);
            const color = parseColor(c.color) ?? (head ? parseColor(st.headerColor) : parseColor(st.color));
            const base: Run = { text: '', size, color: color ?? undefined, b: head || !!c.bold, font: st.fontFamily ? firstFamily(st.fontFamily) : undefined };
            const paras = htmlToParas(String(c.html ?? ''), base);
            return `<a:tc><a:txBody><a:bodyPr/><a:lstStyle/>${parasXml(paras, c.align ?? 'left', undefined, base, opacity)}</a:txBody><a:tcPr marL="${emu(st.cellPadX ?? 8)}" marR="${emu(st.cellPadX ?? 8)}" marT="${emu(st.cellPadY ?? 4)}" marB="${emu(st.cellPadY ?? 4)}" anchor="ctr">${bl('lnL')}${bl('lnR')}${bl('lnT')}${bl('lnB')}${bg ? solid(bg) : '<a:noFill/>'}</a:tcPr></a:tc>`;
          });
          return `<a:tr h="${rowH}">${cells.join('')}</a:tr>`;
        })
        .join('');
      const grid = cols.map((c) => `<a:gridCol w="${Math.round(emu(e.w) * ((Number(c.w) || 1) / total))}"/>`).join('');
      const id = nextId(ctx);
      return (
        `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="${id}" name="Tabelle ${id}"/><p:cNvGraphicFramePr><a:graphicFrameLocks noGrp="1"/></p:cNvGraphicFramePr><p:nvPr/></p:nvGraphicFramePr>` +
        `<p:xfrm><a:off x="${emu(e.x)}" y="${emu(e.y)}"/><a:ext cx="${emu(e.w)}" cy="${emu(e.h)}"/></p:xfrm>` +
        `<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblPr${e.header ? ' firstRow="1"' : ''}/><a:tblGrid>${grid}</a:tblGrid>${tr}</a:tbl></a:graphicData></a:graphic></p:graphicFrame>`
      );
    }
    case 'chart': {
      const snap = ctx.snapshots[`${ctx.slideId}/${e.id}`];
      const png = snap ? await svgToPng(snap, e.w, e.h) : null;
      if (png) {
        ctx.warnings.add('Diagramme kommen als Bild (bearbeitbar bleiben sie in Bento).');
        return picXml(ctx, e, addImageRel(ctx, 'png', png), opacity);
      }
      ctx.warnings.add('Diagramme kommen als Platzhalter (in Bento bleiben sie bearbeitbar).');
      return placeholder(ctx, e, 'Diagramm');
    }
    case 'media':
      ctx.warnings.add('Videos und Audio sind nicht in der PowerPoint-Datei enthalten.');
      return placeholder(ctx, e, e.kind === 'audio' ? 'Audio' : 'Video');
    default:
      return '';
  }
}

const TRANSITION: Record<string, string> = {
  fade: '<p:transition spd="med"><p:fade/></p:transition>',
  slide: '<p:transition spd="med"><p:push dir="l"/></p:transition>',
  zoom: '<p:transition spd="med"><p:zoom/></p:transition>',
  // Morph kennt erst PowerPoint 2019; ältere Fassungen zeigen den Ersatz „Verblassen“
  morph:
    '<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"><mc:Choice xmlns:p159="http://schemas.microsoft.com/office/powerpoint/2015/09/main" Requires="p159"><p:transition spd="slow" p14:dur="2000" xmlns:p14="http://schemas.microsoft.com/office/powerpoint/2010/main"><p159:morph option="byObject"/></p:transition></mc:Choice><mc:Fallback><p:transition spd="slow"><p:fade/></p:transition></mc:Fallback></mc:AlternateContent>',
};

function backgroundXml(slide: J, doc: J): string {
  const g = gradient(slide.backgroundGradient, 1);
  const c = parseColor(slide.background) ?? parseColor(doc.theme?.background);
  if (!g && !c) return '';
  return `<p:bg><p:bgPr>${g ?? solid(c)}<a:effectLst/></p:bgPr></p:bg>`;
}

function notesXml(text: string, slideNo: number): string {
  const paras = text
    .split(/\r?\n/)
    .map((l) => `<a:p><a:r><a:rPr lang="de-DE" dirty="0"/><a:t>${esc(clean(l))}</a:t></a:r></a:p>`)
    .join('');
  return (
    `${XML}<p:notes ${NS}><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>` +
    `<p:sp><p:nvSpPr><p:cNvPr id="2" name="Folienbild ${slideNo}"/><p:cNvSpPr><a:spLocks noGrp="1" noRot="1" noChangeAspect="1"/></p:cNvSpPr><p:nvPr><p:ph type="sldImg"/></p:nvPr></p:nvSpPr><p:spPr/></p:sp>` +
    `<p:sp><p:nvSpPr><p:cNvPr id="3" name="Notizen ${slideNo}"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/>${paras}</p:txBody></p:sp>` +
    `</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:notes>`
  );
}

// --- feste Teile ----------------------------------------------------------------------------------------------------

function themeXml(doc: J): string {
  const acc = parseColor(doc.theme?.accent)?.hex ?? 'C2410C';
  const font = esc(firstFamily(doc.theme?.fontFamily ?? 'Calibri'));
  const fs = '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>';
  return (
    `${XML}<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Collegare"><a:themeElements>` +
    `<a:clrScheme name="Collegare"><a:dk1><a:srgbClr val="1E2A3A"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="31445C"/></a:dk2><a:lt2><a:srgbClr val="ECEFF4"/></a:lt2>` +
    `<a:accent1><a:srgbClr val="${acc}"/></a:accent1><a:accent2><a:srgbClr val="5B8DEF"/></a:accent2><a:accent3><a:srgbClr val="2F9E44"/></a:accent3><a:accent4><a:srgbClr val="F59F00"/></a:accent4><a:accent5><a:srgbClr val="7048E8"/></a:accent5><a:accent6><a:srgbClr val="E64980"/></a:accent6>` +
    `<a:hlink><a:srgbClr val="1C7ED6"/></a:hlink><a:folHlink><a:srgbClr val="7048E8"/></a:folHlink></a:clrScheme>` +
    `<a:fontScheme name="Collegare"><a:majorFont><a:latin typeface="${font}"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="${font}"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme>` +
    `<a:fmtScheme name="Collegare"><a:fillStyleLst>${fs}${fs}${fs}</a:fillStyleLst>` +
    `<a:lnStyleLst><a:ln w="9525"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst>` +
    `<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>` +
    `<a:bgFillStyleLst>${fs}${fs}${fs}</a:bgFillStyleLst></a:fmtScheme></a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>`
  );
}

const CLRMAP = '<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>';
const EMPTY_TREE = '<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree>';

export interface PptxResult {
  blob: Blob;
  warnings: string[];
  slides: number;
}

export async function bentoToPptx(doc: J, snapshots: Record<string, string> = {}): Promise<PptxResult> {
  const W = emu(doc.size?.width ?? 1280);
  const H = emu(doc.size?.height ?? 720);
  // versteckte Zustände (stateOf) sind Varianten, keine eigenen Folien
  const slides: J[] = (doc.slides ?? []).filter((s: J) => !s.stateOf);
  const warnings = new Set<string>();
  if ((doc.slides ?? []).length !== slides.length) warnings.add('Interaktive Zustände (verlinkte Varianten einer Folie) sind nicht enthalten.');
  const media: Media[] = [];
  const cache = new Map<string, { name: string }>();
  const files: ZipEntry[] = [];
  const hasNotes = slides.some((s) => typeof s.notes === 'string' && s.notes.trim());

  for (let i = 0; i < slides.length; i++) {
    const s = slides[i];
    const ctx: Ctx = { id: 1, rels: [], media, doc, warnings, page: i + 1, pages: slides.length, slideId: String(s.id), snapshots, cache };
    const parts: string[] = [];
    for (const e of s.elements ?? []) {
      if (e.showOnHover) continue;
      try {
        parts.push(await elementXml(ctx, e));
      } catch {
        warnings.add('Einzelne Elemente ließen sich nicht übertragen.');
      }
    }
    const no = i + 1;
    const rels = [`<Relationship Id="rId1" Type="${REL.layout}" Target="../slideLayouts/slideLayout1.xml"/>`, ...ctx.rels];
    if (hasNotes && s.notes?.trim()) {
      rels.push(`<Relationship Id="rId${rels.length + 1}" Type="${REL.notes}" Target="../notesSlides/notesSlide${no}.xml"/>`);
      files.push({ name: `ppt/notesSlides/notesSlide${no}.xml`, data: notesXml(String(s.notes), no) });
      files.push({
        name: `ppt/notesSlides/_rels/notesSlide${no}.xml.rels`,
        data: `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL.notesMaster}" Target="../notesMasters/notesMaster1.xml"/><Relationship Id="rId2" Type="${REL.slide}" Target="../slides/slide${no}.xml"/></Relationships>`,
      });
    }
    const tree = EMPTY_TREE.replace('</p:spTree>', parts.join('') + '</p:spTree>');
    files.push({
      name: `ppt/slides/slide${no}.xml`,
      data: `${XML}<p:sld ${NS}${s.hidden ? ' show="0"' : ''}><p:cSld${s.name ? ` name="${esc(clean(String(s.name)))}"` : ''}>${backgroundXml(s, doc)}${tree}</p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>${TRANSITION[s.transition] ?? ''}</p:sld>`,
    });
    files.push({ name: `ppt/slides/_rels/slide${no}.xml.rels`, data: `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.join('')}</Relationships>` });
  }

  const n = slides.length;
  const slideIds = slides.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 2}"/>`).join('');
  const presRels = [
    `<Relationship Id="rId1" Type="${REL.master}" Target="slideMasters/slideMaster1.xml"/>`,
    ...slides.map((_, i) => `<Relationship Id="rId${i + 2}" Type="${REL.slide}" Target="slides/slide${i + 1}.xml"/>`),
    `<Relationship Id="rId${n + 2}" Type="${REL.theme}" Target="theme/theme1.xml"/>`,
    ...(hasNotes ? [`<Relationship Id="rId${n + 3}" Type="${REL.notesMaster}" Target="notesMasters/notesMaster1.xml"/>`] : []),
  ];
  const ct = [
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
    '<Default Extension="xml" ContentType="application/xml"/>',
    '<Default Extension="png" ContentType="image/png"/>',
    '<Default Extension="jpeg" ContentType="image/jpeg"/>',
    '<Default Extension="gif" ContentType="image/gif"/>',
    '<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>',
    '<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>',
    '<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>',
    '<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>',
    '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>',
    '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>',
    ...slides.map((_, i) => `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`),
    ...files.filter((f) => f.name.startsWith('ppt/notesSlides/notesSlide')).map((f) => `<Override PartName="/${f.name}" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml"/>`),
    ...(hasNotes
      ? [
          '<Override PartName="/ppt/notesMasters/notesMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesMaster+xml"/>',
          '<Override PartName="/ppt/theme/theme2.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>',
        ]
      : []),
  ];
  const title = esc(clean(String(doc.title ?? 'Präsentation')));
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  files.push(
    { name: '[Content_Types].xml', data: `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">${ct.join('')}</Types>` },
    {
      name: '_rels/.rels',
      data: `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`,
    },
    {
      name: 'docProps/core.xml',
      data: `${XML}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${title}</dc:title><dc:creator>Collegare</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`,
    },
    {
      name: 'docProps/app.xml',
      data: `${XML}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Collegare</Application><Slides>${n}</Slides></Properties>`,
    },
    {
      name: 'ppt/presentation.xml',
      data: `${XML}<p:presentation ${NS} saveSubsetFonts="1"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>${hasNotes ? `<p:notesMasterIdLst><p:notesMasterId r:id="rId${n + 3}"/></p:notesMasterIdLst>` : ''}<p:sldIdLst>${slideIds}</p:sldIdLst><p:sldSz cx="${W}" cy="${H}"/><p:notesSz cx="6858000" cy="9144000"/><p:defaultTextStyle><a:defPPr><a:defRPr lang="de-DE"/></a:defPPr></p:defaultTextStyle></p:presentation>`,
    },
    { name: 'ppt/_rels/presentation.xml.rels', data: `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${presRels.join('')}</Relationships>` },
    {
      name: 'ppt/slideMasters/slideMaster1.xml',
      data: `${XML}<p:sldMaster ${NS}><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg>${EMPTY_TREE}</p:cSld>${CLRMAP}<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle><a:lvl1pPr><a:defRPr sz="4400"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mj-lt"/></a:defRPr></a:lvl1pPr></p:titleStyle><p:bodyStyle><a:lvl1pPr><a:defRPr sz="2400"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/></a:defRPr></a:lvl1pPr></p:bodyStyle><p:otherStyle><a:lvl1pPr><a:defRPr sz="1800"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/></a:defRPr></a:lvl1pPr></p:otherStyle></p:txStyles></p:sldMaster>`,
    },
    {
      name: 'ppt/slideMasters/_rels/slideMaster1.xml.rels',
      data: `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL.layout}" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="${REL.theme}" Target="../theme/theme1.xml"/></Relationships>`,
    },
    { name: 'ppt/slideLayouts/slideLayout1.xml', data: `${XML}<p:sldLayout ${NS} type="blank" preserve="1"><p:cSld name="Leer">${EMPTY_TREE}</p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>` },
    {
      name: 'ppt/slideLayouts/_rels/slideLayout1.xml.rels',
      data: `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL.master}" Target="../slideMasters/slideMaster1.xml"/></Relationships>`,
    },
    { name: 'ppt/theme/theme1.xml', data: themeXml(doc) },
  );
  if (hasNotes) {
    files.push(
      {
        name: 'ppt/notesMasters/notesMaster1.xml',
        data: `${XML}<p:notesMaster ${NS}><p:cSld>${EMPTY_TREE}</p:cSld>${CLRMAP}<p:notesStyle><a:lvl1pPr><a:defRPr sz="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/></a:defRPr></a:lvl1pPr></p:notesStyle></p:notesMaster>`,
      },
      {
        name: 'ppt/notesMasters/_rels/notesMaster1.xml.rels',
        data: `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL.theme}" Target="../theme/theme2.xml"/></Relationships>`,
      },
      { name: 'ppt/theme/theme2.xml', data: themeXml(doc) },
    );
  }
  for (const m of media) files.push({ name: `ppt/media/${m.name}`, data: m.data });
  // [Content_Types].xml zuerst, wie PowerPoint es schreibt
  files.sort((a, b) => (a.name === '[Content_Types].xml' ? -1 : b.name === '[Content_Types].xml' ? 1 : 0));
  return { blob: await makeZip(files), warnings: [...warnings], slides: n };
}
