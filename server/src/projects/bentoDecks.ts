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
}
