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
}

export class DocError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

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
      for (const cardId of sec.cards) {
        const card = map.cards[cardId];
        if (!card) continue;
        position++;
        const title = (card.title || 'Ohne Titel').slice(0, 255);
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
    return { created, total: position };
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
