import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { requireSession } from '../http/auth.js';
import { DocError, collabId } from '../projects/documents.js';
import type { Services } from '../services.js';
import { mapScopes } from './maps.js';

/** Meldet geänderte Dokumente an offene Projektseiten und trennt bei „Fertig“ die Editoren. */
export interface DocEvents {
  changed(projectId: number, scope: string): void;
  lockChanged(docId: number): void;
}

/** Ausarbeitung: Dokumente je Karte der Gliederung, „Fertig“ und „Wieder öffnen“ (Issue #9). */
export function documentRoutes(app: FastifyInstance, s: Services, ev: DocEvents) {
  async function scopeAccess(req: FastifyRequest, reply: FastifyReply, projectId: number, scope?: string) {
    const sess = requireSession(req, reply);
    if (!sess) return null;
    if (sess.projectId !== null && sess.projectId !== projectId) return void reply.code(403).send({ error: 'Kein Zugriff auf dieses Projekt' });
    const r = await mapScopes(s, sess.userId, projectId);
    if (!r) return void reply.code(403).send({ error: 'Kein Zugriff auf dieses Projekt' });
    const sc = scope ? r.scopes.find((x) => x.scope === scope) : r.scopes[0];
    return { userId: sess.userId, role: r.role, scopes: r.scopes, scope: sc ?? null };
  }

  app.get<{ Params: { id: string }; Querystring: { bereich?: string } }>('/api/projects/:id/documents', async (req, reply) => {
    const projectId = Number(req.params.id);
    const a = await scopeAccess(req, reply, projectId, req.query.bereich);
    if (!a) return;
    const p = await s.projects.get(projectId);
    const base = { role: a.role, scopes: a.scopes.map(({ scope, title }) => ({ scope, title })), finishLock: p!.settings.finishLock, reopenBy: p!.settings.reopenBy };
    if (!a.scope) return { ...base, scope: null, people: [], docs: [], outlineAt: null };
    const { map } = await s.maps.get(projectId, a.scope.scope);
    return { ...base, scope: a.scope.scope, people: a.scope.people, docs: await s.documents.list(projectId, a.scope.scope), outlineAt: map.outline?.at ?? null };
  });

  app.post<{ Params: { id: string } }>('/api/projects/:id/documents/sync', async (req, reply) => {
    const projectId = Number(req.params.id);
    const body = z.object({ scope: z.string() }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'Bereich fehlt' });
    const a = await scopeAccess(req, reply, projectId, body.data.scope);
    if (!a) return;
    if (!a.scope) return reply.code(403).send({ error: 'Kein Zugriff auf diese Gruppe' });
    try {
      const { map } = await s.maps.get(projectId, a.scope.scope);
      const r = await s.documents.syncFromOutline(projectId, a.scope.scope, map);
      await s.audit.append({ actorId: a.userId, action: 'documents.sync', projectId, data: { scope: a.scope.scope, ...r } });
      ev.changed(projectId, a.scope.scope);
      return r;
    } catch (e) {
      if (e instanceof DocError) return reply.code(e.status).send({ error: e.message });
      throw e;
    }
  });

  async function docAccess(req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) {
    const doc = await s.documents.get(Number(req.params.id));
    if (!doc) return void reply.code(404).send({ error: 'Dokument nicht gefunden' });
    const a = await scopeAccess(req, reply, doc.projectId, doc.scope);
    if (!a) return;
    if (!a.scope) return void reply.code(403).send({ error: 'Kein Zugriff auf dieses Dokument' });
    const p = await s.projects.get(doc.projectId);
    return { ...a, doc, settings: p!.settings };
  }

  app.post<{ Params: { id: string } }>('/api/documents/:id/done', async (req, reply) => {
    const a = await docAccess(req, reply);
    if (!a) return;
    if (!a.settings.finishLock) return reply.code(403).send({ error: 'Die Fertig-Sperre ist in diesem Projekt ausgeschaltet' });
    if (a.role !== 'student') return reply.code(403).send({ error: 'Fertig melden die Lernenden selbst' });
    if (a.doc.ownerId !== null && a.doc.ownerId !== a.userId) return reply.code(403).send({ error: 'Nur die zuständige Person meldet diesen Abschnitt fertig' });
    if (a.doc.doneAt) return { ok: true };
    await s.documents.setDone(a.doc.id, a.userId);
    await s.audit.append({ actorId: a.userId, action: 'document.done', projectId: a.doc.projectId, data: { doc: a.doc.id } });
    ev.lockChanged(a.doc.id);
    ev.changed(a.doc.projectId, a.doc.scope);
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/api/documents/:id/reopen', async (req, reply) => {
    const a = await docAccess(req, reply);
    if (!a) return;
    if (a.role !== 'teacher' && a.settings.reopenBy !== 'group') return reply.code(403).send({ error: 'Wieder öffnen kann hier nur die Lehrkraft' });
    if (!a.doc.doneAt) return { ok: true };
    await s.documents.setDone(a.doc.id, null);
    await s.audit.append({ actorId: a.userId, action: 'document.reopened', projectId: a.doc.projectId, data: { doc: a.doc.id } });
    ev.lockChanged(a.doc.id);
    ev.changed(a.doc.projectId, a.doc.scope);
    return { ok: true };
  });

  return { collabId };
}

/** Zugriff des Editors auf ein Dokument: Gruppe oder Lehrkraft; fertige Dokumente und Lehrkräfte nur lesend. */
export async function authorizeDoc(s: Services, sess: { userId: number; projectId: number | null }, docId: number) {
  const doc = await s.documents.get(docId);
  if (!doc) return null;
  if (sess.projectId !== null && sess.projectId !== doc.projectId) return null;
  const r = await mapScopes(s, sess.userId, doc.projectId);
  if (!r || !r.scopes.some((x) => x.scope === doc.scope)) return null;
  return { view: doc.doneAt !== null || r.role === 'teacher' };
}
