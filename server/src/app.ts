import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import fstatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import { Server, type Socket } from 'socket.io';
import { CoServer, type CoServerOptions } from './collab/coServer.js';
import { COOKIE, sessionHook } from './http/auth.js';
import { adminRoutes } from './routes/admin.js';
import { authRoutes } from './routes/auth.js';
import { BoardBroadcaster, projectRoutes } from './routes/projects.js';
import { ltiRoutes } from './routes/lti.js';
import type { Services } from './services.js';

export interface App {
  http: FastifyInstance;
  io: Server;
  co: CoServer;
  services: Services | null;
}

export interface AppOptions {
  logger?: boolean;
  co?: CoServerOptions;
  corsOrigin?: string | string[];
  /** Ohne Dienste läuft nur der Kollaborationsserver wie im M0-Spike (Protokolltests). */
  services?: Services;
  /** Test-Endpunkte unter /api/spike (Fertig-Sperre von Hand setzen). Nie im Betrieb. */
  spike?: boolean;
  /** Statischer Export der Projektoberfläche (client/out), ausgeliefert unter / */
  clientDir?: string;
  /** Statischer Export der Office-Editoren (web/out), ausgeliefert unter /office/ */
  officeDir?: string;
}

/** Sitzungstoken aus dem Handshake: zuerst auth.token (App), dann Cookie (Browser). */
function socketToken(socket: Socket): string | null {
  const t = (socket.handshake.auth as Record<string, unknown> | undefined)?.token;
  if (typeof t === 'string' && t) return t;
  const raw = socket.handshake.headers.cookie ?? '';
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === COOKIE) return decodeURIComponent(v.join('='));
  }
  return null;
}

/**
 * Baut den Collegare-Server: REST unter /api, Echtzeit über socket.io
 * (Namespace /collab für die Editoren, /project für Board und Projektstand).
 */
export async function buildApp(opts: AppOptions = {}): Promise<App> {
  const http = Fastify({ logger: opts.logger ?? false, trustProxy: true, bodyLimit: 5 * 1024 * 1024 });
  const io = new Server(http.server, {
    path: '/socket.io',
    maxHttpBufferSize: 100_000_000,
    cors: opts.corsOrigin ? { origin: opts.corsOrigin, credentials: true } : undefined,
  });
  const s = opts.services ?? null;

  const authorize: CoServerOptions['authorize'] = s
    ? async (socket) => {
        const sess = await s.sessions.resolve(socketToken(socket));
        if (!sess) return null;
        const user = await s.users.byId(sess.userId);
        // M1: Dokumente gehören noch keinem Projekt; ab M2 prüft hier die Projekt- und Gruppenzugehörigkeit.
        return user ? { id: String(user.id), name: user.name } : null;
      }
    : undefined;
  const co = new CoServer(io, { log: (m, d) => http.log.info({ d }, m), authorize, ...opts.co });

  http.get('/api/health', async () => ({ ok: true }));

  // Entwicklung: Oberfläche läuft auf einem eigenen Port (Next-Dev-Server) und schickt das Cookie mit
  if (opts.corsOrigin) await http.register(cors, { origin: opts.corsOrigin, credentials: true });

  if (opts.officeDir && existsSync(opts.officeDir)) {
    await http.register(fstatic, { root: resolve(opts.officeDir), prefix: '/office/', decorateReply: false });
  }
  if (opts.clientDir && existsSync(opts.clientDir)) {
    await http.register(fstatic, { root: resolve(opts.clientDir), prefix: '/', extensions: ['html'], index: ['index.html'] });
  }

  if (s) {
    await http.register(cookie);
    http.decorateRequest('session', null);
    http.decorateRequest('sessionToken', null);
    http.addHook('onRequest', sessionHook(s));

    const bc = new BoardBroadcaster(io, s);
    authRoutes(http, s);
    adminRoutes(http, s);
    projectRoutes(http, s, bc);
    await ltiRoutes(http, s, bc);

    // Projekt-Namespace: Wer ein Projekt geöffnet hat, bekommt Änderungen am Board sofort.
    const nsp = io.of('/project');
    nsp.use((socket, next) => {
      s.sessions.resolve(socketToken(socket)).then(
        (sess) => {
          if (!sess) return next(new Error('Bitte anmelden'));
          socket.data.session = sess;
          next();
        },
        (e) => next(e instanceof Error ? e : new Error(String(e))),
      );
    });
    nsp.on('connection', (socket) => {
      socket.on('join', async (projectId: unknown, ack?: (r: { ok: boolean; error?: string }) => void) => {
        const id = Number(projectId);
        const sess = socket.data.session as { userId: number; projectId: number | null };
        const allowed = Number.isInteger(id) && (sess.projectId === null || sess.projectId === id) && (await s.projects.roleOf(sess.userId, id)) !== null;
        if (!allowed) return ack?.({ ok: false, error: 'Kein Zugriff auf dieses Projekt' });
        for (const room of socket.rooms) if (room.startsWith('project:')) void socket.leave(room);
        await socket.join('project:' + id);
        ack?.({ ok: true });
        socket.emit('board', await s.projects.board(id));
      });
    });

    http.addHook('onClose', async () => {
      await s.db.destroy();
    });
  }

  if (opts.spike) {
    http.get<{ Params: { id: string } }>('/api/spike/docs/:id', async (req, reply) => {
      const st = co.state(req.params.id);
      if (!st) return reply.code(404).send({ error: 'unbekannt' });
      return st;
    });

    http.post<{ Params: { id: string }; Body: { user?: string; keys?: string[] } }>('/api/spike/docs/:id/finish', async (req, reply) => {
      const user = req.body?.user;
      if (!user) return reply.code(400).send({ error: 'user fehlt' });
      return co.finish(req.params.id, user, req.body.keys);
    });

    http.post<{ Params: { id: string }; Body: { key?: string } }>('/api/spike/docs/:id/reopen', async (req, reply) => {
      if (!req.body?.key) return reply.code(400).send({ error: 'key fehlt' });
      return { reopened: co.reopen(req.params.id, req.body.key) };
    });
  }

  http.addHook('onClose', async () => {
    io.close();
  });

  return { http, io, co, services: s };
}
