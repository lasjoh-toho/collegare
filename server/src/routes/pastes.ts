/**
 * Einfüge-Protokoll (Konzept 6.1, 8d.3). Lernende schreiben Einträge für den eigenen Bereich und sehen nur ihre eigenen
 * (offene Antworten bleiben als Erinnerung sichtbar), Lehrkräfte sehen alle Bereiche des Projekts.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { requireSession } from '../http/auth.js';
import { PasteAnswer, PasteInput } from '../projects/pastes.js';
import type { Services } from '../services.js';
import { mapScopes } from './maps.js';

export function pasteRoutes(app: FastifyInstance, s: Services) {
  async function member(req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) {
    const sess = requireSession(req, reply);
    if (!sess) return null;
    const projectId = Number(req.params.id);
    if (!Number.isInteger(projectId) || (sess.projectId !== null && sess.projectId !== projectId)) return void reply.code(403).send({ error: 'Kein Zugriff auf dieses Projekt' });
    const r = await mapScopes(s, sess.userId, projectId);
    if (!r) return void reply.code(404).send({ error: 'Projekt nicht gefunden' });
    return { userId: sess.userId, projectId, role: r.role, scopes: r.scopes };
  }

  app.get<{ Params: { id: string } }>('/api/projects/:id/einfuegen', async (req, reply) => {
    const a = await member(req, reply);
    if (!a) return;
    const scopes = a.scopes.map((x) => x.scope);
    const pastes = await s.pastes.list(a.projectId, scopes, a.role === 'teacher' ? undefined : a.userId);
    return { role: a.role, scopes: a.scopes.map(({ scope, title }) => ({ scope, title })), pastes };
  });

  app.post<{ Params: { id: string } }>('/api/projects/:id/einfuegen', { bodyLimit: 1024 * 1024 }, async (req, reply) => {
    const a = await member(req, reply);
    if (!a) return;
    const body = PasteInput.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'Ungültiger Eintrag' });
    if (!a.scopes.some((x) => x.scope === body.data.scope)) return reply.code(403).send({ error: 'Kein Zugriff auf diesen Bereich' });
    const id = await s.pastes.add(a.projectId, a.userId, body.data);
    await s.audit.append({ actorId: a.userId, action: 'paste.outside', projectId: a.projectId, data: { id, scope: body.data.scope, chars: [...body.data.text].length } });
    return { id };
  });

  app.post<{ Params: { id: string; pid: string } }>('/api/projects/:id/einfuegen/:pid', async (req, reply) => {
    const a = await member(req, reply);
    if (!a) return;
    const row = await s.pastes.get(Number(req.params.pid));
    if (!row || row.project_id !== a.projectId || row.user_id !== a.userId) return reply.code(404).send({ error: 'Eintrag nicht gefunden' });
    const body = PasteAnswer.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'Ungültige Antwort' });
    await s.pastes.answer(row.id, body.data);
    return { ok: true };
  });
}
