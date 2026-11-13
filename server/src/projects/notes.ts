/**
 * Notizen und Quellen (Konzept 8d.2, Issue #8): Recherche-Karten einer Gruppe im Seiten-Thread. Eine Notiz ist ein
 * Datensatz; Karten in der Mindmap verweisen auf sie (noteId) und übernehmen Überarbeitungen.
 */
import { z } from 'zod';
import type { Db } from '../db/index.js';

export const NOTE_KINDS = ['note', 'source', 'link'] as const;

export const NoteInput = z.object({
  kind: z.enum(NOTE_KINDS).default('note'),
  title: z.string().max(200).default(''),
  body: z.string().max(10_000).default(''),
  source: z.string().max(500).default(''),
  url: z
    .string()
    .max(2000)
    .regex(/^https?:\/\//i, 'Link muss mit http:// oder https:// beginnen')
    .nullable()
    .or(z.literal('').transform(() => null))
    .default(null),
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
  at: number;
  updatedAt: number;
}

export class Notes {
  constructor(
    private db: Db,
    private now: () => number = Date.now,
  ) {}

  async list(projectId: number, scope: string): Promise<Note[]> {
    const rows = await this.db
      .selectFrom('notes as n')
      .innerJoin('users as u', 'u.id', 'n.user_id')
      .select(['n.id', 'n.user_id', 'u.name', 'n.kind', 'n.title', 'n.body', 'n.source', 'n.url', 'n.created_at', 'n.updated_at'])
      .where('n.project_id', '=', projectId)
      .where('n.scope', '=', scope)
      .orderBy('n.id', 'desc')
      .limit(500)
      .execute();
    return rows.map((r) => this.view(r));
  }

  async get(id: number): Promise<(Note & { projectId: number; scope: string }) | null> {
    const r = await this.db
      .selectFrom('notes as n')
      .innerJoin('users as u', 'u.id', 'n.user_id')
      .select(['n.id', 'n.project_id', 'n.scope', 'n.user_id', 'u.name', 'n.kind', 'n.title', 'n.body', 'n.source', 'n.url', 'n.created_at', 'n.updated_at'])
      .where('n.id', '=', id)
      .executeTakeFirst();
    return r ? { ...this.view(r), projectId: r.project_id, scope: r.scope } : null;
  }

  async add(projectId: number, scope: string, userId: number, input: NoteInput): Promise<Note> {
    const n = this.clean(input);
    if (!n.title && !n.body && !n.url) throw new Error('Leere Notiz');
    const at = this.now();
    const r = await this.db
      .insertInto('notes')
      .values({ project_id: projectId, scope, user_id: userId, ...n, created_at: at, updated_at: at })
      .executeTakeFirst();
    return (await this.get(Number(r.insertId)))!;
  }

  async update(id: number, input: NoteInput): Promise<Note> {
    const n = this.clean(input);
    await this.db.updateTable('notes').set({ ...n, updated_at: this.now() }).where('id', '=', id).execute();
    return (await this.get(id))!;
  }

  async remove(id: number): Promise<void> {
    await this.db.deleteFrom('notes').where('id', '=', id).execute();
  }

  /** Titel einer Notiz: eigener Titel, sonst erste Zeile des Texts, sonst der Link. */
  static cardTitle(n: Pick<Note, 'title' | 'body' | 'url'>): string {
    const first = n.body.trim().split('\n')[0] ?? '';
    return (n.title || (first.length > 120 ? first.slice(0, 117).trimEnd() + '…' : first) || n.url || 'Notiz').slice(0, 200);
  }

  /** Text einer Karte aus einer Notiz: Text, Fundstelle, Link. */
  static cardText(n: Pick<Note, 'title' | 'body' | 'source' | 'url'>): string {
    const parts = [n.title ? n.body.trim() : n.body.trim().split('\n').slice(1).join('\n').trim(), n.source && `Fundstelle: ${n.source}`, n.url ?? ''];
    return parts.filter(Boolean).join('\n\n').slice(0, 5000);
  }

  private clean(i: NoteInput) {
    return { kind: i.kind, title: i.title.trim(), body: i.body.replace(/\r\n?/g, '\n').trim(), source: i.source.trim(), url: i.url };
  }

  private view(r: { id: number; user_id: number; name: string; kind: string; title: string; body: string; source: string; url: string | null; created_at: number; updated_at: number }): Note {
    return {
      id: Number(r.id),
      userId: r.user_id,
      name: r.name,
      kind: r.kind as Note['kind'],
      title: r.title,
      body: r.body,
      source: r.source,
      url: r.url,
      at: Number(r.created_at),
      updatedAt: Number(r.updated_at),
    };
  }
}
