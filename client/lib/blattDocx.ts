/**
 * Arbeitsblatt als Word-Datei (.docx) (Wunsch Jo, 24. November 2026: Reiter „Datei“ mit Exportoptionen).
 *
 * Schreibt ein schlichtes, gut weiterbearbeitbares Word-Dokument: Kopf mit Rahmendaten, Überschriften, Materialien
 * (Quelle als Fußnote), Zitate, Kästen, Aufgaben mit Nummer, Punkten und Antwortlinien, Tabellen, Bilder und Diagramme
 * (als PNG), Glossar. Fußnoten sind echte Word-Fußnoten; Randbemerkungen stehen kursiv in Klammern im Text.
 * Der Seitensatz (Umbruch, Spalten, Broschüre) bleibt Sache von Word. Ohne Abhängigkeiten außer dem kleinen ZIP.
 */
import { type BlattDoc, type Block, type HeadCtx, chartSvg, cornerText, glossaryTerms, headCorners, LINE_MM, pageGeom, plainMd, shownBlocks, svgSrc, taskLabels, totalPoints, walk } from './blatt';
import { makeZip } from './zip';
import { effectImage, hasFx, imageFilter } from './blattImage';

const xe = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const TW = 56.6929; // twips je mm
const EMU = 36000; // EMU je mm

interface Run {
  t: string;
  b?: boolean;
  i?: boolean;
  u?: boolean;
  h?: boolean;
  sup?: boolean;
  fn?: Run[];
}

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

/** eine Zeile kleines Markdown → Textstücke mit Auszeichnung */
function runs(s: string, base: Omit<Run, 't'> = {}): Run[] {
  const out: Run[] = [];
  let buf = '';
  const flush = () => {
    if (buf) out.push({ ...base, t: buf });
    buf = '';
  };
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === '\\' && i + 1 < s.length) {
      buf += s[i + 1];
      i += 2;
      continue;
    }
    if (c === '^' && (s.startsWith('^[', i) || s.startsWith('^^[', i))) {
      const margin = s.startsWith('^^[', i);
      const start = i + (margin ? 2 : 1);
      const end = closing(s, start, '[', ']');
      if (end > 0) {
        flush();
        const inner = s.slice(start + 1, end);
        if (margin) out.push({ t: ' (' }, ...runs(inner, { ...base, i: true }), { t: ')' });
        else out.push({ t: '', fn: runs(inner) });
        i = end + 1;
        continue;
      }
    }
    if (c === '{') {
      const end = closing(s, i, '{', '}');
      const bar = end > 0 ? s.indexOf('|', i) : -1;
      if (end > 0 && bar > i && bar < end) {
        flush();
        out.push(...runs(s.slice(i + 1, bar), base), { t: '*', sup: true });
        i = end + 1;
        continue;
      }
    }
    if (s.startsWith('==', i) && s[i + 2] && s[i + 2] !== ' ') {
      const end = s.indexOf('==', i + 2);
      if (end > i + 2) {
        flush();
        out.push(...runs(s.slice(i + 2, end), { ...base, h: true }));
        i = end + 2;
        continue;
      }
    }
    if (c === '[') {
      const end = closing(s, i, '[', ']');
      if (end > 0 && s[end + 1] === '(') {
        const pe = closing(s, end + 1, '(', ')');
        if (pe > 0) {
          flush();
          out.push(...runs(s.slice(i + 1, end), base));
          i = pe + 1;
          continue;
        }
      }
    }
    let hit = false;
    for (const [mk, k] of [
      ['++', 'u'],
      ['**', 'b'],
      ['__', 'b'],
      ['*', 'i'],
      ['_', 'i'],
    ] as const) {
      if (!s.startsWith(mk, i) || !s[i + mk.length] || s[i + mk.length] === ' ') continue;
      if (mk[0] === '_' && i > 0 && /\w/.test(s[i - 1])) continue;
      const end = s.indexOf(mk, i + mk.length);
      if (end > i + mk.length) {
        flush();
        out.push(...runs(s.slice(i + mk.length, end), { ...base, [k]: true }));
        i = end + mk.length;
        hit = true;
        break;
      }
    }
    if (hit) continue;
    buf += c;
    i++;
  }
  flush();
  return out;
}

interface Ctx {
  fns: string[];
  media: { name: string; data: Uint8Array }[];
  rels: string[];
  width: number;
}

function runXml(r: Run, ctx: Ctx): string {
  if (r.fn) {
    const id = ctx.fns.length + 1;
    ctx.fns.push(`<w:footnote w:id="${id}"><w:p><w:pPr><w:pStyle w:val="FootnoteText"/></w:pPr><w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr><w:footnoteRef/></w:r><w:r><w:t xml:space="preserve"> </w:t></w:r>${r.fn.map((x) => runXml(x, ctx)).join('')}</w:p></w:footnote>`);
    return `<w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr><w:footnoteReference w:id="${id}"/></w:r>`;
  }
  const pr = [r.b && '<w:b/>', r.i && '<w:i/>', r.u && '<w:u w:val="single"/>', r.h && '<w:highlight w:val="yellow"/>', r.sup && '<w:vertAlign w:val="superscript"/>'].filter(Boolean).join('');
  return `<w:r>${pr ? `<w:rPr>${pr}</w:rPr>` : ''}<w:t xml:space="preserve">${xe(r.t)}</w:t></w:r>`;
}

const pPr = (o: { style?: string; align?: string; ind?: number; hanging?: number; border?: boolean; keep?: boolean; after?: number; shade?: string; tabs?: string }) =>
  `<w:pPr>${o.style ? `<w:pStyle w:val="${o.style}"/>` : ''}${o.keep ? '<w:keepNext/>' : ''}${o.border ? '<w:pBdr><w:bottom w:val="single" w:sz="4" w:space="1" w:color="808080"/></w:pBdr>' : ''}${o.shade ? `<w:shd w:val="clear" w:color="auto" w:fill="${o.shade}"/>` : ''}${o.tabs ?? ''}${o.after !== undefined ? `<w:spacing w:after="${o.after}"/>` : ''}${o.ind || o.hanging ? `<w:ind w:left="${Math.round((o.ind ?? 0) * TW)}"${o.hanging ? ` w:hanging="${Math.round(o.hanging * TW)}"` : ''}/>` : ''}${o.align ? `<w:jc w:val="${o.align}"/>` : ''}</w:pPr>`;

function para(rs: Run[], ctx: Ctx, o: Parameters<typeof pPr>[0] = {}): string {
  return `<w:p>${pPr(o)}${rs.map((r) => runXml(r, ctx)).join('')}</w:p>`;
}
const ALIGN: Record<string, string> = { left: 'left', center: 'center', right: 'right', justify: 'both' };

/** Markdown-Absätze (eine Zeile je Absatz, Listen mit - und 1.) */
function mdParas(md: string | undefined, ctx: Ctx, o: Parameters<typeof pPr>[0] = {}, base: Omit<Run, 't'> = {}): string {
  const out: string[] = [];
  let n = 0;
  for (const raw of (md ?? '').replace(/\r\n?/g, '\n').split('\n')) {
    const t = raw.trim();
    if (!t) continue;
    const li = /^([-*•]|\d+[.)])\s+(.*)$/.exec(t);
    if (li) {
      const ordered = /^\d/.test(li[1]);
      n = ordered ? n + 1 : 0;
      out.push(para([{ t: ordered ? `${n}.\t` : '•\t' }, ...runs(li[2], base)], ctx, { ...o, ind: (o.ind ?? 0) + 6, hanging: 6, after: 40 }));
      continue;
    }
    n = 0;
    const h = /^#{1,3}\s+(.*)$/.exec(t);
    out.push(h ? para(runs(h[1], { ...base, b: true }), ctx, { ...o, keep: true }) : para(runs(t.replace(/^>\s?/, ''), base), ctx, o));
  }
  return out.join('');
}

function dataUrlBytes(src: string): { data: Uint8Array; ext: string } | null {
  const m = /^data:image\/(png|jpe?g|gif);base64,(.*)$/.exec(src);
  if (!m) return null;
  const bin = atob(m[2]);
  const data = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) data[i] = bin.charCodeAt(i);
  return { data, ext: m[1] === 'jpg' ? 'jpeg' : m[1] };
}
/** Bild als PNG (andere Formate und SVG über eine Leinwand) */
async function toPng(src: string, wPx?: number, look?: { filter?: string; frame?: number }): Promise<{ data: Uint8Array; ext: string; ar: number } | null> {
  const img = new Image();
  img.src = src;
  try {
    await img.decode();
  } catch {
    return null;
  }
  const ar = img.naturalHeight / Math.max(1, img.naturalWidth);
  const direct = dataUrlBytes(src);
  if (direct && !wPx && !look?.filter && !look?.frame) return { ...direct, ar };
  const c = document.createElement('canvas');
  c.width = wPx ?? img.naturalWidth;
  c.height = Math.round(c.width * ar);
  const g = c.getContext('2d')!;
  g.fillStyle = '#fff';
  g.fillRect(0, 0, c.width, c.height);
  // Helligkeit, Kontrast, Graustufen und Rahmen ins Bild übernehmen (Word kennt die Filter nicht)
  if (look?.filter) g.filter = look.filter;
  g.drawImage(img, 0, 0, c.width, c.height);
  g.filter = 'none';
  if (look?.frame) {
    // Linienstärke als Anteil der Bildbreite
    const lw = Math.max(1, Math.round(look.frame * c.width));
    g.strokeStyle = '#333';
    g.lineWidth = lw;
    g.strokeRect(lw / 2, lw / 2, c.width - lw, c.height - lw);
  }
  const bytes = dataUrlBytes(c.toDataURL('image/png'));
  return bytes ? { ...bytes, ar } : null;
}

function drawing(ctx: Ctx, data: Uint8Array, ext: string, wMm: number, hMm: number): string {
  const n = ctx.media.length + 1;
  const name = `image${n}.${ext}`;
  ctx.media.push({ name, data });
  const rid = `rIdImg${n}`;
  ctx.rels.push(`<Relationship Id="${rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${name}"/>`);
  const cx = Math.round(wMm * EMU);
  const cy = Math.round(hMm * EMU);
  return `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${n}" name="Bild ${n}"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${n}" name="${name}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
}

/** Schreiblinien: Tabulator mit Unterstrich bis zum rechten Rand (Rahmenlinien würde Word zusammenfassen) */
function answerLines(n: number, ctx: Ctx, mm = 8, ind = 0): string {
  const line = Math.round(mm * TW);
  const p = `<w:p><w:pPr><w:tabs><w:tab w:val="right" w:leader="underscore" w:pos="${Math.round(ctx.width * TW)}"/></w:tabs><w:spacing w:before="0" w:after="0" w:line="${line}" w:lineRule="exact"/>${ind ? `<w:ind w:left="${Math.round(ind * TW)}"/>` : ''}</w:pPr><w:r><w:rPr><w:color w:val="808080"/></w:rPr><w:tab/></w:r></w:p>`;
  return p.repeat(Math.max(0, n));
}

/** WordArt/Form aus dem Pinnwand-Editor als Bild */
async function svgPara(b: Block, ctx: Ctx, def: number): Promise<string> {
  const w = (ctx.width * Math.max(10, Math.min(100, b.width ?? def))) / 100;
  const img = await toPng(svgSrc(b.svg ?? ''), Math.round(w * 8));
  if (!img) return '';
  return `<w:p>${pPr({ align: b.align ?? 'center' })}${drawing(ctx, img.data, img.ext, w, w * img.ar)}</w:p>`;
}

async function blockXml(b: Block, doc: BlattDoc, ctx: Ctx, st: { mat: number; labels: Map<string, string> }): Promise<string> {
  const al = b.ta ? ALIGN[b.ta] : undefined;
  const base: Omit<Run, 't'> = { b: b.bd || undefined, i: b.it || undefined };
  switch (b.type) {
    case 'heading':
      return para(runs(b.text ?? ''), ctx, { style: b.level === 1 ? 'Heading1' : 'Heading2', keep: true });
    case 'text':
      return mdParas(b.md, ctx, { align: al, ind: b.ind }, base);
    case 'material': {
      st.mat++;
      const label = (b.label ?? '').trim() || `Material ${st.mat}`;
      const title: Run[] = [{ t: label, b: true }, ...(b.title?.trim() ? [{ t: ': ', b: true }, ...runs(b.title, { b: true })] : [])];
      if (b.source?.trim()) title.push({ t: '', fn: runs(b.source) });
      return para(title, ctx, { keep: true }) + mdParas(b.md, ctx, { align: b.justify === false ? undefined : (al ?? 'both'), ind: 6 }, base);
    }
    case 'quote':
      return mdParas(b.md, ctx, { style: 'Quote', align: al ?? 'center' }, base) + (b.source?.trim() ? para(runs(b.source, { i: true }), ctx, { align: 'center' }) : '');
    case 'box':
      return (b.text?.trim() ? para(runs(b.text, { b: true }), ctx, { shade: 'EEF2F7', keep: true }) : '') + mdParas(b.md, ctx, { shade: 'EEF2F7', align: al }, base);
    case 'task': {
      const label = st.labels.get(b.id) ?? '';
      const lines = (b.md ?? '').split('\n').filter((x) => x.trim());
      const earned = doc.page.earned && doc.page.earned !== 'none';
      const showMax = doc.page.earnedMax !== false && !!b.points?.trim();
      const maxT = showMax ? ` / ${b.points!.trim()}` : '';
      const field = doc.page.earned === 'box' ? (showMax ? `[      ${maxT.trim()} ]` : '[      ]') : `______${maxT}`;
      const inline = b.points?.trim() && (!earned || !showMax) ? [{ t: ` ${b.points.trim()}`, b: true }] : [];
      const pts = earned ? [...inline, { t: `\t${field}`, b: true }] : b.points?.trim() ? [{ t: `\t${b.points.trim()}`, b: true }] : [];
      const ind = b.subtask ? 16 : 8;
      const tabs = `<w:tabs><w:tab w:val="right" w:pos="${Math.round(ctx.width * TW)}"/></w:tabs>`;
      const first = para([{ t: `${label}\t`, b: base.b }, ...runs(lines[0] ?? '', base), ...pts], ctx, { ind, hanging: 8, tabs });
      const rest = mdParas(lines.slice(1).join('\n'), ctx, { ind }, base);
      return first + rest + (b.lines ? answerLines(b.lines, ctx, 8, ind) : '');
    }
    case 'image': {
      if (!b.src) return '';
      const w = (ctx.width * Math.min(100, b.width ?? 100)) / 100;
      let filter = imageFilter(b);
      let src = b.src;
      if (hasFx(b)) {
        src = await effectImage(b.src, { filter, poster: b.poster, dither: b.dither });
        filter = '';
      }
      const img = await toPng(src, undefined, filter || b.frame ? { filter, frame: b.frame ? LINE_MM[b.frame] / w : 0 } : undefined);
      if (!img) return '';
      const rot = ((Number(b.rot) || 0) % 180) !== 0;
      const h = rot ? w / Math.max(0.05, img.ar) : w * img.ar;
      return `<w:p>${pPr({ align: b.align ?? 'center', keep: !!b.caption })}${drawing(ctx, img.data, img.ext, w, h)}</w:p>` + (b.caption?.trim() ? para(runs(b.caption), ctx, { style: 'Caption', align: b.align ?? 'center' }) : '');
    }
    case 'chart': {
      const t = b.ref ? walk(doc.blocks).find((x) => x.id === b.ref) : undefined;
      if (!t?.rows) return '';
      const w = (ctx.width * Math.min(100, b.width ?? 90)) / 100;
      const h = b.hMm ?? 60;
      const svg = chartSvg(t.rows, b.kind ?? 'col', w, h, !!b.gray);
      const src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg.includes('xmlns') ? svg : svg.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"'));
      const img = await toPng(src, Math.round(w * 8));
      if (!img) return '';
      return `<w:p>${pPr({ align: b.align ?? 'center' })}${drawing(ctx, img.data, img.ext, w, w * img.ar)}</w:p>` + (b.caption?.trim() ? para(runs(b.caption), ctx, { style: 'Caption', align: b.align ?? 'center' }) : '');
    }
    case 'table': {
      const rows = b.rows ?? [];
      const n = rows[0]?.length ?? 1;
      const colW = Math.round((ctx.width * TW) / n);
      const border = b.grid === 'none' ? 'nil' : 'single';
      const inner = b.grid === 'rows' ? 'nil' : border;
      const tbl = `<w:tbl><w:tblPr><w:tblW w:w="${colW * n}" w:type="dxa"/><w:tblBorders><w:top w:val="${border}" w:sz="4"/><w:bottom w:val="${border}" w:sz="4"/><w:left w:val="${inner}" w:sz="4"/><w:right w:val="${inner}" w:sz="4"/><w:insideH w:val="${border}" w:sz="4"/><w:insideV w:val="${inner}" w:sz="4"/></w:tblBorders></w:tblPr><w:tblGrid>${Array(n).fill(`<w:gridCol w:w="${colW}"/>`).join('')}</w:tblGrid>${rows
        .map(
          (r, ri) =>
            `<w:tr>${r.map((c) => `<w:tc><w:tcPr><w:tcW w:w="${colW}" w:type="dxa"/>${ri === 0 && b.headRow !== false ? '<w:shd w:val="clear" w:color="auto" w:fill="E8ECF2"/>' : ''}</w:tcPr>${mdParas(c || ' ', ctx, { after: 0 }, ri === 0 && b.headRow !== false ? { b: true } : {}) || '<w:p/>'}</w:tc>`).join('')}</w:tr>`,
        )
        .join('')}</w:tbl>`;
      return tbl + (b.caption?.trim() ? para(runs(b.caption), ctx, { style: 'Caption' }) : para([{ t: '' }], ctx));
    }
    case 'glossary': {
      const terms = glossaryTerms(doc).filter((t) => t.word);
      if (!terms.length) return '';
      return para(runs(b.text?.trim() || 'Glossar'), ctx, { style: 'Heading2', keep: true }) + terms.map((t) => para([{ t: t.word, b: true }, { t: ': ' }, ...runs(t.explain ?? '')], ctx, { ind: 6, hanging: 6 })).join('');
    }
    case 'lines':
      return b.style === 'empty' ? '' : answerLines(b.fill ? 12 : (b.count ?? 8), ctx, b.spacing ?? 8);
    case 'pagebreak':
      return '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
    // Formel als LaTeX-Text, WordArt fett und groß, Form als Kasten mit Text (Word-Formeln/-Formen später)
    case 'formula':
      return b.text?.trim() ? para([{ t: b.text.trim(), i: true }], ctx, { align: b.align ?? 'center' }) : '';
    case 'wordart':
      if (b.svg) return svgPara(b, ctx, 60);
      return b.text?.trim() ? para([{ t: b.text.trim(), b: true }], ctx, { style: 'Title', align: b.align ?? 'center' }) : '';
    case 'shape':
      if (b.svg) return svgPara(b, ctx, 40);
      return b.text?.trim() ? para(runs(b.text), ctx, { shade: (b.color ?? '#e8f0fb').replace('#', '').toUpperCase().padEnd(6, '0').slice(0, 6), align: 'center' }) : '';
    case 'grade': {
      const scores = walk(doc.blocks).filter((x) => x.type === 'task' && x.points?.trim() && !/%/.test(x.points));
      const out: string[] = [];
      if (b.scoreTable !== false && scores.length) {
        const n = scores.length + 2;
        const colW = Math.round((ctx.width * TW) / n);
        const cell = (t: string, bold = false) => `<w:tc><w:tcPr><w:tcW w:w="${colW}" w:type="dxa"/></w:tcPr>${para(t ? [{ t, b: bold }] : [], ctx, { align: 'center', after: 0 })}</w:tc>`;
        const max = scores.map((x) => x.points!.trim().replace(/\s*(p\.?|pkt\.?|punkte?|be)\s*$/i, ''));
        const sum = max.reduce((a, x) => a + (Number(x.replace(',', '.').match(/\d+(?:\.\d+)?/)?.[0]) || 0), 0);
        const row = (cells: string[], bold = false) => `<w:tr><w:trPr><w:trHeight w:val="${Math.round(8 * TW)}"/></w:trPr>${cells.map((c, i) => cell(c, bold || i === 0)).join('')}</w:tr>`;
        const sz = Math.max(2, Math.round(LINE_MM[b.line ?? 'thin'] * 2.835 * 8));
        const bd = (k: string) => `<w:${k} w:val="single" w:sz="${sz}" w:color="777777"/>`;
        out.push(
          `<w:tbl><w:tblPr><w:tblW w:w="${colW * n}" w:type="dxa"/><w:tblBorders>${['top', 'bottom', 'left', 'right', 'insideH', 'insideV'].map(bd).join('')}</w:tblBorders></w:tblPr><w:tblGrid>${Array(n).fill(`<w:gridCol w:w="${colW}"/>`).join('')}</w:tblGrid>` +
            row(['Aufgabe', ...scores.map((x) => (st.labels.get(x.id) ?? '').replace(/[.)]$/, '')), 'Summe'], true) +
            row(['mögliche Punkte', ...max, sum ? String(sum).replace('.', ',') : '']) +
            row(['erreichte Punkte', ...max.map(() => ''), '']) +
            '</w:tbl>',
        );
      }
      out.push(para([{ t: `${b.text?.trim() || 'Note'}: `, b: true }, { t: '[            ]' }], ctx, { after: 120 }));
      if (b.remark) out.push(para([{ t: 'Bemerkung: ' }, { t: '_'.repeat(60) }], ctx));
      if (b.sign) out.push(para([{ t: 'Unterschrift: ' }, { t: '_'.repeat(30) }], ctx));
      if (b.qrHint !== false && doc.page.header.show !== false && doc.page.header.qr !== 'none') out.push(para([{ t: 'Scannen Sie für ein genaues Feedback erneut den QR-Code.', i: true }], ctx));
      return out.join('');
    }
    case 'cols': {
      // Spalten nacheinander (Word-Abschnitte mit Spalten würden den Satz verschieben)
      const parts: string[] = [];
      for (const col of b.cols ?? []) for (const x of col) parts.push(await blockXml(x, doc, ctx, st));
      return parts.join('');
    }
  }
  return '';
}

function headXml(doc: BlattDoc, head: HeadCtx, ctx: Ctx): string {
  const H = doc.page.header;
  if (H.show === false) return '';
  // vier Eckfelder als randlose Tabelle: links Titel und Name, rechts Datum und Punkte
  const C = headCorners(doc);
  const sum = totalPoints(doc);
  const tok = (k: string): string | null =>
    k === 'Titel' ? head.title ?? '' : k === 'Name' ? '_'.repeat(28) : k === 'Klasse' || k === 'Kurs' ? head.course || '_'.repeat(8) : k === 'Lehrkraft' ? head.teacher || '_'.repeat(16) : k === 'Datum' ? new Date().toLocaleDateString('de-DE') : k === 'Punkte' ? `${'_'.repeat(8)}${sum !== null ? ' / ' + String(sum).replace('.', ',') : ''}` : null;
  const cell = (k: 'tl' | 'tr' | 'bl' | 'br', w: number) => {
    const lines = cornerText(C[k], tok).split('\n').filter((l, i, a) => l.trim() || a.length === 1);
    const ps = lines.map((l, i) => (k === 'tl' && i === 0 && l.trim() ? para(runs(l), ctx, { style: 'Title' }) : para(runs(l), ctx, { align: k.endsWith('r') ? 'right' : undefined, after: 40 }))).join('') || '<w:p/>';
    return `<w:tc><w:tcPr><w:tcW w:w="${w}" w:type="dxa"/><w:vAlign w:val="${k.startsWith('t') ? 'top' : 'bottom'}"/></w:tcPr>${ps}</w:tc>`;
  };
  const W = Math.round(ctx.width * TW);
  const wl = Math.round(W * 0.6);
  const wr = W - wl;
  const bottom = H.style === 'none' ? 'nil' : 'single';
  const box = H.style === 'box' ? 'single' : 'nil';
  return (
    `<w:tbl><w:tblPr><w:tblW w:w="${W}" w:type="dxa"/><w:tblBorders><w:top w:val="${box}" w:sz="6"/><w:left w:val="${box}" w:sz="6"/><w:bottom w:val="${bottom}" w:sz="6"/><w:right w:val="${box}" w:sz="6"/><w:insideH w:val="nil"/><w:insideV w:val="nil"/></w:tblBorders><w:tblCellMar><w:left w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid><w:gridCol w:w="${wl}"/><w:gridCol w:w="${wr}"/></w:tblGrid>` +
    `<w:tr>${cell('tl', wl)}${cell('tr', wr)}</w:tr><w:tr>${cell('bl', wl)}${cell('br', wr)}</w:tr></w:tbl>` +
    para([], ctx, { after: 120 })
  );
}

const STYLES = (font: string, size: number) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="${font}" w:hAnsi="${font}" w:cs="${font}"/><w:sz w:val="${Math.round(size * 2)}"/><w:lang w:val="de-DE"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="300" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="80"/></w:pPr><w:rPr><w:b/><w:sz w:val="${Math.round(size * 2.8)}"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="120"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="${Math.round(size * 2.6)}"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="200" w:after="80"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:u w:val="single"/><w:sz w:val="${Math.round(size * 2.2)}"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:qFormat/><w:rPr><w:i/><w:sz w:val="${Math.round(size * 2.4)}"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Caption"><w:name w:val="caption"/><w:basedOn w:val="Normal"/><w:qFormat/><w:rPr><w:sz w:val="${Math.round(size * 1.7)}"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="FootnoteText"><w:name w:val="footnote text"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:rPr><w:sz w:val="${Math.round(size * 1.6)}"/></w:rPr></w:style></w:styles>`;

/** Blatt als .docx-Datei */
export async function toDocx(doc: BlattDoc, head: HeadCtx): Promise<Blob> {
  doc = { ...doc, blocks: shownBlocks(doc.blocks) };
  const g = pageGeom(doc);
  const ctx: Ctx = { fns: [], media: [], rels: [], width: g.w - 2 * g.m };
  const st = { mat: 0, labels: taskLabels(doc) };
  const parts = [headXml(doc, head, ctx)];
  for (const b of doc.blocks) parts.push(await blockXml(b, doc, ctx, st));
  if (doc.page.watermark?.trim()) parts.unshift(para([{ t: doc.page.watermark.trim(), b: true }], ctx, { align: 'right' }));
  const W = Math.round(g.w * TW);
  const Hh = Math.round(g.h * TW);
  const M = Math.round(g.m * TW);
  const footer = doc.page.pageNumbers;
  const body = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>${parts.join('')}<w:sectPr>${footer ? '<w:footerReference w:type="default" r:id="rIdFooter"/>' : ''}<w:footnotePr><w:numFmt w:val="decimal"/></w:footnotePr><w:pgSz w:w="${W}" w:h="${Hh}"${doc.page.landscape ? ' w:orient="landscape"' : ''}/><w:pgMar w:top="${M}" w:right="${M}" w:bottom="${M}" w:left="${M}" w:header="${Math.round(M / 2)}" w:footer="${Math.round(M / 2)}" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  const footnotes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:footnotes xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote><w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>${ctx.fns.join('')}</w:footnotes>`;
  const footerXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t xml:space="preserve">Seite </w:t></w:r><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>1</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r><w:r><w:t xml:space="preserve"> von </w:t></w:r><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> NUMPAGES </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>1</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p></w:ftr>`;
  const types = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="jpeg" ContentType="image/jpeg"/><Default Extension="gif" ContentType="image/gif"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/><Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`;
  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`;
  const docRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rIdFootnotes" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes" Target="footnotes.xml"/><Relationship Id="rIdFooter" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>${ctx.rels.join('')}</Relationships>`;
  const core = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xe(head.title ?? "")}</dc:title><dc:creator>Collegare</dc:creator></cp:coreProperties>`;
  const font = doc.page.font === 'serif' ? 'Linux Libertine G' : 'Carlito';
  const enc = new TextEncoder();
  const entries = [
    { name: '[Content_Types].xml', data: enc.encode(types) },
    { name: '_rels/.rels', data: enc.encode(rootRels) },
    { name: 'docProps/core.xml', data: enc.encode(core) },
    { name: 'word/document.xml', data: enc.encode(body) },
    { name: 'word/_rels/document.xml.rels', data: enc.encode(docRels) },
    { name: 'word/styles.xml', data: enc.encode(STYLES(font, doc.page.fontSize)) },
    { name: 'word/footnotes.xml', data: enc.encode(footnotes) },
    { name: 'word/footer1.xml', data: enc.encode(footerXml) },
    ...ctx.media.map((m) => ({ name: `word/media/${m.name}`, data: m.data })),
  ];
  return makeZip(entries);
}

/** Text ohne Auszeichnung (für Dateinamen) */
export const docxName = (title: string) => (plainMd(title).replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'Arbeitsblatt') + '.docx';
