/**
 * Die Web-Services von mod_pinnwand (classes/external.php), nachgebaut für Collegare (Konzept 8d.5). Methodennamen,
 * Argumente und Antworten bleiben gleich, damit dieselbe Oberfläche (js/app.js) in Moodle und in Collegare läuft.
 *
 * Anders als in Moodle gehört eine Pinnwand nicht einer Person, sondern dem Bereich: alle einer Gruppe (im Einzelmodus
 * die Person) arbeiten als dieselbe „Person“ (USER = 1) an denselben Boards. Lehrkräfte arbeiten mit und haben die
 * Rechte viewall und manage.
 */
import { PinError, type PinFile, type Row, type Scope } from './store.js';

export interface PinCtx {
  s: Scope;
  /** Name, unter dem die Pinnwand des Bereichs auftritt (Gruppe bzw. Person) */
  fullname: string;
  teacher: boolean;
  /** Pfad vor /api, z. B. /collegare */
  base: string;
  /** Grenze für Dateien in Bytes */
  maxBytes: number;
}

/** Einstellungen der Aktivität (Tabelle pinnwand), in Collegare fest für Gruppenarbeit */
export const INSTANCE = {
  maxpictures: 0,
  allowconsent: 0,
  boarddefault: 1,
  studentcansend: 1,
  teachercansend: 1,
  studentclassview: 0,
  boardpannable: 1,
  startmode: 'overview',
  sidebaropacity: 92,
  studentboardclone: 1,
  studentboardcreate: 1,
  studentseeotherboards: 0,
  studentthreads: 1,
  studentpoststream: 1,
  studentlayers: 1,
  formulatransform: 0,
  formulacalc: 0,
};

const ME = 1;
type A = Record<string, any>;
const int = (v: unknown, d = 0) => (v === undefined || v === null || v === '' ? d : Math.trunc(Number(v)) || 0);
const num = (v: unknown, d = 0) => (v === undefined || v === null || v === '' ? d : Number(v) || 0);
const raw = (v: unknown, d = '') => (v === undefined || v === null ? d : String(v));
/** PARAM_TEXT: ohne HTML */
const text = (v: unknown, d = '') => raw(v, d).replace(/<[^>]*>/g, '');
const bool = (v: unknown) => v === true || v === 1 || v === '1' || v === 'true';
const sec = (s: Scope) => Math.floor(s.now() / 1000);
const hex6 = (c: unknown, d: string) => (/^#[0-9a-fA-F]{6}$/.test(String(c ?? '')) ? String(c) : d);

function deny(what: string): never {
  throw new PinError('nopermissions:' + what);
}

function dataUrl(v: string, kinds: RegExp): { ext: string; bin: Buffer; mime: string } | null {
  const m = /^data:([a-z]+\/[a-z0-9.+-]+);base64,(.+)$/s.exec(v);
  if (!m || !kinds.test(m[1])) return null;
  const bin = Buffer.from(m[2], 'base64');
  const ext = m[1] === 'image/png' ? 'png' : m[1] === 'image/svg+xml' ? 'svg' : m[1] === 'application/pdf' ? 'pdf' : 'jpg';
  return { ext, bin, mime: m[1] === 'image/jpg' ? 'image/jpeg' : m[1] };
}

function fileUrl(c: PinCtx, f: PinFile | undefined, v?: number): string {
  if (!f) return '';
  return `${c.base}/api/projects/${c.s.projectId}/pinnwand/${c.s.scope}/datei/${f.id}/${encodeURIComponent(f.name)}${v ? '?v=' + v : ''}`;
}
const areaUrl = (c: PinCtx, area: string, id: number, v?: number) => fileUrl(c, c.s.areaFiles(area, id)[0], v);

function effectiveMax(c: PinCtx) {
  return c.teacher ? 0 : INSTANCE.maxpictures;
}
const canViewClass = (c: PinCtx) => c.teacher || !!INSTANCE.studentclassview;
const canUseThreads = (c: PinCtx) => c.teacher || !!INSTANCE.studentthreads;

function ownPhoto(c: PinCtx, id: unknown, what: string): Row {
  const p = c.s.get('photos', int(id));
  if (!p) throw new PinError('invalidrecord');
  if (p.userid != ME) deny(what);
  return p;
}

async function storePhotoEdit(c: PinCtx, photo: Row, origdata: string, maskdata: string, editdata: string) {
  const store = async (area: string, v: string) => {
    const d = dataUrl(v, /^image\/(png|jpeg|jpg)$/);
    if (!d || d.bin.length < 20) return;
    await c.s.deleteArea(area, photo.id);
    await c.s.putFile(area, photo.id, `${area}_${photo.id}_${sec(c.s)}.${d.ext === 'png' ? 'png' : 'jpg'}`, d.mime, d.bin);
  };
  if (origdata !== '') await store('photoorig', origdata);
  if (maskdata === 'none') await c.s.deleteArea('photomask', photo.id);
  else if (maskdata !== '') await store('photomask', maskdata);
  if (editdata !== '') {
    try {
      if (typeof JSON.parse(editdata) === 'object') await c.s.update('photos', { ...c.s.get('photos', photo.id)!, editdata });
    } catch {
      /* ungültig: nicht speichern */
    }
  }
}

function placementCounts(c: PinCtx) {
  const counts = new Map<number, number>();
  for (const pl of c.s.all('object_placements', { status: 'active' })) counts.set(pl.photoid, (counts.get(pl.photoid) ?? 0) + 1);
  return counts;
}

function photoFile(c: PinCtx, id: number) {
  return c.s.areaFiles('photo', id)[0];
}

function exportPhoto(c: PinCtx, r: Row, counts: Map<number, number>) {
  return {
    id: r.id,
    url: fileUrl(c, photoFile(c, r.id), r.timemodified),
    annotationdata: r.annotationdata != null ? String(r.annotationdata) : '[]',
    gridtype: r.gridtype ?? 'none',
    gridvalue: int(r.gridvalue),
    gridcolor: r.gridcolor || '#ff3c3c',
    consent: !!r.consent,
    hiddenfromboard: !!r.hiddenfromboard,
    annotationonboard: !!r.annotationonboard,
    sourcetitle: String(r.sourcetitle ?? ''),
    sourceauthor: String(r.sourceauthor ?? ''),
    sourceyear: String(r.sourceyear ?? ''),
    sourceepoch: String(r.sourceepoch ?? ''),
    sourceplace: String(r.sourceplace ?? ''),
    sourceorigauthor: String(r.sourceorigauthor ?? ''),
    tags: String(r.tags ?? ''),
    timecreated: int(r.timecreated),
    canvasx: num(r.canvasx),
    canvasy: num(r.canvasy),
    canvasw: num(r.canvasw, 200),
    canvasrot: num(r.canvasrot),
    canvasz: int(r.canvasz),
    boardid: int(r.boardid),
    backphotoid: r.backphotoid != null ? int(r.backphotoid) : 0,
    showingback: !!r.showingback,
    boardplaced: !!r.boardplaced,
    wordfielddata: String(r.wordfielddata ?? ''),
    blendmode: String(r.blendmode ?? ''),
    origurl: areaUrl(c, 'photoorig', r.id),
    maskurl: areaUrl(c, 'photomask', r.id),
    editdata: String(r.editdata ?? ''),
    otherboardcount: counts.get(r.id) ?? 0,
    userfullname: c.fullname,
  };
}

// ---- Hintergrund (in Moodle Nutzereinstellungen, hier Zeilen in prefs) ----
function pref(c: PinCtx, name: string): string | null {
  return c.s.first('prefs', { name })?.value ?? null;
}
async function setPref(c: PinCtx, name: string, value: string | null) {
  const row = c.s.first('prefs', { name });
  if (value === null) return row ? c.s.remove('prefs', [row.id]) : undefined;
  if (row) await c.s.update('prefs', { ...row, value });
  else await c.s.insert('prefs', { name, value });
}

function sanitizeFx(rawv: unknown): string {
  let data: any = rawv;
  if (typeof rawv === 'string') {
    try {
      data = JSON.parse(rawv);
    } catch {
      return '';
    }
  }
  if (!data || typeof data !== 'object') return '';
  const hex = (x: unknown) => (/^#[0-9a-fA-F]{6}$/.test(String(x ?? '')) ? String(x).toLowerCase() : '#000000');
  const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
  const r3 = (v: number) => Math.round(v * 1000) / 1000;
  const out: A = {};
  const blur = clamp(int(data.blur), 0, 30);
  if (blur) out.blur = blur;
  const fill = data.fill && typeof data.fill === 'object' ? data.fill : {};
  const mode = ['gradient', 'mesh'].includes(fill.mode) ? fill.mode : 'solid';
  const stopsOf = (arr: unknown, n: number) => (Array.isArray(arr) ? arr.slice(0, n) : []).map((st: any) => ({ color: hex(st?.color), pos: r3(clamp(num(st?.pos), 0, 1)) }));
  if (mode === 'gradient') {
    const stops = stopsOf(fill.stops, 8);
    if (stops.length >= 2) out.fill = { mode: 'gradient', stops, angle: int(fill.angle, 135), radial: !!fill.radial };
  } else if (mode === 'mesh') {
    const points = (Array.isArray(fill.points) ? fill.points.slice(0, 8) : []).map((pt: any) => ({
      x: r3(clamp(num(pt?.x, 0.5), -1, 2)),
      y: r3(clamp(num(pt?.y, 0.5), -1, 2)),
      color: hex(pt?.color),
    }));
    if (points.length) {
      out.fill = { mode: 'mesh', points, grain: clamp(int(fill.grain), 0, 100) };
      const base = fill.base && typeof fill.base === 'object' ? fill.base : {};
      if (base.mode === 'solid') out.fill.base = { mode: 'solid', color: hex(base.color) };
      else if (base.mode === 'gradient') {
        const bs = stopsOf(base.stops, 4);
        if (bs.length >= 2) out.fill.base = { mode: 'gradient', stops: bs, angle: int(base.angle, 135), radial: !!base.radial };
      }
    }
  }
  const json = Object.keys(out).length ? JSON.stringify(out) : '';
  return json.length <= 1300 ? json : '';
}

function backgroundData(c: PinCtx) {
  const bg: A = { type: 'color', color: '#2b2d33', url: null, brightness: 100, saturation: 100, invert: 0, fit: 'contain', pdfurl: '', pdfspreads: '', pdfdouble: false, photoid: 0, startmode: '', fx: '' };
  bg.fx = sanitizeFx(pref(c, 'bgfx') ?? '');
  const rawBg = pref(c, 'bg');
  if (!rawBg) return bg;
  let d: any;
  try {
    d = JSON.parse(rawBg);
  } catch {
    return bg;
  }
  if (!d || typeof d !== 'object') return bg;
  bg.startmode = ['overview', 'slide'].includes(d.startmode) ? d.startmode : '';
  bg.type = ['image', 'url', 'upload'].includes(d.type) ? d.type : 'color';
  bg.color = text(d.color ?? bg.color);
  bg.brightness = Math.max(20, Math.min(180, int(d.brightness, 100)));
  bg.saturation = Math.max(0, Math.min(200, int(d.saturation, 100)));
  bg.invert = Math.max(0, Math.min(100, int(d.invert)));
  bg.fit = ['cover', 'contain'].includes(d.fit) ? d.fit : 'contain';
  if (bg.type === 'image' && d.photoid) {
    const photo = c.s.get('photos', int(d.photoid));
    if (photo) {
      bg.photoid = photo.id;
      bg.url = fileUrl(c, photoFile(c, photo.id)) || null;
    }
    if (!bg.url) bg.type = 'color';
  } else if (bg.type === 'url') {
    const url = /^https?:\/\//i.test(String(d.url ?? '')) ? String(d.url) : '';
    bg.url = url || null;
    if (!bg.url) bg.type = 'color';
  } else if (bg.type === 'upload') {
    bg.url = areaUrl(c, 'background', ME) || null;
    if (!bg.url) bg.type = 'color';
    if (bg.type === 'upload' && d.pdf) {
      const pdf = areaUrl(c, 'backgroundpdf', ME);
      if (pdf) {
        bg.pdfurl = pdf;
        bg.pdfspreads = String(d.pdfspreads ?? '').replace(/[^0-9,]/g, '');
        bg.pdfdouble = !!d.pdfdouble;
      }
    }
  }
  return bg;
}

function cleanStrokes(decoded: unknown[]): A[] {
  const out: A[] = [];
  for (const st of decoded.slice(0, 500) as any[]) {
    if (!st || typeof st !== 'object') continue;
    const color = hex6(st.color, '#ef4444');
    const id = String(st.id ?? '').replace(/[^A-Za-z0-9_-]/g, '');
    if (st.type === 'text') {
      const t = text(st.text);
      if (t === '' || st.x == null || st.y == null) continue;
      out.push({ id, type: 'text', x: num(st.x), y: num(st.y), text: [...t].slice(0, 300).join(''), color, size: num(st.size, 20) });
      continue;
    }
    if (!Array.isArray(st.points) || !st.points.length) continue;
    const points = (st.points as any[])
      .slice(0, 2000)
      .filter((p) => p && p.x != null && p.y != null)
      .map((p) => ({ x: num(p.x), y: num(p.y) }));
    if (!points.length) continue;
    out.push({ id, points, color, width: num(st.width, 0.01), erase: !!st.erase });
  }
  return out;
}

function parseArray(v: string): unknown[] {
  let d: unknown;
  try {
    d = JSON.parse(v);
  } catch {
    throw new PinError('error_save');
  }
  if (!Array.isArray(d) && !(d && typeof d === 'object')) throw new PinError('error_save');
  return Array.isArray(d) ? d : Object.values(d as object);
}

function threadItems(c: PinCtx, threadid: number) {
  return c.s
    .all('thread_items', { threadid })
    .sort((a, b) => int(a.sortorder) - int(b.sortorder) || a.id - b.id)
    .map((r) => ({
      id: r.id,
      itemtype: r.itemtype,
      photoid: r.photoid != null ? int(r.photoid) : 0,
      boardid: int(r.boardid),
      framex: num(r.framex),
      framey: num(r.framey),
      framew: num(r.framew),
      frameh: num(r.frameh),
      framerot: num(r.framerot),
      framez: int(r.framez),
      framelabel: String(r.framelabel ?? ''),
      framedata: String(r.framedata ?? ''),
    }));
}

async function ownThread(c: PinCtx): Promise<Row> {
  const t = c.s.first('threads', { userid: ME });
  if (t) return t;
  if (!canUseThreads(c)) deny('thread');
  const id = await c.s.insert('threads', { userid: ME, color: '#e0503f', bgmoves: 0, linewidth: 3, timecreated: sec(c.s) });
  return c.s.get('threads', id)!;
}

function ownItem(c: PinCtx, id: unknown, frame: boolean, what: string): Row {
  const it = c.s.get('thread_items', int(id));
  if (!it || (frame && it.itemtype !== 'frame')) throw new PinError('invalidrecord');
  const t = c.s.get('threads', int(it.threadid));
  if (!t || t.userid != ME) deny(what);
  return it;
}

function ownPlacement(c: PinCtx, id: unknown): Row {
  const pl = c.s.get('object_placements', int(id));
  if (!pl) throw new PinError('invalidrecord');
  const p = c.s.get('photos', int(pl.photoid));
  if (!p || p.userid != ME) deny('placement');
  return pl;
}

export const METHODS: Record<string, (c: PinCtx, a: A) => Promise<unknown> | unknown> = {
  async save_photo(c, a) {
    const s = c.s;
    const existing = s.all('photos', { userid: ME }).length;
    const max = effectiveMax(c);
    if (max > 0 && existing >= max) throw new PinError('maxreached');
    const d = dataUrl(raw(a.imagedata), /^image\/(png|jpeg|jpg|svg\+xml)$/);
    if (!d || d.bin.length < 20) throw new PinError('error_save');
    if (d.bin.length > c.maxBytes) throw new PinError('error_save');
    const t = sec(s);
    const gridtype = ['none', 'square', 'fixed'].includes(a.gridtype) ? a.gridtype : 'none';
    const id = await s.insert('photos', {
      userid: ME,
      sortorder: existing,
      gridtype,
      gridvalue: int(a.gridvalue),
      consent: bool(a.consent) ? 1 : 0,
      hiddenfromboard: INSTANCE.boarddefault ? 0 : 1,
      annotationonboard: 1,
      sourcetitle: text(a.sourcetitle),
      sourceauthor: text(a.sourceauthor),
      sourceyear: text(a.sourceyear),
      sourceepoch: text(a.sourceepoch),
      sourceplace: text(a.sourceplace),
      sourceorigauthor: text(a.sourceorigauthor),
      canvasx: 20 + (existing % 5) * 30,
      canvasy: 20 + Math.floor(existing / 5) * 30,
      canvasw: 220,
      canvasrot: 0,
      canvasz: existing,
      boardid: int(a.boardid),
      wordfielddata: raw(a.wordfielddata) !== '' ? raw(a.wordfielddata) : null,
      status: 'active',
      boardplaced: 0,
      showingback: 0,
      timecreated: t,
      timemodified: t,
    });
    const f = await s.putFile('photo', id, `photo_${id}.${d.ext}`, d.mime, d.bin);
    await storePhotoEdit(c, s.get('photos', id)!, raw(a.origdata), raw(a.maskdata), raw(a.editdata));
    const count = existing + 1;
    return { photoid: id, count, max, maxreached: max > 0 && count >= max, hiddenfromboard: !INSTANCE.boarddefault, url: fileUrl(c, f, t) };
  },

  get_photos(c) {
    const counts = placementCounts(c);
    const photos = c.s
      .all('photos', { userid: ME, status: 'active' })
      .sort((a, b) => int(a.sortorder) - int(b.sortorder) || a.id - b.id)
      .filter((r) => photoFile(c, r.id))
      .map((r) => exportPhoto(c, r, counts));
    return {
      photos,
      max: effectiveMax(c),
      background: backgroundData(c),
      candelete: c.teacher,
      canmoderate: canViewClass(c),
      studentcansend: !!INSTANCE.studentcansend,
      teachercansend: !!INSTANCE.teachercansend,
    };
  },

  async save_annotation(c, a) {
    const p = ownPhoto(c, a.photoid, 'save_annotation');
    const annotationdata = JSON.stringify(cleanStrokes(parseArray(raw(a.strokes))));
    await c.s.update('photos', { ...p, annotationdata });
    return { success: true, annotationdata };
  },

  get_board_ink(c, a) {
    const row = c.s.first('board_ink', { userid: ME, boardid: int(a.boardid) });
    return { strokedata: row ? String(row.strokedata) : '[]' };
  },

  async save_board_ink(c, a) {
    const strokedata = JSON.stringify(cleanStrokes(parseArray(raw(a.strokes))));
    const boardid = int(a.boardid);
    const row = c.s.first('board_ink', { userid: ME, boardid });
    const t = sec(c.s);
    if (row) await c.s.update('board_ink', { ...row, strokedata, timemodified: t });
    else await c.s.insert('board_ink', { userid: ME, boardid, strokedata, timecreated: t, timemodified: t });
    return { success: true, strokedata };
  },

  get_object_placements(c, a) {
    const boardid = int(a.boardid);
    const placements = c.s
      .all('object_placements', { boardid, status: 'active' })
      .filter((pl) => c.s.get('photos', int(pl.photoid))?.userid == ME)
      .map((r) => ({
        id: r.id,
        photoid: int(r.photoid),
        boardid: int(r.boardid),
        canvasx: num(r.canvasx),
        canvasy: num(r.canvasy),
        canvasw: num(r.canvasw, 200),
        canvasrot: num(r.canvasrot),
        canvasz: int(r.canvasz),
        boardplaced: !!r.boardplaced,
      }));
    return { placements };
  },

  async update_object_placement(c, a) {
    const pl = ownPlacement(c, a.placementid);
    await c.s.update('object_placements', { ...pl, canvasx: num(a.x), canvasy: num(a.y), canvasw: num(a.w), canvasrot: num(a.rot), canvasz: int(a.z), boardplaced: 1, timemodified: sec(c.s) });
    return { success: true };
  },

  async toggle_own_board_placement(c, a) {
    const p = ownPhoto(c, a.photoid, 'toggle_own_board_placement');
    const own = new Set<number>();
    for (const r of c.s.all('photos', { userid: ME })) if (int(r.boardid)) own.add(int(r.boardid));
    for (const r of c.s.all('object_placements')) if (int(r.boardid) && c.s.get('photos', int(r.photoid))?.userid == ME) own.add(int(r.boardid));
    for (const r of c.s.all('board_names', { userid: ME })) if (int(r.boardid)) own.add(int(r.boardid));
    const ownboardid = own.size ? Math.min(...own) : 0;
    if (!ownboardid) deny('toggle_own_board_placement');
    const ex = c.s.first('object_placements', { photoid: p.id, boardid: ownboardid });
    const t = sec(c.s);
    let placed: boolean;
    if (ex) {
      const status = ex.status === 'active' ? 'trash' : 'active';
      await c.s.update('object_placements', { ...ex, status, timemodified: t });
      placed = status === 'active';
    } else {
      await c.s.insert('object_placements', { photoid: p.id, boardid: ownboardid, canvasx: 300, canvasy: 300, canvasw: 220, canvasrot: 0, canvasz: 0, boardplaced: 1, status: 'active', timecreated: t, timemodified: t });
      placed = true;
    }
    return { placed, boardid: ownboardid };
  },

  async set_placement_status(c, a) {
    if (!['active', 'trash'].includes(a.status)) throw new PinError('error_save');
    const pl = ownPlacement(c, a.placementid);
    await c.s.update('object_placements', { ...pl, status: a.status, timemodified: sec(c.s) });
    return { success: true };
  },

  get_object_usage(c, a) {
    const p = ownPhoto(c, a.photoid, 'get_object_usage');
    const usages: A[] = [];
    if (p.status === 'active') usages.push({ kind: 'home', id: p.id, boardid: int(p.boardid) });
    for (const pl of c.s.all('object_placements', { photoid: p.id, status: 'active' })) usages.push({ kind: 'placement', id: pl.id, boardid: int(pl.boardid) });
    return { usages };
  },

  get_board_names(c) {
    return { names: c.s.all('board_names', { userid: ME }).map((r) => ({ boardid: int(r.boardid), name: String(r.name ?? '') })) };
  },

  async set_board_name(c, a) {
    const boardid = int(a.boardid);
    const name = text(a.name);
    const row = c.s.first('board_names', { userid: ME, boardid });
    if (row) await c.s.update('board_names', { ...row, name, timemodified: sec(c.s) });
    else await c.s.insert('board_names', { userid: ME, boardid, name, hidden: 0, timemodified: sec(c.s) });
    return { success: true };
  },

  async set_board_hidden(c, a) {
    const boardid = int(a.boardid);
    const hidden = int(a.hidden);
    const row = c.s.first('board_names', { userid: ME, boardid });
    if (row) await c.s.update('board_names', { ...row, hidden, timemodified: sec(c.s) });
    else await c.s.insert('board_names', { userid: ME, boardid, name: null, hidden, timemodified: sec(c.s) });
    return { success: true };
  },

  get_all_boards(c) {
    const ids = new Set(c.s.all('photos').map((p) => int(p.boardid)));
    const boards = [...ids]
      .sort((x, y) => x - y)
      .map((boardid) => {
        const e = c.s.first('board_names', { userid: ME, boardid });
        return { userid: ME, boardid, ownername: c.fullname, isown: true, name: e && e.name != null ? String(e.name) : '', hidden: !!e?.hidden };
      });
    return { boards };
  },

  async clone_board(c, a) {
    if (!c.teacher && !INSTANCE.studentboardclone) deny('clone_board');
    const from = int(a.boardid);
    const maxboard = Math.max(0, ...c.s.all('photos', { userid: ME }).map((p) => int(p.boardid)));
    const newboardid = Math.max(maxboard, from) + 1;
    const t = sec(c.s);
    for (const p of c.s.all('photos', { userid: ME, boardid: from, status: 'active' })) {
      await c.s.insert('object_placements', {
        photoid: p.id,
        boardid: newboardid,
        canvasx: p.canvasx,
        canvasy: p.canvasy,
        canvasw: p.canvasw,
        canvasrot: p.canvasrot,
        canvasz: p.canvasz,
        boardplaced: p.boardplaced,
        status: 'active',
        timecreated: t,
        timemodified: t,
      });
    }
    const nm = c.s.first('board_names', { userid: ME, boardid: from });
    if (nm) await c.s.insert('board_names', { userid: ME, boardid: newboardid, name: nm.name, hidden: 0, timemodified: t });
    return { newboardid };
  },

  async save_background(c, a) {
    const type = ['image', 'url', 'upload'].includes(a.type) ? a.type : 'color';
    const imagedata = raw(a.imagedata);
    if (type === 'image' && int(a.photoid) > 0 && !c.s.get('photos', int(a.photoid))) deny('save_background');
    if (type === 'upload' && imagedata !== '') {
      const d = dataUrl(imagedata, /^image\/(png|jpeg|jpg)$/);
      if (!d || d.bin.length < 50 || d.bin.length > c.maxBytes) throw new PinError('error_save');
      await c.s.deleteArea('background', ME);
      await c.s.putFile('background', ME, `bg_${ME}.${d.ext}`, d.mime, d.bin);
    }
    let old: A = {};
    try {
      old = JSON.parse(pref(c, 'bg') ?? '{}') ?? {};
    } catch {
      old = {};
    }
    let pdf = 0;
    let spreads = raw(a.pdfspreads).replace(/[^0-9,]/g, '');
    let double = bool(a.pdfdouble) || int(a.pdfdouble) ? 1 : 0;
    const pdfdata = raw(a.pdfdata);
    if (type === 'upload' && imagedata !== '') {
      if (pdfdata !== '') {
        const d = dataUrl(pdfdata, /^application\/pdf$/);
        if (!d || d.bin.subarray(0, 4).toString() !== '%PDF' || d.bin.length > c.maxBytes) throw new PinError('error_save');
        await c.s.deleteArea('backgroundpdf', ME);
        await c.s.putFile('backgroundpdf', ME, `bg_${ME}.pdf`, 'application/pdf', d.bin);
        pdf = 1;
      } else if (spreads !== '' && old.pdf) pdf = 1;
      else await c.s.deleteArea('backgroundpdf', ME);
    } else if (type === 'upload' && old.pdf) {
      pdf = 1;
      spreads = String(old.pdfspreads ?? '').replace(/[^0-9,]/g, '');
      double = old.pdfdouble ? 1 : 0;
    } else if (type !== 'upload') await c.s.deleteArea('backgroundpdf', ME);
    const invert = int(a.invert, -1);
    const payload = {
      startmode: ['overview', 'slide'].includes(a.startmode) ? a.startmode : ['overview', 'slide'].includes(old.startmode) ? old.startmode : '',
      pdf,
      pdfspreads: pdf ? spreads : '',
      pdfdouble: pdf ? double : 0,
      type,
      color: text(a.color, '#2b2d33'),
      photoid: int(a.photoid),
      url: /^https?:\/\//i.test(raw(a.url)) ? raw(a.url) : '',
      brightness: Math.max(20, Math.min(180, int(a.brightness, 100))),
      saturation: Math.max(0, Math.min(200, int(a.saturation, 100))),
      invert: invert >= 0 ? Math.min(100, invert) : Math.max(0, Math.min(100, int(old.invert))),
      fit: ['cover', 'contain'].includes(a.fit) ? a.fit : 'contain',
    };
    await setPref(c, 'bg', JSON.stringify(payload));
    if (a.fx !== undefined && a.fx !== null) await setPref(c, 'bgfx', sanitizeFx(a.fx) || null);
    return { background: backgroundData(c) };
  },

  async update_layout(c, a) {
    const p = ownPhoto(c, a.photoid, 'update_layout');
    await c.s.update('photos', { ...p, canvasx: num(a.x), canvasy: num(a.y), canvasw: Math.max(40, num(a.w)), canvasrot: num(a.rot), canvasz: int(a.z), boardid: int(a.boardid), boardplaced: 1 });
    return { success: true };
  },

  async update_grid(c, a) {
    const p = ownPhoto(c, a.photoid, 'update_grid');
    const gridtype = ['none', 'square', 'fixed'].includes(a.gridtype) ? a.gridtype : 'none';
    await c.s.update('photos', { ...p, gridtype, gridvalue: int(a.gridvalue), gridcolor: hex6(a.gridcolor, '#ff3c3c') });
    return { success: true };
  },

  async update_source(c, a) {
    const p = c.s.get('photos', int(a.photoid));
    if (!p) throw new PinError('invalidrecord');
    if (!(c.teacher || p.userid == ME)) deny('update_source');
    await c.s.update('photos', {
      ...p,
      sourcetitle: text(a.sourcetitle),
      sourceauthor: text(a.sourceauthor),
      sourceyear: text(a.sourceyear),
      sourceepoch: text(a.sourceepoch),
      sourceplace: text(a.sourceplace),
      sourceorigauthor: text(a.sourceorigauthor),
    });
    return { success: true };
  },

  async set_photo_tags(c, a) {
    const norm = (str: string) => {
      const out: string[] = [];
      for (let t of str.split(',')) {
        t = text(t).trim();
        if (t !== '' && !out.some((o) => o.toLowerCase() === t.toLowerCase())) out.push(t);
      }
      return out;
    };
    const tags = norm(raw(a.tags));
    const photos: A[] = [];
    for (const pid of [...new Set((Array.isArray(a.photoids) ? a.photoids : []).map((x: unknown) => int(x)))]) {
      const p = c.s.get('photos', pid as number);
      if (!p || !(c.teacher || p.userid == ME)) continue;
      const merged = a.mode === 'add' ? norm([...norm(String(p.tags ?? '')), ...tags].join(',')) : tags;
      const next = { ...p, tags: merged.join(', ') };
      await c.s.update('photos', next);
      photos.push({ id: p.id, tags: next.tags });
    }
    return { photos };
  },

  async delete_photo(c, a) {
    const p = c.s.get('photos', int(a.photoid));
    if (!p) throw new PinError('invalidrecord');
    if (!(c.teacher || p.userid == ME)) deny('delete_photo');
    await c.s.update('photos', { ...p, status: 'trash' });
    return { success: true };
  },

  async restore_photo(c, a) {
    const p = ownPhoto(c, a.photoid, 'restore_photo');
    await c.s.update('photos', { ...p, status: 'active' });
    return { success: true };
  },

  async permanently_delete_photo(c, a) {
    const p = ownPhoto(c, a.photoid, 'permanently_delete_photo');
    if (c.s.all('object_placements', { photoid: p.id, status: 'active' }).length) throw new PinError('error_save');
    for (const area of ['photo', 'photoorig', 'photomask']) await c.s.deleteArea(area, p.id);
    await c.s.remove('photos', [p.id]);
    await c.s.remove(
      'object_placements',
      c.s.all('object_placements', { photoid: p.id }).map((r) => r.id),
    );
    return { success: true };
  },

  get_trash(c) {
    const items: A[] = [];
    for (const r of c.s.all('photos', { userid: ME, status: 'trash' })) {
      items.push({ kind: 'object', id: r.id, boardid: int(r.boardid), sourcetitle: String(r.sourcetitle ?? ''), usedelsewhere: c.s.all('object_placements', { photoid: r.id, status: 'active' }).length > 0 });
    }
    for (const r of c.s.all('object_placements', { status: 'trash' })) {
      if (c.s.get('photos', int(r.photoid))?.userid == ME) items.push({ kind: 'placement', id: r.id, boardid: int(r.boardid), sourcetitle: '', usedelsewhere: true });
    }
    return { items };
  },

  get_all_photos(c) {
    if (!canViewClass(c)) deny('get_all_photos');
    const counts = placementCounts(c);
    const photos = c.s
      .all('photos', { status: 'active' })
      .sort((a, b) => int(a.sortorder) - int(b.sortorder) || a.id - b.id)
      .filter((r) => photoFile(c, r.id))
      .map((r) => ({
        id: r.id,
        userid: int(r.userid),
        userfullname: c.fullname,
        url: fileUrl(c, photoFile(c, r.id), r.timemodified),
        sourcetitle: String(r.sourcetitle ?? ''),
        sourceauthor: String(r.sourceauthor ?? ''),
        sourceyear: String(r.sourceyear ?? ''),
        sourceepoch: String(r.sourceepoch ?? ''),
        sourceplace: String(r.sourceplace ?? ''),
        sourceorigauthor: String(r.sourceorigauthor ?? ''),
        tags: String(r.tags ?? ''),
        consent: !!r.consent,
        hiddenfromboard: !!r.hiddenfromboard,
        otherboardcount: counts.get(r.id) ?? 0,
        timecreated: int(r.timecreated),
        wordfielddata: String(r.wordfielddata ?? ''),
      }));
    return { photos, candelete: c.teacher, canedit: c.teacher };
  },

  async set_photo_hidden(c, a) {
    const p = c.s.get('photos', int(a.photoid));
    if (!p) throw new PinError('invalidrecord');
    const ok = p.userid == ME ? c.teacher || !!INSTANCE.studentcansend : c.teacher && !!INSTANCE.teachercansend;
    if (!ok) deny('set_photo_hidden');
    const hiddenfromboard = bool(a.hidden) ? 1 : 0;
    await c.s.update('photos', { ...p, hiddenfromboard, boardplaced: 0 });
    return { success: true, hiddenfromboard: !!hiddenfromboard };
  },

  async set_annotation_onboard(c, a) {
    const p = ownPhoto(c, a.photoid, 'set_annotation_onboard');
    const annotationonboard = bool(a.onboard) ? 1 : 0;
    await c.s.update('photos', { ...p, annotationonboard });
    return { success: true, annotationonboard: !!annotationonboard };
  },

  async set_blendmode(c, a) {
    const p = c.s.get('photos', int(a.photoid));
    if (!p) throw new PinError('invalidrecord');
    if (p.userid != ME && !c.teacher) deny('set_blendmode');
    const blendmode = ['', 'multiply', 'difference', 'color-burn', 'invert'].includes(a.mode) ? a.mode : '';
    await c.s.update('photos', { ...p, blendmode });
    return { success: true, blendmode };
  },

  async update_photo(c, a) {
    const p = c.s.get('photos', int(a.photoid));
    if (!p) throw new PinError('invalidrecord');
    if (!(c.teacher || p.userid == ME)) deny('update_photo');
    const d = dataUrl(raw(a.imagedata), /^image\/(png|jpeg|jpg|svg\+xml)$/);
    if (!d || d.bin.length < 20 || d.bin.length > c.maxBytes) throw new PinError('error_save');
    const t = sec(c.s);
    await c.s.update('photos', { ...p, wordfielddata: raw(a.wordfielddata) !== '' ? raw(a.wordfielddata) : null, timemodified: t });
    await c.s.deleteArea('photo', p.id);
    const f = await c.s.putFile('photo', p.id, `photo_${p.id}_${t}.${d.ext}`, d.mime, d.bin);
    await storePhotoEdit(c, c.s.get('photos', p.id)!, raw(a.origdata), raw(a.maskdata), raw(a.editdata));
    return { success: true, url: fileUrl(c, f, t) };
  },

  get_threads(c) {
    const own = c.s.first('threads', { userid: ME });
    const threads = own ? [{ id: own.id, color: own.color, bgmoves: !!own.bgmoves, linewidth: num(own.linewidth, 3), isown: true, items: threadItems(c, own.id) }] : [];
    return { threads, canuse: canUseThreads(c) };
  },

  async add_thread_item(c, a) {
    const itemtype = a.itemtype;
    if (!['photo', 'frame', 'overview'].includes(itemtype)) throw new PinError('invalidparameter');
    const thread = await ownThread(c);
    if (itemtype === 'photo') ownPhoto(c, a.photoid, 'add_thread_item');
    const items = c.s.all('thread_items', { threadid: thread.id });
    const maxorder = Math.max(0, ...items.map((i) => int(i.sortorder)));
    const maxz = Math.max(0, ...items.map((i) => int(i.framez)));
    const frame = itemtype === 'frame';
    await c.s.insert('thread_items', {
      threadid: thread.id,
      sortorder: maxorder + 1,
      itemtype,
      photoid: itemtype === 'photo' ? int(a.photoid) : null,
      boardid: int(a.boardid),
      framex: frame ? num(a.framex) : null,
      framey: frame ? num(a.framey) : null,
      framew: frame ? num(a.framew, 200) : null,
      frameh: frame ? num(a.frameh, 150) : null,
      framerot: 0,
      framez: frame ? maxz + 1 : 0,
      framelabel: frame ? text(a.framelabel) : null,
      timecreated: sec(c.s),
    });
    return { threadid: thread.id, color: thread.color, items: threadItems(c, thread.id) };
  },

  async remove_thread_item(c, a) {
    const it = ownItem(c, a.itemid, false, 'remove_thread_item');
    await c.s.remove('thread_items', [it.id]);
    return { success: true };
  },

  async reorder_thread_items(c, a) {
    const own = c.s.first('threads', { userid: ME });
    if (!own) throw new PinError('invalidrecord');
    const ids = Array.isArray(a.itemids) ? a.itemids : [];
    for (let order = 0; order < ids.length; order++) {
      const it = c.s.first('thread_items', { id: int(ids[order]), threadid: own.id });
      if (it) await c.s.update('thread_items', { ...it, sortorder: order });
    }
    return { success: true };
  },

  async update_thread_frame(c, a) {
    const it = ownItem(c, a.itemid, true, 'update_thread_frame');
    await c.s.update('thread_items', {
      ...it,
      framex: num(a.framex),
      framey: num(a.framey),
      framew: Math.max(40, num(a.framew)),
      frameh: Math.max(40, num(a.frameh)),
      framerot: num(a.framerot),
      framez: int(a.framez),
    });
    return { success: true };
  },

  async set_frame_label(c, a) {
    const it = ownItem(c, a.itemid, true, 'set_frame_label');
    await c.s.update('thread_items', { ...it, framelabel: text(a.framelabel) });
    return { success: true };
  },

  async set_frame_content(c, a) {
    const it = ownItem(c, a.itemid, true, 'set_frame_content');
    const data = raw(a.framedata).trim();
    if (data !== '') {
      try {
        if (typeof JSON.parse(data) !== 'object') throw new Error();
      } catch {
        throw new PinError('error_save');
      }
    }
    let svg = raw(a.framesvg).trim();
    if (svg !== '') {
      if (!/^<svg/i.test(svg)) throw new PinError('error_save');
      svg = svg
        .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '')
        .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
        .replace(/javascript\s*:/gi, '');
    }
    await c.s.update('thread_items', { ...it, framedata: data !== '' ? data : null, framesvg: data !== '' && svg !== '' ? svg : null });
    return { success: true };
  },

  async delete_thread(c) {
    const own = c.s.first('threads', { userid: ME });
    if (own) {
      await c.s.remove(
        'thread_items',
        c.s.all('thread_items', { threadid: own.id }).map((r) => r.id),
      );
      await c.s.remove('threads', [own.id]);
    }
    return { success: true };
  },

  async set_thread_bgmoves(c, a) {
    const t = await ownThread(c);
    await c.s.update('threads', { ...t, bgmoves: bool(a.bgmoves) ? 1 : 0 });
    return { success: true };
  },

  async set_thread_style(c, a) {
    const t = await ownThread(c);
    await c.s.update('threads', { ...t, color: text(a.color), linewidth: Math.max(1, Math.min(12, num(a.linewidth, 3))) });
    return { success: true };
  },

  get_stream_photos(c) {
    const photos = c.s
      .all('photos', { userid: ME, status: 'active' })
      .filter((p) => !int(p.hiddenfromboard) && !int(p.boardplaced) && photoFile(c, p.id))
      .sort((a, b) => int(b.timecreated) - int(a.timecreated))
      .slice(0, 100)
      .map((r) => ({
        id: r.id,
        userid: ME,
        userfullname: c.fullname,
        mine: true,
        url: fileUrl(c, photoFile(c, r.id), r.timemodified),
        sourcetitle: String(r.sourcetitle ?? ''),
        sourceauthor: String(r.sourceauthor ?? ''),
        sourceyear: String(r.sourceyear ?? ''),
        timecreated: int(r.timecreated),
      }));
    return { photos };
  },

  async adopt_photo_to_board(c, a) {
    if (!c.teacher) deny('adopt_photo_to_board');
    const src = c.s.get('photos', int(a.photoid));
    if (!src) throw new PinError('invalidrecord');
    const t = sec(c.s);
    const { id: _id, ...rest } = src;
    const id = await c.s.insert('photos', {
      ...rest,
      userid: ME,
      boardid: int(a.boardid),
      sourcephotoid: src.id,
      backphotoid: null,
      showingback: 0,
      hiddenfromboard: 0,
      canvasx: num(a.x),
      canvasy: num(a.y),
      canvasw: 200,
      canvasrot: 0,
      canvasz: 0,
      boardplaced: 1,
      timecreated: t,
    });
    const f = photoFile(c, src.id);
    const nf = f ? await c.s.copyFile(f, 'photo', id) : null;
    return { id, url: fileUrl(c, nf ?? undefined, t) };
  },

  async set_backside(c, a) {
    const p = ownPhoto(c, a.photoid, 'set_backside');
    const back = int(a.backphotoid);
    if (back > 0) {
      if (back === p.id) throw new PinError('invalidparameter');
      ownPhoto(c, back, 'set_backside');
      await c.s.update('photos', { ...p, backphotoid: back });
    } else await c.s.update('photos', { ...p, backphotoid: null, showingback: 0 });
    return { success: true };
  },

  async toggle_backside(c, a) {
    const p = ownPhoto(c, a.photoid, 'toggle_backside');
    if (!p.backphotoid) deny('toggle_backside');
    const showingback = p.showingback ? 0 : 1;
    await c.s.update('photos', { ...p, showingback });
    return { showingback: !!showingback };
  },
};

/** Methoden, die nur lesen (für Echtzeit: nach allen anderen bekommen die übrigen Geräte Bescheid) */
export const READ_ONLY = new Set(['get_photos', 'get_board_ink', 'get_object_placements', 'get_object_usage', 'get_board_names', 'get_all_boards', 'get_trash', 'get_all_photos', 'get_threads', 'get_stream_photos']);

/** Folien-Medien (slidemedia.php): Bild, Ton oder Video hochladen; gleicher Inhalt, gleiche Datei */
export async function slideMedia(c: PinCtx, name: string, mime: string, data: Buffer): Promise<A> {
  const m = mime.toLowerCase().split(';')[0].trim();
  if (!/^(image|audio|video)\/[a-z0-9.+-]+$/.test(m) || m === 'image/svg+xml') return { error: 'type' };
  if (!data.length) return { error: 'failed' };
  if (data.length > c.maxBytes) return { error: 'toolarge', maxbytes: c.maxBytes };
  const { createHash } = await import('node:crypto');
  const ext = (/\.([a-z0-9]{1,5})$/i.exec(name)?.[1] ?? m.split('/')[1].replace(/[^a-z0-9]/g, '').slice(0, 5)) || 'bin';
  const file = createHash('sha1').update(data).digest('hex') + '.' + ext.toLowerCase();
  if (!c.s.fileByName('slidemedia', file)) await c.s.putFile('slidemedia', 0, file, m, data);
  return { file, mimetype: m, size: data.length };
}

export interface MapSection {
  id: string;
  title: string;
  cards: { id: string; title: string; text: string }[];
}

const esc = (t: string) => t.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!);

/** Vorschaubild eines Zettels (die Pinnwand zeichnet Wortfelder selbst aus wordfielddata, das Bild dient Listen) */
function noteSvg(w: number, h: number, title: string, body: string): string {
  const wrap = (t: string, n: number) => {
    const out: string[] = [];
    for (const para of t.split('\n')) {
      let line = '';
      for (const word of para.split(/\s+/).filter(Boolean)) {
        if ((line + ' ' + word).trim().length > n && line) {
          out.push(line);
          line = word;
        } else line = (line + ' ' + word).trim();
      }
      out.push(line);
    }
    return out;
  };
  const lines = [...wrap(title, 18).map((l) => ({ l, b: true })), ...wrap(body, 30).map((l) => ({ l, b: false }))].slice(0, 9);
  const tspans = lines.map((x, i) => `<text x="${w / 2}" y="${40 + i * 24}" text-anchor="middle" font-family="sans-serif" font-size="${x.b ? 22 : 15}" font-weight="${x.b ? 700 : 400}" fill="#111">${esc(x.l)}</text>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect x="0" y="0" width="${w}" height="${h}" rx="16" fill="#ffffff"/>${tspans}</svg>`;
}

/**
 * „Pinnwand aus der Mindmap“ (Konzept 8d.5): Jeder übernommene Ast wird ein Rahmen (Folie) im Roten Faden, in der
 * Reihenfolge der Gliederung; seine Karten werden Zettel darin. Erneut übernehmen ergänzt nur, was fehlt.
 */
export async function fromMap(c: PinCtx, sections: MapSection[]): Promise<{ frames: number; notes: number }> {
  const s = c.s;
  const thread = await ownThread(c);
  const t = sec(s);
  let frames = 0;
  let notes = 0;
  const FW = 1200;
  const FH = 760;
  const items = () => s.all('thread_items', { threadid: thread.id });
  for (let i = 0; i < sections.length; i++) {
    const sec_ = sections[i];
    let frame = items().find((it) => it.itemtype === 'frame' && it.mapcard === sec_.id);
    if (!frame) {
      const maxorder = Math.max(0, ...items().map((it) => int(it.sortorder)));
      const maxz = Math.max(0, ...items().map((it) => int(it.framez)));
      // Rahmen nebeneinander, jeweils rechts vom letzten aus der Mindmap
      const placed = items().filter((it) => it.mapcard);
      const x = placed.length ? Math.max(...placed.map((it) => num(it.framex) + num(it.framew))) + 120 : 80;
      const id = await s.insert('thread_items', {
        threadid: thread.id,
        sortorder: maxorder + 1,
        itemtype: 'frame',
        photoid: null,
        boardid: 0,
        framex: x,
        framey: 80,
        framew: FW,
        frameh: FH,
        framerot: 0,
        framez: maxz + 1,
        framelabel: text(sec_.title).slice(0, 255),
        mapcard: sec_.id,
        timecreated: t,
      });
      frame = s.get('thread_items', id)!;
      frames++;
    }
    const inFrame = s.all('photos').filter((p) => p.mapframe === sec_.id).length;
    let k = inFrame;
    for (const card of sec_.cards) {
      if (s.all('photos').some((p) => p.mapcard === card.id && p.status !== 'trash')) continue;
      const w = 320;
      const h = 220;
      const body = card.text.trim();
      const tf = { w, h, preset: 'paper', isWordArt: false, texts: [{ id: 1, text: (card.title + (body ? '\n' + body : '')).slice(0, 600), font: 'sans', size: 26, x: 0.5, y: 0.5, fontWeight: 600 }] };
      const svg = noteSvg(w, h, card.title, body);
      const col = k % 3;
      const row = Math.floor(k / 3);
      const pid = await s.insert('photos', {
        userid: ME,
        sortorder: s.all('photos', { userid: ME }).length,
        gridtype: 'none',
        gridvalue: 0,
        consent: 0,
        hiddenfromboard: 0,
        annotationonboard: 1,
        sourcetitle: text(card.title).slice(0, 255),
        sourceauthor: '',
        sourceyear: '',
        sourceepoch: '',
        sourceplace: '',
        sourceorigauthor: '',
        canvasx: num(frame.framex) + 60 + col * 380,
        canvasy: num(frame.framey) + 80 + row * 260,
        canvasw: 330,
        canvasrot: 0,
        canvasz: k + 1,
        boardid: 0,
        wordfielddata: JSON.stringify(tf),
        status: 'active',
        boardplaced: 1,
        showingback: 0,
        mapcard: card.id,
        mapframe: sec_.id,
        timecreated: t,
        timemodified: t,
      });
      await s.putFile('photo', pid, `photo_${pid}.svg`, 'image/svg+xml', Buffer.from(svg));
      k++;
      notes++;
    }
  }
  return { frames, notes };
}

// ---- Präsentation als eigenständige Datei (export_presentation.php) ----

/** Anzahl der Animationsschritte einer Folie, wie slideAnimMap() in js/app.js */
function animSteps(tf: A): number {
  const exists = new Set<string>();
  for (const t of tf.texts ?? []) exists.add('t' + (t?.id ?? ''));
  for (const sh of tf.shapes ?? []) if (!sh?.main) exists.add('s' + (sh?.id ?? ''));
  for (const st of tf.ink ?? []) exists.add('i' + (st?.id ?? ''));
  for (const md of tf.media ?? []) exists.add('m' + (md?.id ?? ''));
  let steps = 0;
  const seen = new Set<string>();
  for (const a of tf.anim ?? []) {
    const key = a && typeof a === 'object' ? String(a.key ?? '') : '';
    if (!key || !exists.has(key) || seen.has(key)) continue;
    if (!(a.withPrev && steps > 0)) steps++;
    seen.add(key);
  }
  return steps;
}

const parse = (s: unknown): any => {
  try {
    return JSON.parse(String(s ?? ''));
  } catch {
    return null;
  }
};

async function dataUrlOf(c: PinCtx, f: PinFile | undefined, fallbackMime: string): Promise<{ url: string; bin: Buffer } | null> {
  if (!f) return null;
  const bin = await c.s.fileData(f);
  return bin ? { url: `data:${f.mime || fallbackMime};base64,${bin.toString('base64')}`, bin } : null;
}

export interface ExportOptions {
  boardid: number;
  annot: boolean;
  ink: boolean;
}

/** Datenblock der exportierten Präsentation (formatVersion 1 wie in Moodle) oder null ohne eigenen Roten Faden */
export async function exportPresentation(c: PinCtx, o: ExportOptions, labels: A): Promise<A | null> {
  const thread = c.s.first('threads', { userid: ME });
  if (!thread) return null;
  const items = c.s
    .all('thread_items', { threadid: thread.id })
    .filter((it) => int(it.boardid) === o.boardid)
    .sort((a, b) => int(a.sortorder) - int(b.sortorder) || a.id - b.id);
  const cache = new Map<number, A | null>();

  async function photoData(id: number): Promise<A | null> {
    if (id <= 0) return null;
    if (cache.has(id)) return cache.get(id)!;
    const p = c.s.get('photos', id);
    const file = p ? await dataUrlOf(c, photoFile(c, id), 'image/svg+xml') : null;
    if (!p || !file) {
      cache.set(id, null);
      return null;
    }
    const r: A = {
      id: p.id,
      url: file.url,
      canvasx: num(p.canvasx),
      canvasy: num(p.canvasy),
      canvasw: num(p.canvasw),
      canvasrot: num(p.canvasrot),
      canvasz: int(p.canvasz),
      iswordart: !!p.wordfielddata,
      blendmode: raw(p.blendmode),
    };
    if (o.annot && p.annotationonboard && p.annotationdata) {
      const strokes = parse(p.annotationdata);
      if (Array.isArray(strokes) && strokes.length) r.annotation = strokes;
    }
    if (p.wordfielddata) {
      const tf = parse(p.wordfielddata);
      if (tf && typeof tf === 'object' && tf.w && tf.h) {
        r.tfw = num(tf.w);
        r.tfh = num(tf.h);
        let wordart = !!tf.isWordArt || (tf.texts ?? []).some((t: A) => t?.wordartStyle && t.wordartStyle !== 'none');
        if (tf.isSlide) {
          wordart = false;
          r.slide = true;
          r.animsteps = animSteps(tf);
        }
        r.wordartframe = wordart;
        const m = /<svg\b[^>]*\sviewBox="([^"]+)"/i.exec(file.bin.toString('utf8', 0, Math.min(file.bin.length, 4000)));
        if (m) {
          const vb = m[1].trim().split(/[\s,]+/).map(Number);
          if (vb.length === 4 && vb[2] > 0 && vb[3] > 0) r.vb = vb;
        }
      }
    }
    cache.set(id, r);
    return r;
  }

  const hex = (x: unknown) => (/^#[0-9a-fA-F]{6}$/.test(String(x ?? '')) ? String(x) : '#000000');
  const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
  const exportItems: A[] = [];
  for (const it of items) {
    const e: A = {
      itemtype: it.itemtype,
      framex: num(it.framex),
      framey: num(it.framey),
      framew: num(it.framew),
      frameh: num(it.frameh),
      framerot: num(it.framerot),
      framez: int(it.framez),
      framelabel: raw(it.framelabel),
    };
    if (it.itemtype === 'photo' && it.photoid) e.photo = await photoData(int(it.photoid));
    if (it.itemtype === 'frame' && it.framedata && it.framesvg) {
      const ftf = parse(it.framedata);
      if (ftf && typeof ftf === 'object') {
        e.framesvg = String(it.framesvg);
        e.animsteps = animSteps(ftf);
        e.blend = ['multiply', 'difference', 'color-burn', 'invert'].includes(ftf.blend) ? ftf.blend : '';
        const sbg = ftf.slideBg && typeof ftf.slideBg === 'object' ? ftf.slideBg : {};
        const sfill = sbg.fill && typeof sbg.fill === 'object' ? sbg.fill : {};
        let fmode = ['gradient', 'mesh'].includes(sfill.mode) ? sfill.mode : 'solid';
        const fstops = (Array.isArray(sfill.stops) ? sfill.stops.slice(0, 12) : []).map((st: A) => ({ color: hex(st?.color), pos: clamp(num(st?.pos), 0, 1) }));
        const fpoints = (Array.isArray(sfill.points) ? sfill.points.slice(0, 8) : []).map((pt: A) => ({ x: clamp(num(pt?.x, 0.5), 0, 1), y: clamp(num(pt?.y, 0.5), 0, 1), color: hex(pt?.color) }));
        if (fmode === 'gradient' && fstops.length < 2) fmode = 'solid';
        if (fmode === 'mesh' && !fpoints.length) fmode = 'solid';
        e.slidebg = {
          color: hex(sbg.color),
          opacity: clamp(int(sbg.opacity), 0, 100),
          blur: clamp(int(sbg.blur), 0, 30),
          invert: clamp(int(sbg.invert), 0, 100),
          brightness: clamp(int(sbg.brightness, 100), 0, 200),
          fill: { mode: fmode, stops: fstops, points: fpoints, angle: int(sfill.angle, 135), radial: !!sfill.radial, grain: clamp(int(sfill.grain), 0, 100) },
        };
        // Bild als Folien-Hintergrund: in der Datei eingebettet statt verlinkt (Collegare ist von außen nicht erreichbar)
        const simg = sbg.image && typeof sbg.image === 'object' ? sbg.image : {};
        if (typeof simg.file === 'string' && simg.file) {
          const f = c.s.fileByName('slidemedia', simg.file.replace(/[^\w.-]/g, ''));
          const d = f ? await dataUrlOf(c, f, 'image/jpeg') : null;
          if (d) e.slidebg.image = d.url;
        } else if (/^https?:\/\//i.test(String(simg.url ?? ''))) e.slidebg.image = String(simg.url);
        e.bgfull = !('full' in sbg) || !!sbg.full;
        e.elemhidebefore = !!ftf.elemHideBefore;
        e.elemhideafter = !!ftf.elemHideAfter;
        e.bgpersist = !!ftf.bgPersist;
        e.bgshowbefore = !!ftf.bgShowBefore;
        e.linked = (Array.isArray(ftf.linked) ? ftf.linked : []).map((x: unknown) => int(x));
      }
    }
    exportItems.push(e);
  }

  // alle sichtbar platzierten Objekte dieses Boards, auch weitere Platzierungen (geklonte Boards)
  const boardPhotos: A[] = [];
  const seen = new Set<number>();
  for (const r of c.s.all('photos', { userid: ME, boardid: o.boardid })) {
    if (!r.boardplaced || int(r.hiddenfromboard) || (r.status ?? 'active') !== 'active') continue;
    const d = await photoData(r.id);
    if (d) {
      boardPhotos.push(d);
      seen.add(r.id);
    }
  }
  for (const pl of c.s.all('object_placements', { boardid: o.boardid })) {
    if ((pl.status ?? 'active') !== 'active' || !pl.boardplaced || seen.has(int(pl.photoid))) continue;
    const p = c.s.get('photos', int(pl.photoid));
    if (!p || (p.status ?? 'active') !== 'active') continue;
    const d = await photoData(p.id);
    if (!d) continue;
    boardPhotos.push({ ...d, canvasx: num(pl.canvasx), canvasy: num(pl.canvasy), canvasw: num(pl.canvasw), canvasrot: num(pl.canvasrot), canvasz: int(pl.canvasz) });
    seen.add(p.id);
  }

  // Hintergrund: Bilder eingebettet, ein verlinkter Hintergrund bleibt verlinkt
  const bg = backgroundData(c);
  const background: A = { type: 'color', color: bg.color, url: null, brightness: bg.brightness, saturation: bg.saturation, invert: bg.invert, fit: bg.fit, fx: bg.fx };
  if (bg.type === 'image' && bg.photoid) {
    const d = await dataUrlOf(c, photoFile(c, bg.photoid), 'image/jpeg');
    if (d) Object.assign(background, { type: 'image', url: d.url });
  } else if (bg.type === 'upload') {
    const d = await dataUrlOf(c, c.s.areaFiles('background', ME)[0], 'image/jpeg');
    if (d) Object.assign(background, { type: 'upload', url: d.url });
  } else if (bg.type === 'url' && bg.url) Object.assign(background, { type: 'url', url: bg.url });

  let boardInk: unknown[] = [];
  if (o.ink) {
    const row = c.s.first('board_ink', { userid: ME, boardid: o.boardid });
    const d = row ? parse(row.strokedata) : null;
    if (Array.isArray(d)) boardInk = d;
  }

  const L = (k: string, d = '') => String(labels[k] ?? d);
  return {
    formatVersion: 1,
    exportedAt: sec(c.s),
    pluginVersion: 'collegare',
    boardid: o.boardid,
    boardWidth: 1400,
    startMode: bg.startmode === 'slide' || (!bg.startmode && INSTANCE.startmode === 'slide') ? 'slide' : 'overview',
    boardHeight: 1000,
    background,
    thread: { color: thread.color, linewidth: num(thread.linewidth), bgmoves: !!thread.bgmoves, items: exportItems },
    boardPhotos,
    boardInk,
    labels: {
      ink: L('present_toggle_ink'),
      annot: L('present_toggle_annot'),
      pen: L('present_pen'),
      penDraw: L('present_pen_draw'),
      penText: L('present_pen_text'),
      penErase: L('present_pen_erase'),
      penSize: L('present_pen_size'),
      penClear: L('present_pen_clear'),
      penShapes: L('ink_tool_shapes'),
      shapes: { rect: L('ink_shape_rect'), ellipse: L('ink_shape_ellipse'), line: L('ink_shape_line'), poly: L('ink_shape_poly'), curve: L('ink_shape_curve') },
      show: L('present_show'),
      hide: L('present_hide'),
      hint: L('present_hint'),
      prev: L('present_prev'),
      next: L('present_next'),
      overview: L('present_overview'),
      frame: L('present_frame'),
      empty: L('present_empty'),
    },
  };
}
