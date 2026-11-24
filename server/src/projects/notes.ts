/**
 * Notizen und Quellen (Konzept 8d.2, 8e): Recherche-Karten einer Gruppe im Seiten-Thread. Eine Notiz ist ein
 * Datensatz; Karten in der Mindmap verweisen auf sie (noteId) und übernehmen Überarbeitungen.
 *
 * Sichtbarkeit (8e.2): private = nur die Erstellerin, group = ihre Gruppe (Standard), all = das ganze Projekt. Die
 * Lehrkraft sieht alles. Gemeldete Notizen (8e.4) sehen nur noch Lehrkraft, Erstellerin und Meldende.
 */
import { z } from 'zod';
import type { Db } from '../db/index.js';
import { noteFileAllowed, type NoteFiles } from './noteFiles.js';
import { sniffImage } from './webImport.js';

/** image: Bild mit Datei, Urheber, Lizenz und Ursprungsseite (Bilder per Ziehen/Einfügen, Wunsch Jo 17.11.2026); data: Tabelle */
export const NOTE_KINDS = ['note', 'source', 'link', 'image', 'data', 'video', 'audio', 'hand'] as const;
export const VISIBILITIES = ['private', 'group', 'all'] as const;
export type Visibility = (typeof VISIBILITIES)[number];

/** Tabelle einer Daten-Notiz: höchstens 50 Zeilen × 12 Spalten, erste Zeile = Kopfzeile */
const Rows = z.array(z.array(z.string().max(500)).max(12)).max(50);

const httpUrl = (msg: string) =>
  z
    .string()
    .max(2000)
    .regex(/^https?:\/\//i, msg)
    .nullable()
    .or(z.literal('').transform(() => null))
    .default(null);

export const NoteInput = z.object({
  kind: z.enum(NOTE_KINDS).default('note'),
  title: z.string().max(200).default(''),
  body: z.string().max(10_000).default(''),
  source: z.string().max(500).default(''),
  url: httpUrl('Link muss mit http:// oder https:// beginnen'),
  /** Urheber, Lizenz und Ursprungsseite (bei Bildern; für andere Arten frei) */
  credit: z.string().max(300).default(''),
  license: z.string().max(200).default(''),
  origin: httpUrl('Ursprungsseite muss mit http:// oder https:// beginnen'),
  /** Pfad aus POST …/notizen/datei; beim Ändern weglassen = Datei bleibt, null = Datei entfernen */
  file: z.string().max(400).nullable().optional(),
  visibility: z.enum(VISIBILITIES).optional(),
  rows: Rows.optional(),
  /** Text aus dem Bild erkannt (Handschrift/Druckschrift); beim Ändern weglassen = bleibt, null = Vermerk entfernen */
  scan: z.enum(['hand', 'print']).nullable().optional(),
});
export type NoteInput = z.infer<typeof NoteInput>;

export interface NoteReport {
  userId: number;
  name: string;
  reason: string;
  at: number;
}

export interface Note {
  id: number;
  userId: number;
  name: string;
  kind: (typeof NOTE_KINDS)[number];
  title: string;
  body: string;
  source: string;
  url: string | null;
  credit: string;
  license: string;
  origin: string | null;
  /** angehängte Datei; abrufen über GET /api/projects/:id/notizen/:noteId/datei */
  file: { mime: string; size: number } | null;
  visibility: Visibility;
  rows: string[][] | null;
  /** Text aus einem Scan erkannt: Handschrift oder Druckschrift */
  scan: 'hand' | 'print' | null;
  at: number;
  updatedAt: number;
}

/** Was eine bestimmte Person von einer Notiz sieht */
export interface NoteView extends Note {
  /** gemeldet: nur für Lehrkraft, Erstellerin und Meldende sichtbar */
  reported?: boolean;
  reportedByMe?: boolean;
  /** nur für die Lehrkraft: wer gemeldet hat und warum */
  reports?: NoteReport[];
}

export interface Viewer {
  userId: number;
  role: 'teacher' | 'student';
}

export type NoteRow = Note & { projectId: number; scope: string; filePath: string | null; reporters: NoteReport[] };

export class NoteError extends Error {}

/** Audio- und Videoformate an den ersten Bytes erkennen */
export function sniffMedia(b: Buffer): string | null {
  const at = (i: number, n: number) => b.subarray(i, i + n).toString('latin1');
  if (b.length >= 4 && b.readUInt32BE(0) === 0x1a45dfa3) return 'video/webm'; // Matroska/WebM, auch reine Tonaufnahmen
  if (b.length >= 4 && at(0, 4) === 'OggS') return 'audio/ogg';
  if (b.length >= 4 && at(0, 4) === 'fLaC') return 'audio/flac';
  if (b.length >= 12 && at(0, 4) === 'RIFF' && at(8, 4) === 'WAVE') return 'audio/wav';
  if (b.length >= 3 && at(0, 3) === 'ID3') return 'audio/mpeg';
  if (b.length >= 2 && b[0] === 0xff && (b[1] & 0xe0) === 0xe0 && (b[1] & 0x06) !== 0) return 'audio/mpeg';
  if (b.length >= 12 && at(4, 4) === 'ftyp') {
    const brand = at(8, 4);
    if (/^avi[fs]/.test(brand)) return null; // Bild, siehe sniffImage
    if (/^M4[AB] /.test(brand)) return 'audio/mp4';
    if (brand === 'qt  ') return 'video/quicktime';
    return 'video/mp4';
  }
  return null;
}

/** Typ einer hochgeladenen Notizdatei aus ihren ersten Bytes */
export function sniffNoteFile(b: Buffer): string | null {
  const m = sniffImage(b) ?? sniffMedia(b);
  return m && noteFileAllowed(m) ? m : null;
}

/** Passt die Datei zur Art? Bild und Handschrift: Bild; Audio: Ton (auch Tonaufnahme in WebM/MP4); Video: Video */
export function fileFits(kind: string, mime: string): boolean {
  if (kind === 'image' || kind === 'hand') return mime.startsWith('image/');
  if (kind === 'audio') return mime.startsWith('audio/') || mime === 'video/webm' || mime === 'video/mp4';
  if (kind === 'video') return mime.startsWith('video/');
  return true;
}

/** Ausgeliefert wird eine Tonaufnahme im WebM/MP4-Behälter als audio/…, damit Browser sie im Audio-Element abspielen */
export const serveMime = (kind: string, mime: string) => (kind === 'audio' && mime.startsWith('video/') ? 'audio/' + mime.slice(6) : mime);

const NEEDS_FILE: Record<string, string> = { image: 'Bild fehlt', hand: 'Foto der Notiz fehlt', audio: 'Tonaufnahme fehlt' };

const COLS = [
  'n.id', 'n.project_id', 'n.scope', 'n.user_id', 'u.name', 'n.kind', 'n.title', 'n.body', 'n.source', 'n.url', 'n.credit', 'n.license', 'n.origin',
  'n.file_path', 'n.file_mime', 'n.file_size', 'n.visibility', 'n.data_json', 'n.scan', 'n.created_at', 'n.updated_at',
] as const;
const NO_FILE = { file_path: null, file_mime: null, file_size: null };

export class Notes {
  constructor(
    private db: Db,
    private now: () => number = Date.now,
    readonly files?: NoteFiles,
  ) {}

  /** Notizen eines Bereichs (Gruppe, Person, Testbereich), soweit die Person sie sehen darf */
  async list(projectId: number, scope: string, viewer: Viewer): Promise<NoteView[]> {
    const rows = await this.db.selectFrom('notes as n').innerJoin('users as u', 'u.id', 'n.user_id').select(COLS).where('n.project_id', '=', projectId).where('n.scope', '=', scope).orderBy('n.id', 'desc').limit(500).execute();
    return this.views(rows, viewer);
  }

  /** „Allgemein“: alle freigegebenen Notizen des Projekts aus allen Gruppen (ohne Testbereiche der Lehrkräfte) */
  async listShared(projectId: number, viewer: Viewer): Promise<(NoteView & { scope: string })[]> {
    const rows = await this.db
      .selectFrom('notes as n')
      .innerJoin('users as u', 'u.id', 'n.user_id')
      .select(COLS)
      .where('n.project_id', '=', projectId)
      .where('n.visibility', '=', 'all')
      .where('n.scope', 'not like', 't%')
      .orderBy('n.id', 'desc')
      .limit(500)
      .execute();
    const views = await this.views(rows, viewer);
    const scopeOf = new Map(rows.map((r) => [Number(r.id), r.scope]));
    return views.map((v) => ({ ...v, scope: scopeOf.get(v.id)! }));
  }

  async get(id: number): Promise<NoteRow | null> {
    const r = await this.db.selectFrom('notes as n').innerJoin('users as u', 'u.id', 'n.user_id').select(COLS).where('n.id', '=', id).executeTakeFirst();
    if (!r) return null;
    const reporters = (await this.reports([Number(r.id)])).get(Number(r.id)) ?? [];
    return { ...this.view(r), projectId: r.project_id, scope: r.scope, filePath: r.file_path, reporters };
  }

  /** hochgeladene Datei für eine Notiz übernehmen: gehört zum Bereich, ist da, hängt an keiner anderen Notiz */
  private async attach(projectId: number, scope: string, path: string, self?: number) {
    if (!this.files || !this.files.belongs(path, projectId, scope)) throw new NoteError('Datei gehört nicht zu diesen Notizen');
    const data = await this.files.read(path);
    const mime = data && sniffNoteFile(data);
    if (!data || !mime) throw new NoteError('Datei nicht gefunden');
    const other = await this.db.selectFrom('notes').select('id').where('file_path', '=', path).executeTakeFirst();
    if (other && other.id !== self) throw new NoteError('Datei hängt schon an einer anderen Notiz');
    return { file_path: path, file_mime: mime, file_size: data.length };
  }

  async add(projectId: number, scope: string, userId: number, input: NoteInput, visibility: Visibility = 'group'): Promise<NoteRow> {
    const n = this.clean(input);
    const f = input.file ? await this.attach(projectId, scope, input.file) : NO_FILE;
    if (NEEDS_FILE[n.kind] && !f.file_path) throw new NoteError(NEEDS_FILE[n.kind]);
    if (n.kind === 'video' && !f.file_path && !n.url) throw new NoteError('Video oder Link fehlt');
    if (f.file_mime && !fileFits(n.kind, f.file_mime)) throw new NoteError('Die Datei passt nicht zu dieser Art');
    if (!n.title && !n.body && !n.url && !n.data_json && !f.file_path) throw new NoteError('Leere Notiz');
    const at = this.now();
    const r = await this.db
      .insertInto('notes')
      .values({ project_id: projectId, scope, user_id: userId, ...n, ...f, scan: f.file_path ? (input.scan ?? null) : null, visibility: input.visibility ?? visibility, created_at: at, updated_at: at })
      .executeTakeFirst();
    return (await this.get(Number(r.insertId)))!;
  }

  async update(id: number, input: NoteInput, visibility: Visibility): Promise<NoteRow> {
    const n = this.clean(input);
    const old = await this.get(id);
    if (!old) throw new NoteError('Notiz nicht gefunden');
    let f: { file_path: string | null; file_mime: string | null; file_size: number | null } | null = null;
    if (input.file === null) f = NO_FILE;
    else if (input.file && input.file !== old.filePath) f = await this.attach(old.projectId, old.scope, input.file, id);
    const path = f ? f.file_path : old.filePath;
    const mime = f ? f.file_mime : (old.file?.mime ?? null);
    if (NEEDS_FILE[n.kind] && !path) throw new NoteError(NEEDS_FILE[n.kind]);
    if (n.kind === 'video' && !path && !n.url) throw new NoteError('Video oder Link fehlt');
    if (mime && !fileFits(n.kind, mime)) throw new NoteError('Die Datei passt nicht zu dieser Art');
    // ohne Bild kein Scan-Vermerk
    const scan = !path ? { scan: null } : input.scan !== undefined ? { scan: input.scan } : {};
    await this.db.updateTable('notes').set({ ...n, ...(f ?? {}), ...scan, visibility, updated_at: this.now() }).where('id', '=', id).execute();
    if (f && old.filePath && f.file_path !== old.filePath) await this.files?.remove(old.filePath);
    return (await this.get(id))!;
  }

  async remove(id: number): Promise<void> {
    const old = await this.get(id);
    await this.db.deleteFrom('note_reports').where('note_id', '=', id).execute();
    await this.db.deleteFrom('notes').where('id', '=', id).execute();
    if (old?.filePath) await this.files?.remove(old.filePath);
  }

  /** Meldung eintragen; false, wenn diese Person die Notiz schon gemeldet hat */
  async report(id: number, userId: number, reason: string): Promise<boolean> {
    const had = await this.db.selectFrom('note_reports').select('id').where('note_id', '=', id).where('user_id', '=', userId).executeTakeFirst();
    if (had) return false;
    await this.db.insertInto('note_reports').values({ note_id: id, user_id: userId, reason: reason.trim().slice(0, 300), created_at: this.now() }).execute();
    return true;
  }

  async clearReports(id: number): Promise<void> {
    await this.db.deleteFrom('note_reports').where('note_id', '=', id).execute();
  }

  /**
   * Darf diese Person die Notiz sehen? Die Lehrkraft immer. Sonst: gemeldet → nur Erstellerin und Meldende; privat → nur
   * die Erstellerin; Gruppe → wer den Bereich sehen darf (inScope); Allgemein → alle im Projekt.
   */
  static canSee(n: Pick<NoteRow, 'userId' | 'visibility' | 'reporters' | 'scope'>, viewer: Viewer, inScope: boolean): boolean {
    if (viewer.role === 'teacher' || n.userId === viewer.userId) return true;
    if (n.reporters.length) return n.reporters.some((r) => r.userId === viewer.userId);
    if (n.visibility === 'private') return false;
    // Testbereiche der Lehrkräfte (t…) bleiben auch mit „Allgemein“ unter sich
    return inScope || (n.visibility === 'all' && !n.scope.startsWith('t'));
  }

  /** Neue Sichtbarkeit: die Erstellerin wählt frei, die Lehrkraft darf nur auf Privat zurückstellen (8e.2) */
  static allowedVisibility(row: Pick<NoteRow, 'userId' | 'visibility'>, viewer: Viewer, wanted: Visibility | undefined): Visibility | null {
    if (!wanted || wanted === row.visibility) return row.visibility;
    if (row.userId === viewer.userId) return wanted;
    if (viewer.role === 'teacher' && wanted === 'private') return wanted;
    return null;
  }

  /** Sicht einer Person auf eine Notiz: Meldungen je nach Rolle */
  static viewFor(n: NoteRow, viewer: Viewer): NoteView {
    const { projectId: _p, scope: _s, filePath: _f, reporters, ...note } = n;
    const v: NoteView = { ...note };
    if (reporters.length) {
      const mine = reporters.some((r) => r.userId === viewer.userId);
      if (viewer.role === 'teacher' || n.userId === viewer.userId || mine) v.reported = true;
      if (mine) v.reportedByMe = true;
      if (viewer.role === 'teacher') v.reports = reporters;
    }
    return v;
  }

  /** Titel einer Notiz: eigener Titel, sonst erste Zeile des Texts, sonst der Link. */
  static cardTitle(n: Pick<Note, 'title' | 'body' | 'url'>): string {
    const first = n.body.trim().split('\n')[0] ?? '';
    return (n.title || (first.length > 120 ? first.slice(0, 117).trimEnd() + '…' : first) || n.url || 'Notiz').slice(0, 200);
  }

  /** Text einer Karte aus einer Notiz: Text, Tabelle, Fundstelle, Urheber und Lizenz, Link, Ursprungsseite. */
  static cardText(n: Pick<Note, 'title' | 'body' | 'source' | 'url'> & Partial<Pick<Note, 'credit' | 'license' | 'origin' | 'rows'>>): string {
    const table = n.rows?.length ? n.rows.map((r) => r.join(' | ')).join('\n') : '';
    const rights = [n.credit, n.license].filter(Boolean).join(', ');
    const parts = [n.title ? n.body.trim() : n.body.trim().split('\n').slice(1).join('\n').trim(), table, n.source && `Fundstelle: ${n.source}`, rights && `Bild: ${rights}`, n.origin ?? n.url ?? ''];
    return parts.filter(Boolean).join('\n\n').slice(0, 5000);
  }

  private async views(rows: RawRow[], viewer: Viewer): Promise<NoteView[]> {
    const reps = await this.reports(rows.map((r) => Number(r.id)));
    const out: NoteView[] = [];
    for (const r of rows) {
      const row: NoteRow = { ...this.view(r), projectId: r.project_id, scope: r.scope, filePath: r.file_path, reporters: reps.get(Number(r.id)) ?? [] };
      // wer den Bereich abfragt, darf ihn sehen (geprüft im Socket); „Allgemein“ enthält nur freigegebene
      if (Notes.canSee(row, viewer, true)) out.push(Notes.viewFor(row, viewer));
    }
    return out;
  }

  private async reports(ids: number[]): Promise<Map<number, NoteReport[]>> {
    const m = new Map<number, NoteReport[]>();
    if (!ids.length) return m;
    const rows = await this.db
      .selectFrom('note_reports as r')
      .innerJoin('users as u', 'u.id', 'r.user_id')
      .select(['r.note_id', 'r.user_id', 'u.name', 'r.reason', 'r.created_at'])
      .where('r.note_id', 'in', ids)
      .orderBy('r.id')
      .execute();
    for (const r of rows) {
      const l = m.get(Number(r.note_id)) ?? [];
      l.push({ userId: r.user_id, name: r.name, reason: r.reason, at: Number(r.created_at) });
      m.set(Number(r.note_id), l);
    }
    return m;
  }

  private clean(i: NoteInput) {
    const rows = i.kind === 'data' ? (i.rows ?? []).map((r) => r.map((c) => c.replace(/\r\n?/g, ' ').trim())).filter((r) => r.some(Boolean)) : [];
    return {
      kind: i.kind,
      title: i.title.trim(),
      body: i.body.replace(/\r\n?/g, '\n').trim(),
      source: i.source.trim(),
      url: i.url,
      credit: i.credit.trim(),
      license: i.license.trim(),
      origin: i.origin,
      data_json: rows.length ? JSON.stringify({ rows }) : null,
    };
  }

  private view(r: RawRow): Note {
    let rows: string[][] | null = null;
    if (r.data_json) {
      try {
        rows = (JSON.parse(r.data_json) as { rows?: string[][] }).rows ?? null;
      } catch {
        rows = null;
      }
    }
    return {
      id: Number(r.id),
      userId: r.user_id,
      name: r.name,
      kind: r.kind as Note['kind'],
      title: r.title,
      body: r.body,
      source: r.source,
      url: r.url,
      credit: r.credit ?? '',
      license: r.license ?? '',
      origin: r.origin ?? null,
      file: r.file_path && r.file_mime ? { mime: r.file_mime, size: Number(r.file_size ?? 0) } : null,
      visibility: (VISIBILITIES as readonly string[]).includes(r.visibility) ? (r.visibility as Visibility) : 'group',
      rows,
      scan: r.scan === 'hand' || r.scan === 'print' ? r.scan : null,
      at: Number(r.created_at),
      updatedAt: Number(r.updated_at),
    };
  }
}

interface RawRow {
  id: number;
  project_id: number;
  scope: string;
  user_id: number;
  name: string;
  kind: string;
  title: string;
  body: string;
  source: string;
  url: string | null;
  credit: string;
  license: string;
  origin: string | null;
  file_path: string | null;
  file_mime: string | null;
  file_size: number | null;
  visibility: string;
  data_json: string | null;
  scan: string | null;
  created_at: number;
  updated_at: number;
}
