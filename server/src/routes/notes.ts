/**
 * Notizen und Quellen in Echtzeit im Namespace /project: notes:join, notes:add, notes:update, notes:delete,
 * notes:report, notes:unreport. Bereiche wie die Mindmaps (eigene Gruppe bzw. eigene Person im Einzelmodus; die
 * Lehrkraft alle), dazu der Bereich SHARED = „Allgemein“: alle freigegebenen Notizen des Projekts (Konzept 8e.3).
 *
 * Weil jede Person je nach Sichtbarkeit und Meldungen anderes sieht, geht jede Änderung einzeln an jede verbundene
 * Person (sendTo), nicht als ein Ereignis an den ganzen Raum. Überarbeitete Notizen werden in die Mindmap-Karten
 * übernommen, die auf sie verweisen.
 */
import type { Namespace, Socket } from 'socket.io';
import { NoteInput, type NoteRow, Notes, type Viewer } from '../projects/notes.js';
import type { Services } from '../services.js';
import { mapScopes } from './maps.js';

type Ack = (r: Record<string, unknown>) => void;
/** „Allgemein (alle Gruppen)“ */
export const SHARED = '*';
/** hier liegen Notizen, die die Lehrkraft unter „Allgemein“ schreibt */
const TEACHER_SHARED = 'p';
const room = (projectId: number, scope: string) => `notes:${projectId}:${scope}`;

interface Joined {
  projectId: number;
  scope: string;
  role: Viewer['role'];
  /** Bereiche, die die Person sehen darf (ohne SHARED) */
  scopes: string[];
}

export function notesSocket(nsp: Namespace, s: Services) {
  /** eine Notiz an alle verbundenen Personen schicken, die sie (noch) sehen dürfen; sonst „weg“ */
  async function sendTo(row: NoteRow, gone = false) {
    for (const scope of [row.scope, SHARED]) {
      const shared = scope === SHARED;
      for (const so of await nsp.in(room(row.projectId, scope)).fetchSockets()) {
        const j = so.data.notes as Joined | undefined;
        const userId = (so.data.session as { userId: number } | undefined)?.userId;
        if (!j || userId == null) continue;
        const viewer: Viewer = { userId, role: j.role };
        const visible = !gone && (!shared || (row.visibility === 'all' && !row.scope.startsWith('t'))) && Notes.canSee(row, viewer, j.scopes.includes(row.scope));
        if (visible) so.emit('note', { projectId: row.projectId, scope, note: { ...Notes.viewFor(row, viewer), scope: row.scope } });
        else so.emit('note:gone', { projectId: row.projectId, scope, id: row.id });
      }
    }
  }

  nsp.on('connection', (socket: Socket) => {
    const sess = () => socket.data.session as { userId: number; projectId: number | null };

    async function resolve(projectIdRaw: unknown, scopeRaw: unknown) {
      const projectId = Number(projectIdRaw);
      const { userId, projectId: bound } = sess();
      if (!Number.isInteger(projectId) || (bound !== null && bound !== projectId)) return null;
      const r = await mapScopes(s, userId, projectId);
      if (!r) return null;
      const all = r.scopes.map((x) => x.scope);
      if (scopeRaw === SHARED) return { projectId, role: r.role, scopes: r.scopes, all, scope: SHARED };
      const sc = typeof scopeRaw === 'string' ? r.scopes.find((x) => x.scope === scopeRaw) : r.scopes[0];
      return { projectId, role: r.role, scopes: r.scopes, all, scope: sc?.scope ?? null };
    }

    /** Karten in der Mindmap nachziehen und allen zeigen, die sie offen haben */
    async function syncMap(row: NoteRow, gone = false) {
      const reported = row.reporters.length > 0;
      const title = reported ? 'Gemeldete Karte' : Notes.cardTitle(row);
      const text = reported ? '' : Notes.cardText(row);
      const res = await s.maps.syncNote(row.projectId, row.scope, row.id, title, text, gone);
      if (res) nsp.to(`map:${row.projectId}:${row.scope}`).emit('map', { projectId: row.projectId, scope: row.scope, map: res.map, version: res.version, by: sess().userId });
    }

    const fail = (ack: Ack | undefined, e: unknown, msg: string) => ack?.({ ok: false, error: e instanceof Error ? e.message : msg });

    socket.on('notes:join', async (msg: { projectId?: unknown; scope?: unknown }, ack?: Ack) => {
      try {
        const r = await resolve(msg?.projectId, msg?.scope);
        if (!r) return ack?.({ ok: false, error: 'Kein Zugriff auf dieses Projekt' });
        for (const rm of socket.rooms) if (rm.startsWith('notes:')) void socket.leave(rm);
        const scopes = r.scopes.map(({ scope, title }) => ({ scope, title }));
        if (!r.scope) return ack?.({ ok: true, role: r.role, scopes, scope: null, notes: [] });
        socket.data.notes = { projectId: r.projectId, scope: r.scope, role: r.role, scopes: r.all } satisfies Joined;
        await socket.join(room(r.projectId, r.scope));
        const viewer: Viewer = { userId: sess().userId, role: r.role };
        const notes = r.scope === SHARED ? await s.notes.listShared(r.projectId, viewer) : await s.notes.list(r.projectId, r.scope, viewer);
        ack?.({ ok: true, role: r.role, scopes, scope: r.scope, notes });
      } catch (e) {
        fail(ack, e, 'Laden fehlgeschlagen');
      }
    });

    socket.on('notes:add', async (msg: { projectId?: unknown; scope?: unknown; note?: unknown }, ack?: Ack) => {
      try {
        const r = await resolve(msg?.projectId, msg?.scope);
        if (!r?.scope || typeof msg.scope !== 'string') return ack?.({ ok: false, error: 'Kein Zugriff auf diese Notizen' });
        const input = NoteInput.safeParse(msg.note);
        if (!input.success) return ack?.({ ok: false, error: input.error.issues[0]?.message ?? 'Ungültige Notiz' });
        let scope = r.scope;
        let data = input.data;
        if (scope === SHARED) {
          // „Allgemein“: Lernende schreiben in ihre Gruppe und geben frei, die Lehrkraft in den Projektbereich
          const own = r.role === 'teacher' ? TEACHER_SHARED : r.all.find((x) => !x.startsWith('t'));
          if (!own) return ack?.({ ok: false, error: 'Du bist noch keiner Gruppe zugeordnet.' });
          scope = own;
          data = { ...data, visibility: 'all' };
        }
        const row = await s.notes.add(r.projectId, scope, sess().userId, data);
        await sendTo(row);
        ack?.({ ok: true, id: row.id });
      } catch (e) {
        fail(ack, e, 'Speichern fehlgeschlagen');
      }
    });

    /** Notiz laden und prüfen, ob die Person sie sieht; edit = auch ändern dürfen (eigene Notiz oder Lehrkraft) */
    async function load(msg: { projectId?: unknown; id?: unknown }, edit: boolean) {
      const id = Number(msg?.id);
      const row = Number.isInteger(id) ? await s.notes.get(id) : null;
      if (!row || row.projectId !== Number(msg?.projectId)) return { error: 'Notiz nicht gefunden' };
      const r = await resolve(row.projectId, undefined);
      if (!r) return { error: 'Kein Zugriff auf diese Notizen' };
      const viewer: Viewer = { userId: sess().userId, role: r.role };
      if (!Notes.canSee(row, viewer, r.all.includes(row.scope))) return { error: 'Notiz nicht gefunden' };
      if (edit && r.role !== 'teacher' && row.userId !== viewer.userId) return { error: 'Nur eigene Notizen lassen sich ändern' };
      return { row, viewer };
    }

    socket.on('notes:update', async (msg: { projectId?: unknown; id?: unknown; note?: unknown }, ack?: Ack) => {
      try {
        const o = await load(msg, true);
        if (!o.row) return ack?.({ ok: false, error: o.error });
        const input = NoteInput.safeParse(msg.note);
        if (!input.success) return ack?.({ ok: false, error: input.error.issues[0]?.message ?? 'Ungültige Notiz' });
        const vis = Notes.allowedVisibility(o.row, o.viewer, input.data.visibility);
        if (!vis) return ack?.({ ok: false, error: 'Private Notizen gibt nur ihre Erstellerin oder ihr Ersteller frei.' });
        const row = await s.notes.update(o.row.id, input.data, vis);
        await sendTo(row);
        await syncMap(row);
        ack?.({ ok: true });
      } catch (e) {
        fail(ack, e, 'Speichern fehlgeschlagen');
      }
    });

    socket.on('notes:delete', async (msg: { projectId?: unknown; id?: unknown }, ack?: Ack) => {
      try {
        const o = await load(msg, true);
        if (!o.row) return ack?.({ ok: false, error: o.error });
        await s.notes.remove(o.row.id);
        await sendTo(o.row, true);
        // Karten in der Mindmap bleiben stehen, verlieren aber den Verweis
        await syncMap(o.row, true);
        ack?.({ ok: true });
      } catch (e) {
        fail(ack, e, 'Löschen fehlgeschlagen');
      }
    });

    /** Melden (8e.4): danach sehen die Notiz nur noch Lehrkraft, Erstellerin und Meldende */
    socket.on('notes:report', async (msg: { projectId?: unknown; id?: unknown; reason?: unknown }, ack?: Ack) => {
      try {
        const o = await load(msg, false);
        if (!o.row) return ack?.({ ok: false, error: o.error });
        if (o.row.userId === o.viewer.userId) return ack?.({ ok: false, error: 'Eigene Notizen kannst du löschen oder auf Privat stellen.' });
        const reason = typeof msg.reason === 'string' ? msg.reason : '';
        if (!(await s.notes.report(o.row.id, o.viewer.userId, reason))) return ack?.({ ok: false, error: 'Du hast diese Notiz schon gemeldet.' });
        await s.audit.append({ actorId: o.viewer.userId, action: 'note.reported', projectId: o.row.projectId, data: { note: o.row.id, scope: o.row.scope } });
        const row = (await s.notes.get(o.row.id))!;
        await sendTo(row);
        await syncMap(row);
        ack?.({ ok: true });
      } catch (e) {
        fail(ack, e, 'Melden fehlgeschlagen');
      }
    });

    /** Meldung aufheben: nur die Lehrkraft; die Notiz ist danach wieder wie vorher sichtbar */
    socket.on('notes:unreport', async (msg: { projectId?: unknown; id?: unknown }, ack?: Ack) => {
      try {
        const o = await load(msg, true);
        if (!o.row) return ack?.({ ok: false, error: o.error });
        if (o.viewer.role !== 'teacher') return ack?.({ ok: false, error: 'Nur die Lehrkraft hebt Meldungen auf.' });
        await s.notes.clearReports(o.row.id);
        await s.audit.append({ actorId: o.viewer.userId, action: 'note.report_cleared', projectId: o.row.projectId, data: { note: o.row.id } });
        const row = (await s.notes.get(o.row.id))!;
        await sendTo(row);
        await syncMap(row);
        ack?.({ ok: true });
      } catch (e) {
        fail(ack, e, 'Aufheben fehlgeschlagen');
      }
    });
  });
}
