import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Server } from 'socket.io';
import { z } from 'zod';
import type { Services } from '../services.js';
import { requireSession } from '../http/auth.js';
import { ProjectError, type ProjectRole } from '../projects/projects.js';
import { PRESETS, SettingsSchema, clampToFrame } from '../projects/settings.js';

type P = { Params: { id: string } };

/** Realtime: alle, die ein Projekt offen haben, bekommen nach jeder Änderung den neuen Stand des Boards. */
export class BoardBroadcaster {
  constructor(private io: Server | null, private s: Services) {}
  async push(projectId: number) {
    if (!this.io) return;
    const board = await this.s.projects.board(projectId);
    this.io.of('/project').to('project:' + projectId).emit('board', board);
  }
}

export function projectRoutes(app: FastifyInstance, s: Services, bc: BoardBroadcaster) {
  async function access(req: FastifyRequest<P>, reply: FastifyReply, need: 'teacher' | 'member'): Promise<{ userId: number; projectId: number; role: ProjectRole } | null> {
    const sess = requireSession(req, reply);
    if (!sess) return null;
    const projectId = Number(req.params.id);
    if (!Number.isInteger(projectId)) {
      void reply.code(404).send({ error: 'Projekt nicht gefunden' });
      return null;
    }
    if (sess.projectId !== null && sess.projectId !== projectId) {
      void reply.code(403).send({ error: 'Kein Zugriff auf dieses Projekt' });
      return null;
    }
    const role = await s.projects.roleOf(sess.userId, projectId);
    if (!role || (need === 'teacher' && role !== 'teacher')) {
      void reply.code(role ? 403 : 404).send({ error: role ? 'Nur für Lehrkräfte' : 'Projekt nicht gefunden' });
      return null;
    }
    return { userId: sess.userId, projectId, role };
  }

  const handle = (reply: FastifyReply, e: unknown) => {
    if (e instanceof ProjectError) return reply.code(e.status).send({ error: e.message });
    throw e;
  };

  // Kurse der Lehrkraft (eigene Klassen im Einzelbetrieb, Moodle-Kurse über LTI)
  app.get('/api/courses', async (req, reply) => {
    const sess = requireSession(req, reply);
    if (!sess) return;
    const rows = await s.db
      .selectFrom('memberships')
      .innerJoin('contexts', 'contexts.id', 'memberships.context_id')
      .select(['contexts.id', 'contexts.kind', 'contexts.title', 'contexts.lti_platform_id'])
      .where('memberships.user_id', '=', sess.userId)
      .where('memberships.role', 'in', ['teacher', 'admin'])
      .execute();
    const areas = rows.filter((r) => r.kind === 'school').map((r) => r.id);
    const below = areas.length ? await s.db.selectFrom('contexts').select(['id', 'kind', 'title', 'lti_platform_id']).where('parent_id', 'in', areas).where('kind', '=', 'course').execute() : [];
    const courses = [...rows.filter((r) => r.kind === 'course'), ...below];
    const uniq = new Map(courses.map((c) => [c.id, { id: c.id, title: c.title, moodle: c.lti_platform_id !== null }]));
    return { courses: [...uniq.values()].sort((a, b) => a.title.localeCompare(b.title, 'de')) };
  });

  app.post('/api/courses', async (req, reply) => {
    const sess = requireSession(req, reply);
    if (!sess) return;
    const body = z.object({ title: z.string().min(1).max(120) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'Name der Klasse bzw. des Kurses fehlt' });
    const area = await s.db
      .selectFrom('memberships')
      .innerJoin('contexts', 'contexts.id', 'memberships.context_id')
      .select('contexts.id')
      .where('memberships.user_id', '=', sess.userId)
      .where('memberships.role', '=', 'teacher')
      .where('contexts.kind', '=', 'school')
      .executeTakeFirst();
    if (!area) return reply.code(403).send({ error: 'Nur für Lehrkräfte mit eigenem Bereich' });
    const id = await s.contexts.create('course', area.id, body.data.title.trim());
    await s.audit.append({ actorId: sess.userId, action: 'course.created', contextId: id });
    return { id };
  });

  app.get('/api/projects', async (req, reply) => {
    const sess = requireSession(req, reply);
    if (!sess) return;
    let list = await s.projects.listFor(sess.userId);
    if (sess.projectId !== null) list = list.filter((p) => p.id === sess.projectId);
    // Kennzahlen für das Portal nur für eigene Projekte als Lehrkraft (Konzept 8b); ?seit= für „neu“
    const since = Number((req.query as { seit?: string }).seit);
    const sums = await s.projects.summaries(list.filter((p) => p.role === 'teacher').map((p) => p.id), Number.isFinite(since) && since > 0 ? since : null);
    return { projects: list.map((p) => ({ ...p, summary: sums.get(p.id) ?? null })) };
  });

  app.post('/api/projects', async (req, reply) => {
    const sess = requireSession(req, reply);
    if (!sess) return;
    const body = z.object({ courseId: z.number().int(), title: z.string().min(1).max(255), mode: z.enum(['group', 'single']).default('group') }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'Kurs und Titel angeben' });
    const roles = await s.users.rolesIn(sess.userId, body.data.courseId);
    if (!roles.has('teacher') && !roles.has('admin')) return reply.code(403).send({ error: 'Nur Lehrkräfte des Kurses' });
    const id = await s.projects.create(body.data.courseId, body.data.title, body.data.mode, sess.userId);
    await s.audit.append({ actorId: sess.userId, action: 'project.created', contextId: body.data.courseId, projectId: id });
    return { id };
  });

  app.get<P>('/api/projects/:id', async (req, reply) => {
    const a = await access(req, reply, 'member');
    if (!a) return;
    const p = await s.projects.get(a.projectId);
    const ctx = await s.contexts.get(p!.context_id);
    const board = await s.projects.board(a.projectId);
    const me = board.members.find((m) => m.userId === a.userId);
    return {
      id: p!.id,
      title: p!.title,
      mode: p!.mode,
      // wirksame Einstellungen: der Rahmen der Administration gilt sofort
      settings: clampToFrame(p!.settings, await s.frame.get()),
      course: { id: ctx?.id, title: ctx?.title, moodle: ctx?.lti_platform_id != null },
      role: a.role,
      myGroupId: me?.groupId ?? null,
      board,
      codesValidUntil: a.role === 'teacher' ? await s.accessCodes.validUntil(a.projectId) : undefined,
    };
  });

  app.patch<P>('/api/projects/:id', async (req, reply) => {
    const a = await access(req, reply, 'teacher');
    if (!a) return;
    const body = z
      .object({ title: z.string().min(1).max(255).optional(), settings: SettingsSchema.partial().optional(), revision: z.number().int().optional() })
      .safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'Ungültige Angaben', details: body.error.issues.map((i) => i.path.join('.')) });
    if (body.data.title) await s.db.updateTable('projects').set({ title: body.data.title.trim() }).where('id', '=', a.projectId).execute();
    if (!body.data.settings) return { ok: true };
    try {
      const p = await s.projects.get(a.projectId);
      const frame = await s.frame.get();
      const wanted = clampToFrame({ ...p!.settings, ...body.data.settings }, frame);
      const res = await s.projects.updateSettings(a.projectId, wanted, body.data.revision);
      await s.audit.append({ actorId: a.userId, action: 'project.settings_changed', projectId: a.projectId, data: { keys: Object.keys(body.data.settings), revision: res.revision } });
      await bc.push(a.projectId);
      return { ok: true, ...res };
    } catch (e) {
      return handle(reply, e);
    }
  });

  /** Einstellungsseite: Einstellungen, Revision, Rahmen der Administration und Voreinstellungen. */
  app.get<P>('/api/projects/:id/settings', async (req, reply) => {
    const a = await access(req, reply, 'teacher');
    if (!a) return;
    const p = await s.projects.get(a.projectId);
    return {
      title: p!.title,
      mode: p!.mode,
      settings: p!.settings,
      revision: p!.revision,
      frame: await s.frame.get(),
      presets: Object.entries(PRESETS).map(([id, v]) => ({ id, title: v.title, patch: v.patch })),
    };
  });

  /** Wahlmodus: Lernende ordnen sich selbst einer Gruppe zu. */
  app.post<P>('/api/projects/:id/choose', async (req, reply) => {
    const a = await access(req, reply, 'member');
    if (!a) return;
    const body = z.object({ groupId: z.number().int().nullable() }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'Gruppe angeben' });
    if (a.role !== 'student') return reply.code(400).send({ error: 'Nur für Lernende; Lehrkräfte verschieben auf dem Board' });
    try {
      await s.projects.choose(a.projectId, a.userId, body.data.groupId);
    } catch (e) {
      return handle(reply, e);
    }
    await s.audit.append({ actorId: a.userId, action: 'project.group_chosen', projectId: a.projectId, data: { groupId: body.data.groupId } });
    await bc.push(a.projectId);
    return { ok: true };
  });

  app.post<P>('/api/projects/:id/students', async (req, reply) => {
    const a = await access(req, reply, 'teacher');
    if (!a) return;
    const body = z.object({ names: z.array(z.string().max(120)).min(1).max(200) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'Namen angeben (eine Zeile je Person)' });
    try {
      const ids = await s.projects.addStudentsByName(a.projectId, body.data.names);
      await s.audit.append({ actorId: a.userId, action: 'project.students_added', projectId: a.projectId, data: { count: ids.length } });
      await bc.push(a.projectId);
      return { ids };
    } catch (e) {
      return handle(reply, e);
    }
  });

  app.delete<{ Params: { id: string; userId: string } }>('/api/projects/:id/students/:userId', async (req, reply) => {
    const a = await access(req as unknown as FastifyRequest<P>, reply, 'teacher');
    if (!a) return;
    const userId = Number(req.params.userId);
    await s.accessCodes.revokeAll(a.projectId, [userId]);
    await s.projects.removeMember(a.projectId, userId);
    await s.audit.append({ actorId: a.userId, action: 'project.student_removed', projectId: a.projectId, data: { userId } });
    await bc.push(a.projectId);
    return { ok: true };
  });

  app.post<P>('/api/projects/:id/groups', async (req, reply) => {
    const a = await access(req, reply, 'member');
    if (!a) return;
    const body = z.object({ title: z.string().max(255).default('') }).safeParse(req.body ?? {});
    if (!body.success) return reply.code(400).send({ error: 'Ungültiger Titel' });
    if (a.role === 'student') {
      // „Lernende dürfen auch Gruppen anlegen“: neue Säule und gleich hinein
      const p = await s.projects.get(a.projectId);
      const st = p!.settings;
      const open = p!.mode === 'group' && st.groupFormation === 'open' && (st.choiceDeadline === null || Date.now() <= st.choiceDeadline);
      if (!open) return reply.code(403).send({ error: 'Neue Gruppen legt hier die Lehrkraft an' });
      const id = await s.projects.createGroup(a.projectId, body.data.title);
      try {
        await s.projects.choose(a.projectId, a.userId, id);
      } catch (e) {
        await s.projects.deleteGroup(a.projectId, id);
        return handle(reply, e);
      }
      await s.audit.append({ actorId: a.userId, action: 'project.group_created_by_student', projectId: a.projectId, data: { groupId: id } });
      await bc.push(a.projectId);
      return { id };
    }
    const id = await s.projects.createGroup(a.projectId, body.data.title);
    await bc.push(a.projectId);
    return { id };
  });

  app.patch<{ Params: { id: string; gid: string } }>('/api/projects/:id/groups/:gid', async (req, reply) => {
    const a = await access(req as unknown as FastifyRequest<P>, reply, 'member');
    if (!a) return;
    const gid = Number(req.params.gid);
    const body = z.object({ title: z.string().max(255).optional(), color: z.string().nullable().optional() }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'Ungültige Angaben' });
    if (a.role === 'student') {
      // Lernende dürfen nur das Thema der eigenen Gruppe setzen, wenn die Lehrkraft es erlaubt
      const p = await s.projects.get(a.projectId);
      const mine = await s.projects.groupOf(a.projectId, a.userId);
      if (!p?.settings.studentsSetTopic || mine !== gid || body.data.color !== undefined) return reply.code(403).send({ error: 'Das Thema setzt hier die Lehrkraft' });
    }
    try {
      if (body.data.title !== undefined) await s.projects.renameGroup(a.projectId, gid, body.data.title);
      if (body.data.color !== undefined) await s.projects.setGroupColor(a.projectId, gid, body.data.color);
    } catch (e) {
      return handle(reply, e);
    }
    await bc.push(a.projectId);
    return { ok: true };
  });

  app.delete<{ Params: { id: string; gid: string } }>('/api/projects/:id/groups/:gid', async (req, reply) => {
    const a = await access(req as unknown as FastifyRequest<P>, reply, 'teacher');
    if (!a) return;
    await s.projects.deleteGroup(a.projectId, Number(req.params.gid));
    await bc.push(a.projectId);
    return { ok: true };
  });

  app.post<P>('/api/projects/:id/groups/order', async (req, reply) => {
    const a = await access(req, reply, 'teacher');
    if (!a) return;
    const body = z.object({ order: z.array(z.number().int()).max(200) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'Reihenfolge ungültig' });
    await s.projects.reorderGroups(a.projectId, body.data.order);
    await bc.push(a.projectId);
    return { ok: true };
  });

  app.post<P>('/api/projects/:id/moves', async (req, reply) => {
    const a = await access(req, reply, 'teacher');
    if (!a) return;
    const body = z.object({ userId: z.number().int(), groupId: z.number().int().nullable(), position: z.number().int().min(0) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'Ungültige Verschiebung' });
    try {
      await s.projects.moveMember(a.projectId, body.data.userId, body.data.groupId, body.data.position);
    } catch (e) {
      return handle(reply, e);
    }
    await bc.push(a.projectId);
    return { ok: true };
  });

  app.post<P>('/api/projects/:id/roles', async (req, reply) => {
    const a = await access(req, reply, 'member');
    if (!a) return;
    const body = z.object({ userId: z.number().int(), label: z.string().max(100).nullable() }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'Ungültige Rolle' });
    if (a.role === 'student') {
      const mine = await s.projects.groupOf(a.projectId, a.userId);
      const theirs = await s.projects.groupOf(a.projectId, body.data.userId);
      if (mine === null || mine !== theirs) return reply.code(403).send({ error: 'Rollen nur in der eigenen Gruppe' });
    }
    await s.projects.setRoleLabel(a.projectId, body.data.userId, body.data.label);
    await bc.push(a.projectId);
    return { ok: true };
  });

  app.post<P>('/api/projects/:id/access-codes', async (req, reply) => {
    const a = await access(req, reply, 'teacher');
    if (!a) return;
    const body = z.object({ userIds: z.array(z.number().int()).min(1).max(200), days: z.number().min(1 / 24).max(60).optional() }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'Personen auswählen' });
    const board = await s.projects.board(a.projectId);
    const allowed = new Set(board.members.map((m) => m.userId));
    const ids = body.data.userIds.filter((id) => allowed.has(id));
    const ttl = (body.data.days ?? s.config.accessCodeDays) * 86_400_000;
    const codes = await s.accessCodes.issue(a.projectId, ids, ttl, a.userId);
    await s.audit.append({ actorId: a.userId, action: 'access.codes_issued', projectId: a.projectId, data: { count: codes.length } });
    const names = new Map(board.members.map((m) => [m.userId, m.name]));
    return {
      codes: codes.map((c) => ({ ...c, name: names.get(c.userId), url: `${s.config.appUrl}/zugang#k=${c.secret}` })),
      redeemUrl: `${s.config.appUrl}/zugang`,
    };
  });

  app.post<P>('/api/projects/:id/access-codes/revoke', async (req, reply) => {
    const a = await access(req, reply, 'teacher');
    if (!a) return;
    const body = z.object({ userIds: z.array(z.number().int()).optional() }).safeParse(req.body ?? {});
    if (!body.success) return reply.code(400).send({ error: 'Ungültig' });
    const n = await s.accessCodes.revokeAll(a.projectId, body.data.userIds);
    await s.audit.append({ actorId: a.userId, action: 'access.codes_revoked', projectId: a.projectId, data: { count: n } });
    return { revoked: n };
  });
}
