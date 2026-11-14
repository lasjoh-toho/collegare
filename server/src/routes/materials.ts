import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { requireSession } from '../http/auth.js';
import { MaterialError } from '../projects/materials.js';
import type { Services } from '../services.js';

/**
 * Einführendes Material (Wunsch Jo): alle Mitglieder lesen, Lehrkräfte pflegen. Läuft auch im Moodle-Start (LTI),
 * weil es Teil von Collegare ist; LTI selbst muss dafür nichts übertragen.
 */
export function materialRoutes(app: FastifyInstance, s: Services) {
  async function member(req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply, need: 'member' | 'teacher') {
    const sess = requireSession(req, reply);
    if (!sess) return null;
    const projectId = Number(req.params.id);
    if (!Number.isInteger(projectId) || (sess.projectId !== null && sess.projectId !== projectId)) return void reply.code(403).send({ error: 'Kein Zugriff auf dieses Projekt' });
    const role = await s.projects.roleOf(sess.userId, projectId);
    if (!role) return void reply.code(404).send({ error: 'Projekt nicht gefunden' });
    if (need === 'teacher' && role !== 'teacher') return void reply.code(403).send({ error: 'Nur für Lehrkräfte' });
    return { userId: sess.userId, projectId, role };
  }
  const fail = (reply: FastifyReply, e: unknown) => {
    if (e instanceof MaterialError) return reply.code(e.status).send({ error: e.message });
    throw e;
  };

  // Dateien kommen als rohe Bytes (Name und Titel in der Adresse), ohne Multipart-Abhängigkeit
  app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer', bodyLimit: 200 * 1024 * 1024 }, (_req, body, done) => done(null, body));

  app.get<{ Params: { id: string } }>('/api/projects/:id/materials', async (req, reply) => {
    const a = await member(req, reply, 'member');
    if (!a) return;
    return { materials: await s.materials.list(a.projectId, a.role !== 'teacher'), canEdit: a.role === 'teacher' };
  });

  // Lernseite: bis 4 MB Text (eingebettete Bilder als data:-Adressen eingeschlossen)
  const PageBody = z.object({ visible: z.boolean().default(true), title: z.string().max(200).default(''), body: z.string().max(4_000_000).default(''), note: z.string().max(5000).default('') });
  app.post<{ Params: { id: string } }>('/api/projects/:id/materials/page', async (req, reply) => {
    const a = await member(req, reply, 'teacher');
    if (!a) return;
    const body = PageBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'Seite zu groß oder ungültig' });
    const id = await s.materials.addPage(a.projectId, a.userId, body.data.title, body.data.body, body.data.note);
    if (!body.data.visible) await s.materials.update(a.projectId, id, { visible: false });
    await s.audit.append({ actorId: a.userId, action: 'material.added', projectId: a.projectId, data: { id, kind: 'page' } });
    return { id };
  });

  app.get<{ Params: { id: string; mid: string } }>('/api/projects/:id/materials/:mid', async (req, reply) => {
    const a = await member(req, reply, 'member');
    if (!a) return;
    const p = await s.materials.page(a.projectId, Number(req.params.mid));
    if (!p || (!p.visible && a.role !== 'teacher')) return reply.code(404).send({ error: 'Seite nicht gefunden' });
    return { page: p, canEdit: a.role === 'teacher' };
  });

  const LinkBody = z.object({ visible: z.boolean().default(true), kind: z.enum(['link', 'video']), title: z.string().max(200).default(''), url: z.string().min(4).max(2000), note: z.string().max(5000).default('') });
  app.post<{ Params: { id: string } }>('/api/projects/:id/materials', async (req, reply) => {
    const a = await member(req, reply, 'teacher');
    if (!a) return;
    const body = LinkBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'Adresse angeben' });
    try {
      const id = await s.materials.addLink(a.projectId, a.userId, body.data.kind, body.data.title, body.data.url, body.data.note);
      if (!body.data.visible) await s.materials.update(a.projectId, id, { visible: false });
      await s.audit.append({ actorId: a.userId, action: 'material.added', projectId: a.projectId, data: { id, kind: body.data.kind } });
      return { id };
    } catch (e) {
      return fail(reply, e);
    }
  });

  app.post<{ Params: { id: string }; Querystring: { name?: string; title?: string; sichtbar?: string } }>('/api/projects/:id/materials/file', { bodyLimit: 200 * 1024 * 1024 }, async (req, reply) => {
    const a = await member(req, reply, 'teacher');
    if (!a) return;
    if (!Buffer.isBuffer(req.body)) return reply.code(400).send({ error: 'Datei fehlt' });
    const p = await s.projects.get(a.projectId);
    try {
      const id = await s.materials.addFile(a.projectId, a.userId, req.query.title ?? '', req.query.name ?? 'datei', req.body, p!.settings.maxFileMb);
      if (req.query.sichtbar === '0') await s.materials.update(a.projectId, id, { visible: false });
      await s.audit.append({ actorId: a.userId, action: 'material.added', projectId: a.projectId, data: { id, kind: 'file', size: req.body.length } });
      return { id };
    } catch (e) {
      return fail(reply, e);
    }
  });

  const Patch = z.object({ visible: z.boolean().optional(), title: z.string().max(200).optional(), note: z.string().max(5000).optional(), body: z.string().max(4_000_000).optional(), order: z.array(z.number().int()).max(500).optional() });
  app.patch<{ Params: { id: string; mid: string } }>('/api/projects/:id/materials/:mid', async (req, reply) => {
    const a = await member(req, reply, 'teacher');
    if (!a) return;
    const body = Patch.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'Ungültige Änderung' });
    try {
      if (body.data.order) await s.materials.reorder(a.projectId, body.data.order);
      await s.materials.update(a.projectId, Number(req.params.mid), { title: body.data.title, note: body.data.note, body: body.data.body, visible: body.data.visible });
      if (body.data.visible !== undefined) await s.audit.append({ actorId: a.userId, action: body.data.visible ? 'material.shown' : 'material.hidden', projectId: a.projectId, data: { id: Number(req.params.mid) } });
      return { ok: true };
    } catch (e) {
      return fail(reply, e);
    }
  });

  app.delete<{ Params: { id: string; mid: string } }>('/api/projects/:id/materials/:mid', async (req, reply) => {
    const a = await member(req, reply, 'teacher');
    if (!a) return;
    await s.materials.remove(a.projectId, Number(req.params.mid));
    await s.audit.append({ actorId: a.userId, action: 'material.removed', projectId: a.projectId, data: { id: Number(req.params.mid) } });
    return { ok: true };
  });

  // Datei ausliefern: nur für Mitglieder des Projekts; PDF, Bilder und Videos im Browser, Dokumente als Download
  app.get<{ Params: { id: string; mid: string }; Querystring: { laden?: string } }>('/api/projects/:id/materials/:mid/datei', async (req, reply) => {
    const a = await member(req, reply, 'member');
    if (!a) return;
    const f = await s.materials.file(Number(req.params.mid));
    if (!f || f.projectId !== a.projectId || (!f.visible && a.role !== 'teacher')) return reply.code(404).send({ error: 'Datei nicht gefunden' });
    const inline = !req.query.laden && /^(application\/pdf|image\/|video\/|audio\/|text\/plain)/.test(f.mime);
    reply
      .header('content-type', f.mime)
      .header('x-content-type-options', 'nosniff')
      .header('accept-ranges', 'bytes')
      .header('cache-control', 'private, max-age=300')
      .header('content-disposition', `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(f.name)}`);
    // Teilbereiche für Videos (Spulen, Safari verlangt das)
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
    if (range && (range[1] || range[2])) {
      const total = f.data.length;
      let start = range[1] ? Number(range[1]) : total - Number(range[2]);
      let end = range[1] && range[2] ? Number(range[2]) : total - 1;
      start = Math.max(0, start);
      end = Math.min(total - 1, end);
      if (start > end) return reply.code(416).header('content-range', `bytes */${total}`).send();
      return reply.code(206).header('content-range', `bytes ${start}-${end}/${total}`).send(f.data.subarray(start, end + 1));
    }
    return reply.send(f.data);
  });
}
