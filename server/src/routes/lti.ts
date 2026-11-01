import formbody from '@fastify/formbody';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { requireSession, setSessionCookie } from '../http/auth.js';
import { LtiError } from '../lti/lti.js';
import type { Services } from '../services.js';
import type { BoardBroadcaster } from './projects.js';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Fehlerseite ohne Oberfläche (der Start kommt aus Moodle, die Oberfläche ist evtl. noch nicht geladen). */
function errorPage(reply: FastifyReply, msg: string, status = 400) {
  return reply
    .code(status)
    .type('text/html; charset=utf-8')
    .send(
      `<!doctype html><html lang="de"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Collegare</title>` +
        `<body style="font:14px system-ui,sans-serif;background:#fbfbfa;color:#1c1c1a;display:grid;place-items:center;min-height:100vh;margin:0">` +
        `<div style="max-width:460px;padding:24px;background:#fff;border-radius:14px;box-shadow:0 8px 24px rgba(0,0,0,.08)"><h1 style="font-size:20px;margin:0 0 8px">Collegare konnte nicht starten</h1>` +
        `<p>${esc(msg)}</p><p style="color:#6b6b66">Bitte die Aktivität in Moodle neu öffnen. Bleibt der Fehler, hilft die Administration (Seite „Moodle-Verbindung“).</p></div></body></html>`,
    );
}

const PlatformBody = z.object({
  title: z.string().min(1).max(120),
  issuer: z.string().min(1).max(255),
  client_id: z.string().min(1).max(255),
  deployment_id: z.string().min(1).max(255),
  auth_url: z.string().url(),
  jwks_url: z.string().url(),
  token_url: z.string().url().nullable(),
});

export async function ltiRoutes(app: FastifyInstance, s: Services, bc: BoardBroadcaster) {
  await app.register(async (scoped) => {
    await scoped.register(formbody);

    scoped.get('/lti/jwks', async () => ({ keys: [(await s.toolKey.get()).publicJwk] }));

    const login = async (params: Record<string, string | undefined>, reply: FastifyReply) => {
      try {
        return reply.redirect(await s.lti.initiateLogin(params), 302);
      } catch (e) {
        if (e instanceof LtiError) return errorPage(reply, e.message);
        throw e;
      }
    };
    scoped.get('/lti/login', async (req, reply) => login(req.query as Record<string, string>, reply));
    scoped.post('/lti/login', async (req, reply) => login(req.body as Record<string, string>, reply));

    scoped.post('/lti/launch', async (req, reply) => {
      try {
        const r = await s.lti.launch(req.body as Record<string, string>);
        // Lernende arbeiten in genau einem Projekt; Lehrkräfte sehen alle ihre Kurse
        const bind = r.role === 'student' ? r.projectId : null;
        const { token, expiresAt } = await s.sessions.create(r.userId, { projectId: bind, ttlMs: 12 * 3600_000 });
        setSessionCookie(reply, s, token, expiresAt);
        const a = s.config.appUrl;
        if (r.projectId !== null) return reply.redirect(`${a}/projekt/?id=${r.projectId}`, 303);
        if (r.role === 'teacher') return reply.redirect(`${a}/lti/?link=${r.linkId}`, 303);
        return reply.redirect(`${a}/lti/?link=${r.linkId}&warten=1`, 303);
      } catch (e) {
        if (e instanceof LtiError) {
          req.log.warn({ err: e.message }, 'LTI-Start abgelehnt');
          return errorPage(reply, e.message);
        }
        throw e;
      }
    });
  });

  /** Lehrkraft nach dem ersten Start: Aktivität mit einem Projekt verbinden. */
  async function linkAccess(req: Parameters<typeof requireSession>[0], reply: FastifyReply, id: number) {
    const sess = requireSession(req, reply);
    if (!sess) return null;
    const link = await s.lti.link(id);
    if (!link) return void reply.code(404).send({ error: 'Moodle-Aktivität unbekannt' });
    const roles = await s.users.rolesIn(sess.userId, link.context_id);
    const teacher = roles.has('teacher') || roles.has('admin');
    return { sess, link, teacher };
  }

  app.get<{ Params: { id: string } }>('/api/lti/links/:id', async (req, reply) => {
    const a = await linkAccess(req, reply, Number(req.params.id));
    if (!a) return;
    const ctx = await s.contexts.get(a.link.context_id);
    const projects = a.teacher
      ? await s.db.selectFrom('projects').select(['id', 'title', 'mode']).where('context_id', '=', a.link.context_id).where('archived_at', 'is', null).orderBy('created_at', 'desc').execute()
      : [];
    return { id: a.link.id, title: a.link.title, course: ctx?.title, projectId: a.link.project_id, teacher: a.teacher, projects };
  });

  app.post<{ Params: { id: string } }>('/api/lti/links/:id/project', async (req, reply) => {
    const a = await linkAccess(req, reply, Number(req.params.id));
    if (!a) return;
    if (!a.teacher) return reply.code(403).send({ error: 'Nur Lehrkräfte des Kurses' });
    const body = z
      .union([z.object({ projectId: z.number().int() }), z.object({ title: z.string().min(1).max(255), mode: z.enum(['group', 'single']).default('group'), importRoster: z.boolean().default(true) })])
      .safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'Projekt wählen oder Titel angeben' });
    let projectId: number;
    let imported: { added: number; total: number } | null = null;
    let warning: string | null = null;
    if ('projectId' in body.data) {
      const p = await s.projects.get(body.data.projectId);
      if (!p || p.context_id !== a.link.context_id) return reply.code(400).send({ error: 'Das Projekt gehört nicht zu diesem Kurs' });
      projectId = p.id;
    } else {
      projectId = await s.projects.create(a.link.context_id, body.data.title, body.data.mode, a.sess.userId);
      await s.audit.append({ actorId: a.sess.userId, action: 'project.created', contextId: a.link.context_id, projectId, data: { via: 'lti' } });
      if (body.data.importRoster) {
        try {
          imported = await s.lti.importRoster(projectId);
        } catch (e) {
          if (!(e instanceof LtiError)) throw e;
          warning = e.message;
        }
      }
    }
    await s.lti.setLinkProject(a.link.id, projectId);
    await s.audit.append({ actorId: a.sess.userId, action: 'lti.link_project', contextId: a.link.context_id, projectId, data: { linkId: a.link.id } });
    return { projectId, imported, warning };
  });

  /** „Aus Moodle übernehmen“: Lernende des Kurses ins Projekt holen (NRPS). */
  app.post<{ Params: { id: string } }>('/api/projects/:id/moodle-import', async (req, reply) => {
    const sess = requireSession(req, reply);
    if (!sess) return;
    const projectId = Number(req.params.id);
    if ((await s.projects.roleOf(sess.userId, projectId)) !== 'teacher' || sess.projectId !== null) return reply.code(403).send({ error: 'Nur für Lehrkräfte' });
    try {
      const r = await s.lti.importRoster(projectId);
      await s.audit.append({ actorId: sess.userId, action: 'project.moodle_import', projectId, data: r });
      await bc.push(projectId);
      return r;
    } catch (e) {
      if (e instanceof LtiError) return reply.code(400).send({ error: e.message });
      throw e;
    }
  });

  // Verwaltung: Seite „Moodle-Verbindung“
  async function admin(req: Parameters<typeof requireSession>[0], reply: FastifyReply) {
    const sess = requireSession(req, reply);
    if (!sess) return null;
    if (sess.projectId !== null || !(await s.users.isSystemAdmin(sess.userId))) {
      void reply.code(403).send({ error: 'Nur für die Administration' });
      return null;
    }
    return sess.userId;
  }

  app.get('/api/admin/lti', async (req, reply) => {
    if (!(await admin(req, reply))) return;
    return { tool: s.lti.toolConfig(), platforms: await s.lti.platforms() };
  });

  app.post('/api/admin/lti/platforms', async (req, reply) => {
    const actor = await admin(req, reply);
    if (!actor) return;
    const body = PlatformBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'Angaben unvollständig', details: body.error.issues.map((i) => i.path.join('.')) });
    try {
      const id = await s.lti.addPlatform(body.data);
      await s.audit.append({ actorId: actor, action: 'admin.lti_platform_added', data: { id, issuer: body.data.issuer } });
      return { id };
    } catch (e) {
      if (e instanceof LtiError) return reply.code(400).send({ error: e.message });
      throw e;
    }
  });

  app.delete<{ Params: { id: string } }>('/api/admin/lti/platforms/:id', async (req, reply) => {
    const actor = await admin(req, reply);
    if (!actor) return;
    await s.lti.removePlatform(Number(req.params.id));
    await s.audit.append({ actorId: actor, action: 'admin.lti_platform_removed', data: { id: Number(req.params.id) } });
    return { ok: true };
  });
}
