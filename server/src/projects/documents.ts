import type { DocStore } from '../collab/coServer.js';
import type { StoredChange } from '../collab/docState.js';
import type { Db } from '../db/index.js';
import type { MindMap } from './maps.js';

/**
 * Dokumente der Ausarbeitung (Issue #9): eines je Karte der übernommenen Gliederung. Die „Fertig“-Sperre gilt je
 * Dokument, also je Karte einer Person (Entscheidung 10.4); fertige Dokumente öffnen alle nur noch zum Lesen.
 * Im Editor heißt ein Dokument `cg<ID>`.
 */

export interface DocRow {
  id: number;
  scope: string;
  sectionId: string;
  sectionTitle: string;
  cardId: string | null;
  kind: 'word' | 'slide' | 'cell';
  title: string;
  ownerId: number | null;
  position: number;
  doneAt: number | null;
  doneBy: number | null;
  /** Text aus dem eigenen Schreibeditor; null = noch nie dort geschrieben */
  body: string | null;
  rev: number;
  textAt: number | null;
  textBy: number | null;
}

/** Höchstlänge eines Abschnitts (Bilder stecken als data:-Adressen im Text) */
export const MAX_BODY = 4_000_000;
/** Schnappschuss beim Schreiben höchstens alle 10 Minuten je Abschnitt */
const SNAP_EVERY = 10 * 60_000;
/** so viele frühere Fassungen bleiben je Abschnitt */
const KEEP_REVISIONS = 40;

export class DocError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

/** Abschnitt-Kennung der Folienpräsentation einer Gruppe */
export const DECK = '__folien';
/** Abschnitt für Texte, deren Punkt aus der Gliederung verschwunden ist */
export const OUTSIDE = '__ohne';

export const collabId = (id: number) => 'cg' + id;
export function parseCollabId(docId: string): number | null {
  const m = /^cg(\d{1,10})$/.exec(docId);
  return m ? Number(m[1]) : null;
}

const toRow = (r: {
  id: number;
  scope: string;
  section_id: string;
  section_title: string;
  card_id: string | null;
  kind: DocRow['kind'];
  title: string;
  owner_id: number | null;
  position: number;
  done_at: number | null;
  done_by: number | null;
  body?: string | null;
  rev?: number;
  text_at?: number | null;
  text_by?: number | null;
}): DocRow => ({
  id: r.id,
  scope: r.scope,
  sectionId: r.section_id,
  sectionTitle: r.section_title,
  cardId: r.card_id,
  kind: r.kind,
  title: r.title,
  ownerId: r.owner_id,
  position: r.position,
  doneAt: r.done_at === null ? null : Number(r.done_at),
  doneBy: r.done_by,
  body: r.body ?? null,
  rev: Number(r.rev ?? 0),
  textAt: r.text_at == null ? null : Number(r.text_at),
  textBy: r.text_by ?? null,
});

export class Documents {
  constructor(private db: Db) {}

  async get(id: number): Promise<(DocRow & { projectId: number }) | undefined> {
    const r = await this.db.selectFrom('documents').selectAll().where('id', '=', id).executeTakeFirst();
    return r ? { ...toRow(r), projectId: r.project_id } : undefined;
  }

  async list(projectId: number, scope: string): Promise<DocRow[]> {
    const rows = await this.db.selectFrom('documents').selectAll().where('project_id', '=', projectId).where('scope', '=', scope).orderBy('position').orderBy('id').execute();
    return rows.map(toRow);
  }

  /**
   * Legt für jede Karte der Gliederung ein Textdokument an, sofern es noch keines gibt. Vorhandene Dokumente
   * übernehmen Abschnitt, Reihenfolge und Titel der Gliederung; Inhalte bleiben unberührt.
   */
  async syncFromOutline(projectId: number, scope: string, map: MindMap): Promise<{ created: number; total: number }> {
    if (!map.outline) throw new DocError('Zuerst in der Mindmap „Gliederung übernehmen“');
    const existing = await this.list(projectId, scope);
    const byCard = new Map(existing.filter((d) => d.cardId).map((d) => [d.cardId!, d]));
    let position = 0;
    let created = 0;
    const now = Date.now();
    for (const sec of map.outline.sections) {
      const sectionTitle = (map.cards[sec.id]?.title || sec.title).slice(0, 255);
      // Punkt der Gliederung ohne Karten (z. B. gestrichelt, nur in der Gliederung entstanden): ein Abschnitt für den Punkt selbst
      const entries = sec.cards.filter((c) => map.cards[c]).map((c) => ({ key: c, title: map.cards[c].title, owner: map.cards[c].owner }));
      if (!entries.length) entries.push({ key: sec.id, title: sectionTitle, owner: map.cards[sec.id]?.owner ?? sec.owners?.[0] ?? null });
      for (const { key: cardId, title: cardTitle, owner } of entries) {
        const card = { owner };
        position++;
        const title = (cardTitle || 'Ohne Titel').slice(0, 255);
        const old = byCard.get(cardId);
        if (old) {
          await this.db
            .updateTable('documents')
            .set({ section_id: sec.id, section_title: sectionTitle, position, title, owner_id: old.doneAt ? old.ownerId : card.owner })
            .where('id', '=', old.id)
            .execute();
        } else {
          await this.db
            .insertInto('documents')
            .values({ project_id: projectId, scope, section_id: sec.id, section_title: sectionTitle, card_id: cardId, kind: 'word', title, owner_id: card.owner, position, done_at: null, done_by: null, created_at: now })
            .execute();
          created++;
        }
      }
    }
    // Abschnitte, deren Punkt nicht mehr in der Gliederung steht, bleiben mit ihrem Text am Ende stehen
    const seen = new Set<string>();
    for (const sec of map.outline.sections) {
      const cards = sec.cards.filter((c) => map.cards[c]);
      for (const c of cards.length ? cards : [sec.id]) seen.add(c);
    }
    let rest = 0;
    for (const d of existing) {
      if (d.kind !== 'word' || !d.cardId || seen.has(d.cardId)) continue;
      await this.db
        .updateTable('documents')
        .set({ section_id: OUTSIDE, section_title: 'Nicht mehr in der Gliederung', position: 100_000 + ++rest })
        .where('id', '=', d.id)
        .execute();
    }
    return { created, total: position };
  }

  /** Folienpräsentation der Gruppe (klassisch wie PowerPoint, neben der Pinnwand): eine je Bereich, beim ersten Öffnen angelegt */
  async deck(projectId: number, scope: string): Promise<DocRow> {
    const found = (await this.list(projectId, scope)).find((d) => d.kind === 'slide' && d.sectionId === DECK);
    if (found) return found;
    await this.db
      .insertInto('documents')
      .values({ project_id: projectId, scope, section_id: DECK, section_title: 'Präsentation', card_id: null, kind: 'slide', title: 'Präsentation', owner_id: null, position: 0, done_at: null, done_by: null, created_at: Date.now() })
      .execute();
    return (await this.list(projectId, scope)).find((d) => d.kind === 'slide' && d.sectionId === DECK)!;
  }

  async rename(id: number, title: string): Promise<void> {
    await this.db.updateTable('documents').set({ title }).where('id', '=', id).execute();
  }

  /**
   * Text aus dem Schreibeditor speichern. Wer mit einem älteren Stand speichert (rev passt nicht), bekommt den
   * aktuellen zurück und nichts wird überschrieben. Alle zehn Minuten bleibt eine frühere Fassung stehen.
   */
  async saveText(id: number, body: string, rev: number, by: number): Promise<{ ok: true; rev: number } | { ok: false; current: DocRow }> {
    const doc = await this.get(id);
    if (!doc) throw new DocError('Dokument nicht gefunden', 404);
    if (doc.rev !== rev) return { ok: false, current: doc };
    const now = Date.now();
    if (doc.body !== null && doc.body !== body) {
      const last = await this.db.selectFrom('doc_revisions').select('at').where('doc_id', '=', id).orderBy('at', 'desc').limit(1).executeTakeFirst();
      // neue Fassung, wenn lange nichts gesichert wurde oder jemand anderes weiterschreibt
      if (!last || now - Number(last.at) > SNAP_EVERY || (doc.textBy !== null && doc.textBy !== by)) await this.snapshot(doc, 'auto');
    }
    const r = await this.db
      .updateTable('documents')
      .set({ body, rev: rev + 1, text_at: now, text_by: by })
      .where('id', '=', id)
      .where('rev', '=', rev)
      .executeTakeFirst();
    if (Number(r.numUpdatedRows) !== 1) return { ok: false, current: (await this.get(id))! };
    return { ok: true, rev: rev + 1 };
  }

  private async snapshot(doc: DocRow, reason: string, by: number | null = doc.textBy): Promise<void> {
    if (doc.body === null) return;
    await this.db.insertInto('doc_revisions').values({ doc_id: doc.id, rev: doc.rev, body: doc.body, at: Date.now(), by, reason }).execute();
    const old = await this.db.selectFrom('doc_revisions').select('id').where('doc_id', '=', doc.id).orderBy('at', 'desc').orderBy('id', 'desc').offset(KEEP_REVISIONS).limit(1000).execute();
    if (old.length)
      await this.db
        .deleteFrom('doc_revisions')
        .where(
          'id',
          'in',
          old.map((o) => o.id),
        )
        .execute();
  }

  /** Frühere Fassungen eines Abschnitts, neueste zuerst (ohne Text) */
  async revisions(id: number): Promise<{ id: number; rev: number; at: number; by: number | null; reason: string; length: number }[]> {
    const rows = await this.db.selectFrom('doc_revisions').select(['id', 'rev', 'at', 'by', 'reason', 'body']).where('doc_id', '=', id).orderBy('at', 'desc').orderBy('id', 'desc').execute();
    return rows.map((r) => ({ id: r.id, rev: r.rev, at: Number(r.at), by: r.by, reason: r.reason, length: r.body.length }));
  }

  async revision(docId: number, revId: number): Promise<string | null> {
    const r = await this.db.selectFrom('doc_revisions').select('body').where('id', '=', revId).where('doc_id', '=', docId).executeTakeFirst();
    return r?.body ?? null;
  }

  /** Stand aller Texte eines Bereichs sichern, bevor die Gliederung etwas verschiebt („Zurück“ holt ihn wieder) */
  async snapshotScope(projectId: number, scope: string, by: number): Promise<number> {
    const docs = (await this.list(projectId, scope)).filter((d) => d.kind === 'word' && d.body !== null);
    let n = 0;
    for (const d of docs) {
      // nur sichern, was sich seit der letzten Fassung geändert hat (jedes Öffnen merkt sich den Stand)
      const last = await this.db.selectFrom('doc_revisions').select(['id', 'body', 'reason']).where('doc_id', '=', d.id).orderBy('at', 'desc').orderBy('id', 'desc').limit(1).executeTakeFirst();
      if (last && last.body === d.body) {
        if (last.reason !== 'mark') await this.db.updateTable('doc_revisions').set({ reason: 'mark' }).where('id', '=', last.id).execute();
        continue;
      }
      await this.snapshot(d, 'mark', by);
      n++;
    }
    return n;
  }

  /**
   * „Zurück zu meinem letzten Zustand im Editor“: setzt jeden Text des Bereichs auf die letzte Sicherung vor einem
   * Abgleich mit der Gliederung zurück. Der Stand davor bleibt als frühere Fassung erhalten, „Zurück“ lässt sich also
   * selbst zurücknehmen.
   */
  async restoreScope(projectId: number, scope: string, by: number): Promise<number> {
    const docs = (await this.list(projectId, scope)).filter((d) => d.kind === 'word' && !d.doneAt);
    let n = 0;
    for (const d of docs) {
      const mark = await this.db.selectFrom('doc_revisions').select(['body']).where('doc_id', '=', d.id).where('reason', '=', 'mark').orderBy('at', 'desc').orderBy('id', 'desc').limit(1).executeTakeFirst();
      if (!mark || mark.body === d.body) continue;
      await this.snapshot(d, 'undo', by);
      await this.db.updateTable('documents').set({ body: mark.body, rev: d.rev + 1, text_at: Date.now(), text_by: by }).where('id', '=', d.id).execute();
      n++;
    }
    return n;
  }

  /** Eine frühere Fassung wieder herstellen (der jetzige Stand wird vorher gesichert) */
  async restoreRevision(id: number, revId: number, by: number): Promise<number | null> {
    const doc = await this.get(id);
    const body = doc ? await this.revision(id, revId) : null;
    if (!doc || body === null) return null;
    await this.snapshot(doc, 'undo', by);
    await this.db.updateTable('documents').set({ body, rev: doc.rev + 1, text_at: Date.now(), text_by: by }).where('id', '=', id).execute();
    return doc.rev + 1;
  }

  /** Hat der Abschnitt noch Inhalt aus dem früheren Office-Editor? */
  async hasOfficeText(ids: number[]): Promise<Set<number>> {
    if (!ids.length) return new Set();
    const rows = await this.db
      .selectFrom('doc_changes')
      .select('doc_id')
      .distinct()
      .where(
        'doc_id',
        'in',
        ids.map(collabId),
      )
      .execute();
    return new Set(rows.map((r) => parseCollabId(r.doc_id)!).filter((x) => x !== null));
  }

  async setDone(id: number, by: number | null): Promise<void> {
    await this.db
      .updateTable('documents')
      .set(by === null ? { done_at: null, done_by: null } : { done_at: Date.now(), done_by: by })
      .where('id', '=', id)
      .execute();
  }
}

/** Änderungen aus dem Editor in der Tabelle doc_changes (Reihenfolge über seq). */
export class DocChangeStore implements DocStore {
  constructor(private db: Db) {}

  async load(docId: string): Promise<StoredChange[]> {
    const rows = await this.db.selectFrom('doc_changes').selectAll().where('doc_id', '=', docId).orderBy('seq').execute();
    return rows.map((r) => ({ docid: docId, change: r.data, time: Number(r.time), user: r.user_id, useridoriginal: r.user_id }));
  }

  async append(docId: string, startIndex: number, changes: StoredChange[]): Promise<void> {
    if (!changes.length) return;
    // falls der Editor neu aufgesetzt hat: Reste ab startIndex entfernen, dann einfügen
    await this.db.deleteFrom('doc_changes').where('doc_id', '=', docId).where('seq', '>=', startIndex).execute();
    for (let i = 0; i < changes.length; i += 200) {
      await this.db
        .insertInto('doc_changes')
        .values(changes.slice(i, i + 200).map((c, j) => ({ doc_id: docId, seq: startIndex + i + j, user_id: c.user, time: c.time, data: c.change })))
        .execute();
    }
  }

  async truncate(docId: string, index: number): Promise<void> {
    await this.db.deleteFrom('doc_changes').where('doc_id', '=', docId).where('seq', '>=', index).execute();
  }
}
