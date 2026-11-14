/**
 * Folienpräsentation in Bento (Wunsch Jo, 14. November 2026, ersetzt dort OnlyOffice): der Server liefert die
 * Bento-Oberfläche (client/out/bento/Bento_Slides.bento.html, MIT, geholt mit scripts/bento-holen.sh) mit der
 * Präsentation im Datenblock #bento-doc und einem <meta name="bento-host-config">. Bento speichert per PUT zurück.
 * Datei-Aktionen (PowerPoint, JSON, Bento-Datei) erledigt die Folien-Seite im Elternfenster.
 */
import { randomUUID } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { requireSession } from '../http/auth.js';
import { BentoConflict, blankDeck } from '../projects/bentoDecks.js';
import type { Services } from '../services.js';
import { mapScopes } from './maps.js';

const SHELL = 'bento/Bento_Slides.bento.html';
/** Präsentationen mit eingebetteten Bildern und Videos werden groß */
const MAX_BYTES = 150 * 1024 * 1024;

const escAttr = (v: string) => v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Dokument in den Datenblock setzen (wie bento_embed_document in mod_bento): `<` nie roh, damit kein </script> entsteht */
export function spliceDoc(shell: string, json: string, meta: string): string {
  const safe = json.replace(/</g, '\\u003c');
  let done = false;
  let out = shell.replace(/(<script[^>]*id=["']bento-doc["'][^>]*>)([\s\S]*?)(<\/script>)/, (_m, a: string, _b: string, c: string) => {
    done = true;
    return a + safe + c;
  });
  if (!done) throw new Error('Bento-Oberfläche ohne Datenblock #bento-doc');
  out = out.replace(/<head[^>]*>/, (m) => m + meta);
  return out;
}

export function bentoRoutes(app: FastifyInstance, s: Services, clientDir?: string) {
  let cache: { mtime: number; html: string } | null = null;
  async function shell(): Promise<string | null> {
    if (!clientDir) return null;
    const p = join(resolve(clientDir), SHELL);
    try {
      const st = await stat(p);
      if (!cache || cache.mtime !== st.mtimeMs) cache = { mtime: st.mtimeMs, html: await readFile(p, 'utf8') };
      return cache.html;
    } catch {
      return null;
    }
  }
  const basePath = new URL(s.config.appUrl).pathname.replace(/\/$/, '');

  /** Zugriff auf eine Präsentation: Projekt, Gruppe; schreiben dürfen Lernende der Gruppe und die Lehrkraft im eigenen Testbereich */
  async function access(req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) {
    const sess = requireSession(req, reply);
    if (!sess) return null;
    const doc = await s.documents.get(Number(req.params.id));
    if (!doc || doc.kind !== 'slide') return void reply.code(404).send({ error: 'Präsentation nicht gefunden' });
    if (sess.projectId !== null && sess.projectId !== doc.projectId) return void reply.code(403).send({ error: 'Kein Zugriff auf dieses Projekt' });
    const r = await mapScopes(s, sess.userId, doc.projectId);
    const scope = r?.scopes.find((x) => x.scope === doc.scope);
    if (!r || !scope) return void reply.code(403).send({ error: 'Kein Zugriff auf diese Präsentation' });
    const project = await s.projects.get(doc.projectId);
    const teacher = r.role === 'teacher';
    const write = !doc.doneAt && (!teacher || !!scope.test);
    const canImport = write && (teacher || !!project?.settings.slidesImportStudents);
    return { userId: sess.userId, doc, write, canImport, teacher };
  }

  app.get<{ Params: { id: string } }>('/api/documents/:id/bento', async (req, reply) => {
    const a = await access(req, reply);
    if (!a) return;
    const html = await shell();
    if (!html) return reply.code(503).send({ error: 'Die Folien-Oberfläche ist auf diesem Server nicht installiert (scripts/bento-holen.sh).' });
    const deck = await s.bentoDecks.get(a.doc.id);
    const json = deck?.data ?? JSON.stringify(blankDeck(a.doc.title, randomUUID()));
    const config = {
      name: 'Collegare',
      saveUrl: `${basePath}/api/documents/${a.doc.id}/bento`,
      version: deck?.version ?? 0,
      ribbon: true,
      readOnly: !a.write,
      canImport: a.canImport,
      fileActions: ['exportPptx', 'exportJson', 'importPptx', 'importHtml', 'importJson'],
    };
    const meta = `<meta name="bento-host-config" data-bento-transient content="${escAttr(JSON.stringify(config))}">`;
    return reply
      .header('Cache-Control', 'no-store')
      .type('text/html; charset=utf-8')
      .send(spliceDoc(html, json, meta));
  });

  /** Dokument als JSON (Export auf der Folien-Seite, Ansicht für die Lehrkraft) */
  app.get<{ Params: { id: string } }>('/api/documents/:id/bento.json', async (req, reply) => {
    const a = await access(req, reply);
    if (!a) return;
    const deck = await s.bentoDecks.get(a.doc.id);
    return reply.header('Cache-Control', 'no-store').type('application/json').send(deck?.data ?? JSON.stringify(blankDeck(a.doc.title, randomUUID())));
  });

  const Body = z.object({ doc: z.record(z.string(), z.unknown()), version: z.number().int().min(0) });
  app.put<{ Params: { id: string } }>('/api/documents/:id/bento', { bodyLimit: MAX_BYTES }, async (req, reply) => {
    const a = await access(req, reply);
    if (!a) return;
    if (!a.write) return reply.code(403).send({ error: a.doc.doneAt ? 'Die Präsentation ist als fertig markiert.' : 'Nur lesen' });
    const body = Body.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'Ungültige Daten' });
    const d = body.data.doc;
    if (d.format !== 'bento/slides' || !Array.isArray(d.slides) || d.slides.length === 0) return reply.code(400).send({ error: 'Keine Bento-Präsentation' });
    // Live-Zugangsdaten gehören nie in die Datenbank (wie in mod_bento)
    delete d.collab;
    try {
      const version = await s.bentoDecks.save(a.doc.id, JSON.stringify(d), body.data.version, a.userId);
      if (typeof d.title === 'string' && d.title.trim() && d.title.trim() !== a.doc.title) await s.documents.rename(a.doc.id, d.title.trim().slice(0, 200));
      return { version };
    } catch (e) {
      if (e instanceof BentoConflict) return reply.code(409).send({ error: e.message, version: e.current });
      throw e;
    }
  });
}
