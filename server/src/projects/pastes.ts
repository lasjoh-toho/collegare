/**
 * Einfüge-Protokoll (Konzept 6.1, 8d.3): Wer Text von außen einsetzt (ab der Schwelle aus den Einstellungen), hinterlässt
 * einen Eintrag mit Ort, Länge, Anfang und Prüfsumme, auf Wunsch mit der Antwort auf „Woher stammt der Text?“.
 * Einsetzen innerhalb des Projekts wird nicht protokolliert.
 *
 * Seit 20. November 2026 (Wunsch Jo): Standardmäßig wird jedes Einsetzen von außen protokolliert (pasteLogAll), damit
 * sich die Grenze nicht absatzweise umgehen lässt; die Grenze zählt je Ziel (Karte, Notiz) alles zusammen. Der ganze
 * Text wird gespeichert (höchstens FULL_CHARS), damit die Lehrkraft sieht, welche Stellen eines Texts noch aus welcher
 * Vorlage stammen (Paste and Shake, client/lib/trace.ts). Einträge aus der Texterkennung (origin print/hand) tragen
 * das Bild als Notiz (note_id).
 */
import { z } from 'zod';
import type { Db } from '../db/index.js';
import { sha256 } from '../security/crypto.js';

export const PASTE_ANSWERS = ['quote', 'draft', 'ai', 'other'] as const;
export const SAMPLE_CHARS = 300;
/** so viel vom eingesetzten Text bleibt für die Spur im Text */
export const FULL_CHARS = 50_000;
export const PASTE_ORIGINS = ['paste', 'print', 'hand'] as const;
export type PasteOrigin = (typeof PASTE_ORIGINS)[number];
/** Ziel eines Eintrags: Karte der Mindmap oder Notiz */
export const TARGET = /^(card|note):[A-Za-z0-9_-]{1,40}$/;

export const PasteInput = z.object({
  scope: z.string().min(1).max(20),
  place: z.string().max(300).default(''),
  text: z.string().min(1).max(200_000),
  answer: z.enum(PASTE_ANSWERS).nullable().default(null),
  note: z.string().max(1000).default(''),
  target: z.string().regex(TARGET).or(z.literal('')).default(''),
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
  target: string;
  origin: PasteOrigin;
  /** Notiz mit dem Bild (Texterkennung) */
  noteId: number | null;
}

/** Eintrag mit ganzem Text, für die Spur im Text */
export interface PasteTrace {
  id: number;
  scope: string;
  userId: number;
  name: string;
  origin: PasteOrigin;
  answer: Paste['answer'];
  note: string;
  at: number;
  text: string;
}

export class Pastes {
  constructor(
    private db: Db,
    private now: () => number = Date.now,
  ) {}

  async add(projectId: number, userId: number, p: PasteInput, extra: { origin?: PasteOrigin; noteId?: number | null } = {}): Promise<number> {
    const t = this.now();
    const chars = [...p.text];
    const r = await this.db
      .insertInto('pastes')
      .values({
        project_id: projectId,
        scope: p.scope,
        user_id: userId,
        place: p.place,
        chars: chars.length,
        sample: chars.slice(0, SAMPLE_CHARS).join(''),
        full_text: chars.slice(0, FULL_CHARS).join(''),
        target: p.target,
        origin: extra.origin ?? 'paste',
        note_id: extra.noteId ?? null,
        hash: sha256(p.text),
        answer: p.answer,
        note: p.note,
        created_at: t,
        answered_at: p.answer ? t : null,
      })
      .executeTakeFirst();
    return Number(r.insertId);
  }

  /**
   * Text aus der Texterkennung protokollieren (Druckschrift oder Handschrift, mit dem Bild als Notiz). Wird vom
   * Erkennungsdienst aufgerufen, sobald Collegare mit Autogra.fi verbunden ist (Konzept 8d.4).
   */
  async addOcr(projectId: number, scope: string, userId: number, o: { noteId: number; script: 'print' | 'hand'; text: string; place: string }) {
    return this.add(projectId, userId, { scope, place: o.place, text: o.text, answer: null, note: '', target: `note:${o.noteId}` }, { origin: o.script, noteId: o.noteId });
  }

  /** Wie viele Zeichen hat die Person schon von außen in dieses Ziel eingesetzt? (Grenze je Ziel) */
  async totalFor(projectId: number, userId: number, target: string): Promise<number> {
    if (!target) return 0;
    const r = await this.db
      .selectFrom('pastes')
      .select((eb) => eb.fn.sum<number>('chars').as('n'))
      .where('project_id', '=', projectId)
      .where('user_id', '=', userId)
      .where('target', '=', target)
      .where('origin', '=', 'paste')
      .executeTakeFirst();
    return Number(r?.n ?? 0);
  }

  /** alle Einträge eines Ziels mit ganzem Text (älteste zuerst) */
  async trace(projectId: number, target: string): Promise<PasteTrace[]> {
    const rows = await this.db
      .selectFrom('pastes as p')
      .innerJoin('users as u', 'u.id', 'p.user_id')
      .select(['p.id', 'p.scope', 'p.user_id', 'u.name', 'p.origin', 'p.answer', 'p.note', 'p.created_at', 'p.full_text', 'p.sample'])
      .where('p.project_id', '=', projectId)
      .where('p.target', '=', target)
      .orderBy('p.id', 'asc')
      .limit(200)
      .execute();
    return rows.map((r) => ({
      id: r.id,
      scope: r.scope,
      userId: r.user_id,
      name: r.name,
      origin: r.origin as PasteOrigin,
      answer: r.answer as Paste['answer'],
      note: r.note,
      at: Number(r.created_at),
      text: r.full_text ?? r.sample,
    }));
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
      .select(['p.id', 'p.scope', 'p.user_id', 'u.name', 'p.place', 'p.chars', 'p.sample', 'p.answer', 'p.note', 'p.created_at', 'p.answered_at', 'p.target', 'p.origin', 'p.note_id'])
      .where('p.project_id', '=', projectId)
      .where('p.scope', 'in', scopes);
    if (userId !== undefined) q = q.where('p.user_id', '=', userId);
    const rows = await q.orderBy('p.id', 'desc').limit(2000).execute();
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
      target: r.target,
      origin: r.origin as PasteOrigin,
      noteId: r.note_id,
    }));
  }
}
