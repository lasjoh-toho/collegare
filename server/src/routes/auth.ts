import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Services } from '../services.js';
import { clearSessionCookie, requireSession, setSessionCookie } from '../http/auth.js';

const LoginBody = z.object({ login: z.string().min(1).max(100), password: z.string().min(1).max(200) });
const RedeemBody = z.object({ secret: z.string().max(200).optional(), code: z.string().max(20).optional() });

export function authRoutes(app: FastifyInstance, s: Services) {
  app.post('/api/auth/login', async (req, reply) => {
    const body = LoginBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'Kürzel und Passwort angeben' });
    const keyIp = 'ip:' + req.ip;
    const keyLogin = 'login:' + body.data.login.toLowerCase();
    if (s.loginLimiter.blocked(keyIp) || s.loginLimiter.blocked(keyLogin)) return reply.code(429).send({ error: 'Zu viele Versuche. Bitte in 10 Minuten erneut versuchen.' });
    const userId = await s.accounts.verify(body.data.login, body.data.password);
    if (!userId) {
      s.loginLimiter.fail(keyIp);
      s.loginLimiter.fail(keyLogin);
      return reply.code(401).send({ error: 'Kürzel oder Passwort falsch' });
    }
    s.loginLimiter.reset(keyLogin);
    const { token, expiresAt } = await s.sessions.create(userId);
    setSessionCookie(reply, s, token, expiresAt);
    await s.audit.append({ actorId: userId, action: 'auth.login' });
    return { ok: true, token, expiresAt };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    if (req.sessionToken) await s.sessions.destroy(req.sessionToken);
    clearSessionCookie(reply, s);
    return { ok: true };
  });

  app.get('/api/me', async (req, reply) => {
    const sess = requireSession(req, reply);
    if (!sess) return;
    const user = await s.users.byId(sess.userId);
    if (!user) return reply.code(401).send({ error: 'Bitte anmelden' });
    const sys = await s.contexts.system();
    const roles = await s.users.rolesIn(user.id, sys);
    const teaches = await s.db.selectFrom('memberships').select('context_id').where('user_id', '=', user.id).where('role', 'in', ['teacher', 'admin']).executeTakeFirst();
    return {
      id: user.id,
      name: user.name,
      admin: roles.has('admin'),
      teacher: !!teaches,
      projectId: sess.projectId,
      impersonated: sess.impersonatorId !== null,
    };
  });

  /** Ansicht als Lehrkraft beenden: zurück zum eigenen Admin-Konto. */
  app.post('/api/auth/unimpersonate', async (req, reply) => {
    const sess = requireSession(req, reply);
    if (!sess) return;
    if (sess.impersonatorId === null) return reply.code(400).send({ error: 'Keine fremde Ansicht aktiv' });
    if (req.sessionToken) await s.sessions.destroy(req.sessionToken);
    const { token, expiresAt } = await s.sessions.create(sess.impersonatorId);
    setSessionCookie(reply, s, token, expiresAt);
    await s.audit.append({ actorId: sess.impersonatorId, action: 'admin.impersonate_end', data: { userId: sess.userId } });
    return { ok: true, token, expiresAt };
  });

  /** Zugang für Lernende per QR-Geheimnis oder Code (Seite /zugang). */
  app.post('/api/access/redeem', async (req, reply) => {
    const body = RedeemBody.safeParse(req.body);
    if (!body.success || (!body.data.secret && !body.data.code)) return reply.code(400).send({ error: 'Code fehlt' });
    const key = 'ip:' + req.ip;
    if (s.codeLimiter.blocked(key)) return reply.code(429).send({ error: 'Zu viele Versuche. Bitte in 10 Minuten erneut versuchen.' });
    const res = await s.accessCodes.redeem(body.data);
    if (!res) {
      s.codeLimiter.fail(key);
      return reply.code(404).send({ error: 'Der Code stimmt nicht oder ist abgelaufen. Bitte bei der Lehrkraft nachfragen.' });
    }
    const { token, expiresAt } = await s.sessions.create(res.userId, { projectId: res.projectId, ttlMs: 12 * 3600_000 });
    setSessionCookie(reply, s, token, expiresAt);
    await s.audit.append({ actorId: res.userId, action: 'access.redeemed', projectId: res.projectId });
    const user = await s.users.byId(res.userId);
    return { ok: true, token, expiresAt, projectId: res.projectId, name: user?.name };
  });
}
