import type { Db } from '../db/index.js';
import type { DocRow } from './documents.js';
import type { MindMap } from './maps.js';
import type { LineItem, LinePoint } from './outlineLines.js';

/**
 * Wo steckt eine Notiz schon (Wunsch Jo, 22. November 2026)? Zwei Wege: an einem Punkt der Gliederung angehängt
 * (Linie Präsentation oder Ausarbeitung) oder in den Text eines Abschnitts gezogen. Die Notizen zeigen dafür eine Marke
 * (blau Ausarbeitung, orange Präsentation); ein Klick springt an die Stelle.
 */
export interface NoteUse {
  kind: 'ausarb' | 'praes';
  where: 'text' | 'line';
  /** Titel des Abschnitts bzw. Punkts */
  label: string;
  /** Abschnitt der Ausarbeitung, falls es einen gibt (zum Hinspringen) */
  docId: number | null;
  point: string | null;
}

/** Text vergleichbar machen: Markdown-Zeichen und Leerraum weg, klein */
export const squash = (s: string) =>
  s
    .replace(/\\(.)/g, '$1')
    .replace(/[*_`=#>\[\]{}^|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

export class NoteUses {
  constructor(private db: Db) {}

  async add(docId: number, noteId: number, snippet: string, by: number): Promise<void> {
    await this.db.insertInto('note_uses').values({ doc_id: docId, note_id: noteId, snippet: squash(snippet).slice(0, 200), at: Date.now(), by }).execute();
  }

  async forScope(docs: DocRow[], map: MindMap): Promise<Record<number, NoteUse[]>> {
    const out: Record<number, NoteUse[]> = {};
    const push = (note: number, u: NoteUse) => {
      const list = (out[note] ??= []);
      if (!list.some((x) => x.where === u.where && x.kind === u.kind && x.docId === u.docId && x.point === u.point)) list.push(u);
    };
    const words = docs.filter((d) => d.kind === 'word');
    const docOf = (key: string | null, kind: 'ausarb' | 'praes') => (key ? (words.find((d) => d.cardId === key && d.line === kind) ?? null) : null);

    // in den Text gezogen: zählt, solange der Anfang noch im Text steht
    if (words.length) {
      const rows = await this.db
        .selectFrom('note_uses')
        .selectAll()
        .where(
          'doc_id',
          'in',
          words.map((d) => d.id),
        )
        .execute();
      for (const r of rows) {
        const d = words.find((x) => x.id === r.doc_id)!;
        if (r.snippet && squash(d.body ?? '').includes(r.snippet.slice(0, 60))) push(r.note_id, { kind: d.line, where: 'text', label: d.title, docId: d.id, point: null });
      }
    }

    // an Punkten der Gliederung: Abschnitt = oberster Punkt (bzw. die Karte darunter, die einen eigenen Abschnitt hat)
    const lines = (map as MindMap & { lines?: { praes: { points: LinePoint[] }; ausarb: { points: LinePoint[] } } }).lines;
    if (lines)
      for (const kind of ['ausarb', 'praes'] as const) {
        const visit = (p: LinePoint, top: LinePoint) => {
          if (p.removed) return;
          const doc = docOf(p.card, kind) ?? docOf(top.card && map.cards[top.card] ? top.card : top.id, kind);
          const title = (p.card && map.cards[p.card]?.title) || p.title || 'Ohne Titel';
          const items = (list: LineItem[]) =>
            list.forEach((it) => {
              if (it.note) push(it.note, { kind, where: 'line', label: title, docId: doc?.id ?? null, point: p.id });
              items(it.items);
            });
          items(p.items);
          p.sub.forEach((s) => visit(s, top));
        };
        lines[kind].points.forEach((p) => visit(p, p));
      }
    return out;
  }
}
