/**
 * KI-Modellkarten (Verwaltung) und Texterkennung für „Bild aufnehmen“ (Wunsch Jo, 24. November 2026):
 *   GET    /api/admin/ki-karten                  Karten ohne Schlüssel
 *   POST   /api/admin/ki-karten                  neue Karte
 *   PUT    /api/admin/ki-karten/:id              ändern (leerer Schlüssel = bleibt)
 *   DELETE /api/admin/ki-karten/:id
 *   POST   /api/admin/ki-karten/:id/hoch         Vorrang bei gleicher Verwendung
 *   POST   /api/admin/ki-karten/:id/pruefen      Probeanfrage mit einem kleinen Bild
 *   GET    /api/admin/ki-karten/export           Datei im Format von Autogra.fi, ohne Schlüssel
 *   POST   /api/admin/ki-karten/import           Datei aus Autogra.fi oder Collegare; keys: Name → Schlüssel
 *   GET    /api/projects/:id/texterkennung       ob die Erkennung hier geht (und warum nicht)
 *   POST   /api/projects/:id/notizen/erkennen    aufbereitetes Bild (Bytes) → {text}; nichts wird gespeichert
 *   POST   /api/projects/:id/notizen/:nid/erkannt erkannten Text der eigenen Notiz ins Einfüge-Protokoll (Herkunft)
 */
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { CardError, CardInput, CARD_TYPES, exportCards, ImportFile, type CardInputT } from '../ai/modelCards.js';
import { OcrError, recognize } from '../ai/ocr.js';
import { requireSession } from '../http/auth.js';
import { clampToFrame, DEFAULT_SETTINGS } from '../projects/settings.js';
import { sniffNoteFile } from '../projects/notes.js';
import type { Services } from '../services.js';
import { requireAdmin } from './admin.js';
import { mapScopes } from './maps.js';

/** Größtes Bild für die Erkennung (der Browser verkleinert vorher auf etwa 2000 Bildpunkte Kantenlänge) */
const OCR_MAX_BYTES = 8 * 1024 * 1024;

/** kleines PNG mit „Test“-Strichen für die Probeanfrage (ohne Bildbibliothek erzeugt) */
function probeImage(): Buffer {
  const w = 64;
  const h = 24;
  const rows: number[] = [];
  for (let y = 0; y < h; y++) {
    rows.push(0);
    for (let x = 0; x < w; x++) rows.push((y > 4 && y < 19 && (x === 8 || x === 20 || x === 32 || x === 44)) || (y === 5 && x > 2 && x < 14) ? 0 : 255);
  }
  const crc = (b: Buffer) => {
    let c = ~0;
    for (const v of b) {
      c ^= v;
      for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
    return ~c >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // Bittiefe
  ihdr[9] = 0; // Graustufen
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.from(rows))), chunk('IEND', Buffer.alloc(0))]);
}

export function aiRoutes(app: FastifyInstance, s: Services) {
  const fail = (reply: FastifyReply, e: unknown) => {
    if (e instanceof CardError) return reply.code(400).send({ error: e.message });
    throw e;
  };

  app.get('/api/admin/ki-karten', async (req, reply) => {
    if (!(await requireAdmin(s, req, reply))) return;
    return { cards: await s.aiCards.list(), types: CARD_TYPES };
  });

  app.post('/api/admin/ki-karten', async (req, reply) => {
    const actor = await requireAdmin(s, req, reply);
    if (!actor) return;
    const body = CardInput.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'Name, Typ und Modell angeben' });
    try {
      const card = await s.aiCards.add(body.data);
      await s.audit.append({ actorId: actor, action: 'admin.ai_card_added', data: { id: card.id, type: card.type, model: card.model } });
      return { card, cards: await s.aiCards.list() };
    } catch (e) {
      return fail(reply, e);
    }
  });

  app.put<{ Params: { id: string } }>('/api/admin/ki-karten/:id', async (req, reply) => {
    const actor = await requireAdmin(s, req, reply);
    if (!actor) return;
    const body = CardInput.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'Name, Typ und Modell angeben' });
    try {
      const card = await s.aiCards.update(req.params.id, body.data);
      await s.audit.append({ actorId: actor, action: 'admin.ai_card_changed', data: { id: card.id, type: card.type, model: card.model } });
      return { card, cards: await s.aiCards.list() };
    } catch (e) {
      return fail(reply, e);
    }
  });

  app.delete<{ Params: { id: string } }>('/api/admin/ki-karten/:id', async (req, reply) => {
    const actor = await requireAdmin(s, req, reply);
    if (!actor) return;
    if (!(await s.aiCards.remove(req.params.id))) return reply.code(404).send({ error: 'Karte nicht gefunden' });
    await s.audit.append({ actorId: actor, action: 'admin.ai_card_deleted', data: { id: req.params.id } });
    return { cards: await s.aiCards.list() };
  });

  app.post<{ Params: { id: string } }>('/api/admin/ki-karten/:id/hoch', async (req, reply) => {
    if (!(await requireAdmin(s, req, reply))) return;
    await s.aiCards.moveUp(req.params.id);
    return { cards: await s.aiCards.list() };
  });

  app.post<{ Params: { id: string } }>('/api/admin/ki-karten/:id/pruefen', async (req, reply) => {
    if (!(await requireAdmin(s, req, reply))) return;
    const card = await s.aiCards.get(req.params.id);
    if (!card) return reply.code(404).send({ error: 'Karte nicht gefunden' });
    try {
      const r = await recognize(card, probeImage(), 'image/png', s.aiFetch, 120_000);
      return { ok: true, ms: r.ms, text: r.text.slice(0, 200) };
    } catch (e) {
      if (e instanceof OcrError) return { ok: false, error: e.message };
      throw e;
    }
  });

  app.get('/api/admin/ki-karten/export', async (req, reply) => {
    if (!(await requireAdmin(s, req, reply))) return;
    return exportCards(await s.aiCards.all());
  });

  app.post('/api/admin/ki-karten/import', async (req, reply) => {
    const actor = await requireAdmin(s, req, reply);
    if (!actor) return;
    const body = z.object({ file: ImportFile, keys: z.record(z.string(), z.string().max(400)).default({}) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'Das ist keine exportierte Konfiguration der Modelle.' });
    const { file, keys } = body.data;
    const have = new Set((await s.aiCards.all()).map((c) => [c.name, c.type, c.url, c.model].join('\u0001')));
    // Zuordnung aus Autogra.fi: welche Karte die Erkennung übernimmt (assigned.ocr = Index)
    const ocrIndex = file.assigned?.ocr;
    let created = 0;
    let skipped = 0;
    const errors: string[] = [];
    for (const [i, c] of file.cards.entries()) {
      const type = (CARD_TYPES as readonly string[]).includes(c.type ?? '') ? (c.type as CardInputT['type']) : null;
      const name = (c.name ?? '').trim() || c.model || 'Karte';
      if (!type) {
        // LanguageTool, Segmentierung, Trainingsdienst gibt es hier nicht
        skipped++;
        continue;
      }
      if (have.has([name, type, c.url ?? '', c.model ?? ''].join('\u0001'))) {
        skipped++;
        continue;
      }
      const uses = (c.uses ?? []).includes('ocr') || ocrIndex === i ? (['ocr'] as const) : [];
      const input = CardInput.safeParse({ name, type, url: c.url ?? '', model: c.model ?? '', description: c.description ?? '', region: c.region ?? undefined, think: !!c.think, uses: [...uses], apiKey: keys[name] ?? '' });
      if (!input.success) {
        errors.push(`„${name}“: Angaben unvollständig`);
        continue;
      }
      try {
        await s.aiCards.add(input.data);
        created++;
      } catch (e) {
        if (e instanceof CardError) errors.push(`„${name}“: ${e.message}`);
        else throw e;
      }
    }
    await s.audit.append({ actorId: actor, action: 'admin.ai_cards_imported', data: { created, skipped, errors: errors.length } });
    return { created, skipped, errors, cards: await s.aiCards.list() };
  });

  // ---- Projekt: Texterkennung ----

  async function member(req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) {
    const sess = requireSession(req, reply);
    if (!sess) return null;
    const projectId = Number(req.params.id);
    if (!Number.isInteger(projectId) || (sess.projectId !== null && sess.projectId !== projectId)) return void reply.code(403).send({ error: 'Kein Zugriff auf dieses Projekt' });
    const r = await mapScopes(s, sess.userId, projectId);
    if (!r) return void reply.code(404).send({ error: 'Projekt nicht gefunden' });
    return { userId: sess.userId, projectId, ...r };
  }

  /** Ob die Erkennung im Projekt geht; sonst der Grund in Worten */
  async function availability(projectId: number): Promise<{ available: boolean; reason?: string }> {
    const frame = await s.frame.get();
    if (!frame.ocr) return { available: false, reason: 'Die Texterkennung ist von der Administration abgeschaltet.' };
    const p = await s.projects.get(projectId);
    const set = clampToFrame(p?.settings ?? DEFAULT_SETTINGS, frame);
    if (!set.notesOcr) return { available: false, reason: 'Die Lehrkraft hat die Texterkennung in diesem Projekt abgeschaltet.' };
    if (!(await s.aiCards.forUse('ocr'))) return { available: false, reason: 'Es ist noch kein KI-Dienst für die Texterkennung eingerichtet (Verwaltung → KI-Konfiguration).' };
    return { available: true };
  }

  app.get<{ Params: { id: string } }>('/api/projects/:id/texterkennung', async (req, reply) => {
    const a = await member(req, reply);
    if (!a) return;
    return availability(a.projectId);
  });

  app.post<{ Params: { id: string } }>('/api/projects/:id/notizen/erkennen', { bodyLimit: OCR_MAX_BYTES + 64 * 1024 }, async (req, reply) => {
    const a = await member(req, reply);
    if (!a) return;
    const av = await availability(a.projectId);
    if (!av.available) return reply.code(403).send({ error: av.reason, code: 'off' });
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) return reply.code(400).send({ error: 'Bild fehlt' });
    const data = req.body;
    const mime = sniffNoteFile(data);
    if (mime !== 'image/jpeg' && mime !== 'image/png' && mime !== 'image/webp') return reply.code(415).send({ error: 'Nur JPEG, PNG oder WebP' });
    const key = 'ocr:' + a.userId;
    if (s.ocrLimiter.blocked(key)) return reply.code(429).send({ error: 'Zu viele Erkennungen. Bitte in ein paar Minuten noch einmal.' });
    s.ocrLimiter.fail(key);
    const card = (await s.aiCards.forUse('ocr'))!;
    const meta = { provider: card.id, type: card.type, model: card.model, region: card.region, input_sha256: createHash('sha256').update(data).digest('hex'), bytes: data.length };
    try {
      const r = await recognize(card, data, mime, s.aiFetch);
      // wie das AiGateway in Autogra.fi: protokolliert wird, dass erkannt wurde, nicht was
      await s.audit.append({ actorId: a.userId, action: 'ai.ocr', projectId: a.projectId, data: { ...meta, ok: true, ms: r.ms, tokens_in: r.tokensIn, tokens_out: r.tokensOut, chars: r.text.length } });
      return { text: r.text, script: r.script };
    } catch (e) {
      if (!(e instanceof OcrError)) throw e;
      await s.audit.append({ actorId: a.userId, action: 'ai.ocr', projectId: a.projectId, data: { ...meta, ok: false, error: e.message.slice(0, 300) } });
      return reply.code(e.status).send({ error: e.message });
    }
  });

  const Recognised = z.object({ text: z.string().min(1).max(50_000), script: z.enum(['hand', 'print']).default('hand') });
  app.post<{ Params: { id: string; nid: string } }>('/api/projects/:id/notizen/:nid/erkannt', async (req, reply) => {
    const a = await member(req, reply);
    if (!a) return;
    const body = Recognised.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'Text fehlt' });
    const n = await s.notes.get(Number(req.params.nid));
    if (!n || n.projectId !== a.projectId || n.userId !== a.userId) return reply.code(404).send({ error: 'Notiz nicht gefunden' });
    const id = await s.pastes.addOcr(a.projectId, n.scope, a.userId, { noteId: n.id, script: body.data.script, text: body.data.text, place: 'Notizen und Quellen' });
    return { id };
  });
}
