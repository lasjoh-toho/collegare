import '@fastify/cookie';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Services } from '../services.js';
import type { Session } from '../identity/sessions.js';

export const COOKIE = 'cg_session';

declare module 'fastify' {
  interface FastifyRequest {
    session: Session | null;
    sessionToken: string | null;
  }
}

export function tokenFrom(req: FastifyRequest): string | null {
  const h = req.headers.authorization;
  if (h?.startsWith('Bearer ')) return h.slice(7).trim();
  const c = (req.cookies as Record<string, string | undefined> | undefined)?.[COOKIE];
  return c ?? null;
}

export function sessionHook(s: Services) {
  return async (req: FastifyRequest) => {
    const token = tokenFrom(req);
    req.sessionToken = token;
    req.session = await s.sessions.resolve(token);
  };
}

export function requireSession(req: FastifyRequest, reply: FastifyReply): Session | null {
  if (!req.session) {
    void reply.code(401).send({ error: 'Bitte anmelden' });
    return null;
  }
  return req.session;
}

export function setSessionCookie(reply: FastifyReply, s: Services, token: string, expiresAt: number) {
  const path = new URL(s.config.appUrl).pathname.replace(/\/$/, '') || '/';
  void reply.setCookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: s.config.cookieSecure,
    path,
    expires: new Date(expiresAt),
  });
}

export function clearSessionCookie(reply: FastifyReply, s: Services) {
  const path = new URL(s.config.appUrl).pathname.replace(/\/$/, '') || '/';
  void reply.clearCookie(COOKIE, { path });
}
