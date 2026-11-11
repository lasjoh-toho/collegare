/**
 * Chat in Echtzeit im Namespace /project: chat:join, chat:send, chat:delete, chat:more.
 * Bereiche: 'p' = alle im Projekt, 'g<id>' = eine Gruppe. Lernende sehen nur den Chat ihrer Gruppe und den für alle;
 * die Lehrkraft alle. Beide lassen sich in den Projekt-Einstellungen abschalten.
 */
import type { Namespace, Socket } from 'socket.io';
import { z } from 'zod';
import { CHAT_MAX } from '../projects/chat.js';
import type { Services } from '../services.js';

type Ack = (r: Record<string, unknown>) => void;
const room = (projectId: number, scope: string) => `chat:${projectId}:${scope}`;

export interface ChatScope {
  scope: string;
  title: string;
}

export async function chatScopes(s: Services, userId: number, projectId: number): Promise<{ role: 'teacher' | 'student'; scopes: ChatScope[] } | null> {
  const role = await s.projects.roleOf(userId, projectId);
  if (!role) return null;
  const project = await s.projects.get(projectId);
  if (!project) return null;
  const settings = project.settings;
  const scopes: ChatScope[] = [];
  if (settings.chatAll !== false) scopes.push({ scope: 'p', title: 'Alle im Projekt' });
  const board = await s.projects.board(projectId);
  if (settings.chatGroups !== false && board.mode === 'group') {
    const me = board.members.find((m) => m.userId === userId);
    board.groups.forEach((g, i) => {
      if (role === 'teacher' || me?.groupId === g.id) scopes.push({ scope: 'g' + g.id, title: g.title || `Gruppe ${i + 1}` });
    });
  }
  return { role, scopes };
}

const Send = z.object({ projectId: z.number().int(), scope: z.string().max(20), text: z.string().min(1).max(CHAT_MAX * 2) });

export function chatSocket(nsp: Namespace, s: Services) {
  nsp.on('connection', (socket: Socket) => {
    const sess = () => socket.data.session as { userId: number; projectId: number | null };
    let lastSend = 0;

    async function resolve(projectIdRaw: unknown, scopeRaw: unknown) {
      const projectId = Number(projectIdRaw);
      const { userId, projectId: bound } = sess();
      if (!Number.isInteger(projectId) || (bound !== null && bound !== projectId)) return null;
      const r = await chatScopes(s, userId, projectId);
      if (!r) return null;
      // ohne Wunsch: der Chat der eigenen Gruppe, sonst der für alle
      const sc = typeof scopeRaw === 'string' ? r.scopes.find((x) => x.scope === scopeRaw) : (r.scopes.find((x) => x.scope !== 'p') ?? r.scopes[0]);
      return { projectId, role: r.role, scopes: r.scopes, scope: sc ?? null };
    }

    socket.on('chat:join', async (msg: { projectId?: unknown; scope?: unknown }, ack?: Ack) => {
      try {
        const r = await resolve(msg?.projectId, msg?.scope);
        if (!r) return ack?.({ ok: false, error: 'Kein Zugriff auf dieses Projekt' });
        for (const rm of socket.rooms) if (rm.startsWith('chat:')) void socket.leave(rm);
        if (!r.scope) return ack?.({ ok: true, role: r.role, scopes: r.scopes, scope: null, messages: [] });
        await socket.join(room(r.projectId, r.scope.scope));
        const messages = await s.chat.list(r.projectId, r.scope.scope);
        ack?.({ ok: true, role: r.role, scopes: r.scopes, scope: r.scope.scope, messages, me: sess().userId });
      } catch (e) {
        ack?.({ ok: false, error: e instanceof Error ? e.message : String(e) });
      }
    });

    socket.on('chat:more', async (msg: { projectId?: unknown; scope?: unknown; before?: unknown }, ack?: Ack) => {
      const r = await resolve(msg?.projectId, msg?.scope);
      if (!r?.scope || typeof msg.scope !== 'string') return ack?.({ ok: false, error: 'Kein Zugriff auf diesen Chat' });
      ack?.({ ok: true, messages: await s.chat.list(r.projectId, r.scope.scope, Number(msg.before) || undefined) });
    });

    socket.on('chat:send', async (msg: unknown, ack?: Ack) => {
      try {
        const m = Send.safeParse(msg);
        if (!m.success) return ack?.({ ok: false, error: 'Ungültige Nachricht' });
        const r = await resolve(m.data.projectId, m.data.scope);
        if (!r?.scope) return ack?.({ ok: false, error: 'Kein Zugriff auf diesen Chat' });
        const t = Date.now();
        if (t - lastSend < 400) return ack?.({ ok: false, error: 'Bitte etwas langsamer' });
        lastSend = t;
        const message = await s.chat.add(r.projectId, r.scope.scope, sess().userId, m.data.text);
        nsp.to(room(r.projectId, r.scope.scope)).emit('chat', { projectId: r.projectId, scope: r.scope.scope, message });
        ack?.({ ok: true, id: message.id });
      } catch (e) {
        ack?.({ ok: false, error: e instanceof Error ? e.message : 'Senden fehlgeschlagen' });
      }
    });

    socket.on('chat:delete', async (msg: { projectId?: unknown; id?: unknown }, ack?: Ack) => {
      try {
        const id = Number(msg?.id);
        const row = Number.isInteger(id) ? await s.chat.get(id) : null;
        if (!row) return ack?.({ ok: false, error: 'Nachricht nicht gefunden' });
        const r = await resolve(row.projectId, row.scope);
        if (!r?.scope || r.projectId !== Number(msg?.projectId)) return ack?.({ ok: false, error: 'Kein Zugriff auf diesen Chat' });
        if (r.role !== 'teacher' && row.userId !== sess().userId) return ack?.({ ok: false, error: 'Nur eigene Nachrichten lassen sich löschen' });
        await s.chat.remove(id);
        if (row.userId !== sess().userId) await s.audit.append({ actorId: sess().userId, action: 'chat.deleted', projectId: row.projectId, data: { scope: row.scope, author: row.userId } });
        nsp.to(room(row.projectId, row.scope)).emit('chat:gone', { projectId: row.projectId, scope: row.scope, id });
        ack?.({ ok: true });
      } catch (e) {
        ack?.({ ok: false, error: e instanceof Error ? e.message : 'Löschen fehlgeschlagen' });
      }
    });
  });
}
