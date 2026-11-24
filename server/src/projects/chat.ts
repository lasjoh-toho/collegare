/**
 * Chat je Gruppe und für alle im Projekt (Wunsch Jo, 11. November 2026). Kurze Nachrichten in Echtzeit;
 * die Lehrkraft liest alle Chats und darf Nachrichten löschen, Lernende nur ihre eigenen.
 */
import type { Db } from '../db/index.js';
import type { NoteFiles } from './noteFiles.js';

export const CHAT_MAX = 2000;
const PAGE = 200;

export interface ChatMessage {
  id: number;
  userId: number;
  name: string;
  body: string;
  at: number;
  /** Nachricht mit Bild (GET /api/projects/:id/chat/:mid/bild) */
  image?: true;
}

export class Chat {
  constructor(
    private db: Db,
    private now: () => number = Date.now,
    readonly files?: NoteFiles,
  ) {}

  /** Die letzten Nachrichten eines Chats, älteste zuerst (before: nur ältere als diese ID). */
  async list(projectId: number, scope: string, before?: number): Promise<ChatMessage[]> {
    let q = this.db
      .selectFrom('chat_messages as c')
      .innerJoin('users as u', 'u.id', 'c.user_id')
      .select(['c.id', 'c.user_id', 'u.name', 'c.body', 'c.created_at', 'c.file_path'])
      .where('c.project_id', '=', projectId)
      .where('c.scope', '=', scope);
    if (before) q = q.where('c.id', '<', before);
    const rows = await q.orderBy('c.id', 'desc').limit(PAGE).execute();
    return rows.reverse().map((r) => ({ id: Number(r.id), userId: r.user_id, name: r.name, body: r.body, at: Number(r.created_at), ...(r.file_path ? { image: true as const } : {}) }));
  }

  /** file: vorher hochgeladenes Bild dieses Chats (storeImage); dann darf der Text leer sein */
  async add(projectId: number, scope: string, userId: number, body: string, file?: string): Promise<ChatMessage> {
    const text = body.replace(/\r\n?/g, '\n').trim().slice(0, CHAT_MAX);
    if (file) {
      if (!this.files?.belongs(file, projectId, scope) || (await this.files.size(file)) === null) throw new Error('Das Bild gehört nicht zu diesem Chat');
      const used = await this.db.selectFrom('chat_messages').select('id').where('file_path', '=', file).executeTakeFirst();
      if (used) throw new Error('Das Bild ist schon verschickt');
    }
    if (!text && !file) throw new Error('Leere Nachricht');
    const at = this.now();
    const r = await this.db
      .insertInto('chat_messages')
      .values({ project_id: projectId, scope, user_id: userId, body: text, created_at: at, file_path: file ?? null })
      .executeTakeFirst();
    const user = await this.db.selectFrom('users').select('name').where('id', '=', userId).executeTakeFirst();
    return { id: Number(r.insertId), userId, name: user?.name ?? 'unbekannt', body: text, at, ...(file ? { image: true as const } : {}) };
  }

  async storeImage(projectId: number, scope: string, data: Buffer): Promise<string> {
    if (!this.files) throw new Error('Kein Ablageordner');
    return this.files.store(projectId, scope, 'bild', data);
  }

  async get(id: number): Promise<{ projectId: number; scope: string; userId: number; filePath: string | null } | null> {
    const r = await this.db.selectFrom('chat_messages').select(['project_id', 'scope', 'user_id', 'file_path']).where('id', '=', id).executeTakeFirst();
    return r ? { projectId: r.project_id, scope: r.scope, userId: r.user_id, filePath: r.file_path ?? null } : null;
  }

  async remove(id: number): Promise<void> {
    const row = await this.get(id);
    await this.db.deleteFrom('chat_messages').where('id', '=', id).execute();
    await this.files?.remove(row?.filePath);
  }
}
