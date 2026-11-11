import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { requireSession } from '../http/auth.js';
import { GradingError } from '../projects/gradings.js';
import type { Services } from '../services.js';

/** Korrektur: Übersicht und Bewertung je Person (nur Lehrkräfte des Projekts). */
export function gradingRoutes(app: FastifyInstance, s: Services) {
  async function teacher(req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) {
    const sess = requireSession(req, reply);
    if (!sess) return null;
    const projectId = Number(req.params.id);
    if (!Number.isInteger(projectId) || (sess.projectId !== null && sess.projectId !== projectId)) return void reply.code(403).send({ error: 'Kein Zugriff auf dieses Projekt' });
    const role = await s.projects.roleOf(sess.userId, projectId);
    if (role !== 'teacher') return void reply.code(role ? 403 : 404).send({ error: role ? 'Nur für Lehrkräfte' : 'Projekt nicht gefunden' });
    return { userId: sess.userId, projectId };
  }

  app.get<{ Params: { id: string } }>('/api/projects/:id/korrektur', async (req, reply) => {
    const a = await teacher(req, reply);
    if (!a) return;
    const p = await s.projects.get(a.projectId);
    return { project: { id: a.projectId, title: p!.title }, ...(await s.gradings.overview(a.projectId)) };
  });

  const Body = z.object({
    points: z.number().int().min(0).max(15).nullable().optional(),
    feedback: z.string().max(100_000).optional(),
    notes: z.string().max(100_000).optional(),
    final: z.boolean().optional(),
  });

  app.put<{ Params: { id: string; userId: string } }>('/api/projects/:id/gradings/:userId', async (req, reply) => {
    const a = await teacher(req, reply);
    if (!a) return;
    const body = Body.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'Ungültige Bewertung' });
    try {
      const g = await s.gradings.save(a.projectId, Number(req.params.userId), a.userId, body.data);
      if (body.data.final !== undefined || body.data.points !== undefined)
        await s.audit.append({ actorId: a.userId, action: body.data.final ? 'grading.finalized' : 'grading.saved', projectId: a.projectId, data: { user: Number(req.params.userId), points: g.points } });
      return { grading: g };
    } catch (e) {
      if (e instanceof GradingError) return reply.code(e.status).send({ error: e.message });
      throw e;
    }
  });
}
