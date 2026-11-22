import type { Db } from '../db/index.js';

/**
 * Kommentare der Lehrkraft an Abschnitten der Ausarbeitung (Jo, 22. November 2026): Lehrkräfte schreiben nicht in die
 * Texte der Gruppen, sondern hinterlassen ein Post-it „Kommentar für die Gruppe …“. Die Gruppe sieht es am Panel und
 * kann es als erledigt abhaken.
 */
export interface DocComment {
  id: number;
  docId: number;
  by: number;
  name: string;
  body: string;
  at: number;
  doneAt: number | null;
}

export class DocComments {
  constructor(private db: Db) {}

  async forDocs(ids: number[]): Promise<Record<number, DocComment[]>> {
    const out: Record<number, DocComment[]> = {};
    if (!ids.length) return out;
    const rows = await this.db
      .selectFrom('doc_comments as c')
      .leftJoin('users as u', 'u.id', 'c.by')
      .select(['c.id', 'c.doc_id', 'c.by', 'c.body', 'c.at', 'c.done_at', 'u.name'])
      .where('c.doc_id', 'in', ids)
      .orderBy('c.at')
      .execute();
    for (const r of rows)
      (out[r.doc_id] ??= []).push({ id: r.id, docId: r.doc_id, by: r.by, name: r.name ?? '', body: r.body, at: Number(r.at), doneAt: r.done_at === null ? null : Number(r.done_at) });
    return out;
  }

  async get(id: number) {
    return this.db.selectFrom('doc_comments').selectAll().where('id', '=', id).executeTakeFirst();
  }

  async add(docId: number, by: number, body: string): Promise<number> {
    const r = await this.db.insertInto('doc_comments').values({ doc_id: docId, by, body, at: Date.now(), done_at: null }).executeTakeFirst();
    return Number(r.insertId);
  }

  async setDone(id: number, done: boolean): Promise<void> {
    await this.db.updateTable('doc_comments').set({ done_at: done ? Date.now() : null }).where('id', '=', id).execute();
  }

  async remove(id: number): Promise<void> {
    await this.db.deleteFrom('doc_comments').where('id', '=', id).execute();
  }
}
