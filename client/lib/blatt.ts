/**
 * Arbeitsblätter und Klassenarbeiten (Wunsch Jo, 22. November 2026): Seitensatz für das Format „ag-blatt/1“.
 *
 * Bausteine (Material mit Zeilenzählung und Fußnote, Zitat, Bild, Erklärtext, Aufgabe, Kasten, Linien, Umbruch) werden
 * im Browser auf Seiten fester Größe (A4 oder A5, in mm) gesetzt. Texte brechen an Absätzen auf die nächste Seite um,
 * Linien „bis zum Seitenende“ füllen den Rest einer Seite. Für die Broschüre wird auf ein Vielfaches von vier Seiten
 * aufgefüllt und ausgeschossen: Seite 1 steht neben der letzten.
 *
 * Bewusst ohne React und ohne Abhängigkeiten außer dem kleinen Markdown der Karten, damit Druckvorschau, Druck und
 * später andere Ausgaben (Ausarbeitung als Broschüre, Autogra.fi) denselben Satz nutzen.
 */
import { renderMarkdown } from './markdown';

export type BlockType = 'heading' | 'text' | 'material' | 'quote' | 'image' | 'task' | 'box' | 'glossary' | 'lines' | 'pagebreak';
export type Ruling = 'lines' | 'grid' | 'empty';

export interface Block {
  id: string;
  type: BlockType;
  /** Überschrift, Kasten-Titel */
  text?: string;
  /** Text als kleines Markdown (Absätze, Listen, fett, kursiv) */
  md?: string;
  level?: 1 | 2;
  /** Material: „Material 1“ (leer = automatisch), Titel, Quelle als Fußnote */
  label?: string;
  title?: string;
  source?: string;
  lineNumbers?: boolean;
  justify?: boolean;
  /** Bild */
  src?: string;
  caption?: string;
  width?: number;
  align?: 'left' | 'center' | 'right';
  /** Aufgabe: Punkte bzw. Anteil, Antwortlinien darunter */
  points?: string;
  lines?: number;
  lineStyle?: Ruling;
  /** Linien */
  style?: Ruling;
  count?: number;
  fill?: boolean;
  spacing?: number;
  /** früher: Korrekturrand je Linien-Baustein; jetzt im Blatt (page.korr), hier nur noch „ohne“ möglich */
  rand?: boolean;
  korrOff?: boolean;
  /** Glossar: Reihenfolge und Kennzeichen der Wörter im Text */
  sort?: 'alpha' | 'order';
  mark?: 'star' | 'arrow' | 'bold' | 'none';
  /** Gestaltung (Wunsch Jo, 22. November 2026): Vorlage und eigene Abweichungen für den ganzen Baustein */
  tpl?: string;
  /** Schriftgröße in Prozent der Blattschrift */
  fs?: number;
  /** Zeilenabstand (Vielfaches der Schrifthöhe) */
  lh?: number;
  ta?: 'left' | 'justify' | 'center' | 'right';
  it?: boolean;
  bd?: boolean;
  /** freier Rand rechts für Notizen (mm); Randbemerkungen ^^[…] stehen dort */
  nm?: number;
  /** Einzug links (mm) */
  ind?: number;
}

/** Korrekturrand auf Schreiblinien und Karos (Wunsch Jo, 22. November 2026) */
export interface Korr {
  side: 'none' | 'right' | 'left';
  width: number;
  /** Linie dünn, mittel oder dick, oder ohne Linie: die Zeilen enden vor dem Rand */
  style: 'thin' | 'medium' | 'thick' | 'end';
}

export interface BlattDoc {
  format: 'ag-blatt/1';
  page: {
    size: 'a4' | 'a5';
    booklet: boolean;
    font: 'sans' | 'serif';
    fontSize: number;
    pageNumbers: boolean;
    /** Leere Seiten der Broschüre */
    fill: Ruling;
    header: { show: boolean; text: string; nameLine: boolean; date: boolean; qr: 'first' | 'all' | 'none' };
    korr: Korr;
  };
  blocks: Block[];
}

/** Platzhalter aus „Nummern bestellen“ (z. B. „Abgabe 3“), kein echter Name */
export function isNumberedSeat(name: string): boolean {
  return /^Abgabe \d+$/.test(name.trim());
}

/** Ein persönliches Exemplar (QR-Code aus Autogra.fi) */
export interface Copy {
  name?: string;
  printName?: boolean;
  code?: string;
  qr?: string;
}

export const SIZES = { a4: [210, 297], a5: [148, 210] } as const;
const MARGIN = { a4: 18, a5: 12 } as const;
const FONTS = {
  sans: "Carlito, Calibri, 'Segoe UI', 'Helvetica Neue', Arial, sans-serif",
  serif: "'Linux Libertine', 'Libertinus Serif', Georgia, 'Times New Roman', serif",
};

export const BLOCK_LABEL: Record<BlockType, string> = {
  heading: 'Überschrift',
  text: 'Erklärtext',
  material: 'Material',
  quote: 'Zitat',
  image: 'Bild',
  task: 'Aufgabe',
  box: 'Kasten',
  glossary: 'Glossar',
  lines: 'Linien',
  pagebreak: 'Seitenumbruch',
};

export function blankDoc(title = ''): BlattDoc {
  return {
    format: 'ag-blatt/1',
    page: { size: 'a4', booklet: false, font: 'sans', fontSize: 11, pageNumbers: true, fill: 'lines', header: { show: true, text: title, nameLine: true, date: false, qr: 'none' }, korr: { side: 'none', width: 30, style: 'thin' } },
    blocks: [],
  };
}

/** Gespeicherten Text lesen; Fehlendes mit Voreinstellungen auffüllen. */
export function parseDoc(body: string, title = ''): BlattDoc {
  const d = blankDoc(title);
  try {
    const j = JSON.parse(body || '{}') as Partial<BlattDoc>;
    const blocks = Array.isArray(j.blocks) ? j.blocks : [];
    // ältere Blätter: Korrekturrand hing am einzelnen Linien-Baustein (rechts, etwa 4 cm)
    const korr = j.page?.korr ?? (blocks.some((b) => b.type === 'lines' && b.rand) ? { side: 'right' as const, width: 40, style: 'thin' as const } : d.page.korr);
    if (!j.page?.korr) for (const b of blocks) if (b.type === 'lines' && !b.rand && korr.side !== 'none') b.korrOff = true;
    return { ...d, ...j, format: 'ag-blatt/1', page: { ...d.page, ...(j.page ?? {}), header: { ...d.page.header, ...(j.page?.header ?? {}) }, korr: { ...d.page.korr, ...korr } }, blocks };
  } catch {
    return d;
  }
}

let seq = 0;
export const uid = () => 'b' + Date.now().toString(36) + (seq++).toString(36) + Math.random().toString(36).slice(2, 5);

export function newBlock(type: BlockType): Block {
  const b: Block = { id: uid(), type };
  if (type === 'heading') Object.assign(b, { text: 'Arbeitsaufträge:', level: 2 });
  if (type === 'text') b.md = '';
  if (type === 'material') Object.assign(b, { label: '', title: '', md: '', source: '', lineNumbers: true, justify: true });
  if (type === 'quote') Object.assign(b, { md: '', source: '' });
  if (type === 'image') Object.assign(b, { src: '', caption: '', width: 100, align: 'center' });
  if (type === 'task') Object.assign(b, { md: '', points: '', lines: 0, lineStyle: 'lines' });
  if (type === 'box') Object.assign(b, { text: '', md: '' });
  if (type === 'glossary') Object.assign(b, { text: 'Glossar', sort: 'alpha', mark: 'star' });
  if (type === 'lines') Object.assign(b, { style: 'lines', count: 8, fill: true, spacing: 8 });
  const t = TEMPLATES[type]?.[0];
  if (t) b.tpl = t.id;
  return b;
}

/** Kurztext eines Bausteins für die Liste */
export function blockSummary(b: Block): string {
  const plain = (s?: string) => plainMd(s ?? '').replace(/[#>-]+/g, ' ').replace(/\s+/g, ' ').trim();
  switch (b.type) {
    case 'heading':
      return b.text || '';
    case 'material':
      return [b.label, plain(b.title)].filter(Boolean).join(': ') || plain(b.md);
    case 'image':
      return b.caption || (b.src ? 'Bild' : 'noch kein Bild');
    case 'box':
      return b.text || plain(b.md);
    case 'glossary':
      return b.text || '';
    case 'lines':
      return `${b.style === 'grid' ? 'Karos' : b.style === 'empty' ? 'Freiraum' : 'Schreiblinien'}${b.fill ? ' bis zum Seitenende' : `, ${b.count ?? 0}`}`;
    case 'pagebreak':
      return '';
    default:
      return plain(b.md);
  }
}

// ---------- DOM-Helfer ----------
function el(tag: string, cls = '', html?: string): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
// ---------- Text der Bausteine ----------
/*
 * Schreibweise wie bei den Lernseiten (lib/tufte.ts), damit der Editor dort mitbenutzt werden kann:
 *   **fett**, *kursiv*, ++unterstrichen++, ==Textmarker==
 *   Text^[Fußnote]          Fußnote unten auf der Seite, fortlaufend nummeriert
 *   Text^^[Randbemerkung]   steht im Rand für Notizen neben der Zeile
 *   {Wort|Erklärung}        Wort fürs Glossar
 * Jede Zeile ist ein Absatz; „- “ und „1. “ sind Listen. Alles wird maskiert.
 */

/** Zähler und Sammelstellen beim Setzen eines Blatts */
export interface TextCtx {
  fn: number;
  notes: Map<number, string>;
  mark: NonNullable<Block['mark']>;
}
const newTextCtx = (mark: TextCtx['mark'] = 'star'): TextCtx => ({ fn: 0, notes: new Map(), mark });

function closing(s: string, i: number, open: string, close: string): number {
  let depth = 0;
  for (let j = i; j < s.length; j++) {
    if (s[j] === '\\') {
      j++;
      continue;
    }
    if (s[j] === open) depth++;
    else if (s[j] === close && --depth === 0) return j;
  }
  return -1;
}

const INLINE_MARKS: [string, string][] = [
  ['++', 'u'],
  ['**', 'strong'],
  ['__', 'strong'],
  ['*', 'em'],
  ['_', 'em'],
];

function inline(s: string, ctx: TextCtx | null, notes = true): string {
  let out = '';
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === '\\' && i + 1 < s.length) {
      out += esc(s[i + 1]);
      i += 2;
      continue;
    }
    if (notes && c === '^' && (s.startsWith('^[', i) || s.startsWith('^^[', i))) {
      const margin = s.startsWith('^^[', i);
      const start = i + (margin ? 2 : 1);
      const end = closing(s, start, '[', ']');
      if (end > 0) {
        const body = inline(s.slice(start + 1, end), ctx, false);
        if (margin) out += `<span class="bl-mnote">${body}</span>`;
        else if (ctx) {
          const n = ++ctx.fn;
          ctx.notes.set(n, body);
          out += `<sup class="bl-fn" data-fn="${n}">${n}</sup>`;
        }
        i = end + 1;
        continue;
      }
    }
    if (notes && c === '{') {
      const end = closing(s, i, '{', '}');
      const bar = end > 0 ? s.indexOf('|', i) : -1;
      if (end > 0 && bar > i && bar < end) {
        const w = inline(s.slice(i + 1, bar), ctx, false);
        const m = ctx?.mark ?? 'star';
        out += m === 'arrow' ? `<span class="bl-gl">→\u2009${w}</span>` : m === 'star' ? `<span class="bl-gl">${w}<sup>*</sup></span>` : `<span class="bl-gl bl-gl-${m}">${w}</span>`;
        i = end + 1;
        continue;
      }
    }
    if (c === '=' && s.startsWith('==', i) && s[i + 2] && s[i + 2] !== ' ') {
      const end = s.indexOf('==', i + 2);
      if (end > i + 2) {
        out += `<mark>${inline(s.slice(i + 2, end), ctx, notes)}</mark>`;
        i = end + 2;
        continue;
      }
    }
    if (c === '`') {
      const end = s.indexOf('`', i + 1);
      if (end > i) {
        out += `<code>${esc(s.slice(i + 1, end))}</code>`;
        i = end + 1;
        continue;
      }
    }
    if (c === '[') {
      // Links: auf Papier nur der Text
      const end = closing(s, i, '[', ']');
      if (end > 0 && s[end + 1] === '(') {
        const pe = closing(s, end + 1, '(', ')');
        if (pe > 0) {
          out += inline(s.slice(i + 1, end), ctx, notes);
          i = pe + 1;
          continue;
        }
      }
    }
    let matched = false;
    for (const [mk, tag] of INLINE_MARKS) {
      if (!s.startsWith(mk, i) || !s[i + mk.length] || s[i + mk.length] === ' ') continue;
      if (mk[0] === '_' && i > 0 && /\w/.test(s[i - 1])) continue;
      const end = s.indexOf(mk, i + mk.length);
      if (end > i + mk.length) {
        out += `<${tag}>${inline(s.slice(i + mk.length, end), ctx, notes)}</${tag}>`;
        i = end + mk.length;
        matched = true;
        break;
      }
    }
    if (matched) continue;
    out += esc(c);
    i++;
  }
  return out;
}

/** Markdown → Absätze (je Absatz bzw. Liste ein Stück HTML); Fußnoten werden dabei nummeriert. */
function paragraphs(md: string | undefined, ctx: TextCtx | null): string[] {
  const out: string[] = [];
  const lines = (md ?? '').replace(/\r\n?/g, '\n').split('\n');
  let i = 0;
  const item = /^\s*([-*•]|\d+[.)])\s+(.*)$/;
  while (i < lines.length) {
    const t = lines[i].trim();
    if (!t) {
      i++;
      continue;
    }
    const li = item.exec(t);
    if (li) {
      const ordered = /^\d/.test(li[1]);
      const items: string[] = [];
      while (i < lines.length) {
        const m = item.exec(lines[i].trim());
        if (!m || /^\d/.test(m[1]) !== ordered) break;
        items.push(`<li>${inline(m[2], ctx)}</li>`);
        i++;
      }
      out.push(`<${ordered ? 'ol' : 'ul'}>${items.join('')}</${ordered ? 'ol' : 'ul'}>`);
      continue;
    }
    const h = /^(#{1,3})\s+(.*)$/.exec(t);
    if (h) out.push(`<h4>${inline(h[2], ctx)}</h4>`);
    else out.push(`<p>${inline(t.replace(/^>\s?/, ''), ctx)}</p>`);
    i++;
  }
  return out;
}
const inlineMd = (md: string | undefined, ctx: TextCtx | null) => paragraphs(md, ctx).map((p) => p.replace(/^<p>|<\/p>$/g, '')).join('<br>');

/** Markdown als schlichter Text (Liste der Bausteine, Autogra.fi) */
export function plainMd(md: string, notes: 'drop' | 'paren' = 'drop'): string {
  let out = '';
  for (let i = 0; i < md.length; i++) {
    const c = md[i];
    if (c === '\\' && i + 1 < md.length) {
      out += md[++i];
      continue;
    }
    if (c === '^' && (md.startsWith('^[', i) || md.startsWith('^^[', i))) {
      const start = i + (md.startsWith('^^[', i) ? 2 : 1);
      const end = closing(md, start, '[', ']');
      if (end > 0) {
        if (notes === 'paren') out += ` (${plainMd(md.slice(start + 1, end))})`;
        i = end;
        continue;
      }
    }
    if (c === '{') {
      const end = closing(md, i, '{', '}');
      const bar = end > 0 ? md.indexOf('|', i) : -1;
      if (end > 0 && bar > i && bar < end) {
        out += plainMd(md.slice(i + 1, bar));
        i = end;
        continue;
      }
    }
    out += c;
  }
  return out.replace(/\+\+|==|\*\*|__|`/g, '').replace(/(^|\s)[*_]|[*_](\s|$)/g, '$1$2').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
}

/** Alle Glossar-Wörter des Blatts in der Reihenfolge des Auftretens (ein Eintrag je Wort) */
export function glossaryTerms(doc: BlattDoc): { word: string; explain: string }[] {
  const seen = new Map<string, { word: string; explain: string }>();
  for (const b of doc.blocks) {
    for (const md of [b.md, b.title]) {
      if (!md) continue;
      for (let i = 0; i < md.length; i++) {
        if (md[i] === '\\') {
          i++;
          continue;
        }
        if (md[i] !== '{') continue;
        const end = closing(md, i, '{', '}');
        const bar = end > 0 ? md.indexOf('|', i) : -1;
        if (end > 0 && bar > i && bar < end) {
          const word = plainMd(md.slice(i + 1, bar)).trim();
          const explain = md.slice(bar + 1, end).trim();
          const k = word.toLowerCase();
          const had = seen.get(k);
          if (!had) seen.set(k, { word, explain });
          else if (!had.explain && explain) had.explain = explain;
          i = end;
        }
      }
    }
  }
  return [...seen.values()];
}

/** Erklärung eines Glossar-Worts überall im Blatt setzen (oder mit explain = null das Wort aus dem Glossar nehmen) */
export function setTerm(doc: BlattDoc, word: string, explain: string | null): BlattDoc {
  const k = word.toLowerCase();
  const fix = (md?: string) => {
    if (!md || !md.includes('{')) return md;
    let out = '';
    for (let i = 0; i < md.length; i++) {
      if (md[i] === '\\') {
        out += md[i] + (md[i + 1] ?? '');
        i++;
        continue;
      }
      if (md[i] === '{') {
        const end = closing(md, i, '{', '}');
        const bar = end > 0 ? md.indexOf('|', i) : -1;
        if (end > 0 && bar > i && bar < end && plainMd(md.slice(i + 1, bar)).trim().toLowerCase() === k) {
          const w = md.slice(i + 1, bar);
          out += explain === null ? w : `{${w}|${explain.replace(/[{}\n]/g, ' ')}}`;
          i = end;
          continue;
        }
      }
      out += md[i];
    }
    return out;
  };
  return { ...doc, blocks: doc.blocks.map((b) => ({ ...b, md: fix(b.md), title: fix(b.title) })) };
}

/**
 * Für den Editor (lib/tufteEdit.ts): dort trennt erst eine Leerzeile die Absätze, hier jede Zeile. Listen und
 * Zitatzeilen bleiben zusammen.
 */
export function toEditMd(md: string): string {
  const lines = (md ?? '').split('\n').filter((l) => l.trim());
  const group = (l: string) => (/^\s*([-*•]|\d+[.)])\s/.test(l) ? 'li' : /^>/.test(l) ? 'q' : 'p');
  // wie editToTufte: Leerzeile zwischen Absätzen, Zeilenende am Schluss (sonst setzt der Editor bei jeder Eingabe neu)
  return lines.map((l, i) => (i && (group(l) === 'p' || group(l) !== group(lines[i - 1])) ? '\n\n' : i ? '\n' : '') + l).join('') + (lines.length ? '\n' : '');
}
export const fromEditMd = (md: string) => md.replace(/\n{2,}/g, '\n').trim();

// ---------- Vorlagen ----------
export interface Template {
  id: string;
  label: string;
  /** Voreinstellungen; was man selbst ändert, gilt zusätzlich */
  style?: Partial<Pick<Block, 'fs' | 'lh' | 'ta' | 'it' | 'bd' | 'nm' | 'ind'>>;
}
export const TEMPLATES: Partial<Record<BlockType, Template[]>> = {
  text: [
    { id: 'standard', label: 'Standard' },
    { id: 'hinweis', label: 'Hinweis, grau hinterlegt' },
    { id: 'klein', label: 'Kleingedrucktes', style: { fs: 85 } },
    { id: 'einleitung', label: 'Einleitung, kursiv', style: { it: true, lh: 1.5 } },
  ],
  material: [
    { id: 'standard', label: 'Standard: Zeilen gezählt, Blocksatz', style: { ta: 'justify', lh: 1.45 } },
    { id: 'rand', label: 'Mit Rand für Notizen', style: { ta: 'justify', lh: 1.7, nm: 35 } },
    { id: 'kompakt', label: 'Kompakt', style: { ta: 'justify', fs: 92, lh: 1.3 } },
    { id: 'zeitung', label: 'Zeitungsartikel (Serifen)', style: { ta: 'justify', lh: 1.4 } },
  ],
  quote: [
    { id: 'balken', label: 'Mit Balken links', style: { it: true } },
    { id: 'eingerueckt', label: 'Eingerückt, ohne Balken', style: { it: true, ind: 10 } },
    { id: 'gross', label: 'Groß in der Mitte', style: { it: true, fs: 120, ta: 'center' } },
  ],
  task: [
    { id: 'standard', label: 'Standard' },
    { id: 'fett', label: 'Aufgabe fett', style: { bd: true } },
    { id: 'kasten', label: 'Im Kasten' },
  ],
  box: [
    { id: 'rahmen', label: 'Rahmen' },
    { id: 'grau', label: 'Grau hinterlegt' },
    { id: 'merksatz', label: 'Merksatz mit Balken' },
    { id: 'gestrichelt', label: 'Gestrichelt' },
  ],
  glossary: [
    { id: 'liste', label: 'Liste' },
    { id: 'kasten', label: 'Im Kasten' },
    { id: 'zweispaltig', label: 'Zwei Spalten', style: { fs: 92 } },
  ],
};
export const STYLE_KEYS = ['fs', 'lh', 'ta', 'it', 'bd', 'nm', 'ind'] as const;
/** Gestaltung eines Bausteins: Vorlage, darüber eigene Werte */
export function styleOf(b: Block): Required<Template>['style'] {
  const t = TEMPLATES[b.type]?.find((x) => x.id === b.tpl) ?? TEMPLATES[b.type]?.[0];
  const st: Required<Template>['style'] = { ...(t?.style ?? {}) };
  // ältere Materialien: Blocksatz als eigener Schalter
  if (b.type === 'material' && b.justify === false && b.ta === undefined) st.ta = 'left';
  for (const k of STYLE_KEYS) if (b[k] !== undefined) (st as Record<string, unknown>)[k] = b[k];
  return st;
}

/**
 * Linien und Karos als SVG: wird zuverlässig mitgedruckt (Hintergründe nicht). Mit Korrekturrand enden die Zeilen
 * vor dem Rand; je nach Wahl steht dort eine dünne, mittlere oder dicke Linie oder keine.
 */
const KORR_W = { thin: 0.25, medium: 0.5, thick: 0.9, end: 0 } as const;
function ruling(style: Ruling, widthMm: number, heightMm: number, spacing: number, korr: Korr | null): Element {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${widthMm} ${heightMm}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('class', 'bl-ruling');
  svg.style.width = widthMm + 'mm';
  svg.style.height = heightMm + 'mm';
  const line = (x1: number, y1: number, x2: number, y2: number, w: number, c: string) => {
    const l = document.createElementNS(ns, 'line');
    l.setAttribute('x1', String(x1));
    l.setAttribute('y1', String(y1));
    l.setAttribute('x2', String(x2));
    l.setAttribute('y2', String(y2));
    l.setAttribute('stroke', c);
    l.setAttribute('stroke-width', String(w));
    svg.appendChild(l);
  };
  const k = korr && korr.side !== 'none' && style !== 'empty' ? korr : null;
  const kw = k ? Math.max(10, Math.min(widthMm / 2, Number(k.width) || 30)) : 0;
  // Schreibfläche ohne Rand; bei „Zeilen enden“ ein kleiner Abstand, damit das Ende klar zu sehen ist
  const x0 = k?.side === 'left' ? kw : 0;
  const x1 = k?.side === 'right' ? widthMm - kw : widthMm;
  if (style === 'grid') {
    const g = 5;
    const w = x1 - x0;
    const ox = x0 + (w % g) / 2;
    for (let x = ox; x <= x1 - (w % g) / 2 + 0.01; x += g) line(x, 0, x, heightMm, 0.15, '#9aa5b1');
    for (let y = 0; y <= heightMm + 0.01; y += g) line(ox, y, x1 - (w % g) / 2, y, 0.15, '#9aa5b1');
  } else if (style === 'lines') {
    for (let y = spacing; y <= heightMm + 0.01; y += spacing) line(x0, y, x1, y, 0.2, '#7b8794');
  }
  if (k && k.style !== 'end') {
    const x = k.side === 'right' ? widthMm - kw : kw;
    line(x, 0, x, heightMm, KORR_W[k.style] ?? 0.25, '#555');
  }
  return svg;
}

interface Ctx {
  widthMm: number;
  number?: number;
  korr: Korr | null;
  text: TextCtx;
  terms: { word: string; explain: string }[];
}
interface Part {
  /** vorbereitete Absätze (einmal gesetzt, damit Fußnoten beim Umbrechen ihre Nummer behalten) */
  paras?: string[];
  title?: string;
  first?: boolean;
  last?: boolean;
  heightMm?: number;
}

/** Vorlage und eigene Gestaltung auf den Baustein anwenden */
function applyStyle(box: HTMLElement, b: Block, hasMargin: boolean) {
  const st = styleOf(b);
  const tpl = TEMPLATES[b.type]?.find((x) => x.id === b.tpl)?.id ?? TEMPLATES[b.type]?.[0]?.id;
  if (tpl) box.classList.add('bl-tpl-' + tpl);
  if (st.fs && st.fs !== 100) box.style.fontSize = Math.max(60, Math.min(200, st.fs)) / 100 + 'em';
  if (st.lh) box.style.lineHeight = String(Math.max(1, Math.min(3, st.lh)));
  if (st.ta) {
    box.style.textAlign = st.ta;
    if (st.ta === 'justify') box.style.hyphens = 'auto';
  }
  if (st.it) box.style.fontStyle = 'italic';
  if (st.bd) box.style.fontWeight = '700';
  if (st.ind) box.style.paddingLeft = Math.max(0, Math.min(60, st.ind)) + 'mm';
  const nm = st.nm || (hasMargin ? 30 : 0);
  if (nm) {
    box.classList.add('bl-hasnm');
    box.style.setProperty('--nm', Math.max(10, Math.min(70, nm)) + 'mm');
  }
}

function render(b: Block, ctx: Ctx, part: Part = {}): HTMLElement {
  const box = el('div', 'bl-block bl-' + b.type);
  box.dataset.bid = b.id;
  const paras = part.paras ?? [];
  const html = paras.join('');
  const first = part.first !== false;
  switch (b.type) {
    case 'heading':
      box.appendChild(el(b.level === 1 ? 'h2' : 'h3', '', part.title || esc(b.text)));
      break;
    case 'text':
      box.appendChild(el('div', 'bl-text', html || '<p class="bl-ph">Erklärtext …</p>'));
      break;
    case 'material': {
      if (first) {
        const label = (b.label ?? '').trim() || `Material ${ctx.number}`;
        const title = part.title ?? '';
        box.appendChild(el('div', 'bl-mat-title', `<span class="bl-mat-label">${esc(label)}${title.replace(/<sup[^>]*>.*?<\/sup>/g, '') ? ':' : ''}</span>${title ? ' ' + title : ''}`));
      }
      box.appendChild(el('div', 'bl-mat-body' + (b.lineNumbers !== false ? ' bl-numbered' : ''), html || '<p class="bl-ph">Text des Materials …</p>'));
      break;
    }
    case 'quote':
      box.appendChild(el('div', 'bl-quote-text', html || '<p class="bl-ph">Zitat …</p>'));
      if (b.source && part.last !== false) box.appendChild(el('div', 'bl-quote-src', esc(b.source)));
      break;
    case 'image': {
      const fig = el('figure', 'bl-fig bl-align-' + (b.align ?? 'center'));
      fig.style.width = Math.max(15, Math.min(100, Number(b.width) || 100)) + '%';
      if (b.src) {
        const img = el('img') as HTMLImageElement;
        img.src = b.src;
        img.alt = b.caption ?? '';
        fig.appendChild(img);
      } else fig.appendChild(el('div', 'bl-img-empty', '<span>Bild hierher ziehen<br>oder rechts auswählen</span>'));
      if (b.caption) fig.appendChild(el('figcaption', '', esc(b.caption)));
      box.appendChild(fig);
      break;
    }
    case 'task': {
      const row = el('div', 'bl-task-row');
      row.appendChild(el('span', 'bl-task-no', `${ctx.number}.`));
      const pts = b.points ? ` <span class="bl-pts">${esc(b.points)}</span>` : '';
      row.appendChild(el('div', 'bl-task-text', (part.title || '<span class="bl-ph">Aufgabenstellung …</span>') + pts));
      box.appendChild(row);
      const n = Math.max(0, Math.min(40, Number(b.lines) || 0));
      if (n) {
        const style = b.lineStyle ?? 'lines';
        const sp = style === 'grid' ? 5 : Number(b.spacing) || 8;
        const lines = style === 'grid' ? Math.ceil((n * 8) / 5) : n;
        const r = ruling(style, ctx.widthMm, lines * sp + (style === 'grid' ? 0 : 1), sp, ctx.korr);
        // Linien gehen über die ganze Breite, auch wenn der Text eingerückt ist
        (r as SVGElement).style.fontStyle = 'normal';
        box.appendChild(r);
      }
      break;
    }
    case 'box':
      if (b.text && first) box.appendChild(el('div', 'bl-box-title', esc(b.text)));
      box.appendChild(el('div', 'bl-box-text', html || '<p class="bl-ph">Inhalt des Kastens …</p>'));
      break;
    case 'glossary':
      if (first && b.text) box.appendChild(el('div', 'bl-gl-title', esc(b.text)));
      box.appendChild(el('div', 'bl-gl-list', html || '<p class="bl-ph">Noch keine Wörter. Markiere im Text ein Wort und wähle „Glossar“.</p>'));
      break;
    case 'lines': {
      const style = b.style ?? 'lines';
      const sp = style === 'grid' ? 5 : Number(b.spacing) || 8;
      const h = part.heightMm ?? Math.max(1, Number(b.count) || 5) * sp;
      if (style === 'empty') {
        const d = el('div', 'bl-empty');
        d.style.height = h + 'mm';
        box.appendChild(d);
      } else box.appendChild(ruling(style, ctx.widthMm, h, sp, b.korrOff ? null : ctx.korr));
      break;
    }
    default:
      break;
  }
  if (b.type !== 'lines' && b.type !== 'pagebreak' && b.type !== 'image') applyStyle(box, b, /bl-mnote/.test(html));
  return box;
}

/** Bausteine einmal in HTML-Stücke übersetzen (Absätze zum Umbrechen, Titel), Fußnoten dabei nummerieren */
function prepare(b: Block, ctx: Ctx): Part {
  const t = ctx.text;
  switch (b.type) {
    case 'material': {
      let title = inlineMd(b.title, t);
      if (b.source?.trim()) {
        const n = ++t.fn;
        t.notes.set(n, esc(b.source));
        title += `<sup class="bl-fn" data-fn="${n}">${n}</sup>`;
      }
      return { title, paras: paragraphs(b.md, t) };
    }
    case 'text':
    case 'quote':
    case 'box':
      return { paras: paragraphs(b.md, t) };
    case 'task':
      return { title: inlineMd(b.md, t) };
    case 'heading':
      return { title: inlineMd(b.text, t) };
    case 'glossary': {
      const terms = [...ctx.terms];
      if (b.sort !== 'order') terms.sort((x, y) => x.word.localeCompare(y.word, 'de'));
      return { paras: terms.map((x) => `<p class="bl-gl-item"><b>${esc(x.word)}</b> ${x.explain ? '– ' + inline(x.explain, null, false) : '<span class="bl-ph">– Erklärung fehlt</span>'}</p>`) };
    }
    default:
      return {};
  }
}

/** Zeilennummern alle fünf Zeilen links neben dem Material, fortlaufend über Seiten. */
function numberLines(blockEl: HTMLElement, start: number): number {
  const body = blockEl.querySelector<HTMLElement>('.bl-mat-body');
  if (!body) return 0;
  const lh = parseFloat(getComputedStyle(body).lineHeight) || 16;
  let n = start;
  for (const p of [...body.children] as HTMLElement[]) {
    if (p.classList.contains('bl-lno')) continue;
    const lines = Math.max(1, Math.round(p.offsetHeight / lh));
    for (let i = 0; i < lines; i++) {
      n++;
      if (body.classList.contains('bl-numbered') && n % 5 === 0) {
        const s = el('span', 'bl-lno', String(n));
        s.style.top = p.offsetTop + i * lh + 'px';
        body.appendChild(s);
      }
    }
  }
  return n - start;
}

interface Pg {
  page: HTMLElement;
  body: HTMLElement;
  notes: HTMLElement;
  foot: HTMLElement;
  widthMm: number;
}

function newPage(doc: BlattDoc, host: HTMLElement, index: number, copy?: Copy): Pg {
  const P = doc.page;
  const size = P.size === 'a5' ? 'a5' : 'a4';
  const [w, h] = SIZES[size];
  const m = MARGIN[size];
  const page = el('div', `bl-page bl-${size}`);
  page.style.width = w + 'mm';
  page.style.height = h + 'mm';
  page.style.padding = `${m}mm ${m}mm ${m * 0.8}mm`;
  page.style.fontFamily = FONTS[P.font] ?? FONTS.sans;
  page.style.fontSize = (Number(P.fontSize) || 11) + 'pt';
  const H = P.header;
  const qrHere = H.qr === 'all' || (H.qr === 'first' && index === 0);
  if (H.show && (index === 0 || qrHere)) {
    const head = el('div', 'bl-head');
    const left = el('div', 'bl-head-left');
    if (H.text) left.appendChild(el('div', 'bl-head-title', esc(H.text)));
    const fields = el('div', 'bl-head-fields');
    if (H.nameLine) {
      // Nummerierte Plätze („Abgabe 3“) sind kein Name: Linie frei lassen, Nummer klein darunter.
      const numbered = !!copy?.name && isNumberedSeat(copy.name);
      const line =
        copy?.name && copy.printName && !numbered
          ? `<span class="bl-filled">${esc(copy.name)}</span>`
          : numbered
            ? `<span class="bl-blank bl-labelled"><span class="bl-under">${esc(copy!.name!)}</span></span>`
            : '<span class="bl-blank"></span>';
      fields.appendChild(el('span', 'bl-field', 'Name: ' + line));
    }
    if (H.date) fields.appendChild(el('span', 'bl-field', 'Datum: <span class="bl-blank bl-short"></span>'));
    if (fields.children.length) left.appendChild(fields);
    head.appendChild(left);
    if (qrHere) {
      const q = el('div', 'bl-qr');
      if (copy?.qr) {
        const img = el('img') as HTMLImageElement;
        img.src = copy.qr;
        img.alt = 'QR-Code für Autogra.fi';
        q.appendChild(img);
        if (copy.code) q.appendChild(el('div', 'bl-qr-code', esc(copy.code)));
      } else q.appendChild(el('div', 'bl-qr-ph', '<span>QR-Code<br>Autogra.fi</span>'));
      head.appendChild(q);
    }
    page.appendChild(head);
  }
  const body = el('div', 'bl-body');
  const notes = el('div', 'bl-notes');
  const foot = el('div', 'bl-foot');
  page.append(body, notes, foot);
  host.appendChild(page);
  return { page, body, notes, foot, widthMm: w - 2 * m };
}

const over = (pg: Pg) => pg.body.scrollHeight > pg.body.clientHeight + 1;
const pxPerMm = (pg: Pg) => pg.body.clientWidth / pg.widthMm;
function usedPx(pg: Pg): number {
  const last = pg.body.lastElementChild as HTMLElement | null;
  if (!last) return 0;
  return last.offsetTop - pg.body.offsetTop + last.offsetHeight + parseFloat(getComputedStyle(last).marginBottom || '0');
}

export interface Problem {
  bid: string;
  msg: string;
}

/**
 * Bausteine auf Seiten setzen. host muss sichtbar im Dokument hängen, denn gemessen wird in px.
 * Liefert die Seiten in Lesereihenfolge und Hinweise auf Bausteine, die nicht auf eine Seite passen.
 */
export function paginate(doc: BlattDoc, host: HTMLElement, copy?: Copy): { pages: HTMLElement[]; problems: Problem[] } {
  host.replaceChildren();
  const pages: Pg[] = [];
  const problems: Problem[] = [];
  let pg!: Pg;
  const next = () => {
    pg = newPage(doc, host, pages.length, copy);
    pages.push(pg);
  };
  next();
  /** neue Seite, weil der nächste Baustein nicht mehr passt: eine Überschrift unten auf der Seite geht mit */
  const nextKeep = () => {
    const last = pg.body.lastElementChild as HTMLElement | null;
    const keep = last?.classList.contains('bl-heading') && pg.body.children.length > 1 ? last : null;
    next();
    if (keep) pg.body.appendChild(keep);
  };
  let taskNo = 0;
  let matNo = 0;
  const gloss = doc.blocks.find((b) => b.type === 'glossary');
  const text = newTextCtx(gloss?.mark ?? 'star');
  const terms = glossaryTerms(doc);
  const korr = doc.page.korr?.side && doc.page.korr.side !== 'none' ? doc.page.korr : null;
  const mkCtx = (extra: Partial<Ctx> = {}): Ctx => ({ widthMm: pg.widthMm, korr, text, terms, ...extra });

  const place = (b: Block, ctx: Ctx, part?: Part) => {
    const e = render(b, ctx, part);
    pg.body.appendChild(e);
    // Fußnoten der gesetzten Stücke unten auf dieselbe Seite
    const notes: HTMLElement[] = [];
    for (const f of e.querySelectorAll<HTMLElement>('sup.bl-fn')) {
      const n = Number(f.dataset.fn);
      const note = el('div', 'bl-note', `<sup>${n}</sup> ${text.notes.get(n) ?? ''}`);
      note.dataset.bid = b.id;
      pg.notes.appendChild(note);
      notes.push(note);
    }
    return {
      e,
      remove() {
        e.remove();
        for (const n of notes) n.remove();
      },
    };
  };

  for (const b of doc.blocks) {
    if (b.type === 'pagebreak') {
      if (pg.body.children.length) next();
      continue;
    }
    const ctx = mkCtx();
    if (b.type === 'task') ctx.number = ++taskNo;
    if (b.type === 'material') ctx.number = ++matNo;

    if (b.type === 'lines' && b.fill) {
      // bis zum Seitenende: Rest messen; ist kaum noch Platz, eine neue Seite füllen
      const sp = b.style === 'grid' ? 5 : Number(b.spacing) || 8;
      const free = () => (pg.body.clientHeight - usedPx(pg)) / pxPerMm(pg) - 2;
      if (free() < sp * 2) next();
      place(b, mkCtx(), { heightMm: Math.max(sp, Math.floor(free() / sp) * sp) });
      continue;
    }

    const prep = prepare(b, ctx);
    const paras = prep.paras ?? [];
    const splittable = b.type === 'text' || b.type === 'material' || b.type === 'quote' || b.type === 'box' || b.type === 'glossary';
    if (!splittable || paras.length <= 1) {
      let p = place(b, ctx, prep);
      if (over(pg) && pg.body.children.length > 1) {
        p.remove();
        nextKeep();
        ctx.widthMm = pg.widthMm;
        p = place(b, ctx, prep);
      }
      if (b.type === 'material') numberLines(p.e, 0);
      if (over(pg)) {
        p.e.classList.add('bl-overflow');
        problems.push({ bid: b.id, msg: 'Passt nicht auf eine Seite' });
      }
      continue;
    }

    // mehrere Absätze: so viele wie passen, der Rest auf die nächste Seite
    let i = 0;
    let lineNo = 0;
    let first = true;
    while (i < paras.length) {
      let j = paras.length;
      const part = (k: number): Part => ({ ...prep, paras: paras.slice(i, k), first, last: k === paras.length });
      let p = place(b, ctx, part(j));
      while (over(pg) && j - i > 1) {
        p.remove();
        j--;
        p = place(b, ctx, part(j));
      }
      if (over(pg) && pg.body.children.length > 1) {
        // nicht einmal ein Absatz passt auf den Rest der Seite
        p.remove();
        nextKeep();
        ctx.widthMm = pg.widthMm;
        continue;
      }
      if (over(pg)) {
        p.e.classList.add('bl-overflow');
        problems.push({ bid: b.id, msg: 'Ein Absatz ist länger als eine Seite' });
      }
      if (b.type === 'material') lineNo += numberLines(p.e, lineNo);
      i = j;
      first = false;
      if (i < paras.length) next();
    }
  }

  // Broschüre: auf ein Vielfaches von vier Seiten auffüllen (Linien, Karos oder leer)
  if (doc.page.booklet) {
    const fill = doc.page.fill ?? 'lines';
    while (pages.length % 4) {
      next();
      pg.page.classList.add('bl-filler');
      if (fill !== 'empty') {
        const sp = fill === 'grid' ? 5 : 8;
        const h = pg.body.clientHeight / pxPerMm(pg) - 2;
        place({ id: '', type: 'lines', style: fill, spacing: sp }, mkCtx(), { heightMm: Math.floor(h / sp) * sp });
      }
    }
  }

  pages.forEach((p, k) => {
    if (doc.page.pageNumbers) p.foot.textContent = `Seite ${k + 1} von ${pages.length}`;
    if (!p.notes.children.length) p.notes.remove();
  });
  return { pages: pages.map((p) => p.page), problems };
}

/**
 * Broschüre (Rückstichheftung): welche Seiten auf welchem Bogen stehen. n ist ein Vielfaches von vier.
 * Bogen k: Vorderseite [n−2k | 1+2k], Rückseite [2+2k | n−1−2k] (Seitenzahlen ab 1). Bei vier Seiten also vorn
 * „4 | 1“ und hinten „2 | 3“: Die erste Seite steht neben der letzten.
 */
export function impose(n: number): { front: [number, number]; back: [number, number] }[] {
  const sheets: { front: [number, number]; back: [number, number] }[] = [];
  for (let k = 0; k < n / 4; k++) sheets.push({ front: [n - 2 * k, 1 + 2 * k], back: [2 + 2 * k, n - 1 - 2 * k] });
  return sheets;
}

/** Papier, auf das gedruckt wird: Broschüre aus A5 auf A4 quer, aus A4 auf A3 quer. */
export function sheetSize(doc: BlattDoc): { name: string; w: number; h: number } {
  const size = doc.page.size === 'a5' ? 'a5' : 'a4';
  if (!doc.page.booklet) return { name: size.toUpperCase(), w: SIZES[size][0], h: SIZES[size][1] };
  return size === 'a5' ? { name: 'A4 quer', w: 297, h: 210 } : { name: 'A3 quer', w: 420, h: 297 };
}

/**
 * Seiten in Druckbögen legen. Ohne Broschüre: jede Seite ein Blatt. Mit Broschüre: je Bogen Vorder- und Rückseite
 * mit zwei Seiten nebeneinander (beidseitig drucken, an der kurzen Kante wenden).
 */
export function toSheets(doc: BlattDoc, pages: HTMLElement[], host: HTMLElement) {
  const s = sheetSize(doc);
  const mk = (cls: string) => {
    const sh = el('div', 'bl-sheet ' + cls);
    sh.style.width = s.w + 'mm';
    sh.style.height = s.h + 'mm';
    host.appendChild(sh);
    return sh;
  };
  if (!doc.page.booklet) {
    for (const p of pages) mk('bl-single').appendChild(p);
    return;
  }
  for (const [k, sheet] of impose(pages.length).entries()) {
    for (const [side, pair] of [['front', sheet.front], ['back', sheet.back]] as const) {
      const sh = mk('bl-spread bl-' + side);
      sh.dataset.label = `Bogen ${k + 1}, ${side === 'front' ? 'Vorderseite' : 'Rückseite'}: Seiten ${pair[0]} und ${pair[1]}`;
      for (const n of pair) sh.appendChild(pages[n - 1].cloneNode(true));
    }
  }
}

/**
 * Text des Blatts als Markdown für Autogra.fi (Aufgabenstellung als Grundlage für Erwartungshorizont und
 * KI-Bewertung): Material mit Titel und Quelle, Bilder als Bildunterschrift, Aufgaben nummeriert mit Punkten.
 * Linien, Umbrüche und Kopfzeile fallen weg.
 */
export function toMarkdown(doc: BlattDoc): string {
  const out: string[] = [];
  let task = 0;
  let mat = 0;
  const para = (md?: string) => plainMd(md ?? '', 'paren').trim();
  for (const b of doc.blocks) {
    switch (b.type) {
      case 'heading':
        if (b.text?.trim()) out.push(`## ${b.text.trim()}`);
        break;
      case 'text':
        if (para(b.md)) out.push(para(b.md));
        break;
      case 'material': {
        mat++;
        const label = (b.label ?? '').trim() || `Material ${mat}`;
        out.push(`### ${label}${b.title?.trim() ? ': ' + para(b.title) : ''}`);
        if (para(b.md)) out.push(para(b.md));
        if (b.source?.trim()) out.push(`Quelle: ${b.source.trim()}`);
        break;
      }
      case 'quote':
        if (para(b.md)) out.push(para(b.md).split('\n').map((l) => '> ' + l).join('\n') + (b.source?.trim() ? `\n> — ${b.source.trim()}` : ''));
        break;
      case 'image':
        out.push(`[Bild${b.caption?.trim() ? ': ' + b.caption.trim() : ''}]`);
        break;
      case 'task':
        task++;
        out.push(`${task}. ${para(b.md).replace(/\n+/g, ' ')}${b.points?.trim() ? ` (${b.points.trim()})` : ''}`);
        break;
      case 'box':
        out.push([b.text?.trim() ? `**${b.text.trim()}**` : '', para(b.md)].filter(Boolean).join('\n'));
        break;
      case 'glossary': {
        const terms = glossaryTerms(doc).filter((t) => t.explain);
        if (terms.length) out.push(`**${b.text?.trim() || 'Glossar'}**\n` + terms.map((t) => `- ${t.word}: ${plainMd(t.explain)}`).join('\n'));
        break;
      }
      default:
        break;
    }
  }
  return out.filter(Boolean).join('\n\n').trim() + '\n';
}

/** Aufgaben mit Punktzahl (z. B. „12 P.“) als Teilaufgaben für Autogra.fi; Prozentangaben zählen nicht als Punkte. */
export function toCriteria(doc: BlattDoc): { key: string; label: string; max_points: number }[] {
  const tasks = doc.blocks.filter((b) => b.type === 'task');
  const out = tasks.map((b, i) => {
    const m = /^\s*(\d+(?:[.,]\d+)?)\s*(?:p\.?|pkt\.?|punkte?|be)?\s*$/i.exec(b.points ?? '');
    return m ? { key: `a${i + 1}`, label: `Aufgabe ${i + 1}`, max_points: Number(m[1].replace(',', '.')) } : null;
  });
  return out.every(Boolean) ? (out as { key: string; label: string; max_points: number }[]) : [];
}
