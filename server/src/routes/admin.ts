import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Services } from '../services.js';
import { requireSession, setSessionCookie } from '../http/auth.js';
import { AccountError } from '../identity/accounts.js';
import { FrameSchema } from '../projects/settings.js';

async function requireAdmin(s: Services, req: FastifyRequest, reply: FastifyReply): Promise<number | null> {
  const sess = requireSession(req, reply);
  if (!sess) return null;
  if (sess.projectId !== null || !(await s.users.isSystemAdmin(sess.userId))) {
    void reply.code(403).send({ error: 'Nur für die Administration' });
    return null;
  }
  return sess.userId;
}

const TeacherBody = z.object({ login: z.string().min(2).max(100), name: z.string().min(1).max(120), password: z.string().min(8).max(200) });

/**
 * Verwaltung im Einzelbetrieb: Lehrkräfte anlegen (jede bekommt einen eigenen Bereich, wie im Autogra.fi-Portal),
 * Passwort setzen, als Lehrkraft ansehen.
 */
export function adminRoutes(app: FastifyInstance, s: Services) {
  app.get('/api/admin/teachers', async (req, reply) => {
    if (!(await requireAdmin(s, req, reply))) return;
    const list = await s.accounts.list();
    const counts = await s.db.selectFrom('projects').select(['created_by', (eb) => eb.fn.countAll().as('n')]).where('archived_at', 'is', null).groupBy('created_by').execute();
    const by = new Map(counts.map((c) => [Number(c.created_by), Number(c.n)]));
    return { teachers: list.map((t) => ({ ...t, projects: by.get(t.id) ?? 0 })) };
  });

  app.post('/api/admin/teachers', async (req, reply) => {
    const actor = await requireAdmin(s, req, reply);
    if (!actor) return;
    const body = TeacherBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'Kürzel, Name und Passwort (mind. 8 Zeichen) angeben' });
    try {
      const userId = await s.accounts.create(body.data.login, body.data.name, body.data.password);
      const area = await s.contexts.create('school', await s.contexts.system(), 'Bereich ' + body.data.name);
      await s.users.grant(userId, area, 'teacher');
      await s.audit.append({ actorId: actor, action: 'admin.teacher_created', contextId: area, data: { userId } });
      return { id: userId };
    } catch (e) {
      if (e instanceof AccountError) return reply.code(400).send({ error: e.message });
      throw e;
    }
  });

  app.post<{ Params: { id: string } }>('/api/admin/teachers/:id/password', async (req, reply) => {
    const actor = await requireAdmin(s, req, reply);
    if (!actor) return;
    const body = z.object({ password: z.string().min(8).max(200) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'Passwort: mindestens 8 Zeichen' });
    const id = Number(req.params.id);
    await s.accounts.setPassword(id, body.data.password);
    await s.sessions.destroyAllFor(id);
    await s.audit.append({ actorId: actor, action: 'admin.password_set', data: { userId: id } });
    return { ok: true };
  });

  /** Konto löschen: nur ohne laufende Projekte (keine verwaisten Schülerdaten), nie das eigene. */
  app.delete<{ Params: { id: string } }>('/api/admin/teachers/:id', async (req, reply) => {
    const actor = await requireAdmin(s, req, reply);
    if (!actor) return;
    const id = Number(req.params.id);
    if (id === actor) return reply.code(400).send({ error: 'Das eigene Konto lässt sich nicht löschen' });
    const acc = await s.db.selectFrom('local_accounts').select('login').where('user_id', '=', id).executeTakeFirst();
    if (!acc) return reply.code(404).send({ error: 'Konto nicht gefunden' });
    const open = await s.db.selectFrom('projects').select((eb) => eb.fn.countAll().as('n')).where('created_by', '=', id).where('archived_at', 'is', null).executeTakeFirst();
    if (Number(open?.n ?? 0) > 0) return reply.code(409).send({ error: `Diese Lehrkraft hat noch ${open!.n} Projekt(e). Erst die Projekte abschließen oder löschen.` });
    await s.sessions.destroyAllFor(id);
    await s.db.deleteFrom('local_accounts').where('user_id', '=', id).execute();
    await s.db.deleteFrom('memberships').where('user_id', '=', id).execute();
    await s.audit.append({ actorId: actor, action: 'admin.teacher_deleted', data: { userId: id } });
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/api/admin/teachers/:id/impersonate', async (req, reply) => {
    const actor = await requireAdmin(s, req, reply);
    if (!actor) return;
    const id = Number(req.params.id);
    const { token, expiresAt } = await s.sessions.create(id, { impersonatorId: actor, ttlMs: 2 * 3600_000 });
    setSessionCookie(reply, s, token, expiresAt);
    await s.audit.append({ actorId: actor, action: 'admin.impersonate', data: { userId: id } });
    return { ok: true };
  });

  /** Rahmen der Instanz: was Lehrkräfte in ihren Projekten einschalten dürfen. */
  app.get('/api/admin/frame', async (req, reply) => {
    if (!(await requireAdmin(s, req, reply))) return;
    return { frame: await s.frame.get() };
  });

  app.put('/api/admin/frame', async (req, reply) => {
    const actor = await requireAdmin(s, req, reply);
    if (!actor) return;
    const body = FrameSchema.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'Ungültiger Rahmen' });
    await s.frame.set(body.data);
    await s.audit.append({ actorId: actor, action: 'admin.frame_changed', data: body.data });
    return { ok: true };
  });
}
