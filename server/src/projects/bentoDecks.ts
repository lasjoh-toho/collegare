/**
 * Folienpräsentationen in Bento (Wunsch Jo, 14. November 2026): je Präsentation (documents, kind 'slide') das
 * Bento-Dokument als JSON. Gespeichert wird immer das ganze Dokument; die Version verhindert, dass zwei Geräte sich
 * gegenseitig überschreiben, solange es noch keine Live-Zusammenarbeit gibt.
 */
import type { Db } from '../db/index.js';

export interface BentoDeck {
  data: string;
  version: number;
  updatedAt: number;
  updatedBy: number | null;
}

export class BentoConflict extends Error {
  constructor(readonly current: number) {
    super('Die Präsentation wurde inzwischen an anderer Stelle gespeichert.');
  }
}

/** Kleinste gültige Präsentation: eine Titelfolie. */
export function blankDeck(title: string, docId: string): Record<string, unknown> {
  const font = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
  const text = (id: string, html: string, y: number, h: number, fontSize: number, fontWeight: number, color: string, placeholder: string, role: string) => ({
    id, type: 'text', x: 140, y, w: 1000, h, rotation: 0, opacity: 1, html, fontSize, fontFamily: font, fontWeight, color,
    align: 'center', valign: 'middle', lineHeight: 1.2, placeholder, role,
  });
  return {
    format: 'bento/slides',
    version: 1,
    docId,
    title,
    size: { width: 1280, height: 720 },
    theme: { background: '#FFFFFF', color: '#1E2A3A', accent: '#C2410C', fontFamily: font },
    slides: [
      {
        id: 's-titel',
        background: '#FFFFFF',
        transition: 'fade',
        notes: '',
        elements: [
          text('titel', '', 250, 130, 60, 700, '#1E2A3A', 'Titel der Präsentation', 'title'),
          text('untertitel', '', 400, 70, 28, 400, '#5B6472', 'Untertitel, Namen der Gruppe', 'subtitle'),
        ],
      },
    ],
    modified: new Date().toISOString(),
  };
}

export class BentoDecks {
  constructor(
    private db: Db,
    private now: () => number = Date.now,
  ) {}

  async get(docId: number): Promise<BentoDeck | null> {
    const r = await this.db.selectFrom('bento_decks').selectAll().where('doc_id', '=', docId).executeTakeFirst();
    return r ? { data: r.data, version: Number(r.version), updatedAt: Number(r.updated_at), updatedBy: r.updated_by } : null;
  }

  /** Speichert, wenn `expected` die aktuelle Version ist (0 = noch nie gespeichert); gibt die neue Version zurück. */
  async save(docId: number, data: string, expected: number, by: number | null): Promise<number> {
    const cur = await this.get(docId);
    const have = cur?.version ?? 0;
    if (expected !== have) throw new BentoConflict(have);
    const version = have + 1;
    if (cur) {
      const r = await this.db
        .updateTable('bento_decks')
        .set({ data, version, updated_at: this.now(), updated_by: by })
        .where('doc_id', '=', docId)
        .where('version', '=', have)
        .executeTakeFirst();
      if (Number(r.numUpdatedRows) !== 1) throw new BentoConflict((await this.get(docId))?.version ?? 0);
    } else {
      try {
        await this.db.insertInto('bento_decks').values({ doc_id: docId, data, version, updated_at: this.now(), updated_by: by }).execute();
      } catch {
        throw new BentoConflict((await this.get(docId))?.version ?? 0);
      }
    }
    return version;
  }

  /** Freigabe und Sperre einer Präsentation */
  async access(docId: number): Promise<DeckAccess> {
    return (await this.accessMany([docId])).get(docId) ?? { shared: false, lockedBy: null };
  }

  async accessMany(docIds: number[]): Promise<Map<number, DeckAccess>> {
    const out = new Map<number, DeckAccess>();
    if (!docIds.length) return out;
    const rows = await this.db.selectFrom('deck_access').selectAll().where('doc_id', 'in', docIds).execute();
    for (const r of rows) out.set(r.doc_id, { shared: !!Number(r.shared), lockedBy: r.locked_by ?? null });
    return out;
  }

  /** Präsentationen des Projekts, die für alle freigeschaltet sind */
  async sharedDocs(projectId: number): Promise<{ id: number; scope: string; title: string }[]> {
    return this.db
      .selectFrom('deck_access')
      .innerJoin('documents', 'documents.id', 'deck_access.doc_id')
      .select(['documents.id as id', 'documents.scope as scope', 'documents.title as title'])
      .where('documents.project_id', '=', projectId)
      .where('documents.kind', '=', 'slide')
      .where('deck_access.shared', '=', 1)
      .orderBy('documents.id')
      .execute();
  }

  async setShared(docId: number, shared: boolean): Promise<void> {
    await this.upsert(docId, { shared: shared ? 1 : 0 });
  }

  /** sperren (userId) oder entsperren (null) */
  async setLock(docId: number, userId: number | null): Promise<void> {
    await this.upsert(docId, { locked_by: userId, locked_at: userId === null ? null : this.now() });
  }

  private async upsert(docId: number, patch: { shared?: number; locked_by?: number | null; locked_at?: number | null }) {
    const r = await this.db.updateTable('deck_access').set(patch).where('doc_id', '=', docId).executeTakeFirst();
    if (Number(r.numUpdatedRows) > 0) return;
    try {
      await this.db.insertInto('deck_access').values({ doc_id: docId, shared: 0, locked_by: null, locked_at: null, ...patch }).execute();
    } catch {
      await this.db.updateTable('deck_access').set(patch).where('doc_id', '=', docId).execute();
    }
  }
}

export interface DeckAccess {
  /** für alle im Projekt sichtbar (lesend) */
  shared: boolean;
  /** „Bearbeitung sperren“: nur diese Person (und die Lehrkraft) kann noch ändern */
  lockedBy: number | null;
}
