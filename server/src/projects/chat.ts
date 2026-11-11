/**
 * Chat je Gruppe und für alle im Projekt (Wunsch Jo, 11. November 2026). Kurze Nachrichten in Echtzeit;
 * die Lehrkraft liest alle Chats und darf Nachrichten löschen, Lernende nur ihre eigenen.
 */
import type { Db } from '../db/index.js';

export const CHAT_MAX = 2000;
const PAGE = 200;

export interface ChatMessage {
  id: number;
  userId: number;
  name: string;
  body: string;
  at: number;
}

export class Chat {
  constructor(
    private db: Db,
    private now: () => number = Date.now,
  ) {}

  /** Die letzten Nachrichten eines Chats, älteste zuerst (before: nur ältere als diese ID). */
  async list(projectId: number, scope: string, before?: number): Promise<ChatMessage[]> {
    let q = this.db
      .selectFrom('chat_messages as c')
      .innerJoin('users as u', 'u.id', 'c.user_id')
      .select(['c.id', 'c.user_id', 'u.name', 'c.body', 'c.created_at'])
      .where('c.project_id', '=', projectId)
      .where('c.scope', '=', scope);
    if (before) q = q.where('c.id', '<', before);
    const rows = await q.orderBy('c.id', 'desc').limit(PAGE).execute();
    return rows.reverse().map((r) => ({ id: Number(r.id), userId: r.user_id, name: r.name, body: r.body, at: Number(r.created_at) }));
  }

  async add(projectId: number, scope: string, userId: number, body: string): Promise<ChatMessage> {
    const text = body.replace(/\r\n?/g, '\n').trim().slice(0, CHAT_MAX);
    if (!text) throw new Error('Leere Nachricht');
    const at = this.now();
    const r = await this.db.insertInto('chat_messages').values({ project_id: projectId, scope, user_id: userId, body: text, created_at: at }).executeTakeFirst();
    const user = await this.db.selectFrom('users').select('name').where('id', '=', userId).executeTakeFirst();
    return { id: Number(r.insertId), userId, name: user?.name ?? 'unbekannt', body: text, at };
  }

  async get(id: number): Promise<{ projectId: number; scope: string; userId: number } | null> {
    const r = await this.db.selectFrom('chat_messages').select(['project_id', 'scope', 'user_id']).where('id', '=', id).executeTakeFirst();
    return r ? { projectId: r.project_id, scope: r.scope, userId: r.user_id } : null;
  }

  async remove(id: number): Promise<void> {
    await this.db.deleteFrom('chat_messages').where('id', '=', id).execute();
  }
}
