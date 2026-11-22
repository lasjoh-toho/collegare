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

export type BlockType = 'heading' | 'text' | 'material' | 'quote' | 'image' | 'task' | 'box' | 'lines' | 'pagebreak';
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
  rand?: boolean;
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
  lines: 'Linien',
  pagebreak: 'Seitenumbruch',
};

export function blankDoc(title = ''): BlattDoc {
  return {
    format: 'ag-blatt/1',
    page: { size: 'a4', booklet: false, font: 'sans', fontSize: 11, pageNumbers: true, fill: 'lines', header: { show: true, text: title, nameLine: true, date: false, qr: 'none' } },
    blocks: [],
  };
}

/** Gespeicherten Text lesen; Fehlendes mit Voreinstellungen auffüllen. */
export function parseDoc(body: string, title = ''): BlattDoc {
  const d = blankDoc(title);
  try {
    const j = JSON.parse(body || '{}') as Partial<BlattDoc>;
    return { ...d, ...j, format: 'ag-blatt/1', page: { ...d.page, ...(j.page ?? {}), header: { ...d.page.header, ...(j.page?.header ?? {}) } }, blocks: Array.isArray(j.blocks) ? j.blocks : [] };
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
  if (type === 'lines') Object.assign(b, { style: 'lines', count: 8, fill: true, spacing: 8, rand: false });
  return b;
}

/** Kurztext eines Bausteins für die Liste */
export function blockSummary(b: Block): string {
  const plain = (s?: string) => (s ?? '').replace(/[*#`>_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  switch (b.type) {
    case 'heading':
      return b.text || '';
    case 'material':
      return [b.label, plain(b.title)].filter(Boolean).join(': ') || plain(b.md);
    case 'image':
      return b.caption || (b.src ? 'Bild' : 'noch kein Bild');
    case 'box':
      return b.text || plain(b.md);
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
/** Markdown → Absätze (je Absatz bzw. Liste ein Stück HTML) */
function paragraphs(md?: string): string[] {
  const t = document.createElement('template');
  t.innerHTML = renderMarkdown(md ?? '');
  return [...t.content.children].map((c) => c.outerHTML);
}
const inlineMd = (md?: string) => renderMarkdown(md ?? '').replace(/^<p>|<\/p>$/g, '').replace(/<\/p><p>/g, '<br>');

/** Linien und Karos als SVG: wird zuverlässig mitgedruckt (Hintergründe nicht). */
function ruling(style: Ruling, widthMm: number, heightMm: number, spacing: number, rand: boolean): Element {
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
  if (style === 'grid') {
    const g = 5;
    const ox = (widthMm % g) / 2;
    for (let x = ox; x <= widthMm + 0.01; x += g) line(x, 0, x, heightMm, 0.15, '#9aa5b1');
    for (let y = 0; y <= heightMm + 0.01; y += g) line(0, y, widthMm, y, 0.15, '#9aa5b1');
  } else if (style === 'lines') {
    for (let y = spacing; y <= heightMm + 0.01; y += spacing) line(0, y, widthMm, y, 0.2, '#7b8794');
  }
  if (rand && style !== 'empty') {
    const x = widthMm - Math.min(40, widthMm / 4);
    line(x, 0, x, heightMm, 0.25, '#7b8794');
  }
  return svg;
}

interface Ctx {
  widthMm: number;
  number?: number;
  note?: number;
}
interface Part {
  paras?: string[];
  first?: boolean;
  last?: boolean;
  heightMm?: number;
}

function render(b: Block, ctx: Ctx, part?: Part): HTMLElement {
  const box = el('div', 'bl-block bl-' + b.type);
  box.dataset.bid = b.id;
  const paras = part?.paras;
  switch (b.type) {
    case 'heading':
      box.appendChild(el(b.level === 1 ? 'h2' : 'h3', '', esc(b.text)));
      break;
    case 'text':
      box.appendChild(el('div', 'bl-text', paras ? paras.join('') : renderMarkdown(b.md ?? '') || '<p class="bl-ph">Erklärtext …</p>'));
      break;
    case 'material': {
      if (!part || part.first) {
        const label = (b.label ?? '').trim() || `Material ${ctx.number}`;
        const title = inlineMd(b.title);
        const mark = b.source ? `<sup>${ctx.note}</sup>` : '';
        box.appendChild(el('div', 'bl-mat-title', `<span class="bl-mat-label">${esc(label)}${title ? ':' : ''}</span>${title ? ' ' + title : ''}${mark}`));
      }
      const body = paras ?? paragraphs(b.md);
      box.appendChild(el('div', 'bl-mat-body' + (b.justify !== false ? ' bl-justify' : '') + (b.lineNumbers !== false ? ' bl-numbered' : ''), body.join('') || '<p class="bl-ph">Text des Materials …</p>'));
      break;
    }
    case 'quote':
      box.appendChild(el('div', 'bl-quote-text', paras ? paras.join('') : renderMarkdown(b.md ?? '') || '<p class="bl-ph">Zitat …</p>'));
      if (b.source && (!part || part.last !== false)) box.appendChild(el('div', 'bl-quote-src', esc(b.source)));
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
      row.appendChild(el('div', 'bl-task-text', (inlineMd(b.md) || '<span class="bl-ph">Aufgabenstellung …</span>') + pts));
      box.appendChild(row);
      const n = Math.max(0, Math.min(40, Number(b.lines) || 0));
      if (n) {
        const style = b.lineStyle ?? 'lines';
        const sp = style === 'grid' ? 5 : Number(b.spacing) || 8;
        const lines = style === 'grid' ? Math.ceil((n * 8) / 5) : n;
        box.appendChild(ruling(style, ctx.widthMm, lines * sp + (style === 'grid' ? 0 : 1), sp, false));
      }
      break;
    }
    case 'box':
      if (b.text) box.appendChild(el('div', 'bl-box-title', esc(b.text)));
      box.appendChild(el('div', 'bl-box-text', renderMarkdown(b.md ?? '') || '<p class="bl-ph">Inhalt des Kastens …</p>'));
      break;
    case 'lines': {
      const style = b.style ?? 'lines';
      const sp = style === 'grid' ? 5 : Number(b.spacing) || 8;
      const h = part?.heightMm ?? Math.max(1, Number(b.count) || 5) * sp;
      if (style === 'empty') {
        const d = el('div', 'bl-empty');
        d.style.height = h + 'mm';
        box.appendChild(d);
      } else box.appendChild(ruling(style, ctx.widthMm, h, sp, !!b.rand));
      break;
    }
    default:
      break;
  }
  return box;
}

/** Zeilennummern alle fünf Zeilen links neben dem Material, fortlaufend über Seiten. */
function numberLines(blockEl: HTMLElement, start: number): number {
  const body = blockEl.querySelector<HTMLElement>('.bl-mat-body');
  if (!body) return 0;
  const lh = parseFloat(getComputedStyle(body).lineHeight) || 16;
  let n = start;
  for (const p of [...body.children] as HTMLElement[]) {
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
  let taskNo = 0;
  let matNo = 0;
  let noteNo = 0;

  const place = (b: Block, ctx: Ctx, part?: Part) => {
    const e = render(b, ctx, part);
    pg.body.appendChild(e);
    let note: HTMLElement | null = null;
    if (b.type === 'material' && b.source && (!part || part.first)) {
      note = el('div', 'bl-note', `<sup>${ctx.note}</sup> ${esc(b.source)}`);
      note.dataset.bid = b.id;
      pg.notes.appendChild(note);
    }
    return {
      e,
      remove() {
        e.remove();
        note?.remove();
      },
    };
  };

  for (const b of doc.blocks) {
    if (b.type === 'pagebreak') {
      if (pg.body.children.length) next();
      continue;
    }
    const ctx: Ctx = { widthMm: pg.widthMm };
    if (b.type === 'task') ctx.number = ++taskNo;
    if (b.type === 'material') {
      ctx.number = ++matNo;
      if (b.source) ctx.note = ++noteNo;
    }

    if (b.type === 'lines' && b.fill) {
      // bis zum Seitenende: Rest messen; ist kaum noch Platz, eine neue Seite füllen
      const sp = b.style === 'grid' ? 5 : Number(b.spacing) || 8;
      const free = () => (pg.body.clientHeight - usedPx(pg)) / pxPerMm(pg) - 2;
      if (free() < sp * 2) next();
      place(b, { widthMm: pg.widthMm }, { heightMm: Math.max(sp, Math.floor(free() / sp) * sp) });
      continue;
    }

    const paras = b.type === 'text' || b.type === 'material' || b.type === 'quote' ? paragraphs(b.md) : null;
    if (!paras || paras.length <= 1) {
      let p = place(b, ctx);
      if (over(pg) && pg.body.children.length > 1) {
        p.remove();
        next();
        ctx.widthMm = pg.widthMm;
        p = place(b, ctx);
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
      let p = place(b, ctx, { paras: paras.slice(i, j), first, last: true });
      while (over(pg) && j - i > 1) {
        p.remove();
        j--;
        p = place(b, ctx, { paras: paras.slice(i, j), first, last: j === paras.length });
      }
      if (over(pg) && pg.body.children.length > 1) {
        // nicht einmal ein Absatz passt auf den Rest der Seite
        p.remove();
        next();
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
        place({ id: '', type: 'lines', style: fill, spacing: sp }, { widthMm: pg.widthMm }, { heightMm: Math.floor(h / sp) * sp });
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
  const para = (md?: string) => (md ?? '').trim();
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
        out.push(`### ${label}${b.title?.trim() ? ': ' + b.title.trim() : ''}`);
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
