/**
 * Eigene Linie (Konzept 8e.7): Jede Person bringt Notizen in eine eigene Reihenfolge parallel zur Gliederung, als
 * senkrechte U-Bahn-Linie mit Stationen. Eine Station ist eine Notiz, gehört zu einem Abschnitt der Gliederung (oder
 * keinem) und kann weitere Karten angehängt haben, die sichtbar (erscheinen später auf derselben Folie bzw. im selben
 * Absatz) oder ausgeblendet (bleiben als Beleg dabei) sind. Die Linie gehört der Person, nicht den Notizen.
 */
import { z } from 'zod';
import type { Db } from '../db/index.js';

export const Line = z.object({
  stations: z
    .array(
      z.object({
        id: z.string().min(1).max(40),
        noteId: z.number().int().positive(),
        section: z.string().max(80).nullable(),
        attached: z.array(z.object({ noteId: z.number().int().positive(), visible: z.boolean() })).max(20),
      }),
    )
    .max(200),
});
export type Line = z.infer<typeof Line>;

export class NoteLines {
  constructor(
    private db: Db,
    private now: () => number = Date.now,
  ) {}

  async get(projectId: number, scope: string, userId: number): Promise<{ line: Line; at: number }> {
    const r = await this.db.selectFrom('note_lines').select(['data', 'updated_at']).where('project_id', '=', projectId).where('scope', '=', scope).where('user_id', '=', userId).executeTakeFirst();
    if (!r) return { line: { stations: [] }, at: 0 };
    const p = Line.safeParse(JSON.parse(r.data));
    return { line: p.success ? p.data : { stations: [] }, at: Number(r.updated_at) };
  }

  async save(projectId: number, scope: string, userId: number, line: Line): Promise<number> {
    const at = this.now();
    const data = JSON.stringify(line);
    const had = await this.db.selectFrom('note_lines').select('id').where('project_id', '=', projectId).where('scope', '=', scope).where('user_id', '=', userId).executeTakeFirst();
    if (had) await this.db.updateTable('note_lines').set({ data, updated_at: at }).where('id', '=', had.id).execute();
    else await this.db.insertInto('note_lines').values({ project_id: projectId, scope, user_id: userId, data, updated_at: at }).execute();
    return at;
  }
}
