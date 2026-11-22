import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { requireSession } from '../http/auth.js';
import { MaterialError, reaches, type Audience, type Viewer } from '../projects/materials.js';
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
  /** Wer liest: Lehrkräfte alles, Lernende mit ihrer Gruppe (für Material nur für bestimmte Gruppen oder Personen) */
  async function viewer(a: { userId: number; projectId: number; role: string }): Promise<Viewer> {
    if (a.role === 'teacher') return { teacher: true };
    const board = await s.projects.board(a.projectId);
    return { teacher: false, userId: a.userId, groupId: board.members.find((m) => m.userId === a.userId)?.groupId ?? null };
  }
  const AudienceBody = z.object({ groups: z.array(z.number().int()).max(200), users: z.array(z.number().int()).max(500) }).nullable();
  /** nur Gruppen und Personen, die es im Projekt gibt */
  async function cleanAudience(projectId: number, a: Audience | null): Promise<Audience | null> {
    if (!a) return null;
    const board = await s.projects.board(projectId);
    const groups = a.groups.filter((g) => board.groups.some((x) => x.id === g));
    const users = a.users.filter((u) => board.members.some((x) => x.userId === u));
    return groups.length || users.length ? { groups, users } : null;
  }

  const fail = (reply: FastifyReply, e: unknown) => {
    if (e instanceof MaterialError) return reply.code(e.status).send({ error: e.message });
    throw e;
  };

  /** Werkstatt der Lehrkraft (Werkzeuge und Materialien im Portal); wird beim ersten Aufruf angelegt */
  app.get('/api/werkstatt', async (req, reply) => {
    const sess = requireSession(req, reply);
    if (!sess) return;
    if (sess.projectId !== null) return reply.code(403).send({ error: 'Die Werkstatt gibt es nur im Portal, nicht beim Start aus einem Projekt' });
    const teaches = await s.db
      .selectFrom('memberships')
      .innerJoin('contexts', 'contexts.id', 'memberships.context_id')
      .select('contexts.id')
      .where('memberships.user_id', '=', sess.userId)
      .where('memberships.role', 'in', ['teacher', 'admin'])
      .where('contexts.kind', '!=', 'werkstatt')
      .executeTakeFirst();
    if (!teaches) return reply.code(403).send({ error: 'Nur für Lehrkräfte' });
    return { projectId: await s.projects.werkstatt(sess.userId) };
  });

  /**
   * Adresse von Autogra.fi für den Druck von Arbeitsblättern und Klassenarbeiten mit persönlichen QR-Codes (Jo,
   * 22. November 2026): abgeleitet aus der Rücksprung-Adresse der angebundenen App („…/auth/oidc/callback“), sonst
   * aus AUTOGRAFI_URL. Klassenliste und Codes holt der Browser dort selbst mit der Anmeldung in Autogra.fi.
   */
  app.get('/api/autografi', async (req, reply) => {
    const sess = requireSession(req, reply);
    if (!sess) return;
    let url: string | null = null;
    for (const c of await s.oidc.clients()) {
      for (const u of c.redirectUris) {
        const m = /^(https?:\/\/.+?)\/(?:auth\/)?oidc\/callback\/?$/.exec(u);
        if (m && (!url || /autogra/i.test(c.title + u))) url = m[1];
      }
    }
    return { url: url ?? (process.env.AUTOGRAFI_URL?.replace(/\/+$/, '') || null) };
  });

  /** Ziele zum Übernehmen: eigene Projekte als Lehrkraft mit ihren Gruppen und Lernenden */
  app.get('/api/werkstatt/ziele', async (req, reply) => {
    const sess = requireSession(req, reply);
    if (!sess) return;
    const list = (await s.projects.listFor(sess.userId)).filter((p) => p.role === 'teacher' && (sess.projectId === null || p.id === sess.projectId));
    const out = [];
    for (const p of list) {
      const b = await s.projects.board(p.id);
      out.push({
        id: p.id,
        title: p.title,
        mode: p.mode,
        groups: b.groups.map((g, i) => ({ id: g.id, title: g.title || `Gruppe ${i + 1}` })),
        members: b.members.map((m) => ({ id: m.userId, name: m.name, groupId: m.groupId })),
      });
    }
    return { projects: out };
  });

  // Dateien kommen als rohe Bytes (Name und Titel in der Adresse), ohne Multipart-Abhängigkeit
  app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer', bodyLimit: 200 * 1024 * 1024 }, (_req, body, done) => done(null, body));

  app.get<{ Params: { id: string } }>('/api/projects/:id/materials', async (req, reply) => {
    const a = await member(req, reply, 'member');
    if (!a) return;
    return { materials: await s.materials.list(a.projectId, await viewer(a)), canEdit: a.role === 'teacher' };
  });

  // Lernseite: bis 4 MB Text (eingebettete Bilder als data:-Adressen eingeschlossen)
  const PageBody = z.object({ kind: z.enum(['page', 'blatt']).default('page'), visible: z.boolean().default(true), title: z.string().max(200).default(''), body: z.string().max(4_000_000).default(''), note: z.string().max(5000).default('') });
  app.post<{ Params: { id: string } }>('/api/projects/:id/materials/page', async (req, reply) => {
    const a = await member(req, reply, 'teacher');
    if (!a) return;
    const body = PageBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'Seite zu groß oder ungültig' });
    const id = await s.materials.addPage(a.projectId, a.userId, body.data.title, body.data.body, body.data.note, body.data.kind);
    if (!body.data.visible) await s.materials.update(a.projectId, id, { visible: false });
    await s.audit.append({ actorId: a.userId, action: 'material.added', projectId: a.projectId, data: { id, kind: body.data.kind } });
    return { id };
  });

  app.get<{ Params: { id: string; mid: string } }>('/api/projects/:id/materials/:mid', async (req, reply) => {
    const a = await member(req, reply, 'member');
    if (!a) return;
    const p = await s.materials.page(a.projectId, Number(req.params.mid));
    if (!p || !reaches(p, await viewer(a))) return reply.code(404).send({ error: 'Seite nicht gefunden' });
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

  const Patch = z.object({ visible: z.boolean().optional(), title: z.string().max(200).optional(), note: z.string().max(5000).optional(), body: z.string().max(4_000_000).optional(), order: z.array(z.number().int()).max(500).optional(), tags: z.array(z.string().max(60)).max(30).optional(), audience: AudienceBody.optional() });
  app.patch<{ Params: { id: string; mid: string } }>('/api/projects/:id/materials/:mid', async (req, reply) => {
    const a = await member(req, reply, 'teacher');
    if (!a) return;
    const body = Patch.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'Ungültige Änderung' });
    try {
      if (body.data.order) await s.materials.reorder(a.projectId, body.data.order);
      const audience = body.data.audience === undefined ? undefined : await cleanAudience(a.projectId, body.data.audience);
      await s.materials.update(a.projectId, Number(req.params.mid), { title: body.data.title, note: body.data.note, body: body.data.body, visible: body.data.visible, tags: body.data.tags, audience });
      if (body.data.audience !== undefined) await s.audit.append({ actorId: a.userId, action: 'material.audience', projectId: a.projectId, data: { id: Number(req.params.mid), audience: audience ?? 'alle' } });
      if (body.data.visible !== undefined) await s.audit.append({ actorId: a.userId, action: body.data.visible ? 'material.shown' : 'material.hidden', projectId: a.projectId, data: { id: Number(req.params.mid) } });
      return { ok: true };
    } catch (e) {
      return fail(reply, e);
    }
  });

  /**
   * Übernehmen (Jo, 20. November 2026): Material aus den „Materialien“ (Werkstatt) als Kopie in ein Projekt, z. B. als
   * einführendes Material, für alle Lernenden, einzelne Gruppen oder einzelne Personen. Lehrkraft in beiden Projekten.
   */
  const CopyBody = z.object({ to: z.number().int(), visible: z.boolean().default(false), audience: AudienceBody.default(null) });
  app.post<{ Params: { id: string; mid: string } }>('/api/projects/:id/materials/:mid/kopieren', async (req, reply) => {
    const a = await member(req, reply, 'teacher');
    if (!a) return;
    const body = CopyBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'Zielprojekt angeben' });
    const src = await s.materials.one(Number(req.params.mid));
    if (!src || src.projectId !== a.projectId) return reply.code(404).send({ error: 'Material nicht gefunden' });
    if ((await s.projects.roleOf(a.userId, body.data.to)) !== 'teacher') return reply.code(403).send({ error: 'Nur in eigene Projekte' });
    try {
      const id = await s.materials.copy(src.id, body.data.to, a.userId, { visible: body.data.visible, audience: await cleanAudience(body.data.to, body.data.audience) });
      await s.audit.append({ actorId: a.userId, action: 'material.copied', projectId: body.data.to, data: { id, from: src.id, fromProject: a.projectId } });
      return { id };
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
    if (!f || f.projectId !== a.projectId || !reaches(f, await viewer(a))) return reply.code(404).send({ error: 'Datei nicht gefunden' });
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
