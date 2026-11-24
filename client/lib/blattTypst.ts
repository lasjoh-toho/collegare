/**
 * Arbeitsblatt als Typst-Code (Wunsch Jo, 24. November 2026: „für Nerds ein Typst-Editor in der rechten Seitenleiste“).
 *
 * Das Blatt (Format „ag-blatt/1“) wird als Typst-Quelltext geschrieben und von dort wieder gelesen. Jeder Baustein ist
 * ein Funktionsaufruf mit benannten Werten und Inhalt in eckigen Klammern, z. B.
 *
 *   #aufgabe(punkte: "4", zeilen: 6)[Beschreibe die *Karte*.]
 *
 * Text folgt der Typst-Auszeichnung: *fett*, _kursiv_, #underline[…], #highlight[…], #footnote[…], #rand[…] (Randbemerkung),
 * #begriff("Wort")[Erklärung] (Glossar), Listen mit „- “ und „+ “, Absätze durch eine Leerzeile. Gelesen wird nur diese
 * Teilmenge von Typst; was nicht passt, meldet eine Zeile mit Fehler, und das Blatt bleibt unverändert.
 * Bilder kommen nicht in den Code (zu groß): #bild("id") verweist auf ein Bild, das schon im Blatt ist.
 *
 * Ohne Abhängigkeiten, ohne React.
 */
import { type BlattDoc, type Block, type BlockType, type HeadKey, type HeadField, HEAD_KEYS, blankDoc, headFields, newBlock, walk } from './blatt';

// ---------- Text: kleines Markdown ↔ Typst-Auszeichnung ----------

const TY_SPECIAL = new Set(['*', '_', '#', '[', ']', '$', '@', '<', '\\', '~', '`']);
const MD_SPECIAL = new Set(['*', '_', '^', '{', '}', '[', ']', '=', '+', '`', '\\']);

function closingIn(s: string, i: number, open: string, close: string): number {
  let depth = 0;
  let inStr = false;
  for (let j = i; j < s.length; j++) {
    const c = s[j];
    if (c === '\\') {
      j++;
      continue;
    }
    if (inStr) {
      if (c === '"') inStr = false;
      continue;
    }
    if (c === '"' && open !== '[') inStr = true;
    else if (c === open) depth++;
    else if (c === close && --depth === 0) return j;
  }
  return -1;
}

const tyText = (s: string) => {
  let o = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (TY_SPECIAL.has(c) || (c === '/' && s[i + 1] === '/')) o += '\\' + c;
    else o += c;
  }
  return o;
};
const tyStr = (s: string) => '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n') + '"';

/** eine Zeile kleines Markdown → Typst-Auszeichnung */
function mdInline(s: string): string {
  let out = '';
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === '\\' && i + 1 < s.length) {
      out += tyText(s[i + 1]);
      i += 2;
      continue;
    }
    if (c === '^' && (s.startsWith('^[', i) || s.startsWith('^^[', i))) {
      const margin = s.startsWith('^^[', i);
      const start = i + (margin ? 2 : 1);
      const end = closingIn(s, start, '[', ']');
      if (end > 0) {
        out += `#${margin ? 'rand' : 'footnote'}[${mdInline(s.slice(start + 1, end))}]`;
        i = end + 1;
        continue;
      }
    }
    if (c === '{') {
      const end = closingIn(s, i, '{', '}');
      const bar = end > 0 ? s.indexOf('|', i) : -1;
      if (end > 0 && bar > i && bar < end) {
        out += `#begriff[${mdInline(s.slice(i + 1, bar))}][${mdInline(s.slice(bar + 1, end))}]`;
        i = end + 1;
        continue;
      }
    }
    if (s.startsWith('==', i) && s[i + 2] && s[i + 2] !== ' ') {
      const end = s.indexOf('==', i + 2);
      if (end > i + 2) {
        out += `#highlight[${mdInline(s.slice(i + 2, end))}]`;
        i = end + 2;
        continue;
      }
    }
    if (c === '`') {
      const end = s.indexOf('`', i + 1);
      if (end > i) {
        out += s.slice(i, end + 1);
        i = end + 1;
        continue;
      }
    }
    if (c === '[') {
      const end = closingIn(s, i, '[', ']');
      if (end > 0 && s[end + 1] === '(') {
        const pe = closingIn(s, end + 1, '(', ')');
        if (pe > 0) {
          out += `#link(${tyStr(s.slice(end + 2, pe))})[${mdInline(s.slice(i + 1, end))}]`;
          i = pe + 1;
          continue;
        }
      }
    }
    let hit = false;
    for (const [mk, open, close] of [
      ['++', '#underline[', ']'],
      ['**', '*', '*'],
      ['__', '*', '*'],
      ['*', '_', '_'],
      ['_', '_', '_'],
    ] as const) {
      if (!s.startsWith(mk, i) || !s[i + mk.length] || s[i + mk.length] === ' ') continue;
      if (mk[0] === '_' && i > 0 && /\w/.test(s[i - 1])) continue;
      const end = s.indexOf(mk, i + mk.length);
      if (end > i + mk.length) {
        const inner = mdInline(s.slice(i + mk.length, end));
        // mitten im Wort braucht Typst die Funktionsform
        const glued = (i > 0 && /[\p{L}\p{N}]/u.test(s[i - 1])) || /[\p{L}\p{N}]/u.test(s[end + mk.length] ?? '');
        out += glued && open !== '#underline[' ? `#${open === '*' ? 'strong' : 'emph'}[${inner}]` : open + inner + close;
        i = end + mk.length;
        hit = true;
        break;
      }
    }
    if (hit) continue;
    out += tyText(c);
    i++;
  }
  return out;
}

/** Markdown (eine Zeile je Absatz) → Typst (Leerzeile zwischen Absätzen, Listen bleiben zusammen) */
export function mdToTypst(md: string | undefined): string {
  const lines = (md ?? '').replace(/\r\n?/g, '\n').split('\n');
  const item = /^\s*([-*•]|\d+[.)])\s+(.*)$/;
  const out: string[] = [];
  let prevList = false;
  for (const raw of lines) {
    const t = raw.trim();
    if (!t) continue;
    const li = item.exec(t);
    if (li) {
      if (out.length && !prevList) out.push('');
      out.push(`${/^\d/.test(li[1]) ? '+' : '-'} ${mdInline(li[2])}`);
      prevList = true;
      continue;
    }
    if (out.length) out.push('');
    let p = mdInline(t);
    // am Anfang eines Absatzes wären = - + Überschrift bzw. Liste
    if (/^[=+-]/.test(p)) p = '\\' + p;
    out.push(p);
    prevList = false;
  }
  return out.join('\n');
}

/** Typst-Auszeichnung → eine Zeile kleines Markdown */
function tyInline(s: string, line: number): string {
  let out = '';
  let i = 0;
  const mdChar = (c: string) => (MD_SPECIAL.has(c) ? '\\' + c : c);
  while (i < s.length) {
    const c = s[i];
    if (c === '\\' && i + 1 < s.length) {
      out += mdChar(s[i + 1]);
      i += 2;
      continue;
    }
    if (c === '/' && s[i + 1] === '/') {
      const e = s.indexOf('\n', i);
      i = e < 0 ? s.length : e;
      continue;
    }
    if (c === '#') {
      const m = /^#([a-zA-Z][\w-]*)/.exec(s.slice(i));
      if (!m) throw new SyntaxError(`Zeile ${line}: nach # fehlt ein Name.`);
      let j = i + m[0].length;
      const args: string[] = [];
      const strs: string[] = [];
      if (s[j] === '(') {
        const e = closingIn(s, j, '(', ')');
        if (e < 0) throw new SyntaxError(`Zeile ${line}: ) fehlt nach #${m[1]}(.`);
        const inner = s.slice(j + 1, e).trim();
        const sm = /^"((?:[^"\\]|\\.)*)"$/.exec(inner);
        if (sm) strs.push(JSON.parse(`"${sm[1]}"`));
        else if (inner) throw new SyntaxError(`Zeile ${line}: #${m[1]}(…) erwartet hier nur einen Text in Anführungszeichen.`);
        j = e + 1;
      }
      while (s[j] === '[') {
        const e = closingIn(s, j, '[', ']');
        if (e < 0) throw new SyntaxError(`Zeile ${line}: ] fehlt nach #${m[1]}[.`);
        args.push(s.slice(j + 1, e));
        j = e + 1;
      }
      const a = (k: number) => tyInline(args[k] ?? '', line);
      switch (m[1]) {
        case 'underline':
          out += `++${a(0)}++`;
          break;
        case 'highlight':
          out += `==${a(0)}==`;
          break;
        case 'footnote':
          out += `^[${a(0)}]`;
          break;
        case 'rand':
          out += `^^[${a(0)}]`;
          break;
        case 'strong':
          out += `**${a(0)}**`;
          break;
        case 'emph':
          out += `*${a(0)}*`;
          break;
        case 'begriff':
          out += strs.length ? `{${mdText(strs[0])}|${a(0)}}` : `{${a(0)}|${a(1)}}`;
          break;
        case 'link':
          out += `[${args.length ? a(0) : mdText(strs[0] ?? '')}](${strs[0] ?? ''})`;
          break;
        case 'linebreak':
          out += ' ';
          break;
        default:
          throw new SyntaxError(`Zeile ${line}: #${m[1]} kenne ich im Text nicht (erlaubt: underline, highlight, footnote, rand, begriff, link).`);
      }
      i = j;
      continue;
    }
    if (c === '*' || c === '_') {
      const end = s.indexOf(c, i + 1);
      if (end > i + 1) {
        const inner = tyInline(s.slice(i + 1, end), line);
        out += c === '*' ? `**${inner}**` : `*${inner}*`;
        i = end + 1;
        continue;
      }
    }
    if (c === '`') {
      const end = s.indexOf('`', i + 1);
      if (end > i) {
        out += s.slice(i, end + 1);
        i = end + 1;
        continue;
      }
    }
    if (c === '~') {
      out += ' ';
      i++;
      continue;
    }
    out += c === '\n' ? ' ' : mdChar(c);
    i++;
  }
  return out;
}
const mdText = (s: string) => [...s].map((c) => (MD_SPECIAL.has(c) ? '\\' + c : c)).join('');

/** Typst-Inhalt → Markdown (eine Zeile je Absatz) */
export function typstToMd(src: string, line0 = 1): string {
  const out: string[] = [];
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  let para: string[] = [];
  let paraLine = line0;
  const flush = () => {
    if (para.length) out.push(tyInline(para.join('\n').trim(), paraLine));
    para = [];
  };
  lines.forEach((raw, k) => {
    const t = raw.trim();
    const ln = line0 + k;
    if (!t) return flush();
    const li = /^([-+])\s+(.*)$/.exec(t);
    if (li) {
      flush();
      out.push(`${li[1] === '+' ? '1.' : '-'} ${tyInline(li[2], ln)}`);
      return;
    }
    if (!para.length) paraLine = ln;
    para.push(t);
  });
  flush();
  return out.filter((x) => x.trim()).join('\n');
}

// ---------- Werte in Funktionsaufrufen ----------

type V = string | number | boolean | null | { len: number; unit: string } | { content: string; line: number } | V[] | { dict: Record<string, V> };
interface Call {
  name: string;
  named: Record<string, V>;
  pos: V[];
  body: { content: string; line: number }[];
  line: number;
}

class Reader {
  i = 0;
  constructor(
    readonly s: string,
    readonly line0 = 1,
  ) {}
  get line() {
    let n = this.line0;
    for (let k = 0; k < this.i && k < this.s.length; k++) if (this.s[k] === '\n') n++;
    return n;
  }
  err(m: string): never {
    throw new SyntaxError(`Zeile ${this.line}: ${m}`);
  }
  ws() {
    for (;;) {
      while (this.i < this.s.length && /\s/.test(this.s[this.i])) this.i++;
      if (this.s.startsWith('//', this.i)) {
        const e = this.s.indexOf('\n', this.i);
        this.i = e < 0 ? this.s.length : e;
      } else if (this.s.startsWith('/*', this.i)) {
        const e = this.s.indexOf('*/', this.i);
        this.i = e < 0 ? this.s.length : e + 2;
      } else return;
    }
  }
  content(): { content: string; line: number } {
    const line = this.line;
    const e = closingIn(this.s, this.i, '[', ']');
    if (e < 0) this.err('] fehlt.');
    const c = this.s.slice(this.i + 1, e);
    this.i = e + 1;
    return { content: c, line };
  }
  value(): V {
    this.ws();
    const s = this.s;
    const c = s[this.i];
    if (c === '"') {
      const m = /^"((?:[^"\\]|\\.)*)"/.exec(s.slice(this.i));
      if (!m) this.err('Anführungszeichen " nicht geschlossen.');
      this.i += m[0].length;
      return JSON.parse(`"${m[1]}"`) as string;
    }
    if (c === '[') return this.content();
    if (c === '(') {
      this.i++;
      const arr: V[] = [];
      const dict: Record<string, V> = {};
      let isDict = false;
      this.ws();
      if (s[this.i] === ':') {
        // (:) = leeres Wörterbuch
        this.i++;
        this.ws();
        if (s[this.i] !== ')') this.err(') erwartet.');
        this.i++;
        return { dict };
      }
      while (s[this.i] !== ')') {
        if (this.i >= s.length) this.err(') fehlt.');
        const km = /^([a-zA-Z][\w-]*)\s*:/.exec(s.slice(this.i));
        if (km) {
          isDict = true;
          this.i += km[0].length;
          dict[km[1]] = this.value();
        } else arr.push(this.value());
        this.ws();
        if (s[this.i] === ',') this.i++;
        this.ws();
      }
      this.i++;
      return isDict ? { dict } : arr;
    }
    const m = /^(-?\d+(?:\.\d+)?)(mm|cm|pt|em|%|fr)?/.exec(s.slice(this.i));
    if (m) {
      this.i += m[0].length;
      return m[2] ? { len: Number(m[1]), unit: m[2] } : Number(m[1]);
    }
    const w = /^(true|false|none|auto)\b/.exec(s.slice(this.i));
    if (w) {
      this.i += w[0].length;
      return w[1] === 'true' ? true : w[1] === 'false' ? false : null;
    }
    return this.err(`Wert erwartet (Text in "…", Zahl, true/false, […] oder (…)), gefunden: „${s.slice(this.i, this.i + 12)}“.`);
  }
  call(): Call {
    const line = this.line;
    const m = /^#([a-zA-Z][\w-]*)/.exec(this.s.slice(this.i));
    if (!m) this.err('Baustein erwartet, z. B. #absatz[…] oder #aufgabe(punkte: "4")[…].');
    this.i += m[0].length;
    const c: Call = { name: m[1], named: {}, pos: [], body: [], line };
    if (this.s[this.i] === '(') {
      this.i++;
      this.ws();
      while (this.s[this.i] !== ')') {
        if (this.i >= this.s.length) this.err(`) fehlt nach #${c.name}(.`);
        const km = /^([a-zA-Z][\w-]*)\s*:/.exec(this.s.slice(this.i));
        if (km) {
          this.i += km[0].length;
          c.named[km[1]] = this.value();
        } else c.pos.push(this.value());
        this.ws();
        if (this.s[this.i] === ',') this.i++;
        this.ws();
      }
      this.i++;
    }
    while (this.s[this.i] === '[') c.body.push(this.content());
    return c;
  }
}

// ---------- Felder der Bausteine ----------

type Kind = 'str' | 'num' | 'bool' | 'content' | 'mm' | 'pct' | 'em' | 'nums';
/** [Feld im Blatt, Name im Code, Art] */
const COMMON: [keyof Block, string, Kind][] = [
  ['tpl', 'vorlage', 'str'],
  ['fs', 'groesse', 'pct'],
  ['lh', 'zeilenabstand', 'num'],
  ['ps', 'absatzabstand', 'em'],
  ['ta', 'ausrichtung', 'str'],
  ['fw', 'staerke', 'num'],
  ['ls', 'laufweite', 'em'],
  ['bd', 'fett', 'bool'],
  ['it', 'kursiv', 'bool'],
  ['ind', 'einzug', 'mm'],
  ['nm', 'notizrand', 'mm'],
  ['flow', 'textspalten', 'num'],
  ['gap', 'steg', 'mm'],
  ['breakBefore', 'neue-seite', 'bool'],
  ['keep', 'nicht-teilen', 'bool'],
  ['keepNext', 'mit-naechstem', 'bool'],
];
const PLACE: [keyof Block, string, Kind][] = [
  ['width', 'breite', 'pct'],
  ['align', 'lage', 'str'],
  ['wrap', 'umfluss', 'str'],
  ['free', 'frei', 'bool'],
  ['over', 'vor-text', 'bool'],
  ['dx', 'x', 'mm'],
  ['dy', 'y', 'mm'],
  ['caption', 'unterschrift', 'content'],
];
const FIELDS: Partial<Record<BlockType, [keyof Block, string, Kind][]>> = {
  heading: [['level', 'ebene', 'num']],
  material: [
    ['label', 'nummer', 'str'],
    ['title', 'titel', 'content'],
    ['source', 'quelle', 'content'],
    ['lineNumbers', 'zeilennummern', 'bool'],
    ['justify', 'blocksatz', 'bool'],
  ],
  quote: [['source', 'quelle', 'content']],
  box: [['text', 'titel', 'content'], ['line', 'linie', 'str']],
  task: [
    ['subtask', 'teilaufgabe', 'bool'],
    ['num', 'nummer', 'str'],
    ['points', 'punkte', 'str'],
    ['lines', 'zeilen', 'num'],
    ['lineStyle', 'linien', 'str'],
    ['line', 'linie', 'str'],
  ],
  image: [...PLACE, ['rot', 'drehung', 'num'], ['ar', 'seitenverhaeltnis', 'num']],
  chart: [['ref', 'tabelle', 'str'], ['kind', 'art', 'str'], ['gray', 'grau', 'bool'], ['hMm', 'hoehe', 'mm'], ...PLACE],
  table: [
    ['headRow', 'kopfzeile', 'bool'],
    ['grid', 'gitter', 'str'],
    ['caption', 'unterschrift', 'content'],
  ],
  glossary: [
    ['text', 'titel', 'str'],
    ['sort', 'ordnung', 'str'],
    ['mark', 'kennzeichen', 'str'],
    ['line', 'linie', 'str'],
  ],
  lines: [
    ['style', 'art', 'str'],
    ['count', 'anzahl', 'num'],
    ['fill', 'bis-ende', 'bool'],
    ['spacing', 'abstand', 'mm'],
    ['korrOff', 'ohne-korrekturrand', 'bool'],
  ],
  cols: [['ratio', 'verhaeltnis', 'nums']],
  grade: [
    ['text', 'beschriftung', 'str'],
    ['scoreTable', 'punktetabelle', 'bool'],
    ['remark', 'bemerkung', 'bool'],
    ['sign', 'unterschrift', 'bool'],
    ['qrHint', 'qr-hinweis', 'bool'],
    ['line', 'linie', 'str'],
  ],
};
const NAME: Record<BlockType, string> = {
  heading: 'ueberschrift',
  text: 'absatz',
  material: 'material',
  quote: 'zitat',
  image: 'bild',
  task: 'aufgabe',
  box: 'kasten',
  glossary: 'glossar',
  table: 'tabelle',
  chart: 'diagramm',
  cols: 'spalten',
  lines: 'linien',
  pagebreak: 'pagebreak',
  grade: 'bewertung',
};
const TYPE_OF = Object.fromEntries(Object.entries(NAME).map(([k, v]) => [v, k])) as Record<string, BlockType>;
/** Bausteine, deren Haupttext im Inhalt [ … ] steht */
const BODY: Partial<Record<BlockType, keyof Block>> = { text: 'md', material: 'md', quote: 'md', box: 'md', task: 'md', heading: 'text' };

const num = (n: number) => String(Math.round(n * 1000) / 1000);
function emit(v: unknown, kind: Kind): string {
  switch (kind) {
    case 'str':
      return tyStr(String(v));
    case 'num':
      return num(Number(v));
    case 'bool':
      return v ? 'true' : 'false';
    case 'content':
      return `[${mdToTypst(String(v))}]`;
    case 'mm':
      return `${num(Number(v))}mm`;
    case 'pct':
      return `${num(Number(v))}%`;
    case 'em':
      return `${num(Number(v))}em`;
    case 'nums':
      return `(${(v as number[]).map(num).join(', ')}${(v as number[]).length === 1 ? ',' : ''})`;
  }
}
function read(v: V, kind: Kind, what: string, line: number): unknown {
  const bad = (): never => {
    throw new SyntaxError(`Zeile ${line}: ${what} hat einen Wert der falschen Art.`);
  };
  const isLen = (x: V): x is { len: number; unit: string } => !!x && typeof x === 'object' && 'len' in x;
  switch (kind) {
    case 'str':
      return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : bad();
    case 'num':
      return typeof v === 'number' ? v : isLen(v) ? v.len : bad();
    case 'bool':
      return typeof v === 'boolean' ? v : bad();
    case 'content':
      return v && typeof v === 'object' && 'content' in v ? typstToMd(v.content, v.line) : typeof v === 'string' ? mdText(v) : bad();
    case 'mm':
      if (typeof v === 'number') return v;
      if (!isLen(v)) return bad();
      return v.unit === 'cm' ? v.len * 10 : v.unit === 'pt' ? Math.round(v.len * 0.3528 * 10) / 10 : v.len;
    case 'pct':
      return typeof v === 'number' ? v : isLen(v) ? v.len : bad();
    case 'em':
      return typeof v === 'number' ? v : isLen(v) ? v.len : bad();
    case 'nums':
      return Array.isArray(v) ? v.map((x) => (typeof x === 'number' ? x : isLen(x) ? x.len : bad())) : bad();
  }
}

// ---------- Blatt → Typst ----------

function blockCode(b: Block, ind: string): string {
  const name = NAME[b.type];
  const args: string[] = [];
  if (b.type === 'image' || b.type === 'table') args.push(tyStr(b.id));
  for (const [k, n, kind] of [...(FIELDS[b.type] ?? []), ...(b.type === 'cols' || b.type === 'lines' || b.type === 'pagebreak' || b.type === 'image' || b.type === 'chart' ? [] : COMMON)]) {
    const v = b[k];
    if (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length)) continue;
    if (b.type === 'cols' && k === 'ratio' && (v as number[]).every((x) => x === 1)) continue;
    // Schalter, die von sich aus aus sind, nur zeigen, wenn sie an sind (fett/kursiv nicht: „aus“ kann die Vorlage ändern)
    if (v === false && ['free', 'over', 'subtask', 'gray', 'breakBefore', 'keep', 'keepNext', 'korrOff', 'sign', 'remark'].includes(k)) continue;
    args.push(`${n}: ${emit(v, kind)}`);
  }
  if (b.type === 'cols' && b.gap) args.push(`steg: ${num(b.gap)}mm`);
  if (b.type === 'image' && !b.src) args.push('leer: true');
  if (b.type === 'table') {
    const rows = b.rows ?? [];
    args.push(`spalten: ${rows[0]?.length ?? 1}`);
    for (const r of rows) args.push(r.map((c) => `[${mdToTypst(c).replace(/\n\n/g, ' \\ ')}]`).join(', '));
  }
  // Überschrift schlicht als = bzw. ==
  if (b.type === 'heading' && args.length <= 1 && !/\n/.test(b.text ?? '')) {
    return `${ind}${b.level === 1 ? '=' : '=='} ${mdInline(b.text ?? '')}`;
  }
  const multi = args.length > 3 || b.type === 'table';
  const argText = multi ? `(\n${args.map((a) => `${ind}  ${a},`).join('\n')}\n${ind})` : `(${args.join(', ')})`;
  const head = `${ind}#${name}${args.length || !BODY[b.type] ? argText : ''}`;
  if (b.type === 'cols') return `${head}${(b.cols ?? []).map((col) => `[\n${col.map((x) => blockCode(x, ind + '  ')).join('\n\n')}\n${ind}]`).join('')}`;
  const bk = BODY[b.type];
  if (!bk) return head;
  const body = b.type === 'heading' ? mdInline(String(b[bk] ?? '')) : mdToTypst(String(b[bk] ?? ''));
  return `${head}[${body.includes('\n') ? `\n${body.replace(/^/gm, (m) => m + ind + '  ').replace(/^\s+$/gm, '')}\n${ind}` : body}]`;
}

const ORDER_OF = (d: BlattDoc) => (d.page.booklet ? 'broschuere' : d.page.nup ? 'zwei-je-blatt' : 'einzeln');
export function toTypst(doc: BlattDoc): string {
  const P = doc.page;
  const H = P.header;
  const F = headFields(doc);
  const out: string[] = [];
  out.push('// Arbeitsblatt als Typst-Code. Ändern und „Übernehmen“; Bilder verweisen auf ihre Nummer im Blatt.');
  out.push(
    `#blatt(\n  format: ${tyStr(P.size)},\n  quer: ${P.landscape ? 'true' : 'false'},\n  raender: ${tyStr(P.margin ?? 'normal')},\n  schrift: ${tyStr(P.font)},\n  schriftgroesse: ${num(P.fontSize)}pt,\n  seitenzahlen: ${P.pageNumbers ? 'true' : 'false'},\n  punktefelder: ${tyStr(P.earned ?? 'none')},\n${P.earnedMax === false ? '  sollpunktzahl: false,\n' : ''}  seitenfolge: ${tyStr(ORDER_OF(doc))},\n  leere-seiten: ${tyStr(P.fill)},\n  teilaufgaben: ${tyStr(P.sub ?? 'letter')},\n  wasserzeichen: ${tyStr(P.watermark ?? '')},\n  korrekturrand: (seite: ${tyStr(P.korr.side)}, breite: ${num(P.korr.width)}mm, linie: ${tyStr(P.korr.style)}),\n)`,
  );
  const fieldCode = (k: HeadKey) => {
    const f = F[k];
    const parts = [`an: ${f.on ? 'true' : 'false'}`];
    if (f.auto !== undefined) parts.push(`auto: ${f.auto ? 'true' : 'false'}`);
    if (f.value) parts.push(`text: ${tyStr(f.value)}`);
    if (f.label) parts.push(`beschriftung: ${tyStr(f.label)}`);
    if (f.row) parts.push(`zeile: ${f.row}`);
    if (f.len) parts.push(`linie: ${tyStr(f.len)}`);
    return `    ${k}: (${parts.join(', ')}),`;
  };
  out.push(
    `#kopf(\n  zeigen: ${H.show !== false ? 'true' : 'false'},\n  qr: ${tyStr(H.qr)},\n  stil: ${tyStr(H.style ?? 'line')},\n  titelgroesse: ${tyStr(H.titleSize ?? 'm')},\n${H.order?.length ? `  reihenfolge: (${H.order.map(tyStr).join(', ')}${H.order.length === 1 ? ',' : ''}),\n` : ''}  felder: (\n${HEAD_KEYS.map(({ key }) => fieldCode(key)).join('\n')}\n  ),\n)`,
  );
  out.push('');
  for (const b of doc.blocks) out.push(blockCode(b, ''), '');
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

// ---------- Typst → Blatt ----------

const isDict = (v: V | undefined): v is { dict: Record<string, V> } => !!v && typeof v === 'object' && 'dict' in v;

function parseBlocks(src: string, line0: number, prev: Map<string, Block>, prevSeq: Block[], counter: { k: number }): Block[] {
  const r = new Reader(src, line0);
  const blocks: Block[] = [];
  let text: { lines: string[]; line: number } | null = null;
  const reuse = (type: BlockType): Block => {
    // Bausteine ohne eigene Nummer behalten die Nummer des Bausteins an derselben Stelle (Auswahl, Verweise)
    const old = prevSeq[counter.k++];
    const b = newBlock(type);
    if (old?.type === type) b.id = old.id;
    for (const k of Object.keys(b) as (keyof Block)[]) if (k !== 'id' && k !== 'type' && k !== 'tpl') delete b[k];
    return b;
  };
  const flushText = () => {
    if (!text) return;
    const md = typstToMd(text.lines.join('\n'), text.line);
    if (md.trim()) blocks.push({ ...reuse('text'), md });
    text = null;
  };
  for (;;) {
    r.ws();
    if (r.i >= src.length) break;
    const rest = src.slice(r.i);
    const hm = /^(=+)\s+([^\n]*)/.exec(rest);
    if (hm && (!text || /\n\s*$/.test(src.slice(0, r.i)))) {
      flushText();
      const b = reuse('heading');
      b.level = hm[1].length === 1 ? 1 : 2;
      b.text = tyInline(hm[2].trim(), r.line);
      blocks.push(b);
      r.i += hm[0].length;
      continue;
    }
    const cm = /^#([a-zA-Z][\w-]*)/.exec(rest);
    if (cm && (TYPE_OF[cm[1]] || cm[1] === 'blatt' || cm[1] === 'kopf')) {
      flushText();
      const c = r.call();
      if (c.name === 'blatt' || c.name === 'kopf') throw new SyntaxError(`Zeile ${c.line}: #${c.name}(…) gehört an den Anfang, nicht zwischen die Bausteine.`);
      blocks.push(toBlock(c, prev, prevSeq, counter, reuse));
      continue;
    }
    // freier Text ohne Baustein: ein Erklärtext (bis zur nächsten Leerzeile vor einem Baustein)
    const e = src.indexOf('\n', r.i);
    const lineText = src.slice(r.i, e < 0 ? src.length : e);
    if (!text) text = { lines: [], line: r.line };
    text.lines.push(lineText);
    r.i = e < 0 ? src.length : e + 1;
    // Leerzeile gehört zum Text (Absatz)
    const nl = /^[ \t]*\n/.exec(src.slice(r.i));
    if (nl) {
      text.lines.push('');
      r.i += nl[0].length;
    }
  }
  flushText();
  return blocks;
}

function toBlock(c: Call, prev: Map<string, Block>, prevSeq: Block[], counter: { k: number }, reuse: (t: BlockType) => Block): Block {
  const type = TYPE_OF[c.name];
  let b: Block;
  if (type === 'image' || type === 'table') {
    const id = typeof c.pos[0] === 'string' ? c.pos[0] : '';
    const old = id ? prev.get(id) : undefined;
    counter.k++;
    b = newBlock(type);
    for (const k of Object.keys(b) as (keyof Block)[]) if (k !== 'id' && k !== 'type' && k !== 'tpl') delete b[k];
    if (id) b.id = id;
    if (type === 'image') {
      if (old?.src) b.src = old.src;
      else if (id && !c.named.leer) throw new SyntaxError(`Zeile ${c.line}: Ein Bild mit der Nummer „${id}“ gibt es im Blatt nicht. Bilder bitte über „Einfügen → Bild“ hinzufügen.`);
    }
  } else b = reuse(type);
  const known = new Set<string>(['leer', 'spalten']);
  const list = [...(FIELDS[type] ?? []), ...(type === 'cols' || type === 'lines' || type === 'pagebreak' || type === 'image' || type === 'chart' ? [] : COMMON)];
  if (type === 'cols') list.push(['gap', 'steg', 'mm']);
  for (const [k, n, kind] of list) {
    known.add(n);
    const v = c.named[n];
    if (v === undefined || v === null) continue;
    (b as unknown as Record<string, unknown>)[k] = read(v, kind, `${n} bei #${c.name}`, c.line);
  }
  for (const n of Object.keys(c.named)) if (!known.has(n)) throw new SyntaxError(`Zeile ${c.line}: #${c.name} kennt „${n}“ nicht. Möglich: ${list.map((x) => x[1]).join(', ')}.`);
  const bk = BODY[type];
  if (bk) {
    const body = c.body[0];
    (b as unknown as Record<string, unknown>)[bk] = body ? (type === 'heading' ? tyInline(body.content.trim(), body.line) : typstToMd(body.content, body.line)) : '';
  }
  if (type === 'table') {
    const cols = Math.max(1, Number(c.named.spalten) || 1);
    const cells = c.pos.slice(1).map((v) => (v && typeof v === 'object' && 'content' in v ? typstToMd(v.content.replace(/\s\\\s/g, '\n'), v.line) : typeof v === 'string' ? mdText(v) : typeof v === 'number' ? String(v) : ''));
    const rows: string[][] = [];
    for (let i = 0; i < cells.length; i += cols) rows.push(Array.from({ length: cols }, (_, j) => cells[i + j] ?? ''));
    b.rows = rows.length ? rows : [Array(cols).fill('')];
  }
  if (type === 'cols') {
    b.cols = c.body.map((x) => parseBlocks(x.content, x.line, prev, [], { k: 0 }));
    if (b.cols.length < 2) throw new SyntaxError(`Zeile ${c.line}: #spalten braucht mindestens zwei Spalten: #spalten[…][…].`);
    if (!b.ratio || b.ratio.length !== b.cols.length) b.ratio = b.cols.map(() => 1);
  }
  if (type === 'heading') b.level = b.level === 1 ? 1 : 2;
  return b;
}

/**
 * Typst-Code lesen und als neues Blatt zurückgeben. `prev` liefert Bilder (nach Nummer) und die Nummern der Bausteine.
 * Wirft SyntaxError mit Zeilenangabe.
 */
export function fromTypst(code: string, prev: BlattDoc): BlattDoc {
  const r = new Reader(code);
  const d = blankDoc();
  const page: BlattDoc['page'] = { ...prev.page, header: { ...prev.page.header }, korr: { ...prev.page.korr } };
  r.ws();
  for (;;) {
    r.ws();
    const m = /^#(blatt|kopf)\b/.exec(code.slice(r.i));
    if (!m) break;
    const c = r.call();
    const g = (n: string) => c.named[n];
    const str = (n: string, allowed?: string[]) => {
      const v = g(n);
      if (v === undefined) return undefined;
      if (typeof v !== 'string' || (allowed && !allowed.includes(v))) throw new SyntaxError(`Zeile ${c.line}: ${n} muss ${allowed ? allowed.map((x) => `"${x}"`).join(' oder ') : 'ein Text'} sein.`);
      return v;
    };
    const bool = (n: string) => (g(n) === undefined ? undefined : read(g(n)!, 'bool', n, c.line) as boolean);
    if (c.name === 'blatt') {
      const size = str('format', ['a4', 'a5']);
      if (size) page.size = size as 'a4' | 'a5';
      const q = bool('quer');
      if (q !== undefined) page.landscape = q;
      const ra = str('raender', ['normal', 'narrow', 'wide']);
      if (ra) page.margin = ra as 'normal';
      const f = str('schrift', ['sans', 'serif']);
      if (f) page.font = f as 'sans';
      if (g('schriftgroesse') !== undefined) page.fontSize = read(g('schriftgroesse')!, 'num', 'schriftgroesse', c.line) as number;
      const pf = str('punktefelder', ['none', 'box', 'line']);
      if (pf) page.earned = pf as 'box';
      const sp = bool('sollpunktzahl');
      page.earnedMax = sp === false ? false : undefined;
      const pn = bool('seitenzahlen');
      if (pn !== undefined) page.pageNumbers = pn;
      const o = str('seitenfolge', ['einzeln', 'zwei-je-blatt', 'broschuere']);
      if (o) {
        page.booklet = o === 'broschuere';
        page.nup = o === 'zwei-je-blatt';
      }
      const fill = str('leere-seiten', ['lines', 'grid', 'empty']);
      if (fill) page.fill = fill as 'lines';
      const sub = str('teilaufgaben', ['letter', 'dot']);
      if (sub) page.sub = sub as 'letter';
      const wm = str('wasserzeichen');
      if (wm !== undefined) page.watermark = wm;
      const k = g('korrekturrand');
      if (k !== undefined) {
        if (!isDict(k)) throw new SyntaxError(`Zeile ${c.line}: korrekturrand: (seite: "right", breite: 30mm, linie: "thin").`);
        const kd = k.dict;
        if (kd.seite !== undefined) page.korr.side = read(kd.seite, 'str', 'seite', c.line) as 'right';
        if (kd.breite !== undefined) page.korr.width = read(kd.breite, 'mm', 'breite', c.line) as number;
        if (kd.linie !== undefined) page.korr.style = read(kd.linie, 'str', 'linie', c.line) as 'thin';
      }
    } else {
      const H = page.header;
      const z = bool('zeigen');
      if (z !== undefined) H.show = z;
      const qr = str('qr', ['none', 'first', 'all']);
      if (qr) H.qr = qr as 'none';
      const sti = str('stil', ['line', 'box', 'none']);
      if (sti) H.style = sti as 'line';
      const ts = str('titelgroesse', ['s', 'm', 'l']);
      if (ts) H.titleSize = ts as 'm';
      const ro = g('reihenfolge');
      if (Array.isArray(ro)) H.order = ro.filter((x): x is HeadKey => typeof x === 'string' && HEAD_KEYS.some((h) => h.key === x));
      const fe = g('felder');
      if (isDict(fe)) {
        const F = headFields({ ...prev, page });
        for (const [k, v] of Object.entries(fe.dict)) {
          if (!HEAD_KEYS.some((h) => h.key === k)) throw new SyntaxError(`Zeile ${c.line}: Feld „${k}“ gibt es nicht (${HEAD_KEYS.map((h) => h.key).join(', ')}).`);
          if (!isDict(v)) continue;
          const x = v.dict;
          const f: HeadField = { on: x.an === undefined ? F[k as HeadKey].on : !!x.an };
          if (typeof x.auto === 'boolean') f.auto = x.auto;
          if (typeof x.text === 'string' && x.text) f.value = x.text;
          if (typeof x.beschriftung === 'string' && x.beschriftung) f.label = x.beschriftung;
          if (x.zeile === 1 || x.zeile === 2) f.row = x.zeile;
          if (x.linie === 's' || x.linie === 'm' || x.linie === 'l') f.len = x.linie;
          F[k as HeadKey] = f;
        }
        H.fields = F;
      }
    }
  }
  const prevById = new Map(walk(prev.blocks).map((b) => [b.id, b]));
  const blocks = parseBlocks(code.slice(r.i), r.line, prevById, prev.blocks, { k: 0 });
  return { ...d, ...prev, page, blocks };
}
