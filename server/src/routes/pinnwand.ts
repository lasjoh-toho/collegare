/**
 * Pinnwand als Modul (Konzept 8d.5): Gegenstelle für den Transport, den die Pinnwand-Seite (client/public/pinnwand/)
 * an js/app.js von mod_pinnwand übergibt. Ein Aufruf entspricht einem Web-Service von mod_pinnwand.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { requireSession } from '../http/auth.js';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { exportHtml } from '../pinnwand/exportHtml.js';
import { fetchMedia, mediaMime } from '../pinnwand/fetchMedia.js';
import { exportPresentation, fromMap, INSTANCE, METHODS, READ_ONLY, slideMedia, type PinCtx } from '../pinnwand/api.js';
import { buildOutline } from '../projects/maps.js';
import { PinError } from '../pinnwand/store.js';
import type { Services } from '../services.js';
import { mapScopes } from './maps.js';

const MESSAGES: Record<string, string> = {
  error_save: 'Speichern fehlgeschlagen',
  maxreached: 'Die Höchstzahl an Objekten ist erreicht',
  invalidrecord: 'Nicht gefunden (vielleicht gerade gelöscht)',
  invalidparameter: 'Ungültige Angabe',
  nopermissions: 'Dafür fehlt die Berechtigung',
};

type P = { id: string; scope: string };

export function pinnwandRoutes(app: FastifyInstance, s: Services, clientDir?: string) {
  const base = (() => {
    try {
      return new URL(s.config.appUrl).pathname.replace(/\/$/, '');
    } catch {
      return '';
    }
  })();

  /** Wer darf an diese Pinnwand: Lernende ihre Gruppe (im Einzelmodus sich selbst), Lehrkräfte alle */
  async function access(req: FastifyRequest<{ Params: P }>, reply: FastifyReply) {
    const sess = requireSession(req, reply);
    if (!sess) return null;
    const projectId = Number(req.params.id);
    if (!Number.isInteger(projectId) || (sess.projectId !== null && sess.projectId !== projectId)) return void reply.code(403).send({ error: 'Kein Zugriff auf dieses Projekt' });
    const r = await mapScopes(s, sess.userId, projectId);
    const sc = r?.scopes.find((x) => x.scope === req.params.scope);
    if (!r || !sc) return void reply.code(403).send({ error: 'Kein Zugriff auf diese Pinnwand' });
    const project = await s.projects.get(projectId);
    const maxBytes = (project?.settings.maxFileMb ?? 25) * 1024 * 1024;
    return { userId: sess.userId, projectId, scope: sc, role: r.role, scopes: r.scopes, maxBytes, settings: project?.settings };
  }

  const ctx = (a: NonNullable<Awaited<ReturnType<typeof access>>>, sc: PinCtx['s']): PinCtx => ({ s: sc, fullname: a.scope.title, teacher: a.role === 'teacher', base, maxBytes: a.maxBytes });

  // Welche Pinnwände: Lernende die eigene, Lehrkräfte alle Gruppen
  app.get<{ Params: { id: string } }>('/api/projects/:id/pinnwand', async (req, reply) => {
    const sess = requireSession(req, reply);
    if (!sess) return;
    const projectId = Number(req.params.id);
    if (!Number.isInteger(projectId) || (sess.projectId !== null && sess.projectId !== projectId)) return reply.code(403).send({ error: 'Kein Zugriff auf dieses Projekt' });
    const r = await mapScopes(s, sess.userId, projectId);
    if (!r) return reply.code(404).send({ error: 'Projekt nicht gefunden' });
    return { ok: true, role: r.role, scopes: r.scopes.map(({ scope, title }) => ({ scope, title })) };
  });

  // Daten für die Pinnwand-Seite (window.pinnwandConfig ohne Texte)
  app.get<{ Params: P }>('/api/projects/:id/pinnwand/:scope/start', async (req, reply) => {
    const a = await access(req, reply);
    if (!a) return;
    const me = await s.users.byId(a.userId);
    const teacher = a.role === 'teacher';
    return {
      ok: true,
      title: a.scope.title,
      scopes: a.scopes.map(({ scope, title }) => ({ scope, title })),
      config: {
        cmid: a.projectId,
        contextid: 0,
        sesskey: '',
        slidemediabase: `${base}/api/projects/${a.projectId}/pinnwand/${a.scope.scope}/medien/`,
        slidemediamax: a.maxBytes,
        maxpictures: INSTANCE.maxpictures,
        boardpannable: !!INSTANCE.boardpannable,
        startmode: INSTANCE.startmode,
        sidebaropacity: INSTANCE.sidebaropacity,
        studentboardclone: !!INSTANCE.studentboardclone,
        studentboardcreate: !!INSTANCE.studentboardcreate,
        studentseeotherboards: !!INSTANCE.studentseeotherboards,
        studentpoststream: !!INSTANCE.studentpoststream,
        studentlayers: !!INSTANCE.studentlayers,
        formulatransform: !!a.settings?.formulaTransform,
        formulacalc: !!a.settings?.formulaCalc,
        allowconsent: !!INSTANCE.allowconsent,
        consenttext: '',
        canmanage: teacher,
        // In Collegare arbeitet die Gruppe als eine Person: ihr Name steht an den Objekten
        currentuserfullname: a.scope.title,
        username: me?.name ?? '',
        managerurl: null,
        exportpresentationurl: `${base}/api/projects/${a.projectId}/pinnwand/${a.scope.scope}/export?v=1`,
        courseurl: `${base}/projekt/?id=${a.projectId}`,
        isediting: false,
        settingsurl: null,
      },
    };
  });

  app.post<{ Params: P; Body: { methodname?: string; args?: Record<string, unknown> } }>('/api/projects/:id/pinnwand/:scope/call', { bodyLimit: 120 * 1024 * 1024 }, async (req, reply) => {
    const a = await access(req, reply);
    if (!a) return;
    const name = String(req.body?.methodname ?? '').replace(/^mod_pinnwand_/, '');
    const fn = Object.prototype.hasOwnProperty.call(METHODS, name) ? METHODS[name] : null;
    if (!fn) return reply.code(400).send({ ok: false, error: 'Unbekannte Methode' });
    const args = req.body?.args && typeof req.body.args === 'object' ? req.body.args : {};
    try {
      const data = await s.pinnwand.run(a.projectId, a.scope.scope, (sc) => Promise.resolve(fn(ctx(a, sc), args)));
      if (!READ_ONLY.has(name)) s.pinnwandEvents.emit('changed', { projectId: a.projectId, scope: a.scope.scope, by: a.userId, method: name });
      return { ok: true, data };
    } catch (e) {
      if (e instanceof PinError) return { ok: false, error: MESSAGES[e.message.split(':')[0]] ?? e.message };
      throw e;
    }
  });

  // „Pinnwand aus der Mindmap“: übernommene Äste werden Rahmen im Roten Faden, ihre Karten Zettel darin
  app.post<{ Params: P }>('/api/projects/:id/pinnwand/:scope/aus-mindmap', async (req, reply) => {
    const a = await access(req, reply);
    if (!a) return;
    const { map } = await s.maps.get(a.projectId, a.scope.scope);
    const sections = buildOutline(map).map((x) => ({ id: x.id, title: x.title, cards: x.cards.map((id) => ({ id, title: map.cards[id]?.title ?? '', text: map.cards[id]?.text ?? '' })) }));
    if (!sections.length) return reply.code(400).send({ error: 'In der Mindmap ist noch nichts „In die Gliederung“ übernommen.' });
    const r = await s.pinnwand.run(a.projectId, a.scope.scope, (sc) => fromMap(ctx(a, sc), sections));
    s.pinnwandEvents.emit('changed', { projectId: a.projectId, scope: a.scope.scope, by: a.userId, method: 'aus_mindmap' });
    return { ok: true, ...r };
  });

  // Folien-Medien hochladen (slidemedia.php, action=upload); die Datei kommt als rohe Bytes
  app.post<{ Params: P; Querystring: { name?: string; mime?: string } }>('/api/projects/:id/pinnwand/:scope/medien', { bodyLimit: 500 * 1024 * 1024 }, async (req, reply) => {
    const a = await access(req, reply);
    if (!a) return;
    const body = req.body;
    if (!Buffer.isBuffer(body)) return { error: 'failed' };
    return s.pinnwand.run(a.projectId, a.scope.scope, (sc) => slideMedia(ctx(a, sc), String(req.query.name ?? 'datei'), String(req.query.mime ?? ''), body));
  });

  // Folien-Medien von einer Adresse übernehmen (slidemedia.php, action=url); limit kleiner als die Grenze, z. B. für Audio
  app.post<{ Params: P; Body: { url?: unknown; limit?: unknown } }>('/api/projects/:id/pinnwand/:scope/medien-url', async (req, reply) => {
    const a = await access(req, reply);
    if (!a) return;
    const url = typeof req.body?.url === 'string' ? req.body.url.trim() : '';
    if (!/^https?:\/\/\S+$/i.test(url) || url.length > 2000) return { error: 'invalid' };
    const limit = Number(req.body?.limit);
    const max = Number.isFinite(limit) && limit > 0 ? Math.min(limit, a.maxBytes) : a.maxBytes;
    const got = await fetchMedia(url, max);
    if ('error' in got) return got.error === 'toolarge' ? { error: 'toolarge', maxbytes: max } : { error: got.error };
    const mime = mediaMime(got.mime, got.name);
    return s.pinnwand.run(a.projectId, a.scope.scope, (sc) => slideMedia(ctx(a, sc), got.name, mime, got.data));
  });

  // Präsentation als eigenständige HTML-Datei (export_presentation.php): Abspiel-Logik und Texte kommen aus den
  // mitgelieferten Dateien von mod_pinnwand, Bilder sind eingebettet
  app.get<{ Params: P; Querystring: { boardid?: string; annot?: string; ink?: string } }>('/api/projects/:id/pinnwand/:scope/export', async (req, reply) => {
    const a = await access(req, reply);
    if (!a) return;
    const dir = clientDir ? join(resolve(clientDir), 'pinnwand', 'mod', 'pinnwand') : '';
    let player = '';
    let labels: Record<string, string> = {};
    try {
      player = await readFile(join(dir, 'js', 'presentation-player.js'), 'utf8');
      labels = JSON.parse(await readFile(join(dir, 'strings.json'), 'utf8'));
    } catch {
      return reply.code(503).type('text/plain; charset=utf-8').send('Die Pinnwand ist auf diesem Server nicht eingerichtet (scripts/pinnwand-holen.sh).');
    }
    const opts = { boardid: Math.max(0, Math.trunc(Number(req.query.boardid ?? 0)) || 0), annot: req.query.annot === '1', ink: req.query.ink === '1' };
    const data = await s.pinnwand.run(a.projectId, a.scope.scope, (sc) => exportPresentation(ctx(a, sc), opts, labels));
    if (!data) return reply.code(404).type('text/plain; charset=utf-8').send(labels.nothreadtoexport ?? 'Kein Roter Faden zum Exportieren.');
    const project = await s.projects.get(a.projectId);
    const name = `${project?.title ?? 'Pinnwand'} – ${a.scope.title}`;
    // Schrägstriche maskieren, damit "</script" im Datenblock nicht vorkommen kann (wie json_encode in PHP)
    const json = JSON.stringify(data).replace(/\//g, '\\/');
    const esc = (t: string) => t.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);
    const html = exportHtml(esc(name + ' - Präsentation'), json, player.replace(/<\/script/gi, '<\\/script'));
    const file = (name.replace(/[^\p{L}\p{N} ._-]+/gu, '').trim().replace(/\s+/g, '-') || 'pinnwand') + '-praesentation.html';
    return reply
      .header('content-type', 'text/html; charset=utf-8')
      .header('content-disposition', `attachment; filename="${file.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(file)}`)
      .send(html);
  });

  const send = (reply: FastifyReply, f: { name: string; mime: string; data: Buffer } | null) => {
    if (!f) return reply.code(404).send({ error: 'Datei nicht gefunden' });
    return reply
      .header('content-type', f.mime)
      .header('x-content-type-options', 'nosniff')
      .header('content-security-policy', "default-src 'none'; style-src 'unsafe-inline'")
      .header('cache-control', 'private, max-age=86400')
      .header('content-disposition', `inline; filename*=UTF-8''${encodeURIComponent(f.name)}`)
      .send(f.data);
  };

  app.get<{ Params: P & { fid: string; name: string } }>('/api/projects/:id/pinnwand/:scope/datei/:fid/:name', async (req, reply) => {
    const a = await access(req, reply);
    if (!a) return;
    return send(reply, await s.pinnwand.file(a.projectId, a.scope.scope, Number(req.params.fid)));
  });

  app.get<{ Params: P & { file: string } }>('/api/projects/:id/pinnwand/:scope/medien/:file', async (req, reply) => {
    const a = await access(req, reply);
    if (!a) return;
    return send(reply, await s.pinnwand.fileByName(a.projectId, a.scope.scope, 'slidemedia', req.params.file));
  });
}

/** Echtzeit: wer eine Pinnwand offen hat, erfährt, dass sich dort etwas geändert hat (die Seite lädt dann neu). */
export function pinnwandSocket(nsp: import('socket.io').Namespace, s: Services) {
  s.pinnwandEvents.on('changed', (e: { projectId: number; scope: string; by: number; method: string }) => {
    nsp.to(`pin:${e.projectId}:${e.scope}`).emit('pinnwand', e);
  });
  /** Wer hat diese Pinnwand gerade offen (gemeinsames Bearbeiten): an alle im Raum */
  async function presence(room: string) {
    const [, p, scope] = room.split(':');
    const seen = new Map<number, string>();
    for (const so of await nsp.in(room).fetchSockets()) {
      const d = so.data.pin as { userId: number; name: string } | undefined;
      if (d) seen.set(d.userId, d.name);
    }
    nsp.to(room).emit('pinnwand:presence', { projectId: Number(p), scope, people: [...seen].map(([id, name]) => ({ id, name })) });
  }
  nsp.on('connection', (socket) => {
    const leave = () => {
      for (const rm of socket.rooms)
        if (rm.startsWith('pin:')) {
          void socket.leave(rm);
          void presence(rm);
        }
    };
    socket.on('pinnwand:join', async (msg: { projectId?: unknown; scope?: unknown }, ack?: (r: { ok: boolean; error?: string }) => void) => {
      const sess = socket.data.session as { userId: number; projectId: number | null };
      const projectId = Number(msg?.projectId);
      if (!Number.isInteger(projectId) || (sess.projectId !== null && sess.projectId !== projectId)) return ack?.({ ok: false, error: 'Kein Zugriff' });
      const r = await mapScopes(s, sess.userId, projectId);
      const sc = r?.scopes.find((x) => x.scope === msg?.scope);
      if (!sc) return ack?.({ ok: false, error: 'Kein Zugriff' });
      leave();
      const room = `pin:${projectId}:${sc.scope}`;
      const user = await s.users.byId(sess.userId);
      socket.data.pin = { userId: sess.userId, name: user?.name ?? '' };
      await socket.join(room);
      ack?.({ ok: true });
      await presence(room);
    });
    socket.on('disconnecting', leave);
  });
}
