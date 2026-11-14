/**
 * Einfüge-Protokoll (Konzept 6.1, 8d.3): Wer Text von außen einsetzt (ab der Schwelle aus den Einstellungen), hinterlässt
 * einen Eintrag mit Ort, Länge, Anfang und Prüfsumme, auf Wunsch mit der Antwort auf „Woher stammt der Text?“.
 * Gespeichert wird nur der Anfang des Texts. Einsetzen innerhalb des Projekts wird nicht protokolliert.
 */
import { z } from 'zod';
import type { Db } from '../db/index.js';
import { sha256 } from '../security/crypto.js';

export const PASTE_ANSWERS = ['quote', 'draft', 'ai', 'other'] as const;
export const SAMPLE_CHARS = 300;

export const PasteInput = z.object({
  scope: z.string().min(1).max(20),
  place: z.string().max(300).default(''),
  text: z.string().min(1).max(200_000),
  answer: z.enum(PASTE_ANSWERS).nullable().default(null),
  note: z.string().max(1000).default(''),
});
export type PasteInput = z.infer<typeof PasteInput>;

export const PasteAnswer = z.object({ answer: z.enum(PASTE_ANSWERS), note: z.string().max(1000).default('') });

export interface Paste {
  id: number;
  scope: string;
  userId: number;
  name: string;
  place: string;
  chars: number;
  sample: string;
  answer: (typeof PASTE_ANSWERS)[number] | null;
  note: string;
  at: number;
  answeredAt: number | null;
}

export class Pastes {
  constructor(
    private db: Db,
    private now: () => number = Date.now,
  ) {}

  async add(projectId: number, userId: number, p: PasteInput): Promise<number> {
    const t = this.now();
    const r = await this.db
      .insertInto('pastes')
      .values({
        project_id: projectId,
        scope: p.scope,
        user_id: userId,
        place: p.place,
        chars: [...p.text].length,
        sample: [...p.text].slice(0, SAMPLE_CHARS).join(''),
        hash: sha256(p.text),
        answer: p.answer,
        note: p.note,
        created_at: t,
        answered_at: p.answer ? t : null,
      })
      .executeTakeFirst();
    return Number(r.insertId);
  }

  async get(id: number) {
    return (await this.db.selectFrom('pastes').selectAll().where('id', '=', id).executeTakeFirst()) ?? null;
  }

  async answer(id: number, a: z.infer<typeof PasteAnswer>) {
    await this.db.updateTable('pastes').set({ answer: a.answer, note: a.note, answered_at: this.now() }).where('id', '=', id).execute();
  }

  /** Einträge in den genannten Bereichen; mit userId nur die eigenen */
  async list(projectId: number, scopes: string[], userId?: number): Promise<Paste[]> {
    if (!scopes.length) return [];
    let q = this.db
      .selectFrom('pastes as p')
      .innerJoin('users as u', 'u.id', 'p.user_id')
      .select(['p.id', 'p.scope', 'p.user_id', 'u.name', 'p.place', 'p.chars', 'p.sample', 'p.answer', 'p.note', 'p.created_at', 'p.answered_at'])
      .where('p.project_id', '=', projectId)
      .where('p.scope', 'in', scopes);
    if (userId !== undefined) q = q.where('p.user_id', '=', userId);
    const rows = await q.orderBy('p.id', 'desc').limit(500).execute();
    return rows.map((r) => ({
      id: r.id,
      scope: r.scope,
      userId: r.user_id,
      name: r.name,
      place: r.place,
      chars: r.chars,
      sample: r.sample,
      answer: r.answer as Paste['answer'],
      note: r.note,
      at: Number(r.created_at),
      answeredAt: r.answered_at === null ? null : Number(r.answered_at),
    }));
  }
}
