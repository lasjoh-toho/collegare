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

export type BlockType = 'heading' | 'text' | 'material' | 'quote' | 'image' | 'task' | 'box' | 'glossary' | 'table' | 'chart' | 'cols' | 'lines' | 'pagebreak' | 'grade';
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
  /** Aufgabe: Teilaufgabe (eingerückt, a) bzw. 1.1) und eigene Nummer statt der automatischen (z. B. „1.2“, „1 b)“) */
  subtask?: boolean;
  num?: string;
  /** Bild: Drehung in Grad (90er-Schritte), Seitenverhältnis Höhe/Breite, frei auf der Seite verschoben (mm) */
  rot?: number;
  ar?: number;
  free?: boolean;
  /** frei verschobenes Bild liegt vor dem Text und nimmt keinen Platz ein */
  over?: boolean;
  dx?: number;
  dy?: number;
  /** Spalten: Bausteine je Spalte und Breitenverhältnis (Mittelstege auf der Seite ziehbar) */
  cols?: Block[][];
  ratio?: number[];
  /** Tabelle (Wunsch Jo, 23. November 2026): Zellen als kleines Markdown, erste Zeile als Kopf, Linien */
  rows?: string[][];
  headRow?: boolean;
  grid?: 'all' | 'rows' | 'none';
  /** Diagramm aus einer Tabelle des Blatts: erste Zeile Reihen, erste Spalte Kategorien */
  ref?: string;
  kind?: 'col' | 'bar' | 'line' | 'pie';
  gray?: boolean;
  /** Höhe des Diagramms in mm */
  hMm?: number;
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
  /** Schriftstärke (300 leicht … 700 fett), Laufweite in em, Abstand nach Absätzen in em */
  fw?: number;
  ls?: number;
  ps?: number;
  /** Text fließt durch n verbundene Spalten (Zeitungsspalten) */
  flow?: number;
  /** Spalten: Breite der Stege in mm */
  gap?: number;
  /** Bild und Diagramm: Umfluss (in der Zeile, links oder rechts umflossen, vor oder hinter dem Text) */
  wrap?: 'inline' | 'left' | 'right' | 'front' | 'behind';
  /** Textfluss: auf neuer Seite beginnen, nicht trennen, mit dem nächsten zusammenhalten */
  breakBefore?: boolean;
  keep?: boolean;
  keepNext?: boolean;
  /** Bewertung (Wunsch Jo, 24. November 2026): Tabelle der Punkte je Aufgabe, Unterschrift, Bemerkung */
  scoreTable?: boolean;
  sign?: boolean;
  remark?: boolean;
  /** Bewertung: Hinweis „Scannen Sie für ein genaues Feedback erneut den QR-Code“, wenn das Blatt einen QR-Code hat (Standard an) */
  qrHint?: boolean;
  /** Kästen (Kasten, Aufgabe im Kasten, Glossar im Kasten, Bewertung): Linienstärke (Wunsch Jo, 24. November 2026) */
  line?: LineWeight;
}

/** Linienstärken für Kästen; Standard „dünn“ */
export type LineWeight = 'hair' | 'thin' | 'medium' | 'thick';
export const LINE_MM: Record<LineWeight, number> = { hair: 0.12, thin: 0.2, medium: 0.35, thick: 0.6 };
export const LINE_LABEL: Record<LineWeight, string> = { hair: 'Haarlinie', thin: 'dünn', medium: 'mittel', thick: 'kräftig' };
/** Bausteine mit Rahmen, bei denen man die Linienstärke wählen kann */
export function hasFrame(b: Block | undefined | null): boolean {
  if (!b) return false;
  if (b.type === 'grade') return true;
  if (b.type === 'box') return (b.tpl ?? 'rahmen') === 'rahmen' || b.tpl === 'gestrichelt';
  if (b.type === 'task' || b.type === 'glossary') return b.tpl === 'kasten';
  return false;
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
    header: {
      show: boolean;
      text: string;
      nameLine: boolean;
      date: boolean;
      qr: 'first' | 'all' | 'none';
      fields?: HeadFields;
      /** Gestaltung des Kopfs: Reihenfolge, Linie darunter, Kasten oder nichts, Größe des Titels */
      order?: HeadKey[];
      style?: 'line' | 'box' | 'none';
      titleSize?: 's' | 'm' | 'l';
    };
    korr: Korr;
    /** Teilaufgaben: a), b) … oder 1.1, 1.2 … */
    sub?: 'letter' | 'dot';
    /** Wasserzeichen quer über jeder Seite (z. B. ENTWURF) */
    watermark?: string;
    /** Seitenränder, Querformat, zwei Seiten auf einem Blatt (1|2, 3|4) */
    margin?: 'normal' | 'narrow' | 'wide';
    landscape?: boolean;
    nup?: boolean;
    /** Feld für die erreichten Punkte hinter jeder Aufgabe: Kästchen oder Linie */
    earned?: 'none' | 'box' | 'line';
    /** Sollpunktzahl „/ 6 P.“ im Punktefeld zeigen (Standard an); beim Kästchen steht sie im Kästchen */
    earnedMax?: boolean;
  };
  blocks: Block[];
}

/**
 * Rahmendaten im Kopf der ersten Seite (Wunsch Jo, 23. November 2026): jedes Feld an oder aus; „automatisch“ füllt es
 * aus dem Blatt bzw. beim Druck aus Autogra.fi, sonst steht der eigene Text da oder eine Linie zum Ausfüllen.
 */
export type HeadKey = 'title' | 'subject' | 'klasse' | 'teacher' | 'date' | 'name' | 'points' | 'grade';
export interface HeadField {
  on: boolean;
  auto?: boolean;
  value?: string;
  /** eigene Beschriftung statt „Klasse“ usw., Zeile im Kopf (1 oder 2), Länge der Linie */
  label?: string;
  row?: 1 | 2;
  len?: 's' | 'm' | 'l';
}
export type HeadFields = Partial<Record<HeadKey, HeadField>>;
export const HEAD_KEYS: { key: HeadKey; label: string; auto?: string }[] = [
  { key: 'title', label: 'Titel', auto: 'Name des Blatts' },
  { key: 'subject', label: 'Fach' },
  { key: 'klasse', label: 'Klasse', auto: 'Kurs, beim Druck die Klasse aus Autogra.fi' },
  { key: 'teacher', label: 'Lehrkraft', auto: 'dein Name' },
  { key: 'date', label: 'Datum', auto: 'Tag des Drucks' },
  { key: 'name', label: 'Name', auto: 'beim Druck aus der Klassenliste' },
  { key: 'points', label: 'Punkte', auto: 'Summe der Aufgaben' },
  { key: 'grade', label: 'Note' },
];
/** Rahmendaten lesen; ältere Blätter (Kopfzeile mit Text, Name, Datum) werden übernommen */
export function headFields(doc: BlattDoc): Record<HeadKey, HeadField> {
  const H = doc.page.header;
  const f = H.fields ?? {};
  const old: Record<HeadKey, HeadField> = {
    title: { on: !!H.text?.trim(), auto: false, value: H.text ?? '' },
    subject: { on: false },
    klasse: { on: false, auto: true },
    teacher: { on: false, auto: true },
    date: { on: !!H.date, auto: false },
    name: { on: H.nameLine !== false, auto: true },
    points: { on: false, auto: true },
    grade: { on: false },
  };
  const out = {} as Record<HeadKey, HeadField>;
  for (const { key } of HEAD_KEYS) out[key] = { ...old[key], ...(f[key] ?? {}) };
  return out;
}
/** Werte, die der Kopf automatisch einsetzt */
export interface HeadCtx {
  title?: string;
  course?: string;
  teacher?: string;
}

/** Platzhalter aus „Nummern bestellen“ (z. B. „Abgabe 3“), kein echter Name */
export function isNumberedSeat(name: string): boolean {
  return /^Abgabe \d+$/.test(name.trim());
}

/** Ein persönliches Exemplar (QR-Code aus Autogra.fi) */
export interface Copy {
  name?: string;
  /** Klasse aus Autogra.fi (Rahmendaten „Klasse“ automatisch) */
  klasse?: string;
  printName?: boolean;
  code?: string;
  qr?: string;
}

export const SIZES = { a4: [210, 297], a5: [148, 210] } as const;
const MARGIN = { a4: 18, a5: 12 } as const;
/** Größe einer Seite in mm (Querformat getauscht) und Rand */
export function pageGeom(doc: BlattDoc): { w: number; h: number; m: number } {
  const size = doc.page.size === 'a5' ? 'a5' : 'a4';
  const [w0, h0] = SIZES[size];
  const base = MARGIN[size];
  const m = doc.page.margin === 'narrow' ? Math.round(base * 0.65) : doc.page.margin === 'wide' ? Math.round(base * 1.4) : base;
  return doc.page.landscape ? { w: h0, h: w0, m } : { w: w0, h: h0, m };
}
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
  table: 'Tabelle',
  chart: 'Diagramm',
  cols: 'Spalten',
  lines: 'Linien',
  pagebreak: 'Seitenumbruch',
  grade: 'Bewertung',
};

export function blankDoc(title = ''): BlattDoc {
  return {
    format: 'ag-blatt/1',
    page: { size: 'a4', booklet: false, font: 'sans', fontSize: 11, pageNumbers: true, fill: 'lines', header: { show: true, text: '', nameLine: true, date: false, qr: 'none', fields: { title: { on: true, auto: true }, name: { on: true, auto: true }, date: { on: false, auto: false } } }, korr: { side: 'none', width: 30, style: 'thin' } },
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
    return { ...d, ...j, format: 'ag-blatt/1', page: { ...d.page, ...(j.page ?? {}), header: { ...d.page.header, ...(j.page?.header ? { fields: undefined, ...j.page.header } : {}) }, korr: { ...d.page.korr, ...korr } }, blocks };
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
  if (type === 'cols') Object.assign(b, { cols: [[], []], ratio: [1, 1] });
  if (type === 'table') Object.assign(b, { rows: [['', '', ''], ['', '', ''], ['', '', '']], headRow: true, grid: 'all' });
  if (type === 'chart') Object.assign(b, { kind: 'col', width: 90, hMm: 60, caption: '' });
  if (type === 'lines') Object.assign(b, { style: 'lines', count: 8, fill: true, spacing: 8 });
  if (type === 'grade') Object.assign(b, { text: 'Note', scoreTable: true, sign: false, remark: false });
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
    case 'table':
      return `${(b.rows ?? []).length} × ${(b.rows ?? [])[0]?.length ?? 0}: ` + (b.rows ?? []).flat().map((c) => plain(c)).filter(Boolean).slice(0, 4).join(', ');
    case 'chart':
      return b.caption || ({ col: 'Säulen', bar: 'Balken', line: 'Linie', pie: 'Kreis' } as const)[b.kind ?? 'col'];
    case 'cols':
      return (b.cols ?? []).map((c) => (c.length ? c.map((x) => BLOCK_LABEL[x.type]).join(', ') : 'leer')).join(' | ');
    case 'lines':
      return `${b.style === 'grid' ? 'Karos' : b.style === 'empty' ? 'Freiraum' : 'Schreiblinien'}${b.fill ? ' bis zum Seitenende' : `, ${b.count ?? 0}`}`;
    case 'pagebreak':
      return '';
    case 'grade':
      return [b.scoreTable !== false && 'Punkte je Aufgabe', b.text || 'Note', b.remark && 'Bemerkung', b.sign && 'Unterschrift'].filter(Boolean).join(', ');
    default:
      return plain(b.md);
  }
}

// ---------- Bausteine in Spalten ----------
/** Alle Bausteine in Lesereihenfolge, auch die in Spalten */
export function walk(blocks: Block[]): Block[] {
  const out: Block[] = [];
  for (const b of blocks) {
    if (b.type === 'cols') for (const c of b.cols ?? []) out.push(...walk(c));
    else out.push(b);
  }
  return out;
}
export function findBlock(blocks: Block[], id: string): Block | null {
  for (const b of blocks) {
    if (b.id === id) return b;
    if (b.type === 'cols') for (const c of b.cols ?? []) {
      const f = findBlock(c, id);
      if (f) return f;
    }
  }
  return null;
}
/** Liste, in der ein Baustein steht (oberste Ebene oder eine Spalte), mit Stelle */
export function listOf(blocks: Block[], id: string): { list: Block[]; i: number; parent: Block | null; col: number } | null {
  const i = blocks.findIndex((b) => b.id === id);
  if (i >= 0) return { list: blocks, i, parent: null, col: -1 };
  for (const b of blocks) {
    if (b.type !== 'cols') continue;
    for (const [k, c] of (b.cols ?? []).entries()) {
      const r = listOf(c, id);
      if (r) return r.parent ? r : { ...r, parent: b, col: k };
    }
  }
  return null;
}
/** Bausteine umbauen: fn bekommt jede Liste (oberste Ebene und jede Spalte) und gibt sie geändert zurück */
export function mapLists(blocks: Block[], fn: (list: Block[]) => Block[]): Block[] {
  return fn(blocks).map((b) => (b.type === 'cols' ? { ...b, cols: (b.cols ?? []).map((c) => mapLists(c, fn)) } : b));
}
export const updateBlock = (blocks: Block[], id: string, p: Partial<Block>) => mapLists(blocks, (l) => l.map((b) => (b.id === id ? { ...b, ...p } : b)));
export const removeBlock = (blocks: Block[], id: string) => mapLists(blocks, (l) => l.filter((b) => b.id !== id));
/** nach dem Baustein after einfügen (in dieselbe Spalte), ohne after am Ende */
export function insertAfter(blocks: Block[], after: string | null, nb: Block): Block[] {
  if (!after || !findBlock(blocks, after)) return [...blocks, nb];
  return mapLists(blocks, (l) => {
    const i = l.findIndex((b) => b.id === after);
    return i < 0 ? l : [...l.slice(0, i + 1), nb, ...l.slice(i + 1)];
  });
}
/** in eine (leere) Spalte setzen */
export const insertIntoCol = (blocks: Block[], colsId: string, k: number, nb: Block) =>
  mapLists(blocks, (l) => l.map((b) => (b.id === colsId ? { ...b, cols: (b.cols ?? []).map((c, j) => (j === k ? [...c, nb] : c)) } : b)));

/** Nummern der Aufgaben: 1., 2. … und Teilaufgaben a), b) bzw. 1.1, 1.2; eigene Nummern gehen vor */
export function taskLabels(doc: BlattDoc): Map<string, string> {
  const out = new Map<string, string>();
  let m = 0;
  let s = 0;
  for (const b of walk(doc.blocks)) {
    if (b.type !== 'task') continue;
    if (b.subtask) {
      s++;
      if (!m) m = 1;
      out.set(b.id, b.num?.trim() || (doc.page.sub === 'dot' ? `${m}.${s}` : `${String.fromCharCode(96 + Math.min(26, s))})`));
    } else {
      m++;
      s = 0;
      out.set(b.id, b.num?.trim() || `${m}.`);
    }
  }
  return out;
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
/**
 * Zeilen des Markdowns je gesetztem Absatz (Listen bilden einen Absatz), als [erste Zeile, Zeile danach].
 * Damit wird auf der Seite nur das Stück bearbeitet, das dort steht, auch wenn der Baustein über Seiten läuft.
 */
export function paraSpans(md: string | undefined): [number, number][] {
  const out: [number, number][] = [];
  const lines = (md ?? '').replace(/\r\n?/g, '\n').split('\n');
  const item = /^\s*([-*•]|\d+[.)])\s+(.*)$/;
  let i = 0;
  while (i < lines.length) {
    const t = lines[i].trim();
    if (!t) {
      i++;
      continue;
    }
    const li = item.exec(t);
    if (li) {
      const ordered = /^\d/.test(li[1]);
      const a = i;
      while (i < lines.length) {
        const m = item.exec(lines[i].trim());
        if (!m || /^\d/.test(m[1]) !== ordered) break;
        i++;
      }
      out.push([a, i]);
      continue;
    }
    out.push([i, i + 1]);
    i++;
  }
  return out;
}

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
  for (const b of walk(doc.blocks)) {
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
  return { ...doc, blocks: mapLists(doc.blocks, (l) => l.map((b) => (b.type === 'cols' ? b : { ...b, md: fix(b.md), title: fix(b.title) }))) };
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
  style?: Partial<Pick<Block, 'fs' | 'lh' | 'ta' | 'it' | 'bd' | 'nm' | 'ind' | 'fw' | 'ls' | 'ps' | 'flow'>>;
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
export const STYLE_KEYS = ['fs', 'lh', 'ta', 'it', 'bd', 'nm', 'ind', 'fw', 'ls', 'ps', 'flow'] as const;
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

// ---------- Diagramm aus einer Tabelle ----------
const PALETTE = ['#2f6db5', '#e07b39', '#3f9d5a', '#c8414b', '#7e5bb5', '#9a7b4f'];
const GRAYS = ['#333', '#999', '#ccc', '#666', '#e2e2e2', '#b0b0b0'];
/** Zahl aus einer Zelle („1.234,5“, „12 %“, „3,5 m“) */
export function cellNumber(s: string): number | null {
  const t = plainMd(s ?? '')
    .replace(/\s/g, '')
    .replace(/\.(?=\d{3}(\D|$))/g, '')
    .replace(',', '.');
  const m = /-?\d+(\.\d+)?/.exec(t);
  return m ? Number(m[0]) : null;
}
/** Erste Zeile: Namen der Reihen; erste Spalte: Kategorien */
export function chartData(rows: string[][]): { cats: string[]; series: { name: string; vals: (number | null)[] }[] } {
  const head = rows[0] ?? [];
  const body = rows.slice(1).filter((r) => r.some((c) => (c ?? '').trim()));
  const cats = body.map((r) => plainMd(r[0] ?? '').trim());
  const series = head
    .slice(1)
    .map((h, j) => ({ name: plainMd(h ?? '').trim() || `Reihe ${j + 1}`, vals: body.map((r) => cellNumber(r[j + 1] ?? '')) }))
    .filter((x) => x.vals.some((v) => v !== null));
  return { cats, series };
}
function niceStep(range: number): number {
  const raw = range / 5;
  const p = Math.pow(10, Math.floor(Math.log10(raw || 1)));
  for (const m of [1, 2, 2.5, 5, 10]) if (raw <= m * p) return m * p;
  return 10 * p;
}
const fmtNum = (n: number) => (Math.round(n * 1000) / 1000).toLocaleString('de-DE');
/** Säulen, Balken, Linie oder Kreis als SVG in mm */
export function chartSvg(rows: string[][], kind: 'col' | 'bar' | 'line' | 'pie', w: number, h: number, gray: boolean): string {
  const { cats, series } = chartData(rows);
  const col = gray ? GRAYS : PALETTE;
  const fs = 3;
  const t = (x: number, y: number, s: string, anchor = 'middle', extra = '') => `<text x="${x.toFixed(2)}" y="${y.toFixed(2)}" text-anchor="${anchor}" font-size="${fs}" ${extra}>${esc(s)}</text>`;
  const open = `<svg class="bl-chart-svg" viewBox="0 0 ${w.toFixed(2)} ${h}" style="width:${w.toFixed(2)}mm;height:${h}mm" font-family="inherit" fill="#111">`;
  if (!series.length || !cats.length) return open + t(w / 2, h / 2, 'In der Tabelle stehen noch keine Zahlen.') + '</svg>';
  let out = open;
  // Legende oben, wenn mehrere Reihen (beim Kreis: Kategorien rechts)
  let top = 2;
  if (kind !== 'pie' && series.length > 1) {
    let x = 0;
    for (const [k, s] of series.entries()) {
      out += `<rect x="${x}" y="1" width="3" height="3" fill="${col[k % col.length]}" stroke="#111" stroke-width="${gray ? 0.15 : 0}"/>` + t(x + 4, 3.8, s.name, 'start');
      x += 8 + s.name.length * 1.6;
    }
    top = 7;
  }
  if (kind === 'pie') {
    const s = series[0];
    const vals = s.vals.map((v) => Math.max(0, v ?? 0));
    const sum = vals.reduce((x, y) => x + y, 0) || 1;
    const r = Math.min(h / 2 - 2, w * 0.3);
    const cx = r + 2;
    const cy = h / 2;
    let a = -Math.PI / 2;
    for (const [k, v] of vals.entries()) {
      const b = a + (v / sum) * 2 * Math.PI;
      const large = b - a > Math.PI ? 1 : 0;
      const p = (ang: number) => `${(cx + r * Math.cos(ang)).toFixed(2)} ${(cy + r * Math.sin(ang)).toFixed(2)}`;
      out += v >= sum ? `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${col[k % col.length]}" stroke="#fff" stroke-width="0.3"/>` : `<path d="M${cx} ${cy} L${p(a)} A${r} ${r} 0 ${large} 1 ${p(b)} Z" fill="${col[k % col.length]}" stroke="#fff" stroke-width="0.3"/>`;
      a = b;
    }
    const lx = 2 * r + 7;
    const step = Math.min(5, (h - 4) / Math.max(1, cats.length));
    for (const [k, c] of cats.entries()) {
      const y = cy - (cats.length * step) / 2 + k * step + 3;
      out += `<rect x="${lx}" y="${(y - 2.6).toFixed(2)}" width="3" height="3" fill="${col[k % col.length]}"/>` + t(lx + 4.5, y, `${c} (${fmtNum(Math.round((vals[k] / sum) * 1000) / 10)} %)`, 'start');
    }
    return out + '</svg>';
  }
  const all = series.flatMap((s) => s.vals.filter((v): v is number => v !== null));
  const lo = Math.min(0, ...all);
  const hi = Math.max(0, ...all);
  const step = niceStep(hi - lo || 1);
  const vmin = Math.floor(lo / step) * step;
  const vmax = Math.ceil(hi / step) * step || step;
  const ticks: number[] = [];
  for (let v = vmin; v <= vmax + step / 2; v += step) ticks.push(v);
  const labW = Math.max(...ticks.map((v) => fmtNum(v).length)) * 1.7 + 2;
  if (kind === 'bar') {
    // Balken waagerecht: Kategorien links, Werte unten
    const catW = Math.min(w * 0.35, Math.max(...cats.map((c) => c.length)) * 1.6 + 2);
    const x0 = catW;
    const x1 = w - 2;
    const y0 = top;
    const y1 = h - 6;
    const X = (v: number) => x0 + ((v - vmin) / (vmax - vmin)) * (x1 - x0);
    for (const v of ticks) out += `<line x1="${X(v).toFixed(2)}" x2="${X(v).toFixed(2)}" y1="${y0}" y2="${y1}" stroke="#ccc" stroke-width="0.2"/>` + t(X(v), y1 + 4, fmtNum(v));
    const band = (y1 - y0) / cats.length;
    const bh = (band * 0.7) / series.length;
    for (const [i, c] of cats.entries()) {
      out += t(x0 - 1.5, y0 + band * (i + 0.5) + 1, c, 'end');
      for (const [k, s] of series.entries()) {
        const v = s.vals[i];
        if (v === null) continue;
        const a = X(Math.min(0, v));
        const b = X(Math.max(0, v));
        out += `<rect x="${a.toFixed(2)}" y="${(y0 + band * i + band * 0.15 + k * bh).toFixed(2)}" width="${Math.max(0.1, b - a).toFixed(2)}" height="${bh.toFixed(2)}" fill="${col[k % col.length]}" stroke="#111" stroke-width="${gray ? 0.15 : 0}"/>`;
      }
    }
    out += `<line x1="${X(0)}" x2="${X(0)}" y1="${y0}" y2="${y1}" stroke="#111" stroke-width="0.3"/>`;
    return out + '</svg>';
  }
  const x0 = labW;
  const x1 = w - 1;
  const y0 = top + 1;
  const y1 = h - 6;
  const Y = (v: number) => y1 - ((v - vmin) / (vmax - vmin)) * (y1 - y0);
  for (const v of ticks) out += `<line x1="${x0}" x2="${x1}" y1="${Y(v).toFixed(2)}" y2="${Y(v).toFixed(2)}" stroke="#ccc" stroke-width="0.2"/>` + t(x0 - 1.2, Y(v) + 1, fmtNum(v), 'end');
  const band = (x1 - x0) / cats.length;
  const every = Math.max(1, Math.ceil((cats.reduce((m, c) => Math.max(m, c.length), 0) * 1.6 + 1) / band));
  cats.forEach((c, i) => {
    if (i % every === 0) out += t(x0 + band * (i + 0.5), y1 + 4, c);
  });
  if (kind === 'line') {
    for (const [k, s] of series.entries()) {
      const pts = s.vals.map((v, i) => (v === null ? null : [x0 + band * (i + 0.5), Y(v)] as const)).filter((p): p is readonly [number, number] => !!p);
      out += `<polyline points="${pts.map((p) => p[0].toFixed(2) + ',' + p[1].toFixed(2)).join(' ')}" fill="none" stroke="${col[k % col.length]}" stroke-width="0.6"${gray && k % 2 ? ' stroke-dasharray="1.5 1"' : ''}/>`;
      out += pts.map((p) => `<circle cx="${p[0].toFixed(2)}" cy="${p[1].toFixed(2)}" r="0.8" fill="${col[k % col.length]}"/>`).join('');
    }
  } else {
    const bw = (band * 0.7) / series.length;
    for (const [i] of cats.entries())
      for (const [k, s] of series.entries()) {
        const v = s.vals[i];
        if (v === null) continue;
        const a = Y(Math.max(0, v));
        const b = Y(Math.min(0, v));
        out += `<rect x="${(x0 + band * i + band * 0.15 + k * bw).toFixed(2)}" y="${a.toFixed(2)}" width="${bw.toFixed(2)}" height="${Math.max(0.1, b - a).toFixed(2)}" fill="${col[k % col.length]}" stroke="#111" stroke-width="${gray ? 0.15 : 0}"/>`;
      }
  }
  out += `<line x1="${x0}" x2="${x1}" y1="${Y(0).toFixed(2)}" y2="${Y(0).toFixed(2)}" stroke="#111" stroke-width="0.3"/><line x1="${x0}" x2="${x0}" y1="${y0}" y2="${y1}" stroke="#111" stroke-width="0.3"/>`;
  return out + '</svg>';
}

interface Ctx {
  widthMm: number;
  number?: number;
  label?: string;
  korr: Korr | null;
  text: TextCtx;
  terms: { word: string; explain: string }[];
  /** im Editor: leere Felder als Platzhalter zeigen, damit man sie anklicken kann */
  editing?: boolean;
  /** Tabellen des Blatts (für Diagramme) */
  tables?: Map<string, string[][]>;
  /** Feld für erreichte Punkte hinter den Aufgaben; Aufgaben mit Punkten für die Bewertung */
  earned?: 'box' | 'line';
  earnedMax?: boolean;
  scores?: { label: string; max: string }[];
  /** Blatt hat einen QR-Code aus Autogra.fi */
  qr?: boolean;
}
interface Part {
  /** vorbereitete Absätze (einmal gesetzt, damit Fußnoten beim Umbrechen ihre Nummer behalten) */
  paras?: string[];
  title?: string;
  /** Fußnotenzeichen hinter dem Titel (Quelle des Materials) */
  mark?: string;
  first?: boolean;
  last?: boolean;
  heightMm?: number;
  /** Spalten: vorbereitete Bausteine je Spalte */
  kids?: { b: Block; ctx: Ctx; part: Part }[][];
  /** Tabelle: Zellen als HTML */
  cells?: string[][];
  /** welche Absätze dieses Stück zeigt (für das Bearbeiten auf der Seite) */
  range?: [number, number];
}

/** Vorlage und eigene Gestaltung auf den Baustein anwenden */
function applyStyle(box: HTMLElement, b: Block, hasMargin: boolean) {
  const st = styleOf(b);
  const tpl = TEMPLATES[b.type]?.find((x) => x.id === b.tpl)?.id ?? TEMPLATES[b.type]?.[0]?.id;
  if (tpl) box.classList.add('bl-tpl-' + tpl);
  if (b.line && LINE_MM[b.line]) box.style.setProperty('--bw', LINE_MM[b.line] + 'mm');
  if (st.fs && st.fs !== 100) box.style.fontSize = Math.max(60, Math.min(200, st.fs)) / 100 + 'em';
  if (st.lh) box.style.lineHeight = String(Math.max(1, Math.min(3, st.lh)));
  if (st.ta) {
    box.style.textAlign = st.ta;
    if (st.ta === 'justify') box.style.hyphens = 'auto';
  }
  if (st.it) box.style.fontStyle = 'italic';
  if (st.bd) box.style.fontWeight = '700';
  if (st.ind) box.style.paddingLeft = Math.max(0, Math.min(60, st.ind)) + 'mm';
  if (st.fw) box.style.fontWeight = String(st.fw);
  if (st.ls) box.style.letterSpacing = st.ls + 'em';
  if (st.ps !== undefined) box.style.setProperty('--ps', st.ps + 'em');
  if (st.flow && st.flow > 1) {
    box.classList.add('bl-flow');
    box.style.setProperty('--flow', String(Math.min(4, st.flow)));
    if (b.gap) box.style.setProperty('--gap', Math.max(2, Math.min(20, b.gap)) + 'mm');
  }
  const nm = st.nm || (hasMargin ? 30 : 0);
  if (nm) {
    box.classList.add('bl-hasnm');
    box.style.setProperty('--nm', Math.max(10, Math.min(70, nm)) + 'mm');
  }
}

/** Feld, das man auf der Seite anklicken und dort bearbeiten kann */
function field(tag: string, cls: string, name: string, html: string, range?: [number, number]): HTMLElement {
  const e = el(tag, cls, html);
  e.dataset.field = name;
  if (range) e.dataset.r = range.join(':');
  return e;
}

function render(b: Block, ctx: Ctx, part: Part = {}): HTMLElement {
  const box = el('div', 'bl-block bl-' + b.type);
  box.dataset.bid = b.id;
  const paras = part.paras ?? [];
  const html = paras.join('');
  const first = part.first !== false;
  switch (b.type) {
    case 'heading':
      box.appendChild(field(b.level === 1 ? 'h2' : 'h3', '', 'text', part.title || esc(b.text) || '<span class="bl-ph">Überschrift</span>'));
      break;
    case 'text':
      box.appendChild(field('div', 'bl-text', 'md', html || '<p class="bl-ph">Erklärtext …</p>', part.range));
      break;
    case 'material': {
      if (first) {
        const label = (b.label ?? '').trim() || `Material ${ctx.number}`;
        const title = part.title ?? '';
        const t = el('div', 'bl-mat-title', `<span class="bl-mat-label">${esc(label)}:</span> `);
        t.appendChild(field('span', 'bl-mat-t', 'title', title || '<span class="bl-ph">Titel</span>'));
        if (part.mark) t.insertAdjacentHTML('beforeend', part.mark);
        box.appendChild(t);
      }
      box.appendChild(field('div', 'bl-mat-body' + (b.lineNumbers !== false ? ' bl-numbered' : ''), 'md', html || '<p class="bl-ph">Text des Materials …</p>', part.range));
      break;
    }
    case 'quote':
      box.appendChild(field('div', 'bl-quote-text', 'md', html || '<p class="bl-ph">Zitat …</p>', part.range));
      if (part.last !== false) box.appendChild(field('div', 'bl-quote-src', 'source', esc(b.source) || (ctx.editing ? '<span class="bl-ph">Quelle</span>' : '')));
      break;
    case 'image': {
      const fig = el('figure', 'bl-fig bl-align-' + (b.align ?? 'center'));
      const pct = Math.max(15, Math.min(100, Number(b.width) || 100));
      const wMm = (pct / 100) * ctx.widthMm;
      fig.style.width = pct + '%';
      const rot = (((Number(b.rot) || 0) % 360) + 360) % 360;
      if (b.src) {
        const img = el('img') as HTMLImageElement;
        img.src = b.src;
        img.alt = b.caption ?? '';
        img.draggable = false;
        if (rot % 180 && b.ar) {
          // gedreht um 90°: sichtbare Breite = Höhe des Bilds; der Rahmen bekommt die neue Höhe
          const wrap = el('div', 'bl-rot');
          const h = wMm / b.ar;
          wrap.style.height = h + 'mm';
          img.style.width = h + 'mm';
          img.style.height = wMm + 'mm';
          img.style.transform = `translate(-50%, -50%) rotate(${rot}deg)`;
          wrap.appendChild(img);
          fig.appendChild(wrap);
        } else {
          if (rot) img.style.transform = `rotate(${rot}deg)`;
          fig.appendChild(img);
        }
      } else fig.appendChild(el('div', 'bl-img-empty', '<span>Bild hierher ziehen<br>oder im Menüband auswählen</span>'));
      if (b.caption || ctx.editing) fig.appendChild(field('figcaption', '', 'caption', esc(b.caption) || '<span class="bl-ph">Bildunterschrift</span>'));
      // Umfluss: links oder rechts vom folgenden Text umflossen
      if (b.wrap === 'left' || b.wrap === 'right') {
        box.classList.add('bl-wrap-' + b.wrap);
        box.style.width = pct + '%';
        fig.style.width = '100%';
      }
      const overText = b.over || b.wrap === 'front' || b.wrap === 'behind';
      if (b.free || b.wrap === 'front' || b.wrap === 'behind') {
        // verschoben um dx/dy gegenüber seiner Stelle; sein Platz im Text bleibt frei, außer es liegt vor oder hinter dem Text
        const dx = Number(b.dx) || 0;
        const dy = Number(b.dy) || 0;
        if (b.wrap === 'behind') box.classList.add('bl-behind');
        if (overText) {
          box.classList.add('bl-free');
          fig.style.width = wMm + 'mm';
          const base = b.align === 'left' ? '0mm' : b.align === 'right' ? `(100% - ${wMm}mm)` : `((100% - ${wMm}mm) / 2)`;
          fig.style.left = `calc(${base} + ${dx}mm)`;
        } else {
          fig.style.position = 'relative';
          fig.style.left = dx + 'mm';
        }
        fig.style.top = dy + 'mm';
        fig.style.zIndex = b.wrap === 'behind' ? '-1' : '3';
      }
      box.appendChild(fig);
      break;
    }
    case 'task': {
      if (b.subtask) box.classList.add('bl-subtask');
      const row = el('div', 'bl-task-row');
      row.appendChild(el('span', 'bl-task-no', esc(ctx.label ?? `${ctx.number}.`)));
      const text = el('div', 'bl-task-text');
      text.appendChild(field('span', 'bl-task-t', 'md', part.title || '<span class="bl-ph">Aufgabenstellung …</span>'));
      const showMax = ctx.earned && ctx.earnedMax !== false && !!b.points?.trim();
      if (b.points && (!ctx.earned || (ctx.earnedMax === false))) text.appendChild(el('span', 'bl-pts', ' ' + esc(b.points)));
      row.appendChild(text);
      if (ctx.earned) {
        // Feld für die erreichten Punkte rechts: [     / 6 P.] bzw. ____ / 6 P.
        const sc = el('span', 'bl-score');
        const max = showMax ? el('span', 'bl-emax', '/ ' + esc(b.points!.trim())) : null;
        if (ctx.earned === 'box') {
          const bx = el('span', 'bl-ebox' + (max ? ' bl-ebox-max' : ''));
          if (max) bx.appendChild(max);
          sc.appendChild(bx);
        } else {
          sc.appendChild(el('span', 'bl-eline'));
          if (max) sc.appendChild(max);
        }
        row.appendChild(sc);
      }
      box.appendChild(row);
      const n = Math.max(0, Math.min(40, Number(b.lines) || 0));
      if (n) {
        const style = b.lineStyle ?? 'lines';
        const sp = style === 'grid' ? 5 : Number(b.spacing) || 8;
        const lines = style === 'grid' ? Math.ceil((n * 8) / 5) : n;
        box.appendChild(ruling(style, ctx.widthMm, lines * sp + (style === 'grid' ? 0 : 1), sp, ctx.korr));
      }
      break;
    }
    case 'box':
      if (first && (b.text || ctx.editing)) box.appendChild(field('div', 'bl-box-title', 'text', esc(b.text) || '<span class="bl-ph">Titel (optional)</span>'));
      box.appendChild(field('div', 'bl-box-text', 'md', html || '<p class="bl-ph">Inhalt des Kastens …</p>', part.range));
      break;
    case 'glossary':
      if (first) box.appendChild(field('div', 'bl-gl-title', 'text', esc(b.text) || (ctx.editing ? '<span class="bl-ph">Überschrift</span>' : '')));
      box.appendChild(el('div', 'bl-gl-list', html || '<p class="bl-ph">Noch keine Wörter. Markiere im Text ein Wort und wähle „Glossar“.</p>'));
      break;
    case 'cols': {
      const ratio = (b.ratio ?? []).length === (b.cols ?? []).length ? b.ratio! : (b.cols ?? []).map(() => 1);
      box.style.gridTemplateColumns = ratio.map((r) => `minmax(0, ${r}fr)`).join(' ');
      const gapMm = Math.max(2, Math.min(20, Number(b.gap) || 6));
      box.style.columnGap = gapMm + 'mm';
      for (const [k, col] of (part.kids ?? []).entries()) {
        const c = el('div', 'bl-col');
        c.dataset.col = `${b.id}:${k}`;
        for (const kid of col) c.appendChild(render(kid.b, kid.ctx, kid.part));
        if (!col.length) c.appendChild(el('div', 'bl-col-empty', ctx.editing ? '<span>leere Spalte<br>hier klicken, dann einfügen</span>' : ''));
        box.appendChild(c);
      }
      // Mittelstege zum Ziehen (nur im Editor)
      if (ctx.editing) {
        const sum = ratio.reduce((x, y) => x + y, 0);
        let acc = 0;
        for (let k = 0; k < ratio.length - 1; k++) {
          acc += ratio[k];
          const g = el('div', 'bl-gutter');
          g.dataset.gutter = `${b.id}:${k}`;
          g.title = 'Mittelsteg ziehen';
          // Lage: Anteil der Spaltenbreiten plus die Stege davor (6 mm je Steg)
          g.style.left = `calc((100% - ${gapMm * (ratio.length - 1)}mm) * ${acc / sum} + ${gapMm * k + gapMm / 2}mm)`;
          box.appendChild(g);
        }
      }
      break;
    }
    case 'table': {
      const tb = el('table', 'bl-table bl-grid-' + (b.grid ?? 'all'));
      const body = el('tbody');
      for (const [i, r] of (part.cells ?? []).entries()) {
        const tr = el('tr');
        for (const [j, c] of r.entries()) tr.appendChild(field(b.headRow !== false && i === 0 ? 'th' : 'td', '', `cell:${i}:${j}`, c || (ctx.editing ? '<span class="bl-ph">&nbsp;</span>' : '')));
        body.appendChild(tr);
      }
      tb.appendChild(body);
      box.appendChild(tb);
      if (b.caption || ctx.editing) box.appendChild(field('div', 'bl-cap', 'caption', esc(b.caption) || '<span class="bl-ph">Beschriftung (optional)</span>'));
      break;
    }
    case 'chart': {
      const pct = Math.max(20, Math.min(100, Number(b.width) || 90));
      const wMm = (pct / 100) * ctx.widthMm;
      const fig = el('figure', 'bl-fig bl-chart bl-align-' + (b.align ?? 'center'));
      fig.style.width = pct + '%';
      if (b.wrap === 'left' || b.wrap === 'right') {
        box.classList.add('bl-wrap-' + b.wrap);
        box.style.width = pct + '%';
        fig.style.width = '100%';
      }
      const rows = b.ref ? ctx.tables?.get(b.ref) : undefined;
      fig.innerHTML = rows ? chartSvg(rows, b.kind ?? 'col', wMm, Math.max(25, Math.min(200, Number(b.hMm) || 60)), !!b.gray) : `<div class="bl-img-empty" style="height:${Number(b.hMm) || 60}mm"><span>${b.ref ? 'Die Tabelle fehlt.' : 'Noch keine Tabelle gewählt.'}<br>Im Reiter „Diagramm“ eine Tabelle wählen.</span></div>`;
      if (b.caption || ctx.editing) fig.appendChild(field('figcaption', '', 'caption', esc(b.caption) || '<span class="bl-ph">Bildunterschrift</span>'));
      box.appendChild(fig);
      break;
    }
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
    case 'grade': {
      // Bewertung: Punkte je Aufgabe, Summe, Note, Bemerkung, Unterschrift
      const scores = ctx.scores ?? [];
      if (b.scoreTable !== false && scores.length) {
        const sum = scores.reduce((a, x) => a + (Number(x.max.replace(',', '.').match(/\d+(?:\.\d+)?/)?.[0]) || 0), 0);
        const t = el('table', 'bl-grade-table');
        const tr = (cls: string, head: string, cells: string[], last: string) => {
          const r = el('tr', cls);
          r.appendChild(el('th', '', head));
          for (const c of cells) r.appendChild(el('td', '', c));
          r.appendChild(el('td', 'bl-grade-sum', last));
          t.appendChild(r);
        };
        tr('bl-grade-h', 'Aufgabe', scores.map((x) => esc(x.label.replace(/[.)]$/, ''))), 'Summe');
        tr('', 'mögliche Punkte', scores.map((x) => esc(x.max.replace(/\s*(p\.?|pkt\.?|punkte?|be)\s*$/i, ''))), sum ? String(Math.round(sum * 10) / 10).replace('.', ',') : '');
        tr('bl-grade-e', 'erreichte Punkte', scores.map(() => ''), '');
        box.appendChild(t);
      } else if (b.scoreTable !== false && ctx.editing) box.appendChild(el('p', 'bl-ph', 'Hier erscheinen die Aufgaben mit ihren Punkten.'));
      const foot = el('div', 'bl-grade-foot');
      foot.appendChild(el('span', 'bl-grade-note', `${esc(b.text?.trim() || 'Note')}: <span class="bl-gbox"></span>`));
      if (b.remark) foot.appendChild(el('span', 'bl-grade-line bl-grade-remark', 'Bemerkung: <span class="bl-blank"></span>'));
      if (b.sign) foot.appendChild(el('span', 'bl-grade-line', 'Unterschrift: <span class="bl-blank"></span>'));
      box.appendChild(foot);
      if (ctx.qr && b.qrHint !== false) box.appendChild(el('p', 'bl-grade-qr', 'Scannen Sie für ein genaues Feedback erneut den QR-Code.'));
      break;
    }
    default:
      break;
  }
  if (b.type !== 'lines' && b.type !== 'pagebreak' && b.type !== 'image' && b.type !== 'cols' && b.type !== 'chart') applyStyle(box, b, /bl-mnote/.test(html));
  return box;
}

/** Bausteine einmal in HTML-Stücke übersetzen (Absätze zum Umbrechen, Titel), Fußnoten dabei nummerieren */
function prepare(b: Block, ctx: Ctx): Part {
  const t = ctx.text;
  switch (b.type) {
    case 'material': {
      const title = inlineMd(b.title, t);
      let mark = '';
      if (b.source?.trim()) {
        const n = ++t.fn;
        t.notes.set(n, esc(b.source));
        mark = `<sup class="bl-fn" data-fn="${n}">${n}</sup>`;
      }
      return { title, mark, paras: paragraphs(b.md, t) };
    }
    case 'text':
    case 'quote':
    case 'box':
      return { paras: paragraphs(b.md, t) };
    case 'task':
      return { title: inlineMd(b.md, t) };
    case 'table':
      return { cells: (b.rows ?? []).map((r) => r.map((c) => inlineMd(c, t))) };
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

/** Summe der Punkte aller Aufgaben („6 P.“), oder null, wenn eine Aufgabe keine Punktzahl hat */
export function totalPoints(doc: BlattDoc): number | null {
  const tasks = walk(doc.blocks).filter((b) => b.type === 'task');
  if (!tasks.length) return null;
  let sum = 0;
  for (const b of tasks) {
    const m = /^\s*(\d+(?:[.,]\d+)?)\s*(?:p\.?|pkt\.?|punkte?|be)?\s*$/i.exec(b.points ?? '');
    if (!m) return null;
    sum += Number(m[1].replace(',', '.'));
  }
  return Math.round(sum * 100) / 100;
}

function newPage(doc: BlattDoc, host: HTMLElement, index: number, copy?: Copy, headCtx?: HeadCtx, editing?: boolean): Pg {
  const P = doc.page;
  const size = P.size === 'a5' ? 'a5' : 'a4';
  const { w, h, m } = pageGeom(doc);
  const page = el('div', `bl-page bl-${size}`);
  page.style.width = w + 'mm';
  page.style.height = h + 'mm';
  page.style.padding = `${m}mm ${m}mm ${m * 0.8}mm`;
  page.style.fontFamily = FONTS[P.font] ?? FONTS.sans;
  page.style.fontSize = (Number(P.fontSize) || 11) + 'pt';
  const H = P.header;
  const qrHere = H.qr === 'all' || (H.qr === 'first' && index === 0);
  const F = headFields(doc);
  if (H.show !== false && (index === 0 || qrHere)) {
    const head = el('div', 'bl-head');
    head.dataset.head = '1';
    const left = el('div', 'bl-head-left');
    const blank = (cls = 'bl-short') => `<span class="bl-blank ${cls}"></span>`;
    const val = (k: HeadKey, auto?: string) => {
      const f = F[k];
      const v = f.auto && auto !== undefined ? auto : f.value;
      return v?.trim() ? esc(v.trim()) : '';
    };
    const title = F.title.on ? val('title', headCtx?.title ?? '') : '';
    if (title) left.appendChild(el('div', 'bl-head-title', title));
    else if (F.title.on && editing) left.appendChild(el('div', 'bl-head-title', '<span class="bl-ph">Titel</span>'));
    // Felder in der gewählten Reihenfolge, auf eine oder zwei Zeilen verteilt
    const rows = [el('div', 'bl-head-fields'), el('div', 'bl-head-fields')];
    const defLen: Record<HeadKey, 's' | 'm' | 'l'> = { title: 'l', subject: 'm', klasse: 's', teacher: 'm', date: 'm', name: 'l', points: 's', grade: 's' };
    const lenCls = (k: HeadKey) => 'bl-len-' + (F[k].len ?? defLen[k]);
    const labelOf = (k: HeadKey) => F[k].label?.trim() || HEAD_KEYS.find((x) => x.key === k)!.label;
    const order = [...(H.order ?? []), ...HEAD_KEYS.map((x) => x.key)].filter((k, i, a) => a.indexOf(k) === i && k !== 'title');
    for (const k of order) {
      const f = F[k];
      if (!f.on) continue;
      let inner = '';
      if (k === 'name') {
        // Nummerierte Plätze („Abgabe 3“) sind kein Name: Linie frei lassen, Nummer klein darunter.
        const numbered = !!copy?.name && isNumberedSeat(copy.name);
        inner =
          f.auto !== false && copy?.name && copy.printName && !numbered
            ? `<span class="bl-filled">${esc(copy.name)}</span>`
            : numbered
              ? `<span class="bl-blank bl-labelled ${lenCls(k)}"><span class="bl-under">${esc(copy!.name!)}</span></span>`
              : blank(lenCls(k));
      } else if (k === 'points') {
        const sum = f.auto !== false ? totalPoints(doc) : null;
        inner = sum !== null ? `${blank('bl-len-s')} / ${String(sum).replace('.', ',')}` : val('points') || blank(lenCls(k));
      } else if (k === 'grade') inner = blank(lenCls(k));
      else {
        const auto = k === 'klasse' ? (copy?.klasse ?? headCtx?.course ?? '') : k === 'teacher' ? (headCtx?.teacher ?? '') : k === 'date' ? new Date().toLocaleDateString('de-DE') : undefined;
        inner = val(k, auto) || blank(lenCls(k));
      }
      rows[(f.row ?? (k === 'points' || k === 'grade' ? 2 : 1)) - 1].appendChild(el('span', `bl-field bl-f-${k}`, `${esc(labelOf(k))}: ${inner}`));
    }
    for (const r of rows) if (r.children.length) left.appendChild(r);
    head.classList.add('bl-head-' + (H.style ?? 'line'), 'bl-ht-' + (H.titleSize ?? 'm'));
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
    if (left.children.length || qrHere) page.appendChild(head);
  }
  if (P.watermark?.trim()) page.appendChild(el('div', 'bl-wm', esc(P.watermark.trim())));
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
export function paginate(doc: BlattDoc, host: HTMLElement, copy?: Copy, opts: { editing?: boolean; head?: HeadCtx } = {}): { pages: HTMLElement[]; problems: Problem[] } {
  host.replaceChildren();
  const pages: Pg[] = [];
  const problems: Problem[] = [];
  let pg!: Pg;
  const next = () => {
    pg = newPage(doc, host, pages.length, copy, opts.head, opts.editing);
    pages.push(pg);
  };
  next();
  /** neue Seite, weil der nächste Baustein nicht mehr passt: eine Überschrift unten auf der Seite geht mit */
  const nextKeep = () => {
    const last = pg.body.lastElementChild as HTMLElement | null;
    const keep = (last?.classList.contains('bl-heading') || (last?.dataset.bid && keepNextIds.has(last.dataset.bid))) && pg.body.children.length > 1 ? last : null;
    next();
    if (keep) pg.body.appendChild(keep);
  };
  const keepNextIds = new Set(walk(doc.blocks).filter((b) => b.keepNext).map((b) => b.id));
  let matNo = 0;
  const labels = taskLabels(doc);
  const gloss = walk(doc.blocks).find((b) => b.type === 'glossary');
  const text = newTextCtx(gloss?.mark ?? 'star');
  const terms = glossaryTerms(doc);
  const korr = doc.page.korr?.side && doc.page.korr.side !== 'none' ? doc.page.korr : null;
  const tables = new Map(walk(doc.blocks).filter((b) => b.type === 'table').map((b) => [b.id, b.rows ?? []] as const));
  const earned = doc.page.earned && doc.page.earned !== 'none' ? doc.page.earned : undefined;
  const qr = doc.page.header.show !== false && doc.page.header.qr !== 'none';
  const scores = walk(doc.blocks)
    .filter((b) => b.type === 'task' && b.points?.trim() && !/%/.test(b.points))
    .map((b) => ({ label: labels.get(b.id) ?? '', max: b.points!.trim() }));
  const mkCtx = (extra: Partial<Ctx> = {}): Ctx => ({ widthMm: pg.widthMm, korr, text, terms, editing: opts.editing, tables, earned, earnedMax: doc.page.earnedMax, scores, qr, ...extra });
  /** Nummer bzw. Bezeichnung eines Bausteins (in Lesereihenfolge, auch in Spalten) */
  const number = (b: Block, ctx: Ctx) => {
    if (b.type === 'task') ctx.label = labels.get(b.id);
    if (b.type === 'material') ctx.number = ++matNo;
  };

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
    if (b.breakBefore && pg.body.children.length) next();
    const ctx = mkCtx();
    number(b, ctx);
    if (b.type === 'cols') {
      // Spalten: Bausteine nebeneinander, als Ganzes auf eine Seite
      const n = Math.max(1, (b.cols ?? []).length);
      const ratio = (b.ratio ?? []).length === n ? b.ratio! : Array(n).fill(1);
      const sum = ratio.reduce((x, y) => x + y, 0);
      const gap = Math.max(2, Math.min(20, Number(b.gap) || 6));
      const kids = (b.cols ?? []).map((col, k) =>
        col.map((kb) => {
          const kc = mkCtx({ widthMm: ((pg.widthMm - gap * (n - 1)) * ratio[k]) / sum });
          number(kb, kc);
          return { b: kb, ctx: kc, part: prepare(kb, kc) };
        }),
      );
      let p = place(b, ctx, { kids });
      if (over(pg) && pg.body.children.length > 1) {
        p.remove();
        nextKeep();
        p = place(b, ctx, { kids });
      }
      for (const m of p.e.querySelectorAll<HTMLElement>('.bl-material')) numberLines(m, 0);
      if (over(pg)) {
        p.e.classList.add('bl-overflow');
        problems.push({ bid: b.id, msg: 'Die Spalten passen nicht auf eine Seite' });
      }
      continue;
    }

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
    const splittable = !b.keep && (b.type === 'text' || b.type === 'material' || b.type === 'quote' || b.type === 'box' || b.type === 'glossary');
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
      const part = (k: number): Part => ({ ...prep, paras: paras.slice(i, k), first, last: k === paras.length, range: [i, k] });
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

/** Papier, auf das gedruckt wird: Broschüre oder zwei Seiten je Blatt aus A5 auf A4 quer, aus A4 auf A3 quer. */
export function sheetSize(doc: BlattDoc): { name: string; w: number; h: number } {
  const size = doc.page.size === 'a5' ? 'a5' : 'a4';
  const g = pageGeom(doc);
  const name = (w: number, h: number) => {
    const [a, b] = [Math.min(w, h), Math.max(w, h)];
    const n = a === 148 && b === 210 ? 'A5' : a === 210 && b === 297 ? 'A4' : a === 297 && b === 420 ? 'A3' : `${w}×${h} mm`;
    return n + (w > h ? ' quer' : '');
  };
  if (!doc.page.booklet && !doc.page.nup) return { name: name(g.w, g.h), w: g.w, h: g.h };
  void size;
  // zwei Seiten nebeneinander: Hochformat → doppelt so breit; Querformat → übereinander
  return g.w <= g.h ? { name: name(2 * g.w, g.h), w: 2 * g.w, h: g.h } : { name: name(g.w, 2 * g.h), w: g.w, h: 2 * g.h };
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
  if (!doc.page.booklet && !doc.page.nup) {
    for (const p of pages) mk('bl-single').appendChild(p);
    return;
  }
  if (!doc.page.booklet) {
    // zwei Seiten auf einem Blatt in Lesereihenfolge: 1|2, 3|4 …
    for (let i = 0; i < pages.length; i += 2) {
      const sh = mk('bl-spread' + (pageGeom(doc).w > pageGeom(doc).h ? ' bl-stack' : ''));
      sh.dataset.label = pages[i + 1] ? `Blatt ${i / 2 + 1}: Seiten ${i + 1} und ${i + 2}` : `Blatt ${i / 2 + 1}: Seite ${i + 1}`;
      sh.appendChild(pages[i].cloneNode(true));
      if (pages[i + 1]) sh.appendChild(pages[i + 1].cloneNode(true));
    }
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
 * Doppelseiten wie im aufgeschlagenen Heft (Wunsch Jo, 23. November 2026): Seite 1 allein rechts, dann 2|3, 4|5 …
 * So lässt sich prüfen, was am Mittelschnitt (Falz) steht.
 */
export function toSpreads(doc: BlattDoc, pages: HTMLElement[], host: HTMLElement) {
  const { w, h } = pageGeom(doc);
  const mk = (label: string) => {
    const sh = el('div', 'bl-sheet bl-spread bl-reading');
    sh.style.width = 2 * w + 'mm';
    sh.style.height = h + 'mm';
    sh.dataset.label = label;
    host.appendChild(sh);
    return sh;
  };
  const blank = () => {
    const e = el('div', 'bl-page bl-blank-page');
    e.style.width = w + 'mm';
    e.style.height = h + 'mm';
    return e;
  };
  for (let i = 0; i < pages.length; i += i === 0 ? 1 : 2) {
    if (i === 0) {
      const sh = mk('Seite 1 (Titelseite)');
      sh.append(blank(), pages[0]);
      continue;
    }
    const right = pages[i + 1];
    const sh = mk(right ? `Seiten ${i + 1} und ${i + 2}` : `Seite ${i + 1}`);
    sh.append(pages[i], right ?? blank());
  }
}

/**
 * Text des Blatts als Markdown für Autogra.fi (Aufgabenstellung als Grundlage für Erwartungshorizont und
 * KI-Bewertung): Material mit Titel und Quelle, Bilder als Bildunterschrift, Aufgaben nummeriert mit Punkten.
 * Linien, Umbrüche und Kopfzeile fallen weg.
 */
export function toMarkdown(doc: BlattDoc): string {
  const out: string[] = [];
  const labels = taskLabels(doc);
  let mat = 0;
  const para = (md?: string) => plainMd(md ?? '', 'paren').trim();
  for (const b of walk(doc.blocks)) {
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
      case 'chart':
        out.push(`[Diagramm${b.caption?.trim() ? ': ' + b.caption.trim() : ''}]`);
        break;
      case 'table': {
        const rows = (b.rows ?? []).map((r) => '| ' + r.map((c) => plainMd(c ?? '').replace(/\|/g, '/').replace(/\n+/g, ' ').trim()).join(' | ') + ' |');
        if (rows.length) rows.splice(1, 0, '|' + (b.rows![0] ?? []).map(() => ' --- |').join(''));
        out.push([rows.join('\n'), b.caption?.trim() ?? ''].filter(Boolean).join('\n\n'));
        break;
      }
      case 'task':
        out.push(`${labels.get(b.id) ?? ''} ${para(b.md).replace(/\n+/g, ' ')}${b.points?.trim() ? ` (${b.points.trim()})` : ''}`);
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
  const tasks = walk(doc.blocks).filter((b) => b.type === 'task');
  const labels = taskLabels(doc);
  const out = tasks.map((b, i) => {
    const m = /^\s*(\d+(?:[.,]\d+)?)\s*(?:p\.?|pkt\.?|punkte?|be)?\s*$/i.exec(b.points ?? '');
    return m ? { key: `a${i + 1}`, label: `Aufgabe ${(labels.get(b.id) ?? String(i + 1)).replace(/[.)]$/, '')}`, max_points: Number(m[1].replace(',', '.')) } : null;
  });
  return out.every(Boolean) ? (out as { key: string; label: string; max_points: number }[]) : [];
}
