/**
 * Bilder aus dem Netz (Wunsch Jo, 17. November 2026), siehe projects/webImport.ts:
 *   GET  /api/bild-holen?url=…                 Bild über den Server (CORS-Umweg) für Bento und die Vorschau
 *   GET  /api/bild-info?url=…&seite=…          Urheber, Lizenz, Ursprungsseite
 *   GET  /api/seite-lesen?url=…                Titel, Autor, Lizenz und Bilder einer Seite (Auswahl „Von einer Seite“)
 *   POST /api/projects/:id/notizen/datei       Datei für eine Notiz: rohe Bytes (application/octet-stream, ?scope=&name=)
 *                                              oder JSON {scope, url} (der Server holt das Bild selbst)
 *   GET  /api/projects/:id/notizen/:nid/datei  Datei einer Notiz
 * Alles nur angemeldet und mit Begrenzung je Person; fremde Adressen nur öffentlich (fetchMedia).
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { requireSession } from '../http/auth.js';
import { Notes, sniffNoteFile } from '../projects/notes.js';
import { SHARED, sharedTarget } from './notes.js';
import { fetchImage, IMAGE_MAX_BYTES, imageInfo, readPage, type Allowed } from '../projects/webImport.js';
import { isPublicAddress } from '../pinnwand/fetchMedia.js';
import type { Services } from '../services.js';
import { mapScopes } from './maps.js';

const ERR: Record<string, [number, string]> = {
  invalid: [400, 'Diese Adresse lässt sich nicht abrufen (nur öffentliche http- und https-Adressen).'],
  download: [502, 'Die Seite hat das Bild nicht herausgegeben. Speichere es und lade die Datei hoch.'],
  toolarge: [413, 'Das Bild ist größer als 15 MB.'],
  notimage: [415, 'Unter dieser Adresse liegt kein Bild.'],
  notpage: [415, 'Unter dieser Adresse liegt keine Webseite.'],
};

/** SVG kann Skript enthalten: nur in der Sandbox und nie als Dokument dieser Seite ausführen */
function sendImage(reply: FastifyReply, data: Buffer, mime: string, cache: string) {
  void reply
    .header('Cache-Control', cache)
    .header('X-Content-Type-Options', 'nosniff')
    .header('Content-Security-Policy', "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox")
    .type(mime);
  return reply.send(data);
}

export function webImageRoutes(app: FastifyInstance, s: Services, allowed: Allowed = isPublicAddress) {
  function limited(req: FastifyRequest, reply: FastifyReply) {
    const sess = requireSession(req, reply);
    if (!sess) return null;
    const key = 'web:' + sess.userId;
    if (s.webLimiter.blocked(key)) return void reply.code(429).send({ error: 'Zu viele Abrufe. Bitte in ein paar Minuten noch einmal.' });
    s.webLimiter.fail(key);
    return sess;
  }
  const fail = (reply: FastifyReply, e: string, extra: Record<string, unknown> = {}) => {
    const [code, msg] = ERR[e] ?? [502, 'Abruf fehlgeschlagen'];
    return reply.code(code).send({ error: msg, code: e, ...extra });
  };

  app.get<{ Querystring: { url?: string } }>('/api/bild-holen', async (req, reply) => {
    if (!limited(req, reply)) return;
    const r = await fetchImage(String(req.query.url ?? ''), allowed);
    if ('error' in r) return fail(reply, r.error, r.page ? { page: true } : {});
    return sendImage(reply, r.data, r.mime, 'private, max-age=3600');
  });

  app.get<{ Querystring: { url?: string; seite?: string } }>('/api/bild-info', async (req, reply) => {
    if (!limited(req, reply)) return;
    const url = String(req.query.url ?? '');
    const page = req.query.seite && /^https?:\/\//i.test(req.query.seite) ? req.query.seite : null;
    if (!/^https?:\/\//i.test(url)) return fail(reply, 'invalid');
    return imageInfo(url, page, allowed);
  });

  app.get<{ Querystring: { url?: string } }>('/api/seite-lesen', async (req, reply) => {
    if (!limited(req, reply)) return;
    const r = await readPage(String(req.query.url ?? ''), allowed);
    if ('error' in r) return fail(reply, r.error);
    return r;
  });

  /** Zugriff auf die Notizen eines Bereichs (wie notes:join); „Allgemein“ (*) wird zum Bereich, in dem die Notiz landet */
  async function scopeOf(userId: number, projectId: number, scope: string): Promise<string | null> {
    const r = await mapScopes(s, userId, projectId);
    if (!r) return null;
    if (scope === SHARED) return sharedTarget(r.role, r.scopes.map((x) => x.scope));
    return r.scopes.some((x) => x.scope === scope) ? scope : null;
  }
  async function project(req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) {
    const sess = requireSession(req, reply);
    if (!sess) return null;
    const projectId = Number(req.params.id);
    if (!Number.isInteger(projectId) || (sess.projectId !== null && sess.projectId !== projectId)) return void reply.code(403).send({ error: 'Kein Zugriff auf dieses Projekt' });
    return { userId: sess.userId, projectId };
  }

  const FromUrl = z.object({ scope: z.string().max(20), url: z.string().max(2000) });
  app.post<{ Params: { id: string }; Querystring: { scope?: string; name?: string } }>('/api/projects/:id/notizen/datei', { bodyLimit: IMAGE_MAX_BYTES + 64 * 1024 }, async (req, reply) => {
    const a = await project(req, reply);
    if (!a || !s.notes.files) return a && reply.code(503).send({ error: 'Kein Ablageordner' });
    let scope: string, name: string, data: Buffer;
    if (Buffer.isBuffer(req.body)) {
      scope = String(req.query.scope ?? '');
      name = String(req.query.name ?? 'bild');
      data = req.body;
    } else {
      const body = FromUrl.safeParse(req.body);
      if (!body.success) return reply.code(400).send({ error: 'Datei oder Adresse fehlt' });
      const target = await scopeOf(a.userId, a.projectId, body.data.scope);
      if (!target) return reply.code(403).send({ error: 'Kein Zugriff auf diese Notizen' });
      if (!limited(req, reply)) return;
      const r = await fetchImage(body.data.url, allowed);
      if ('error' in r) return fail(reply, r.error, r.page ? { page: true } : {});
      ({ name, data } = r);
      scope = target;
    }
    const target = await scopeOf(a.userId, a.projectId, scope);
    if (!target) return reply.code(403).send({ error: 'Kein Zugriff auf diese Notizen' });
    scope = target;
    if (data.length > IMAGE_MAX_BYTES) return fail(reply, 'toolarge');
    const mime = sniffNoteFile(data);
    if (!mime) return reply.code(415).send({ error: 'Nur Bilder (PNG, JPEG, GIF, WebP, AVIF, SVG)', code: 'type' });
    const file = await s.notes.files.store(a.projectId, scope, name, data);
    return { file, mime, size: data.length };
  });

  app.get<{ Params: { id: string; nid: string } }>('/api/projects/:id/notizen/:nid/datei', async (req, reply) => {
    const a = await project(req, reply);
    if (!a) return;
    const n = await s.notes.get(Number(req.params.nid));
    // Sichtbarkeit und Meldungen wie in den Notizen (Konzept 8e): Privat, Gruppe, Allgemein
    const r = n && (await mapScopes(s, a.userId, a.projectId));
    const visible = !!(n && r && Notes.canSee(n, { userId: a.userId, role: r.role }, r.scopes.some((x) => x.scope === n.scope)));
    if (!n || !visible || n.projectId !== a.projectId || !n.filePath || !n.file) return reply.code(404).send({ error: 'Datei nicht gefunden' });
    const data = await s.notes.files?.read(n.filePath);
    if (!data) return reply.code(404).send({ error: 'Datei nicht gefunden' });
    return sendImage(reply, data, n.file.mime, 'private, max-age=86400');
  });
}
