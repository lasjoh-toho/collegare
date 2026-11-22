import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { requireSession } from '../http/auth.js';
import { DocError, MAX_BODY, collabId } from '../projects/documents.js';
import type { Services } from '../services.js';
import { deckWritable } from './bento.js';
import { folienScopes, mapScopes } from './maps.js';

/** Meldet geänderte Dokumente an offene Projektseiten und trennt bei „Fertig“ die Editoren. */
export interface DocEvents {
  changed(projectId: number, scope: string): void;
  /** Text eines Abschnitts gespeichert (offene Ausarbeitungen laden ihn nach) */
  text(projectId: number, scope: string, docId: number, rev: number, by: number): void;
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

  const lineOf = (v: unknown): 'ausarb' | 'praes' => (v === 'praes' ? 'praes' : 'ausarb');

  app.get<{ Params: { id: string }; Querystring: { bereich?: string; linie?: string } }>('/api/projects/:id/documents', async (req, reply) => {
    const projectId = Number(req.params.id);
    const a = await scopeAccess(req, reply, projectId, req.query.bereich);
    if (!a) return;
    const p = await s.projects.get(projectId);
    const base = { role: a.role, scopes: a.scopes.map(({ scope, title, test }) => ({ scope, title, test: !!test })), finishLock: p!.settings.finishLock, reopenBy: p!.settings.reopenBy };
    if (!a.scope) return { ...base, scope: null, people: [], docs: [], outlineAt: null };
    const { map } = await s.maps.get(projectId, a.scope.scope);
    const line = lineOf(req.query.linie);
    const docs = (await s.documents.list(projectId, a.scope.scope)).filter((d) => d.kind === 'word' && d.line === line);
    const office = await s.documents.hasOfficeText(docs.filter((d) => d.body === null).map((d) => d.id));
    const test = !!a.scope.test;
    return {
      ...base,
      scope: a.scope.scope,
      test,
      people: a.scope.people,
      docs: docs.map((d) => ({ ...d, office: office.has(d.id) })),
      outlineAt: map.outline?.at ?? null,
      line,
      // Präsentationslinie: erst vorhanden, wenn die Gliederung nach dem Update gespeichert wurde
      hasPraes: !!map.outline?.praes,
      // Zwischenüberschriften der tieferen Gliederungsebenen (falls die Gliederung sie liefert)
      subs: Object.fromEntries((map.outline?.sections ?? []).map((x) => [x.id, (x as { subs?: unknown }).subs ?? []])),
    };
  });

  // Folienpräsentationen: die eigene (Gruppe bzw. Testbereich der Lehrkraft), für die Lehrkraft alle Gruppen, für Lernende
  // dazu alle, die andere für alle freigeschaltet haben (Wunsch Jo, 17. November 2026: Titel statt „Test / Demo“)
  app.get<{ Params: { id: string }; Querystring: { bereich?: string } }>('/api/projects/:id/folien', async (req, reply) => {
    const projectId = Number(req.params.id);
    const sess = requireSession(req, reply);
    if (!sess) return;
    if (sess.projectId !== null && sess.projectId !== projectId) return reply.code(403).send({ error: 'Kein Zugriff auf dieses Projekt' });
    const r = await folienScopes(s, sess.userId, projectId);
    if (!r) return reply.code(403).send({ error: 'Kein Zugriff auf dieses Projekt' });
    const docs = await Promise.all(r.scopes.map((x) => s.documents.deck(projectId, x.scope)));
    const acc = await s.bentoDecks.accessMany(docs.map((d) => d.id));
    const names = new Map<number, string>();
    for (const a of acc.values()) if (a.lockedBy !== null && !names.has(a.lockedBy)) names.set(a.lockedBy, (await s.users.byId(a.lockedBy))?.name ?? 'jemand');
    const decks = r.scopes.map((x, i) => {
      const a = acc.get(docs[i].id) ?? { shared: false, lockedBy: null };
      const mine = r.role === 'teacher' ? !!x.test : !x.demo;
      return {
        scope: x.scope,
        docId: docs[i].id,
        title: docs[i].title,
        owner: x.test ? (r.role === 'teacher' ? 'Nur du' : x.title) : x.title.replace(/ \(nur für mich\)$/, ''),
        shared: a.shared,
        lockedBy: a.lockedBy,
        lockedByName: a.lockedBy === null ? null : (names.get(a.lockedBy) ?? null),
        mine,
        test: !!x.test,
        done: !!docs[i].doneAt,
      };
    });
    const wanted = req.query.bereich;
    const cur = (wanted ? decks.find((d) => d.scope === wanted) : undefined) ?? decks.find((d) => d.mine && !d.test) ?? decks.find((d) => d.mine) ?? decks[0];
    const base = { role: r.role, decks };
    if (!cur) return { ...base, scope: null, doc: null };
    const doc = docs[decks.indexOf(cur)];
    const teacher = r.role === 'teacher';
    const write = deckWritable(teacher, cur, doc.doneAt, sess.userId);
    return {
      ...base,
      scope: cur.scope,
      doc,
      write,
      canShare: cur.mine || teacher,
      canLock: !cur.test && (cur.mine || teacher),
      canUnlock: cur.lockedBy !== null && (cur.lockedBy === sess.userId || teacher),
    };
  });

  /** Zugriff auf eine Präsentation für Freigabe und Sperre */
  async function deckAccess(req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) {
    const sess = requireSession(req, reply);
    if (!sess) return null;
    const doc = await s.documents.get(Number(req.params.id));
    if (!doc || doc.kind !== 'slide') return void reply.code(404).send({ error: 'Präsentation nicht gefunden' });
    if (sess.projectId !== null && sess.projectId !== doc.projectId) return void reply.code(403).send({ error: 'Kein Zugriff auf dieses Projekt' });
    const r = await folienScopes(s, sess.userId, doc.projectId);
    const scope = r?.scopes.find((x) => x.scope === doc.scope);
    if (!r || !scope) return void reply.code(403).send({ error: 'Kein Zugriff auf diese Präsentation' });
    const teacher = r.role === 'teacher';
    const mine = teacher ? !!scope.test : !scope.demo;
    return { userId: sess.userId, doc, teacher, mine, test: !!scope.test, access: await s.bentoDecks.access(doc.id) };
  }

  /** Für alle freischalten (Lernende die eigene Präsentation, die Lehrkraft jede) oder wieder verbergen */
  app.post<{ Params: { id: string } }>('/api/documents/:id/freigabe', async (req, reply) => {
    const body = z.object({ shared: z.boolean() }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'Angabe fehlt' });
    const a = await deckAccess(req, reply);
    if (!a) return;
    if (!a.mine && !a.teacher) return reply.code(403).send({ error: 'Nur die eigene Präsentation' });
    await s.bentoDecks.setShared(a.doc.id, body.data.shared);
    await s.audit.append({ actorId: a.userId, action: 'folien.freigabe', projectId: a.doc.projectId, data: { doc: a.doc.id, shared: body.data.shared } });
    return { ok: true, shared: body.data.shared };
  });

  /** „Bearbeitung sperren“: nur wer sperrt, ändert noch (auch Gruppenmitglieder nicht); entsperren sie selbst oder die Lehrkraft */
  app.post<{ Params: { id: string } }>('/api/documents/:id/sperre', async (req, reply) => {
    const body = z.object({ locked: z.boolean() }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'Angabe fehlt' });
    const a = await deckAccess(req, reply);
    if (!a) return;
    if (a.test || (!a.mine && !a.teacher)) return reply.code(403).send({ error: 'Nur die eigene Präsentation' });
    const holder = a.access.lockedBy;
    if (body.data.locked) {
      if (holder !== null && holder !== a.userId && !a.teacher) return reply.code(409).send({ error: 'Schon von jemand anderem gesperrt' });
      await s.bentoDecks.setLock(a.doc.id, a.userId);
    } else {
      if (holder !== null && holder !== a.userId && !a.teacher) return reply.code(403).send({ error: 'Entsperren kann nur, wer gesperrt hat, oder die Lehrkraft' });
      await s.bentoDecks.setLock(a.doc.id, null);
    }
    await s.audit.append({ actorId: a.userId, action: 'folien.sperre', projectId: a.doc.projectId, data: { doc: a.doc.id, locked: body.data.locked } });
    return { ok: true, locked: body.data.locked };
  });

  app.post<{ Params: { id: string } }>('/api/projects/:id/documents/sync', async (req, reply) => {
    const projectId = Number(req.params.id);
    const body = z.object({ scope: z.string(), line: z.enum(['ausarb', 'praes']).optional() }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'Bereich fehlt' });
    const a = await scopeAccess(req, reply, projectId, body.data.scope);
    if (!a) return;
    if (!a.scope) return reply.code(403).send({ error: 'Kein Zugriff auf diese Gruppe' });
    try {
      const { map } = await s.maps.get(projectId, a.scope.scope);
      const r = await s.documents.syncFromOutline(projectId, a.scope.scope, map, body.data.line ?? 'ausarb');
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

  /** Darf diese Person den Text schreiben? Gruppe (nicht fertig), Lehrkraft nur im eigenen Testbereich */
  const writable = (a: { role: string; scope: { test?: boolean } | null; doc: { doneAt: number | null } }) => !a.doc.doneAt && (a.role !== 'teacher' || !!a.scope?.test);

  app.put<{ Params: { id: string } }>('/api/documents/:id/text', { bodyLimit: MAX_BODY * 2 + 1000 }, async (req, reply) => {
    const body = z.object({ body: z.string().max(MAX_BODY), rev: z.number().int().min(0) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'Text fehlt oder ist zu lang' });
    const a = await docAccess(req, reply);
    if (!a) return;
    if (a.doc.kind !== 'word') return reply.code(400).send({ error: 'Kein Textabschnitt' });
    if (!writable(a)) return reply.code(403).send({ error: a.doc.doneAt ? 'Der Abschnitt ist fertig gemeldet' : 'Lehrkräfte lesen hier nur' });
    const r = await s.documents.saveText(a.doc.id, body.data.body, body.data.rev, a.userId);
    if (!r.ok) return reply.code(409).send({ error: 'Inzwischen hat jemand anderes weitergeschrieben', body: r.current.body ?? '', rev: r.current.rev, by: r.current.textBy });
    ev.text(a.doc.projectId, a.doc.scope, a.doc.id, r.rev, a.userId);
    return { rev: r.rev };
  });

  app.get<{ Params: { id: string } }>('/api/documents/:id/text', async (req, reply) => {
    const a = await docAccess(req, reply);
    if (!a) return;
    return { body: a.doc.body ?? '', rev: a.doc.rev, by: a.doc.textBy, at: a.doc.textAt };
  });

  app.get<{ Params: { id: string } }>('/api/documents/:id/fassungen', async (req, reply) => {
    const a = await docAccess(req, reply);
    if (!a) return;
    return { revisions: await s.documents.revisions(a.doc.id) };
  });

  app.get<{ Params: { id: string; rev: string } }>('/api/documents/:id/fassungen/:rev', async (req, reply) => {
    const a = await docAccess(req, reply);
    if (!a) return;
    const b = await s.documents.revision(a.doc.id, Number(req.params.rev));
    if (b === null) return reply.code(404).send({ error: 'Fassung nicht gefunden' });
    return { body: b };
  });

  app.post<{ Params: { id: string; rev: string } }>('/api/documents/:id/fassungen/:rev/zurueck', async (req, reply) => {
    const a = await docAccess(req, reply);
    if (!a) return;
    if (!writable(a)) return reply.code(403).send({ error: 'Hier darfst du nicht schreiben' });
    const rev = await s.documents.restoreRevision(a.doc.id, Number(req.params.rev), a.userId);
    if (rev === null) return reply.code(404).send({ error: 'Fassung nicht gefunden' });
    await s.audit.append({ actorId: a.userId, action: 'document.restored', projectId: a.doc.projectId, data: { doc: a.doc.id, revision: Number(req.params.rev) } });
    ev.text(a.doc.projectId, a.doc.scope, a.doc.id, rev, a.userId);
    return { rev };
  });

  /** Stand merken (vor dem Abgleich mit der Gliederung) bzw. „Zurück zu meinem letzten Zustand im Editor“ */
  app.post<{ Params: { id: string; what: string } }>('/api/projects/:id/documents/:what', async (req, reply) => {
    const what = req.params.what;
    if (what !== 'merken' && what !== 'zurueck') return reply.code(404).send({ error: 'Unbekannt' });
    const projectId = Number(req.params.id);
    const body = z.object({ scope: z.string(), line: z.enum(['ausarb', 'praes']).optional() }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'Bereich fehlt' });
    const a = await scopeAccess(req, reply, projectId, body.data.scope);
    if (!a) return;
    if (!a.scope) return reply.code(403).send({ error: 'Kein Zugriff auf diese Gruppe' });
    if (a.role === 'teacher' && !a.scope.test) return reply.code(403).send({ error: 'Lehrkräfte lesen hier nur' });
    const line = body.data.line ?? 'ausarb';
    if (what === 'merken') return { saved: await s.documents.snapshotScope(projectId, a.scope.scope, a.userId, line) };
    const n = await s.documents.restoreScope(projectId, a.scope.scope, a.userId, line);
    await s.audit.append({ actorId: a.userId, action: 'documents.restored', projectId, data: { scope: a.scope.scope, count: n } });
    ev.changed(projectId, a.scope.scope);
    return { restored: n };
  });

  /** Notiz wurde in den Text gezogen (für die Marke „verbaut“ an der Notiz) */
  app.post<{ Params: { id: string } }>('/api/documents/:id/notiz', async (req, reply) => {
    const body = z.object({ noteId: z.number().int().positive(), snippet: z.string().min(1).max(2000) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'Angabe fehlt' });
    const a = await docAccess(req, reply);
    if (!a) return;
    if (!writable(a)) return reply.code(403).send({ error: 'Hier darfst du nicht schreiben' });
    const note = await s.notes.get(body.data.noteId);
    if (!note || note.projectId !== a.doc.projectId) return reply.code(404).send({ error: 'Notiz nicht gefunden' });
    await s.noteUses.add(a.doc.id, body.data.noteId, body.data.snippet, a.userId);
    return { ok: true };
  });

  /** Wo stecken die Notizen eines Bereichs schon (Gliederung, Text der Ausarbeitung)? */
  app.get<{ Params: { id: string }; Querystring: { bereich?: string } }>('/api/projects/:id/notizen-verwendung', async (req, reply) => {
    const projectId = Number(req.params.id);
    const a = await scopeAccess(req, reply, projectId, req.query.bereich);
    if (!a) return;
    if (!a.scope) return { uses: {} };
    const { map } = await s.maps.get(projectId, a.scope.scope);
    const docs = await s.documents.list(projectId, a.scope.scope);
    return { scope: a.scope.scope, uses: await s.noteUses.forScope(docs, map) };
  });

  return { collabId };
}

/** Zugriff des Editors auf ein Dokument: Gruppe oder Lehrkraft; fertige Dokumente und Lehrkräfte nur lesend. */
export async function authorizeDoc(s: Services, sess: { userId: number; projectId: number | null }, docId: number) {
  const doc = await s.documents.get(docId);
  if (!doc) return null;
  if (sess.projectId !== null && sess.projectId !== doc.projectId) return null;
  const r = await mapScopes(s, sess.userId, doc.projectId);
  const sc = r?.scopes.find((x) => x.scope === doc.scope);
  if (!r || !sc) return null;
  // im eigenen Testbereich schreibt die Lehrkraft selbst
  return { view: doc.doneAt !== null || (r.role === 'teacher' && !sc.test) };
}
