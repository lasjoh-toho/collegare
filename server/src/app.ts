import Fastify, { type FastifyInstance } from 'fastify';
import { Server } from 'socket.io';
import { CoServer, type CoServerOptions } from './collab/coServer.js';

export interface App {
  http: FastifyInstance;
  io: Server;
  co: CoServer;
}

/**
 * Baut den Collegare-Server: REST unter /api, Kollaboration über socket.io (Namespace /collab).
 * M0-Spike: Die Endpunkte unter /api/spike dienen nur dem Test und entfallen ab M1.
 */
export function buildApp(opts: { logger?: boolean; co?: CoServerOptions; corsOrigin?: string | string[] } = {}): App {
  const http = Fastify({ logger: opts.logger ?? false });
  const io = new Server(http.server, {
    path: '/socket.io',
    maxHttpBufferSize: 100_000_000,
    cors: opts.corsOrigin ? { origin: opts.corsOrigin } : undefined,
  });
  const co = new CoServer(io, { log: (m, d) => http.log.info({ d }, m), ...opts.co });

  http.get('/api/health', async () => ({ ok: true }));

  http.get<{ Params: { id: string } }>('/api/spike/docs/:id', async (req, reply) => {
    const s = co.state(req.params.id);
    if (!s) return reply.code(404).send({ error: 'unbekannt' });
    return s;
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

  return { http, io, co };
}
