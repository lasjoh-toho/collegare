import type { Namespace, Socket } from 'socket.io';
import { MapError, MapOp } from '../projects/maps.js';
import type { Services } from '../services.js';

/**
 * Bereich einer Mindmap: je Gruppe (g<ID>), im Einzelprojekt je Person (u<ID>) und vor der Gruppenbildung die
 * gemeinsame Themen-Mindmap des ganzen Projekts (p), z. B. um das Thema zu umreißen.
 */
export interface MapScope {
  scope: string;
  title: string;
  people: { id: number; name: string }[];
  /** Lernende dürfen nur lesen (Themen-Mindmap, wenn nur die Lehrkraft daran arbeitet) */
  readOnly?: boolean;
  /** Testbereich der Lehrkraft: für Lernende unsichtbar, zum Ausprobieren und für Demos */
  test?: boolean;
}

/** Testbereich je Lehrkraft (t<id>): Mindmap, Notizen, Pinnwand und Dokumente ohne Gruppen ausprobieren */
export const testScope = (userId: number) => 't' + userId;

export const TOPIC = 'p';

/** Welche Mindmaps eine Person sehen darf: Lehrkräfte alle des Projekts, Lernende die eigene. */
export async function mapScopes(s: Services, userId: number, projectId: number, withTopic = false): Promise<{ role: 'teacher' | 'student'; scopes: MapScope[] } | null> {
  const role = await s.projects.roleOf(userId, projectId);
  if (!role) return null;
  const board = await s.projects.board(projectId);
  const people = (pred: (m: (typeof board.members)[number]) => boolean) => board.members.filter(pred).map((m) => ({ id: m.userId, name: m.name }));
  let scopes: MapScope[];
  if (board.mode === 'single') {
    scopes = board.members.map((m) => ({ scope: 'u' + m.userId, title: m.name, people: [{ id: m.userId, name: m.name }] }));
  } else {
    scopes = board.groups.map((g, i) => ({ scope: 'g' + g.id, title: g.title || `Gruppe ${i + 1}`, people: people((m) => m.groupId === g.id) }));
  }
  if (role === 'student') {
    const me = board.members.find((m) => m.userId === userId);
    const own = board.mode === 'single' ? 'u' + userId : me?.groupId != null ? 'g' + me.groupId : null;
    scopes = scopes.filter((x) => x.scope === own);
  }
  if (role === 'teacher') {
    const me = await s.users.byId(userId);
    scopes.push({ scope: testScope(userId), title: 'Mein Testbereich (nur für mich)', people: [{ id: userId, name: me?.name ?? 'Lehrkraft' }], test: true });
  }
  const settings = withTopic ? (await s.projects.get(projectId))?.settings : undefined;
  if (withTopic && settings && settings.phases.topic?.state !== 'off') {
    scopes.unshift({ scope: TOPIC, title: 'Thema (alle)', people: people(() => true), readOnly: role === 'student' && settings.topicMapEdit === 'teacher' });
  }
  return { role, scopes };
}

type Ack = (r: Record<string, unknown>) => void;
const room = (projectId: number, scope: string) => `map:${projectId}:${scope}`;

/** Echtzeit der Mindmap im Namespace /project. */
export function mapSocket(nsp: Namespace, s: Services) {
  nsp.on('connection', (socket: Socket) => {
    const sess = () => socket.data.session as { userId: number; projectId: number | null };

    async function resolve(projectIdRaw: unknown, scopeRaw: unknown) {
      const projectId = Number(projectIdRaw);
      const { userId, projectId: bound } = sess();
      if (!Number.isInteger(projectId) || (bound !== null && bound !== projectId)) return null;
      const r = await mapScopes(s, userId, projectId, true);
      if (!r) return null;
      // ohne Wunsch: die eigene Gruppe, sonst (vor der Gruppenbildung) die Themen-Mindmap
      const sc = typeof scopeRaw === 'string' ? r.scopes.find((x) => x.scope === scopeRaw) : (r.scopes.find((x) => x.scope !== TOPIC) ?? r.scopes[0]);
      return { projectId, role: r.role, scopes: r.scopes, scope: sc ?? null };
    }

    socket.on('map:join', async (msg: { projectId?: unknown; scope?: unknown }, ack?: Ack) => {
      try {
        const r = await resolve(msg?.projectId, msg?.scope);
        if (!r) return ack?.({ ok: false, error: 'Kein Zugriff auf dieses Projekt' });
        const scopes = r.scopes.map(({ scope, title, readOnly }) => ({ scope, title, readOnly: !!readOnly }));
        if (!r.scope) return ack?.({ ok: true, role: r.role, scopes, scope: null });
        for (const rm of socket.rooms) if (rm.startsWith('map:')) void socket.leave(rm);
        await socket.join(room(r.projectId, r.scope.scope));
        const { map, version } = await s.maps.get(r.projectId, r.scope.scope);
        ack?.({ ok: true, role: r.role, scopes, scope: r.scope.scope, people: r.scope.people, map, version, readOnly: !!r.scope.readOnly });
      } catch (e) {
        ack?.({ ok: false, error: e instanceof Error ? e.message : String(e) });
      }
    });

    // Gruppe beginnt mit der Themen-Mindmap
    socket.on('map:seed', async (msg: { projectId?: unknown; scope?: unknown }, ack?: Ack) => {
      try {
        const r = await resolve(msg?.projectId, msg?.scope);
        if (!r?.scope || typeof msg.scope !== 'string' || r.scope.scope === TOPIC || r.scope.readOnly) return ack?.({ ok: false, error: 'Kein Zugriff auf diese Mindmap' });
        if (!r.scopes.some((x) => x.scope === TOPIC)) return ack?.({ ok: false, error: 'Keine Themen-Mindmap' });
        const src = await s.maps.get(r.projectId, TOPIC);
        if (!Object.keys(src.map.cards).length) return ack?.({ ok: false, error: 'Die Themen-Mindmap ist noch leer' });
        const res = await s.maps.seed(r.projectId, r.scope.scope, src.map);
        await s.audit.append({ actorId: sess().userId, action: 'map.seeded', projectId: r.projectId, data: { scope: r.scope.scope } });
        nsp.to(room(r.projectId, r.scope.scope)).emit('map', { projectId: r.projectId, scope: r.scope.scope, map: res.map, version: res.version, by: sess().userId });
        ack?.({ ok: true, version: res.version });
      } catch (e) {
        if (e instanceof MapError) return ack?.({ ok: false, error: e.message });
        ack?.({ ok: false, error: 'Übernehmen fehlgeschlagen' });
      }
    });

    socket.on('map:op', async (msg: { projectId?: unknown; scope?: unknown; op?: unknown }, ack?: Ack) => {
      try {
        const r = await resolve(msg?.projectId, msg?.scope);
        if (!r?.scope || typeof msg.scope !== 'string') return ack?.({ ok: false, error: 'Kein Zugriff auf diese Mindmap' });
        if (r.scope.readOnly) return ack?.({ ok: false, error: 'Diese Mindmap bearbeitet die Lehrkraft' });
        const op = MapOp.safeParse(msg.op);
        if (!op.success) return ack?.({ ok: false, error: 'Ungültige Änderung' });
        if (op.data.type === 'outline' && r.scope.scope === TOPIC) return ack?.({ ok: false, error: 'Die Gliederung entsteht in den Mindmaps der Gruppen' });
        const people = new Set(r.scope.people.map((p) => p.id));
        const res = await s.maps.apply(r.projectId, r.scope.scope, op.data, sess().userId, people);
        if (op.data.type === 'outline') {
          await s.audit.append({ actorId: sess().userId, action: 'map.outline', projectId: r.projectId, data: { scope: r.scope.scope, sections: res.map.outline?.sections.length } });
        }
        nsp.to(room(r.projectId, r.scope.scope)).emit('map', { projectId: r.projectId, scope: r.scope.scope, map: res.map, version: res.version, by: sess().userId });
        ack?.({ ok: true, version: res.version });
      } catch (e) {
        if (e instanceof MapError) return ack?.({ ok: false, error: e.message });
        ack?.({ ok: false, error: 'Änderung fehlgeschlagen' });
      }
    });
  });
}
