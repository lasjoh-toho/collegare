/**
 * Notizen und Quellen (Konzept 8d.2, Issue #8): Recherche-Karten einer Gruppe im Seiten-Thread. Eine Notiz ist ein
 * Datensatz; Karten in der Mindmap verweisen auf sie (noteId) und übernehmen Überarbeitungen.
 */
import { z } from 'zod';
import type { Db } from '../db/index.js';
import { noteFileAllowed, type NoteFiles } from './noteFiles.js';
import { sniffImage } from './webImport.js';

/** image: Bild mit Datei, Urheber, Lizenz und Ursprungsseite (Bilder per Ziehen/Einfügen, Wunsch Jo 17.11.2026) */
export const NOTE_KINDS = ['note', 'source', 'link', 'image'] as const;

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
});
export type NoteInput = z.infer<typeof NoteInput>;

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
  at: number;
  updatedAt: number;
}

export class NoteError extends Error {}

/** Typ einer hochgeladenen Notizdatei aus ihren ersten Bytes (für Audio/Video hier ergänzen) */
export function sniffNoteFile(b: Buffer): string | null {
  const m = sniffImage(b);
  return m && noteFileAllowed(m) ? m : null;
}

const COLS = ['n.id', 'n.user_id', 'u.name', 'n.kind', 'n.title', 'n.body', 'n.source', 'n.url', 'n.credit', 'n.license', 'n.origin', 'n.file_path', 'n.file_mime', 'n.file_size', 'n.created_at', 'n.updated_at'] as const;
type Row = { id: number; user_id: number; name: string; kind: string; title: string; body: string; source: string; url: string | null; credit: string; license: string; origin: string | null; file_path: string | null; file_mime: string | null; file_size: number | null; created_at: number; updated_at: number };

export class Notes {
  constructor(
    private db: Db,
    private now: () => number = Date.now,
    readonly files?: NoteFiles,
  ) {}

  async list(projectId: number, scope: string): Promise<Note[]> {
    const rows = await this.db
      .selectFrom('notes as n')
      .innerJoin('users as u', 'u.id', 'n.user_id')
      .select(COLS)
      .where('n.project_id', '=', projectId)
      .where('n.scope', '=', scope)
      .orderBy('n.id', 'desc')
      .limit(500)
      .execute();
    return rows.map((r) => this.view(r));
  }

  async get(id: number): Promise<(Note & { projectId: number; scope: string; filePath: string | null }) | null> {
    const r = await this.db
      .selectFrom('notes as n')
      .innerJoin('users as u', 'u.id', 'n.user_id')
      .select([...COLS, 'n.project_id', 'n.scope'])
      .where('n.id', '=', id)
      .executeTakeFirst();
    return r ? { ...this.view(r), projectId: r.project_id, scope: r.scope, filePath: r.file_path } : null;
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

  async add(projectId: number, scope: string, userId: number, input: NoteInput): Promise<Note> {
    const n = this.clean(input);
    const f = input.file ? await this.attach(projectId, scope, input.file) : { file_path: null, file_mime: null, file_size: null };
    if (n.kind === 'image' && !f.file_path) throw new NoteError('Bild fehlt');
    if (!n.title && !n.body && !n.url && !f.file_path) throw new NoteError('Leere Notiz');
    const at = this.now();
    const r = await this.db
      .insertInto('notes')
      .values({ project_id: projectId, scope, user_id: userId, ...n, ...f, created_at: at, updated_at: at })
      .executeTakeFirst();
    return (await this.get(Number(r.insertId)))!;
  }

  async update(id: number, input: NoteInput): Promise<Note> {
    const n = this.clean(input);
    const old = await this.get(id);
    if (!old) throw new NoteError('Notiz nicht gefunden');
    let f: { file_path: string | null; file_mime: string | null; file_size: number | null } | null = null;
    if (input.file === null) f = { file_path: null, file_mime: null, file_size: null };
    else if (input.file && input.file !== old.filePath) f = await this.attach(old.projectId, old.scope, input.file, id);
    if (n.kind === 'image' && !(f ? f.file_path : old.filePath)) throw new NoteError('Bild fehlt');
    await this.db.updateTable('notes').set({ ...n, ...(f ?? {}), updated_at: this.now() }).where('id', '=', id).execute();
    if (f && old.filePath && f.file_path !== old.filePath) await this.files?.remove(old.filePath);
    return (await this.get(id))!;
  }

  async remove(id: number): Promise<void> {
    const old = await this.get(id);
    await this.db.deleteFrom('notes').where('id', '=', id).execute();
    if (old?.filePath) await this.files?.remove(old.filePath);
  }

  /** Titel einer Notiz: eigener Titel, sonst erste Zeile des Texts, sonst der Link. */
  static cardTitle(n: Pick<Note, 'title' | 'body' | 'url'>): string {
    const first = n.body.trim().split('\n')[0] ?? '';
    return (n.title || (first.length > 120 ? first.slice(0, 117).trimEnd() + '…' : first) || n.url || 'Notiz').slice(0, 200);
  }

  /** Text einer Karte aus einer Notiz: Text, Fundstelle, Urheber und Lizenz, Link, Ursprungsseite. */
  static cardText(n: Pick<Note, 'title' | 'body' | 'source' | 'url'> & Partial<Pick<Note, 'credit' | 'license' | 'origin'>>): string {
    const rights = [n.credit, n.license].filter(Boolean).join(', ');
    const parts = [n.title ? n.body.trim() : n.body.trim().split('\n').slice(1).join('\n').trim(), n.source && `Fundstelle: ${n.source}`, rights && `Bild: ${rights}`, n.origin ?? n.url ?? ''];
    return parts.filter(Boolean).join('\n\n').slice(0, 5000);
  }

  private clean(i: NoteInput) {
    return { kind: i.kind, title: i.title.trim(), body: i.body.replace(/\r\n?/g, '\n').trim(), source: i.source.trim(), url: i.url, credit: i.credit.trim(), license: i.license.trim(), origin: i.origin };
  }

  private view(r: Row): Note {
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
      at: Number(r.created_at),
      updatedAt: Number(r.updated_at),
    };
  }
}
