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
import temml from 'temml';
import { effectCached, hasFx, imageFilter } from './blattImage';

export type BlockType = 'heading' | 'text' | 'material' | 'quote' | 'image' | 'task' | 'box' | 'glossary' | 'table' | 'chart' | 'cols' | 'lines' | 'pagebreak' | 'grade' | 'formula' | 'wordart' | 'shape';
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
  /** Bild: Helligkeit und Kontrast in Prozent (−60 … +60), Rahmen, runde Ecken, Schatten; Original vor dem Zuschneiden,
   *  Freistellen oder Verkleinern (Wunsch Jo, 24. November 2026) */
  bright?: number;
  contrast?: number;
  frame?: LineWeight;
  round?: boolean;
  shadow?: boolean;
  orig?: string;
  origRot?: number;
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
  /** Seite des Rands für Notizen (Standard rechts); innen/außen wechseln mit der Seite (Wunsch Jo, 25. November 2026) */
  nmSide?: 'left' | 'right' | 'inner' | 'outer';
  /** WordArt (Wunsch Jo, 25. November 2026): Stil der Schrift */
  wa?: 'schatten' | 'kontur' | 'verlauf' | 'bogen' | 'stempel';
  /** Form: Art der Form */
  shape?: 'rect' | 'round' | 'ellipse' | 'arrow' | 'speech' | 'star';
  /** WordArt und Form: Farbe (#rrggbb) */
  color?: string;
  /** Bild: Farben umkehren, Mischmodus mit dem Hintergrund, Tontrennung (Stufen je Kanal), Dithering (Wunsch Jo, 25. November 2026) */
  invert?: boolean;
  blend?: 'multiply' | 'screen' | 'overlay' | 'darken' | 'lighten' | 'color-dodge' | 'color-burn' | 'soft-light' | 'hard-light' | 'difference' | 'luminosity';
  poster?: number;
  dither?: 'fs' | 'bayer';
  /** WordArt und Form aus dem Editor der Pinnwand (Wunsch Jo, 25. November 2026): fertiges SVG mit eingebetteten Schriften */
  svg?: string;
  /** dazu der Stand des Editors (JSON), um später weiter zu bearbeiten */
  pdata?: string;
  /** unten auf der Seite festhalten: steht am Fuß der Seite, auf der er landet */
  bottom?: boolean;
  /** vorübergehend ausgeblendet (Wunsch Jo, 25. November 2026): bleibt in „Elemente“ ausgegraut, fehlt auf dem Blatt, im Druck und in der Ausgabe */
  hidden?: boolean;
  /** Kästen (Kasten, Aufgabe im Kasten, Glossar im Kasten, Bewertung): Linienstärke (Wunsch Jo, 24. November 2026) */
  line?: LineWeight;
}

/** Gestaltung der Unterschriften unter Bildern, Diagrammen und Tabellen */
export interface CaptionStyle {
  /** Größe in Prozent der Grundschrift (Standard 85) */
  size?: number;
  style?: 'normal' | 'italic' | 'bold' | 'bolditalic';
  align?: 'left' | 'center' | 'right';
  gray?: boolean;
  /** automatisch nummerieren: „Abb. 1:“, „Tab. 1:“ */
  number?: boolean;
}

/** Linienstärken für Kästen; Standard „dünn“ */
export type LineWeight = 'hair' | 'thin' | 'medium' | 'thick';
export const LINE_MM: Record<LineWeight, number> = { hair: 0.12, thin: 0.2, medium: 0.35, thick: 0.6 };
export const LINE_LABEL: Record<LineWeight, string> = { hair: 'Haarlinie', thin: 'dünn', medium: 'mittel', thick: 'kräftig' };
/** Bausteine mit Rahmen, bei denen man die Linienstärke wählen kann */
export function hasFrame(b: Block | undefined | null): boolean {
  if (!b) return false;
  if (b.type === 'grade' || b.type === 'shape') return true;
  if (b.type === 'box') return (b.tpl ?? 'rahmen') === 'rahmen' || b.tpl === 'gestrichelt';
  if (b.type === 'task' || b.type === 'glossary') return b.tpl === 'kasten';
  return false;
}

/** Korrekturrand auf Schreiblinien und Karos (Wunsch Jo, 22. November 2026) */
export interface Korr {
  /** innen/außen: je nach Seite links oder rechts (Seite 1 ist eine rechte Seite, innen ist dort links) */
  side: 'none' | 'right' | 'left' | 'inner' | 'outer';
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
    /** Seitenzahl: mindestens so viele Seiten, leere Seiten am Ende wie bei der Broschüre gefüllt */
    minPages?: number;
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
      /** vier Felder in den Ecken des Kopfs, direkt auf der Seite beschrieben (Wunsch Jo, 24. November 2026) */
      corners?: HeadCorners;
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
    /** Bild- und Tabellenunterschriften (Wunsch Jo, 24. November 2026) */
    caption?: CaptionStyle;
    /**
     * Blattvorlage (Wunsch Jo, 24. November 2026, nach dem Vorbild von tufte-css): „book“ = Buchsatz mit breiter
     * Randspalte, Überschriften kursiv statt fett, Zitate als Motto. Fußnoten auf Wunsch als nummerierte Randnoten.
     */
    look?: 'book';
    sidenotes?: boolean;
    /** eigene Absatzvorlagen, aus dem Format eines Bausteins gemerkt */
    styles?: { name: string; style: Partial<Pick<Block, 'fs' | 'lh' | 'ta' | 'it' | 'bd' | 'nm' | 'ind' | 'fw' | 'ls' | 'ps' | 'flow'>> }[];
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
/**
 * Kopf mit vier Eckfeldern (Wunsch Jo, 24. November 2026): oben links, oben rechts, unten links, unten rechts. Jedes Feld
 * ist freier Text, eine Zeile je Absatz; die erste Zeile oben links ist der Titel. „___“ (drei oder mehr Unterstriche)
 * wird zur Linie zum Ausfüllen, so lang wie getippt. Platzhalter in geschweiften Klammern setzt das Blatt selbst ein.
 */
export type CornerKey = 'tl' | 'tr' | 'bl' | 'br';
export type HeadCorners = Partial<Record<CornerKey, string>>;
export const CORNERS: { key: CornerKey; label: string }[] = [
  { key: 'tl', label: 'oben links' },
  { key: 'tr', label: 'oben rechts' },
  { key: 'bl', label: 'unten links' },
  { key: 'br', label: 'unten rechts' },
];
export const HEAD_TOKENS: { key: string; label: string; hint: string }[] = [
  { key: 'Titel', label: 'Titel', hint: 'Name des Blatts' },
  { key: 'Name', label: 'Name', hint: 'beim Druck aus der Klassenliste, sonst eine Linie' },
  { key: 'Klasse', label: 'Klasse', hint: 'Kurs, beim Druck die Klasse aus Autogra.fi' },
  { key: 'Lehrkraft', label: 'Lehrkraft', hint: 'dein Name' },
  { key: 'Datum', label: 'Datum', hint: 'Tag des Drucks' },
  { key: 'Punkte', label: 'Punkte', hint: 'Linie und Summe der Aufgaben, z. B. ___ / 24' },
];
export const DEFAULT_CORNERS: Required<HeadCorners> = { tl: '{Titel}', tr: 'Datum: __________', bl: 'Name: {Name}', br: 'Punkte: {Punkte}   Note: ______' };
/** Eckfelder lesen; ältere Blätter (Rahmendaten mit einzelnen Feldern) werden in die Ecken übertragen */
export function headCorners(doc: BlattDoc): Required<HeadCorners> {
  const H = doc.page.header;
  if (H.corners) return { tl: H.corners.tl ?? '', tr: H.corners.tr ?? '', bl: H.corners.bl ?? '', br: H.corners.br ?? '' };
  const F = headFields(doc);
  const TOK: Partial<Record<HeadKey, string>> = { klasse: 'Klasse', teacher: 'Lehrkraft', date: 'Datum', name: 'Name', points: 'Punkte' };
  const line = (k: HeadKey) => {
    const f = F[k];
    const len = f.len === 'l' ? 24 : f.len === 's' ? 6 : 12;
    const v = f.auto && TOK[k] ? `{${TOK[k]}}` : f.value?.trim() || '_'.repeat(len);
    return `${f.label?.trim() || HEAD_KEYS.find((x) => x.key === k)!.label}: ${v}`;
  };
  const on = (ks: HeadKey[]) => ks.filter((k) => F[k].on).map(line).join('\n');
  return {
    tl: F.title.on ? (F.title.auto ? '{Titel}' : F.title.value?.trim() ?? '') : '',
    tr: on(['subject', 'klasse', 'teacher', 'date']),
    bl: on(['name']),
    br: on(['points', 'grade']).replace(/\n/g, '   '),
  };
}
/** Platzhalter und Linien eines Eckfelds einsetzen; tok liefert fertiges HTML (oder null: Platzhalter bleibt stehen) */
export function cornerHtml(text: string, tok: (k: string) => string | null, tools = false): string {
  // tools: im Editor je Zeile Griff zum Verschieben und × zum Löschen (Wunsch Jo, 25. November 2026)
  const T = '<span class="bl-cl-tools" contenteditable="false"><span class="bl-cl-grip" draggable="true" title="Ziehen: in eine andere Ecke oder Zeile verschieben">⠿</span><span class="bl-cl-x" title="Zeile löschen">×</span></span>';
  return text
    .split('\n')
    .map((ln, n) => {
      let out = '';
      const re = /\{([A-Za-zÄÖÜäöüß]+)\}|_{3,}/g;
      let i = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(ln))) {
        out += esc(ln.slice(i, m.index));
        if (m[1]) out += tok(m[1]) ?? esc(m[0]);
        else out += `<span class="bl-blank" style="width:${Math.min(80, m[0].length * 2.2).toFixed(1)}mm"></span>`;
        i = m.index + m[0].length;
      }
      return `<div class="bl-cl"${tools ? ` data-ln="${n}"` : ''}>${(out + esc(ln.slice(i)) || '&#8203;') + (tools ? T : '')}</div>`;
    })
    .join('');
}
/** Eckfeld als schlichter Text (Word, Text-Export) */
export function cornerText(text: string, tok: (k: string) => string | null): string {
  return text.replace(/\{([A-Za-zÄÖÜäöüß]+)\}/g, (m, k) => tok(k) ?? m);
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
  formula: 'Formel',
  wordart: 'WordArt',
  shape: 'Form',
};

export function blankDoc(title = ''): BlattDoc {
  return {
    format: 'ag-blatt/1',
    page: { size: 'a4', booklet: false, font: 'sans', fontSize: 11, pageNumbers: true, fill: 'lines', header: { show: true, text: '', nameLine: true, date: false, qr: 'none', fields: { title: { on: true, auto: true }, name: { on: true, auto: true }, date: { on: false, auto: false } }, corners: { ...DEFAULT_CORNERS } }, korr: { side: 'none', width: 30, style: 'thin' } },
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
    return { ...d, ...j, format: 'ag-blatt/1', page: { ...d.page, ...(j.page ?? {}), header: { ...d.page.header, ...(j.page?.header ? { fields: undefined, corners: undefined, ...j.page.header } : {}) }, korr: { ...d.page.korr, ...korr } }, blocks };
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
  if (type === 'formula') Object.assign(b, { text: String.raw`\frac{a}{b} = \sqrt{x^2 + y^2}`, align: 'center' });
  if (type === 'wordart') Object.assign(b, { text: 'Überschrift', wa: 'verlauf', color: '#2f6db5', align: 'center' });
  if (type === 'shape') Object.assign(b, { text: '', shape: 'round', width: 40, hMm: 25, align: 'center', color: '#e8f0fb' });
  const t = TEMPLATES[type]?.[0];
  if (t) b.tpl = t.id;
  return b;
}

/** Textbausteine, die sich ineinander umwandeln lassen (Wunsch Jo, 24. November 2026) */
export const CONVERTIBLE: BlockType[] = ['heading', 'text', 'material', 'quote', 'box', 'task'];

/**
 * Baustein in eine andere Art umwandeln, ohne Text zu verlieren: Titel (Überschrift, Materialtitel, Kastentitel) und
 * Text (eine Zeile je Absatz) wandern mit. Wird aus mehrzeiligem Text eine Überschrift, folgt der Rest als Erklärtext.
 * Gemeinsame Einstellungen (Umbrüche, Zusammenhalten) bleiben, die Vorlage beginnt neu.
 */
/**
 * Eingefügten Text in mehrere Bausteine teilen (Wunsch Jo, 24. November 2026), für alle Bausteine mit Text (Erklärtext,
 * Material, Kasten, Zitat, Aufgabe). „Nummern“: eine neue Einheit beginnt bei jeder Zeile mit Nummer am Anfang („1.“,
 * „2)“, „Aufgabe 3:“, „a)“). Bei Aufgaben fällt die Nummer weg (das Blatt nummeriert selbst), „a)“ wird Teilaufgabe,
 * Punkte am Zeilenende („(6 P.)“, „8 Punkte“, „4 BE“) wandern ins Punktefeld. „Absätze“: jeder Absatz für sich.
 * „Überschriften“: Zeilen mit # werden Überschrift-Bausteine, der Text dazwischen bleibt, was er war.
 */
export const SPLITTABLE: BlockType[] = ['text', 'material', 'box', 'quote', 'task'];
const NUM_START = /^\s*(?:\*\*)?(?:(?:Aufgabe|Nr\.?)\s*(\d+[a-z]?)\s*[:.)]?|(\d{1,2})\s*[.)]|([a-h])\s*\))(?:\*\*)?\s+(?=\S)/i;
const POINTS_END = /\s*[([]?\s*(\d+(?:[,.]\d+)?)\s*(?:P\.?|Pkt\.?|Punkte?|BE|VP)\s*[)\]]?\s*$/i;
const linesOf = (b: Block) => (b.md ?? '').replace(/\r\n?/g, '\n').split('\n');
/** neuer Baustein gleicher Art mit den Einstellungen des alten (ohne Titel, Quelle, eigene Nummer) */
function sibling(b: Block, md: string): Block {
  const n = newBlock(b.type);
  for (const k of ['tpl', 'lines', 'lineStyle', 'subtask', 'fs', 'lh', 'ta', 'it', 'bd', 'nm', 'ind', 'fw', 'ls', 'ps', 'korrOff'] as const) if (b[k] !== undefined) (n as unknown as Record<string, unknown>)[k] = b[k];
  n.md = md;
  return n;
}
/** Wie viele Bausteine entstünden? (0 = geht nicht) */
export function splitCount(b: Block, mode: 'numbers' | 'paras' | 'headings'): number {
  if (!SPLITTABLE.includes(b.type)) return 0;
  const n = mode === 'numbers' ? linesOf(b).filter((l) => NUM_START.test(l)).length + (NUM_START.test(linesOf(b).find((l) => l.trim()) ?? '') ? 0 : 1) : mode === 'paras' ? paraSpans(b.md).length : linesOf(b).filter((l) => /^#{1,3}\s+\S/.test(l)).length;
  return n >= 2 || (mode === 'headings' && n >= 1) ? n : 0;
}
export function splitBlock(b: Block, mode: 'numbers' | 'paras' | 'headings'): Block[] {
  if (!SPLITTABLE.includes(b.type)) return [b];
  const lines = linesOf(b);
  if (mode === 'paras') {
    const sp = paraSpans(b.md);
    if (sp.length < 2) return [b];
    return sp.map(([x, y], i) => (i === 0 ? { ...b, md: lines.slice(x, y).join('\n') } : sibling(b, lines.slice(x, y).join('\n'))));
  }
  if (mode === 'headings') {
    const out: Block[] = [];
    let cur: string[] = [];
    let first = true;
    const flush = () => {
      const md = cur.join('\n').trim();
      if (md) out.push(first ? { ...b, md } : sibling(b, md));
      if (md) first = false;
      cur = [];
    };
    for (const ln of lines) {
      const h = /^(#{1,3})\s+(.*\S)\s*$/.exec(ln);
      if (!h) {
        cur.push(ln);
        continue;
      }
      flush();
      const hb = newBlock('heading');
      hb.text = plainMd(h[2]);
      hb.level = h[1].length <= 1 ? 1 : 2;
      out.push(hb);
    }
    flush();
    if (!out.some((x) => x.id === b.id)) out[0] = { ...out[0], id: b.id };
    return out.length > 1 ? out : [b];
  }
  const task = b.type === 'task';
  const parts: { lines: string[]; sub: boolean }[] = [];
  for (const ln of lines) {
    const m = NUM_START.exec(ln);
    if (m) parts.push({ lines: [task ? ln.slice(m[0].length) : ln], sub: !!m[3] });
    else if (parts.length) parts[parts.length - 1].lines.push(ln);
    else if (ln.trim()) parts.push({ lines: [ln], sub: !!b.subtask });
  }
  if (parts.length < 2) return [b];
  return parts.map((p, i) => {
    let md = p.lines.join('\n').trim();
    const n: Block = i === 0 ? { ...b } : sibling(b, md);
    if (task) {
      const pm = POINTS_END.exec(md);
      if (pm && md.slice(0, pm.index).trim()) {
        md = md.slice(0, pm.index).trim();
        n.points = `${pm[1].replace('.', ',')} P.`;
      } else if (i > 0) n.points = '';
      n.subtask = p.sub || undefined;
      if (i > 0) delete n.num;
    }
    n.md = md;
    return n;
  });
}
/** Baustein vor der Zeile `line` teilen (Schreibmarke) */
export function splitBlockAt(b: Block, line: number): Block[] {
  const lines = linesOf(b);
  const a = lines.slice(0, line).join('\n').trim();
  const z = lines.slice(line).join('\n').trim();
  if (!SPLITTABLE.includes(b.type) || !a || !z) return [b];
  const n = sibling(b, z);
  if (b.type === 'task') n.points = '';
  return [{ ...b, md: a }, n];
}

export function convertBlock(b: Block, to: BlockType): Block[] {
  if (b.type === to || !CONVERTIBLE.includes(b.type) || !CONVERTIBLE.includes(to)) return [b];
  const title = (b.type === 'heading' ? b.text : b.type === 'material' ? b.title : b.type === 'box' ? b.text : '')?.trim() ?? '';
  const body = b.type === 'heading' ? '' : (b.md ?? '').replace(/\s+$/, '');
  const n = newBlock(to);
  n.id = b.id;
  for (const k of ['breakBefore', 'keep', 'keepNext'] as const) if (b[k]) n[k] = b[k];
  const both = [title, body].filter(Boolean).join('\n');
  switch (to) {
    case 'heading': {
      const lines = body.split('\n');
      n.text = title || plainMd(lines.shift() ?? '').trim();
      n.level = 2;
      const rest = (title ? body : lines.join('\n')).trim();
      if (!rest) return [n];
      const t = newBlock('text');
      t.md = rest;
      return [n, t];
    }
    case 'material':
      n.title = title;
      n.md = body;
      if (b.type === 'quote' && b.source) n.source = b.source;
      break;
    case 'box':
      n.text = title;
      n.md = body;
      break;
    case 'quote':
      n.md = both;
      if (b.type === 'material' && b.source) n.source = b.source;
      break;
    default:
      // Aufgabe, Erklärtext: Titel als erste Zeile
      n.md = both;
  }
  return [n];
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
    case 'formula':
      return b.text || '';
    case 'wordart':
      return [WA_LABEL[b.wa ?? 'verlauf'], b.text].filter(Boolean).join(': ');
    case 'shape':
      return [SHAPE_LABEL[b.shape ?? 'round'], b.text].filter(Boolean).join(': ');
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
/** nur die sichtbaren Bausteine, auch in Spalten (ausgeblendete fallen weg) */
export function shownBlocks(blocks: Block[]): Block[] {
  return blocks.filter((b) => !b.hidden).map((b) => (b.type === 'cols' ? { ...b, cols: (b.cols ?? []).map(shownBlocks) } : b));
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
  for (const b of walk(shownBlocks(doc.blocks))) {
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
  /** Fußnoten als nummerierte Randnoten neben der Zeile */
  side?: boolean;
}
const newTextCtx = (mark: TextCtx['mark'] = 'star', side = false): TextCtx => ({ fn: 0, notes: new Map(), mark, side });

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
        else if (ctx?.side) {
          const n = ++ctx.fn;
          out += `<sup class="bl-fn" data-fn="${n}">${n}</sup><span class="bl-mnote bl-side"><sup>${n}</sup> ${body}</span>`;
        } else if (ctx) {
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
    { id: 'definitionen', label: 'Definitionen: Begriff links, Erklärung rechts' },
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
    { id: 'definitionen', label: 'Definitionen im Kasten' },
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
  // innen/außen wird wie rechts gezeichnet und auf den passenden Seiten gespiegelt (siehe paginate)
  if (k) svg.dataset.korr = k.side;
  const x0 = k?.side === 'left' ? kw : 0;
  const x1 = k && k.side !== 'left' ? widthMm - kw : widthMm;
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
    const x = k.side !== 'left' ? widthMm - kw : kw;
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
  /** Buchsatz: alle Textbausteine mit Randspalte */
  book?: boolean;
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
  /** automatische Nummer vor der Unterschrift („Abb. 2:“) */
  capLabel?: string;
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
function applyStyle(box: HTMLElement, b: Block, margin: number) {
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
  const nm = st.nm || margin;
  if (nm) {
    box.classList.add('bl-hasnm');
    box.style.setProperty('--nm', Math.max(10, Math.min(70, nm)) + 'mm');
    if (b.nmSide && b.nmSide !== 'right') box.classList.add('bl-nm-' + b.nmSide);
  }
}

/** Unterschrift mit automatischer Nummer davor (die Nummer gehört nicht zum Text, den man bearbeitet) */
function capField(tag: string, cls: string, b: Block, ctx: Ctx, ph: string): HTMLElement {
  const f = field(tag, cls, 'caption', esc(b.caption) || `<span class="bl-ph">${ph}</span>`);
  // steht schon „Abb. 1:“ im Text, keine zweite Nummer davor
  if (ctx.capLabel && b.caption?.trim() && !/^\s*(abb|abbildung|tab|tabelle|fig|m)\.?\s*\d+/i.test(b.caption)) f.dataset.cap = ctx.capLabel;
  return f;
}

export const SHAPE_LABEL: Record<NonNullable<Block['shape']>, string> = { rect: 'Rechteck', round: 'Abgerundet', ellipse: 'Ellipse', arrow: 'Pfeil', speech: 'Sprechblase', star: 'Stern' };
export const WA_LABEL: Record<NonNullable<Block['wa']>, string> = { verlauf: 'Verlauf', schatten: 'Schatten', kontur: 'Kontur', bogen: 'Bogen', stempel: 'Stempel' };

/** nur #rgb/#rrggbb zulassen (Farbe landet im Stil) */
function safeColor(c: string | undefined, fb: string): string {
  return c && /^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(c) ? c : fb;
}

/** LaTeX als MathML (temml); Fehler zeigt temml rot im Text */
export function formulaHtml(tex: string): string {
  try {
    return temml.renderToString(tex, { displayMode: true, throwOnError: false });
  } catch {
    return `<span class="bl-ph">${esc(tex)}</span>`;
  }
}

/** SVG aus dem Pinnwand-Editor als Bild (data-URL: kein Skript, Schriften sind eingebettet) */
export function svgSrc(svg: string): string {
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg.includes('xmlns=') ? svg : svg.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"'));
}
function pwImg(b: Block, def: number): HTMLElement {
  const wrap = el('div', 'bl-pw bl-align-' + (b.align ?? 'center'));
  const img = el('img') as HTMLImageElement;
  img.src = svgSrc(b.svg ?? '');
  img.alt = b.text ?? '';
  img.style.width = Math.max(10, Math.min(100, Number(b.width) || def)) + '%';
  if (b.rot) img.style.transform = `rotate(${Number(b.rot)}deg)`;
  wrap.appendChild(img);
  return wrap;
}

function shapeSvg(kind: NonNullable<Block['shape']>, fill: string, line: string): string {
  const sw = line === 'hair' ? 0.6 : line === 'thick' ? 2.4 : line === 'medium' ? 1.6 : 1;
  const a = `fill="${fill}" stroke="#333" stroke-width="${sw}" vector-effect="non-scaling-stroke"`;
  const d: Record<string, string> = {
    rect: `<rect x="1" y="1" width="98" height="98" ${a}/>`,
    round: `<rect x="1" y="1" width="98" height="98" rx="12" ry="12" ${a}/>`,
    ellipse: `<ellipse cx="50" cy="50" rx="49" ry="49" ${a}/>`,
    arrow: `<path d="M1 30 H65 V5 L99 50 L65 95 V70 H1 Z" ${a}/>`,
    speech: `<path d="M8 2 H92 Q98 2 98 8 V62 Q98 68 92 68 H40 L22 96 L26 68 H8 Q2 68 2 62 V8 Q2 2 8 2 Z" ${a}/>`,
    star: `<path d="M50 2 L62 36 L98 37 L69 58 L80 94 L50 73 L20 94 L31 58 L2 37 L38 36 Z" ${a}/>`,
  };
  return `<svg class="bl-shape-svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">${d[kind] ?? d.round}</svg>`;
}

/** Feld, das man auf der Seite anklicken und dort bearbeiten kann */
function field(tag: string, cls: string, name: string, html: string, range?: [number, number]): HTMLElement {
  const e = el(tag, cls, html);
  e.dataset.field = name;
  if (range) e.dataset.r = range.join(':');
  return e;
}

/**
 * Definitionen (Wunsch Jo, 24. November 2026, z. B. Operatoren): jeder Absatz „Begriff: Erklärung“ (auch „–“) wird zu
 * Begriff links in fester Spalte und Erklärung rechts daneben. Absätze ohne Doppelpunkt bleiben, wie sie sind.
 */
function defPara(p: string): string {
  const m = /^<p>([\s\S]*)<\/p>$/.exec(p);
  if (!m) return p;
  const inner = m[1];
  let depth = 0;
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (c === '<') depth++;
    else if (c === '>') depth--;
    else if (depth === 0 && ((c === ':' && /\s/.test(inner[i + 1] ?? '')) || ((c === '–' || c === '—') && inner[i - 1] === ' ' && inner[i + 1] === ' '))) {
      const term = inner.slice(0, i).trim().replace(/<\/?strong>/g, '');
      const rest = inner.slice(i + 1).trim();
      if (!term || term.replace(/<[^>]+>/g, '').length > 40) return p;
      return `<p class="bl-def"><span class="bl-dt">${term}</span><span class="bl-dd">${rest}</span></p>`;
    }
  }
  return p;
}

function render(b: Block, ctx: Ctx, part: Part = {}): HTMLElement {
  const box = el('div', 'bl-block bl-' + b.type);
  box.dataset.bid = b.id;
  const paras = (part.paras ?? []).map((x) => (b.tpl === 'definitionen' && (b.type === 'text' || b.type === 'box') ? defPara(x) : x));
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
        const filter = imageFilter(b);
        if (hasFx(b)) {
          // Tontrennung/Dithering rechnet die Leinwand (mit den Filtern); bis dahin das Bild mit Filtern zeigen
          const ready = effectCached(b.src, { filter, poster: b.poster, dither: b.dither }, (u) => {
            img.src = u;
            img.style.filter = '';
          });
          img.src = ready ?? b.src;
          if (!ready && filter) img.style.filter = filter;
        } else {
          img.src = b.src;
          if (filter) img.style.filter = filter;
        }
        if (b.blend) img.style.mixBlendMode = b.blend;
        if (b.frame && LINE_MM[b.frame]) img.style.border = `${LINE_MM[b.frame]}mm solid #333`;
        if (b.round) img.style.borderRadius = '2.5mm';
        if (b.shadow) img.style.boxShadow = '0.6mm 0.8mm 2mm rgba(0, 0, 0, 0.35)';
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
      if (b.caption || ctx.editing) fig.appendChild(capField('figcaption', '', b, ctx, 'Bildunterschrift'));
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
      // Punkte direkt auf der Seite schreiben (Wunsch Jo, 25. November 2026): Feld „points“, im Editor leer mit Platzhalter
      const ptsPh = '<span class="bl-ph">P.</span>';
      const showMax = ctx.earned && ctx.earnedMax !== false && (!!b.points?.trim() || !!ctx.editing);
      if (!ctx.earned || ctx.earnedMax === false) {
        if (b.points?.trim() || ctx.editing) {
          text.appendChild(document.createTextNode(' '));
          text.appendChild(field('span', 'bl-pts', 'points', esc(b.points?.trim() ?? '') || ptsPh));
        }
      }
      row.appendChild(text);
      if (ctx.earned) {
        // Feld für die erreichten Punkte rechts: [     / 6 P.] bzw. ____ / 6 P.
        const sc = el('span', 'bl-score');
        let max: HTMLElement | null = null;
        if (showMax) {
          max = el('span', 'bl-emax', '/ ');
          max.appendChild(field('span', 'bl-emax-v', 'points', esc(b.points?.trim() ?? '') || ptsPh));
        }
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
      if (b.caption || ctx.editing) box.appendChild(capField('div', 'bl-cap', b, ctx, 'Beschriftung (optional)'));
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
      if (b.caption || ctx.editing) fig.appendChild(capField('figcaption', '', b, ctx, 'Bildunterschrift'));
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
      // Im Editor bleibt der Hinweis sichtbar, auch wenn das Blatt (noch) keinen QR-Code hat: dann blass; gedruckt wird er nur mit QR-Code
      if (b.qrHint !== false && (ctx.qr || ctx.editing)) {
        const q = el('p', ctx.qr ? 'bl-grade-qr' : 'bl-grade-qr bl-grade-qr-off', 'Scannen Sie für ein genaues Feedback erneut den QR-Code.');
        if (!ctx.qr) q.title = 'Erscheint im Druck, sobald das Blatt einen QR-Code hat (Kopf → QR-Code oder Drucken mit Autogra.fi)';
        box.appendChild(q);
      }
      break;
    }
    case 'formula': {
      const f = el('div', 'bl-formula bl-align-' + (b.align ?? 'center'), b.text?.trim() ? formulaHtml(b.text) : '<span class="bl-ph">Formel (LaTeX) im Reiter „Formel“ eingeben</span>');
      f.dataset.formula = '1';
      if (b.rot) f.style.setProperty('--rot', `${Number(b.rot)}deg`);
      box.appendChild(f);
      break;
    }
    case 'wordart': {
      if (b.svg) {
        box.appendChild(pwImg(b, 60));
        break;
      }
      const wa = b.wa ?? 'verlauf';
      const color = safeColor(b.color, '#2f6db5');
      const wrap = el('div', 'bl-wa-wrap bl-align-' + (b.align ?? 'center'));
      wrap.style.setProperty('--wa', color);
      if (wa === 'bogen') {
        const txt = esc(b.text || 'WordArt');
        wrap.innerHTML = `<svg class="bl-wa-arc" viewBox="0 12 400 104" aria-label="${txt}"><defs><path id="wa-${b.id}" d="M20 110 Q200 -20 380 110"/></defs><text><textPath href="#wa-${b.id}" startOffset="50%" text-anchor="middle">${txt}</textPath></text></svg>`;
        if (ctx.editing) wrap.appendChild(field('div', 'bl-wa-edit', 'text', esc(b.text) || '<span class="bl-ph">Text</span>'));
      } else wrap.appendChild(field('div', 'bl-wa bl-wa-' + wa, 'text', esc(b.text) || '<span class="bl-ph">WordArt</span>'));
      box.appendChild(wrap);
      break;
    }
    case 'shape': {
      if (b.svg) {
        box.appendChild(pwImg(b, 40));
        if (b.wrap === 'left' || b.wrap === 'right') {
          box.classList.add('bl-wrap-' + b.wrap);
          box.style.width = Math.max(10, Math.min(100, Number(b.width) || 40)) + '%';
          (box.firstChild as HTMLElement).querySelector('img')!.style.width = '100%';
        }
        break;
      }
      const pct = Math.max(10, Math.min(100, Number(b.width) || 40));
      const h = Math.max(8, Math.min(250, Number(b.hMm) || 25));
      const sh = el('div', 'bl-shape bl-align-' + (b.align ?? 'center'));
      sh.style.width = pct + '%';
      sh.style.height = h + 'mm';
      if (b.rot) sh.style.transform = `rotate(${Number(b.rot)}deg)`;
      sh.innerHTML = shapeSvg(b.shape ?? 'round', safeColor(b.color, '#e8f0fb'), b.line ?? 'thin');
      sh.appendChild(field('div', 'bl-shape-t', 'text', esc(b.text) || (ctx.editing ? '<span class="bl-ph">Text (optional)</span>' : '')));
      if (b.wrap === 'left' || b.wrap === 'right') box.classList.add('bl-wrap-' + b.wrap);
      box.appendChild(sh);
      break;
    }
    default:
      break;
  }
  if (b.type !== 'lines' && b.type !== 'pagebreak' && b.type !== 'image' && b.type !== 'cols' && b.type !== 'chart' && b.type !== 'shape') applyStyle(box, b, ctx.book && b.type !== 'table' && b.type !== 'grade' ? 42 : /bl-mnote/.test(html) ? 30 : 0);
  // im Editor: X zum Löschen hinten am Baustein (Wunsch Jo, 24. November 2026); sichtbar beim Darüberfahren und gewählt
  if (ctx.editing && first) {
    const x = el('button', 'bl-x', '×');
    x.setAttribute('type', 'button');
    x.setAttribute('data-del', b.id);
    x.setAttribute('title', `${BLOCK_LABEL[b.type]} löschen`);
    x.setAttribute('aria-label', `${BLOCK_LABEL[b.type]} löschen`);
    x.contentEditable = 'false';
    box.appendChild(x);
  }
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
  const tasks = walk(shownBlocks(doc.blocks)).filter((b) => b.type === 'task');
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
  const page = el('div', `bl-page bl-${size}${P.look === 'book' ? ' bl-look-book' : ''}`);
  page.style.width = w + 'mm';
  page.style.height = h + 'mm';
  page.style.padding = `${m}mm ${m}mm ${m * 0.8}mm`;
  page.style.fontFamily = FONTS[P.font] ?? FONTS.sans;
  page.style.fontSize = (Number(P.fontSize) || 11) + 'pt';
  const C = P.caption;
  if (C) {
    if (C.size) page.style.setProperty('--cap-fs', Math.max(60, Math.min(160, C.size)) / 100 + 'em');
    if (C.style === 'italic' || C.style === 'bolditalic') page.style.setProperty('--cap-it', 'italic');
    if (C.style === 'bold' || C.style === 'bolditalic') page.style.setProperty('--cap-fw', '700');
    if (C.align) page.style.setProperty('--cap-ta', C.align);
    if (C.gray) page.style.setProperty('--cap-col', '#555');
  }
  const H = P.header;
  const qrHere = H.qr === 'all' || (H.qr === 'first' && index === 0);
  if (H.show !== false && (index === 0 || qrHere)) {
    const head = el('div', 'bl-head');
    head.dataset.head = '1';
    const left = el('div', 'bl-head-left bl-corners');
    const blank = (cls = 'bl-short') => `<span class="bl-blank ${cls}"></span>`;
    const C = headCorners(doc);
    const sum = totalPoints(doc);
    const tok = (k: string): string | null => {
      switch (k) {
        case 'Titel':
          return headCtx?.title?.trim() ? esc(headCtx.title.trim()) : editing ? '<span class="bl-ph">Titel</span>' : '';
        case 'Name': {
          // Nummerierte Plätze („Abgabe 3“) sind kein Name: Linie frei lassen, Nummer klein darunter.
          const numbered = !!copy?.name && isNumberedSeat(copy.name);
          return copy?.name && copy.printName && !numbered ? `<span class="bl-filled">${esc(copy.name)}</span>` : numbered ? `<span class="bl-blank bl-labelled bl-len-l"><span class="bl-under">${esc(copy!.name!)}</span></span>` : blank('bl-len-l');
        }
        case 'Klasse':
        case 'Kurs': {
          const v = copy?.klasse ?? headCtx?.course ?? '';
          return v.trim() ? esc(v.trim()) : blank('bl-len-s');
        }
        case 'Lehrkraft':
          return headCtx?.teacher?.trim() ? esc(headCtx.teacher.trim()) : blank('bl-len-m');
        case 'Datum':
          return esc(new Date().toLocaleDateString('de-DE'));
        case 'Punkte':
          return sum !== null ? `${blank('bl-len-s')} / ${String(sum).replace('.', ',')}` : blank('bl-len-s');
      }
      return null;
    };
    for (const { key, label } of CORNERS) {
      const v = C[key];
      const f = field('div', `bl-corner bl-c-${key}`, 'head:' + key, v.trim() ? cornerHtml(v, tok, !!editing) : editing ? `<span class="bl-ph">${label}</span>` : '');
      left.appendChild(f);
    }
    left.dataset.bid = '__head';
    if (!editing && !Object.values(C).some((v) => v.trim())) left.replaceChildren();
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
    if (editing && index === 0) {
      const x = el('button', 'bl-x', '×');
      x.setAttribute('type', 'button');
      x.setAttribute('data-del', '__head');
      x.setAttribute('title', 'Kopf mit Rahmendaten entfernen (unter „Aufgabe“ → Rahmendaten wieder einschalten)');
      x.setAttribute('aria-label', 'Kopf entfernen');
      head.appendChild(x);
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
  doc = { ...doc, blocks: shownBlocks(doc.blocks) };
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
  let figNo = 0;
  let tabNo = 0;
  const labels = taskLabels(doc);
  const gloss = walk(doc.blocks).find((b) => b.type === 'glossary');
  const text = newTextCtx(gloss?.mark ?? 'star', !!doc.page.sidenotes);
  const terms = glossaryTerms(doc);
  const korr = doc.page.korr?.side && doc.page.korr.side !== 'none' ? doc.page.korr : null;
  const tables = new Map(walk(doc.blocks).filter((b) => b.type === 'table').map((b) => [b.id, b.rows ?? []] as const));
  const earned = doc.page.earned && doc.page.earned !== 'none' ? doc.page.earned : undefined;
  const qr = doc.page.header.show !== false && doc.page.header.qr !== 'none';
  const scores = walk(doc.blocks)
    .filter((b) => b.type === 'task' && b.points?.trim() && !/%/.test(b.points))
    .map((b) => ({ label: labels.get(b.id) ?? '', max: b.points!.trim() }));
  const mkCtx = (extra: Partial<Ctx> = {}): Ctx => ({ widthMm: pg.widthMm, book: doc.page.look === 'book', korr, text, terms, editing: opts.editing, tables, earned, earnedMax: doc.page.earnedMax, scores, qr, ...extra });
  /** Nummer bzw. Bezeichnung eines Bausteins (in Lesereihenfolge, auch in Spalten) */
  const number = (b: Block, ctx: Ctx) => {
    if (b.type === 'task') ctx.label = labels.get(b.id);
    if (b.type === 'material') ctx.number = ++matNo;
    if (doc.page.caption?.number && b.caption?.trim()) {
      if (b.type === 'table') ctx.capLabel = `Tab. ${++tabNo}:`;
      else if (b.type === 'image' || b.type === 'chart') ctx.capLabel = `Abb. ${++figNo}:`;
    }
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

  /** Höhe der Bausteine „unten festhalten“ direkt hinter Baustein i (in mm), damit Linien bis zum Seitenende Platz lassen */
  const bottomAfter = (i: number): number => {
    let h = 0;
    for (let j = i + 1; j < doc.blocks.length && doc.blocks[j].bottom; j++) {
      const nb = doc.blocks[j];
      const c = mkCtx();
      const p = place(nb, c, prepare(nb, c));
      const cs = getComputedStyle(p.e);
      h += (p.e.offsetHeight + parseFloat(cs.marginTop || '0') + parseFloat(cs.marginBottom || '0')) / pxPerMm(pg);
      p.remove();
    }
    return h;
  };
  for (const [bi, b] of doc.blocks.entries()) {
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
      const reserve = bottomAfter(bi);
      const free = () => (pg.body.clientHeight - usedPx(pg)) / pxPerMm(pg) - 2 - reserve;
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

  // Broschüre: auf ein Vielfaches von vier Seiten auffüllen; feste Seitenzahl (Wunsch Jo, 25. November 2026): bis
  // dahin auffüllen (Linien, Karos oder leer)
  // Schritt der Seitenfolge: Broschüre 4, zwei je Blatt 2 (eine feste Zahl wird darauf aufgerundet)
  const step = doc.page.booklet ? 4 : doc.page.nup ? 2 : 1;
  const want = Math.max(0, Math.min(64, Number(doc.page.minPages) || 0));
  const minPages = Math.ceil(want / step) * step;
  if (doc.page.booklet || minPages > pages.length) {
    const fill = doc.page.fill ?? 'lines';
    while (pages.length < minPages || (doc.page.booklet && pages.length % 4)) {
      next();
      pg.page.classList.add('bl-filler');
      if (fill !== 'empty') {
        const sp = fill === 'grid' ? 5 : 8;
        const h = pg.body.clientHeight / pxPerMm(pg) - 2;
        place({ id: '', type: 'lines', style: fill, spacing: sp }, mkCtx(), { heightMm: Math.floor(h / sp) * sp });
      }
    }
  }

  // unten festhalten: Lücke vor dem ersten solchen Baustein der Seite, damit er am Fuß steht
  const bottomIds = new Set(doc.blocks.filter((b) => b.bottom).map((b) => b.id));
  if (bottomIds.size)
    for (const p of pages) {
      const first = [...p.body.children].find((c) => bottomIds.has((c as HTMLElement).dataset.bid ?? '')) as HTMLElement | undefined;
      if (!first) continue;
      const gap = p.body.clientHeight - usedPx(p) - 2;
      if (gap > 1) {
        const sp = document.createElement('div');
        sp.className = 'bl-bottom-gap';
        sp.style.height = gap + 'px';
        p.body.insertBefore(sp, first);
      }
    }
  pages.forEach((p, k) => {
    // rechte Seite (1, 3, …): innen ist links; linke Seite (2, 4, …): innen ist rechts
    p.page.classList.add(k % 2 ? 'bl-verso' : 'bl-recto');
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
      case 'formula':
        if (b.text?.trim()) out.push(`$$${b.text.trim()}$$`);
        break;
      case 'wordart':
        if (b.text?.trim()) out.push(`**${b.text.trim()}**`);
        break;
      case 'shape':
        out.push(`[Form: ${SHAPE_LABEL[b.shape ?? 'round']}${b.text?.trim() ? ', ' + b.text.trim() : ''}]`);
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
  const tasks = walk(shownBlocks(doc.blocks)).filter((b) => b.type === 'task');
  const labels = taskLabels(doc);
  const out = tasks.map((b, i) => {
    const m = /^\s*(\d+(?:[.,]\d+)?)\s*(?:p\.?|pkt\.?|punkte?|be)?\s*$/i.exec(b.points ?? '');
    return m ? { key: `a${i + 1}`, label: `Aufgabe ${(labels.get(b.id) ?? String(i + 1)).replace(/[.)]$/, '')}`, max_points: Number(m[1].replace(',', '.')) } : null;
  });
  return out.every(Boolean) ? (out as { key: string; label: string; max_points: number }[]) : [];
}
