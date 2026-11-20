/**
 * Eingefügtes oder hergezogenes Stück einer Webseite in Blöcke zerlegen (Wunsch Jo, 20. November 2026, nach „Auf
 * Seiten verteilen“ in mod_bento): Überschriften, Absätze und Bilder mit Bildunterschrift, in der Reihenfolge der
 * Seite. Daraus macht components/NoteSplit.tsx eine oder mehrere Notizen.
 */
import { looksLikeImage } from './imageDrop';

export type Block = { type: 'heading'; text: string } | { type: 'text'; text: string } | { type: 'img'; src: string; file?: File; caption: string; page: string | null };

const isHttp = (u: string) => /^https?:\/\//i.test(u);
const clean = (s: string) => s.replace(/[ \t ]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();

function dataUrlFile(src: string, i: number): File | undefined {
  const m = /^data:(image\/[a-z0-9.+-]+);base64,(.*)$/i.exec(src);
  if (!m) return undefined;
  try {
    const bin = atob(m[2]);
    const buf = new Uint8Array(bin.length);
    for (let k = 0; k < bin.length; k++) buf[k] = bin.charCodeAt(k);
    return new File([buf], `bild-${i + 1}.${m[1].split('/')[1].replace('svg+xml', 'svg').replace('jpeg', 'jpg')}`, { type: m[1] });
  } catch {
    return undefined;
  }
}

const SEL = 'h1,h2,h3,h4,h5,h6,p,li,blockquote,pre,dd,dt,td,th,figure,img';
const BLOCKISH = /^(H[1-6]|P|LI|BLOCKQUOTE|PRE|DD|DT|TD|TH|FIGURE|UL|OL|TABLE|DIV|SECTION|ARTICLE)$/;

/** Blöcke aus HTML (Zwischenablage, Ziehen); ohne HTML aus Klartext (Absätze an Leerzeilen) */
export function blocksFrom(html: string, plain: string): Block[] {
  const out: Block[] = [];
  if (html.trim()) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const taken: Element[] = [];
    const inside = (el: Element) => taken.some((t) => t !== el && t.contains(el));
    let imgs = 0;
    doc.body.querySelectorAll(SEL).forEach((el) => {
      if (el.tagName === 'IMG') {
        // Bilder in Absätzen gehören vor deren Text; Bilder in einer figure kommen mit ihr
        if (el.closest('figure') && taken.includes(el.closest('figure')!)) return;
        pushImg(el as HTMLImageElement, '');
        return;
      }
      if (inside(el)) return;
      // Behälter mit weiteren Blöcken darin: deren Inhalt kommt einzeln
      if (el.tagName !== 'FIGURE' && [...el.children].some((ch) => BLOCKISH.test(ch.tagName))) return;
      taken.push(el);
      if (el.tagName === 'FIGURE') {
        const cap = clean(el.querySelector('figcaption')?.textContent ?? '');
        const all = [...el.querySelectorAll('img')];
        all.forEach((img, i) => pushImg(img, i === 0 ? cap : ''));
        if (!all.length && cap) out.push({ type: 'text', text: cap });
        return;
      }
      el.querySelectorAll('img').forEach((img) => pushImg(img, ''));
      const text = clean(el.textContent ?? '');
      if (!text) return;
      out.push(/^H[1-6]$/.test(el.tagName) ? { type: 'heading', text: text.slice(0, 200) } : { type: 'text', text });
    });
    function pushImg(img: HTMLImageElement, caption: string) {
      if ((img as Element & { _done?: boolean })._done) return;
      (img as Element & { _done?: boolean })._done = true;
      const src = (img.getAttribute('src') ?? '').trim();
      const a = img.closest('a')?.getAttribute('href') ?? '';
      const page = isHttp(a) && !looksLikeImage(a) ? a : null;
      const alt = clean(img.getAttribute('alt') ?? img.getAttribute('title') ?? '');
      if (src.startsWith('data:')) {
        const file = dataUrlFile(src, imgs++);
        if (file) out.push({ type: 'img', src, file, caption: caption || alt, page });
      } else if (isHttp(src)) {
        // winzige Symbole und Zählpixel weglassen
        const w = Number(img.getAttribute('width') ?? 0);
        if (w && w < 40) return;
        out.push({ type: 'img', src, caption: caption || alt, page });
      }
    }
    // Text ohne Blöcke (z. B. nur <span>): als ein Absatz
    if (!out.some((b) => b.type !== 'img')) {
      const t = clean(doc.body.textContent ?? '');
      if (t) out.push({ type: 'text', text: t });
    }
  } else if (plain.trim()) {
    for (const p of plain.replace(/\r\n?/g, '\n').split(/\n\s*\n/)) {
      const t = clean(p);
      if (t) out.push({ type: 'text', text: t });
    }
  }
  return out;
}

/** Wie viel Text steckt in den Blöcken? (für „lohnt sich der Dialog?“) */
export const textLength = (b: Block[]) => b.reduce((n, x) => n + (x.type === 'img' ? 0 : x.text.length), 0);

export type SplitMode = 'one' | 'sections' | 'each';

export interface PlannedNote {
  title: string;
  body: string;
  img: Extract<Block, { type: 'img' }> | null;
}

/**
 * Blöcke auf Notizen verteilen.
 * - one: eine Notiz mit allem Text und dem ersten Bild; weitere Bilder werden eigene Notizen
 * - sections: neue Notiz an jeder Überschrift und jedem Bild (Überschrift bzw. Bildunterschrift als Titel)
 * - each: jeder Absatz und jedes Bild eine Notiz; eine Überschrift wird Titel der folgenden
 */
export function plan(blocks: Block[], mode: SplitMode, captionAsTitle: boolean): PlannedNote[] {
  const notes: PlannedNote[] = [];
  const capTitle = (b: Extract<Block, { type: 'img' }>) => (captionAsTitle ? b.caption.slice(0, 200) : '');
  if (mode === 'one') {
    const first = blocks.find((b) => b.type === 'img') as Extract<Block, { type: 'img' }> | undefined;
    const heading = blocks.find((b) => b.type === 'heading');
    const text = blocks.filter((b) => b.type !== 'img' && b !== heading).map((b) => (b as { text: string }).text);
    if (first && !captionAsTitle && first.caption) text.unshift(first.caption);
    notes.push({ title: heading ? (heading as { text: string }).text : first ? capTitle(first) : '', body: text.join('\n\n'), img: first ?? null });
    for (const b of blocks) if (b.type === 'img' && b !== first) notes.push({ title: capTitle(b), body: captionAsTitle ? '' : b.caption, img: b });
    return notes.filter((n) => n.title || n.body || n.img);
  }
  let cur: PlannedNote | null = null;
  let pendingTitle = '';
  const flush = () => {
    if (cur && (cur.title || cur.body || cur.img)) notes.push(cur);
    cur = null;
  };
  for (const b of blocks) {
    if (b.type === 'heading') {
      flush();
      if (mode === 'sections') cur = { title: b.text, body: '', img: null };
      else pendingTitle = b.text;
    } else if (b.type === 'img') {
      flush();
      cur = { title: capTitle(b) || pendingTitle, body: captionAsTitle ? '' : b.caption, img: b };
      pendingTitle = '';
      if (mode === 'each') flush();
    } else {
      if (mode === 'each') {
        flush();
        notes.push({ title: pendingTitle, body: b.text, img: null });
        pendingTitle = '';
      } else {
        cur ??= { title: '', body: '', img: null };
        cur.body = cur.body ? cur.body + '\n\n' + b.text : b.text;
      }
    }
  }
  flush();
  if (pendingTitle) notes.push({ title: pendingTitle, body: '', img: null });
  return notes;
}
