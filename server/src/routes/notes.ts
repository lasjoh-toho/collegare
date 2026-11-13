/**
 * Notizen und Quellen in Echtzeit im Namespace /project: notes:join, notes:add, notes:update, notes:delete.
 * Bereiche wie die Mindmaps (eigene Gruppe bzw. eigene Person im Einzelmodus; die Lehrkraft alle). Überarbeitete
 * Notizen werden in die Mindmap-Karten übernommen, die auf sie verweisen.
 */
import type { Namespace, Socket } from 'socket.io';
import { NoteInput, Notes } from '../projects/notes.js';
import type { Services } from '../services.js';
import { mapScopes } from './maps.js';

type Ack = (r: Record<string, unknown>) => void;
const room = (projectId: number, scope: string) => `notes:${projectId}:${scope}`;

export function notesSocket(nsp: Namespace, s: Services) {
  nsp.on('connection', (socket: Socket) => {
    const sess = () => socket.data.session as { userId: number; projectId: number | null };

    async function resolve(projectIdRaw: unknown, scopeRaw: unknown) {
      const projectId = Number(projectIdRaw);
      const { userId, projectId: bound } = sess();
      if (!Number.isInteger(projectId) || (bound !== null && bound !== projectId)) return null;
      const r = await mapScopes(s, userId, projectId);
      if (!r) return null;
      const sc = typeof scopeRaw === 'string' ? r.scopes.find((x) => x.scope === scopeRaw) : r.scopes[0];
      return { projectId, role: r.role, scopes: r.scopes, scope: sc ?? null };
    }

    /** Karten in der Mindmap nachziehen und allen zeigen, die sie offen haben */
    async function syncMap(projectId: number, scope: string, noteId: number, title: string, text: string, gone = false) {
      const res = await s.maps.syncNote(projectId, scope, noteId, title, text, gone);
      if (res) nsp.to(`map:${projectId}:${scope}`).emit('map', { projectId, scope, map: res.map, version: res.version, by: sess().userId });
    }

    socket.on('notes:join', async (msg: { projectId?: unknown; scope?: unknown }, ack?: Ack) => {
      try {
        const r = await resolve(msg?.projectId, msg?.scope);
        if (!r) return ack?.({ ok: false, error: 'Kein Zugriff auf dieses Projekt' });
        for (const rm of socket.rooms) if (rm.startsWith('notes:')) void socket.leave(rm);
        const scopes = r.scopes.map(({ scope, title }) => ({ scope, title }));
        if (!r.scope) return ack?.({ ok: true, role: r.role, scopes, scope: null, notes: [] });
        await socket.join(room(r.projectId, r.scope.scope));
        ack?.({ ok: true, role: r.role, scopes, scope: r.scope.scope, notes: await s.notes.list(r.projectId, r.scope.scope) });
      } catch (e) {
        ack?.({ ok: false, error: e instanceof Error ? e.message : String(e) });
      }
    });

    socket.on('notes:add', async (msg: { projectId?: unknown; scope?: unknown; note?: unknown }, ack?: Ack) => {
      try {
        const r = await resolve(msg?.projectId, msg?.scope);
        if (!r?.scope || typeof msg.scope !== 'string') return ack?.({ ok: false, error: 'Kein Zugriff auf diese Notizen' });
        const input = NoteInput.safeParse(msg.note);
        if (!input.success) return ack?.({ ok: false, error: input.error.issues[0]?.message ?? 'Ungültige Notiz' });
        const note = await s.notes.add(r.projectId, r.scope.scope, sess().userId, input.data);
        nsp.to(room(r.projectId, r.scope.scope)).emit('note', { projectId: r.projectId, scope: r.scope.scope, note });
        ack?.({ ok: true, id: note.id });
      } catch (e) {
        ack?.({ ok: false, error: e instanceof Error ? e.message : 'Speichern fehlgeschlagen' });
      }
    });

    /** gemeinsame Prüfung für Ändern und Löschen: eigene Notiz oder Lehrkraft */
    async function own(msg: { projectId?: unknown; id?: unknown }) {
      const id = Number(msg?.id);
      const row = Number.isInteger(id) ? await s.notes.get(id) : null;
      if (!row) return { error: 'Notiz nicht gefunden' };
      const r = await resolve(row.projectId, row.scope);
      if (!r?.scope || r.projectId !== Number(msg?.projectId)) return { error: 'Kein Zugriff auf diese Notizen' };
      if (r.role !== 'teacher' && row.userId !== sess().userId) return { error: 'Nur eigene Notizen lassen sich ändern' };
      return { row };
    }

    socket.on('notes:update', async (msg: { projectId?: unknown; id?: unknown; note?: unknown }, ack?: Ack) => {
      try {
        const o = await own(msg);
        if (!o.row) return ack?.({ ok: false, error: o.error });
        const input = NoteInput.safeParse(msg.note);
        if (!input.success) return ack?.({ ok: false, error: input.error.issues[0]?.message ?? 'Ungültige Notiz' });
        const note = await s.notes.update(o.row.id, input.data);
        nsp.to(room(o.row.projectId, o.row.scope)).emit('note', { projectId: o.row.projectId, scope: o.row.scope, note });
        await syncMap(o.row.projectId, o.row.scope, note.id, Notes.cardTitle(note), Notes.cardText(note));
        ack?.({ ok: true });
      } catch (e) {
        ack?.({ ok: false, error: e instanceof Error ? e.message : 'Speichern fehlgeschlagen' });
      }
    });

    socket.on('notes:delete', async (msg: { projectId?: unknown; id?: unknown }, ack?: Ack) => {
      try {
        const o = await own(msg);
        if (!o.row) return ack?.({ ok: false, error: o.error });
        await s.notes.remove(o.row.id);
        nsp.to(room(o.row.projectId, o.row.scope)).emit('note:gone', { projectId: o.row.projectId, scope: o.row.scope, id: o.row.id });
        // Karten in der Mindmap bleiben stehen, verlieren aber den Verweis
        await syncMap(o.row.projectId, o.row.scope, o.row.id, '', '', true);
        ack?.({ ok: true });
      } catch (e) {
        ack?.({ ok: false, error: e instanceof Error ? e.message : 'Löschen fehlgeschlagen' });
      }
    });
  });
}
