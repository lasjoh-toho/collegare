import formbody from '@fastify/formbody';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { requireSession } from '../http/auth.js';
import { OidcError, type AuthorizeParams } from '../identity/oidcProvider.js';
import type { Services } from '../services.js';

/** Collegare als Kontodienst (Konzept 8c): Endpunkte für angebundene Apps und ihre Verwaltung. */
export async function oidcRoutes(app: FastifyInstance, s: Services) {
  const p = s.oidc;
  const errorPage = (reply: FastifyReply, msg: string) =>
    reply
      .code(400)
      .type('text/html; charset=utf-8')
      .send(`<!doctype html><meta charset="utf-8"><title>Anmeldung nicht möglich</title><body style="font-family:system-ui;max-width:520px;margin:60px auto;padding:0 16px"><h1 style="font-size:20px">Anmeldung nicht möglich</h1><p>${msg.replace(/[<>&]/g, '')}</p><p><a href="${s.config.appUrl}/">Zu Collegare</a></p>`);

  await app.register(async (scoped) => {
    await scoped.register(formbody);

    scoped.get('/.well-known/openid-configuration', async () => p.discovery());
    scoped.get('/oidc/jwks', async () => p.jwks());

    scoped.get('/oidc/authorize', async (req: FastifyRequest<{ Querystring: AuthorizeParams }>, reply) => {
      const q = req.query;
      try {
        await p.check(q);
      } catch (e) {
        if (e instanceof OidcError) return errorPage(reply, e.message);
        throw e;
      }
      // Nur Konten mit Kürzel und Passwort (bzw. Moodle-Lehrkräfte), nicht Sitzungen aus einem Zugangscode
      if (!req.session || req.session.projectId !== null) {
        const weiter = '/oidc/authorize?' + new URLSearchParams(q as Record<string, string>).toString();
        return reply.redirect(`${s.config.appUrl}/?weiter=${encodeURIComponent(weiter)}`, 302);
      }
      const to = await p.authorize(q, req.session.userId);
      await s.audit.append({ actorId: req.session.userId, action: 'oidc.login', data: { client: q.client_id } });
      return reply.redirect(to, 302);
    });

    scoped.post('/oidc/token', async (req, reply) => {
      void reply.header('cache-control', 'no-store');
      let basic: { id: string; secret: string } | null = null;
      const h = req.headers.authorization;
      if (h?.startsWith('Basic ')) {
        const [id, secret] = Buffer.from(h.slice(6), 'base64').toString().split(':');
        basic = { id: decodeURIComponent(id ?? ''), secret: decodeURIComponent(secret ?? '') };
      }
      try {
        return await p.token((req.body ?? {}) as Record<string, string>, basic);
      } catch (e) {
        if (e instanceof OidcError) return reply.code(e.status).send({ error: e.code, error_description: e.message });
        throw e;
      }
    });

    scoped.get('/oidc/userinfo', async (req, reply) => {
      const h = req.headers.authorization;
      try {
        return await p.userinfo(h?.startsWith('Bearer ') ? h.slice(7) : '');
      } catch (e) {
        if (e instanceof OidcError) return reply.code(e.status).header('www-authenticate', 'Bearer error="invalid_token"').send({ error: e.code });
        throw e;
      }
    });
  });

  // ---- Verwaltung: angebundene Apps ----
  async function admin(req: FastifyRequest, reply: FastifyReply) {
    const sess = requireSession(req, reply);
    if (!sess) return null;
    if (sess.projectId !== null || !(await s.users.isSystemAdmin(sess.userId))) return void reply.code(403).send({ error: 'Nur für die Administration' });
    return sess.userId;
  }
  const view = (c: { clientId: string; title: string; redirectUris: string[]; createdAt: number }) => ({ clientId: c.clientId, title: c.title, redirectUris: c.redirectUris, createdAt: c.createdAt });

  app.get('/api/admin/apps', async (req, reply) => {
    if (!(await admin(req, reply))) return;
    return { issuer: s.config.appUrl, apps: (await p.clients()).map(view) };
  });

  app.post('/api/admin/apps', async (req, reply) => {
    const actor = await admin(req, reply);
    if (!actor) return;
    const body = z.object({ title: z.string().min(1).max(80), redirectUris: z.array(z.string().max(500)).min(1).max(5) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'Name und Rücksprung-Adresse angeben' });
    try {
      const { client, secret } = await p.addClient(body.data.title, body.data.redirectUris);
      await s.audit.append({ actorId: actor, action: 'oidc.client_added', data: { client: client.clientId, title: client.title } });
      return { app: view(client), secret };
    } catch (e) {
      if (e instanceof OidcError) return reply.code(400).send({ error: e.message });
      throw e;
    }
  });

  app.post<{ Params: { id: string } }>('/api/admin/apps/:id/secret', async (req, reply) => {
    const actor = await admin(req, reply);
    if (!actor) return;
    try {
      const secret = await p.newSecret(req.params.id);
      await s.audit.append({ actorId: actor, action: 'oidc.secret_renewed', data: { client: req.params.id } });
      return { secret };
    } catch (e) {
      if (e instanceof OidcError) return reply.code(e.status).send({ error: e.message });
      throw e;
    }
  });

  app.delete<{ Params: { id: string } }>('/api/admin/apps/:id', async (req, reply) => {
    const actor = await admin(req, reply);
    if (!actor) return;
    await p.removeClient(req.params.id);
    await s.audit.append({ actorId: actor, action: 'oidc.client_removed', data: { client: req.params.id } });
    return { ok: true };
  });
}
