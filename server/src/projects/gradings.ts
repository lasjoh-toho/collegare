/**
 * Korrektur (gestaltung.md 4): Warteschlange je Person, Produkte des Projekts mit Zuständen und Bewertung je Person.
 * Noten sind Notenpunkte 0–15 wie in Autogra.fi; Gruppen sind nur eine Sortierung.
 */
import type { Db } from '../db/index.js';
import type { MapStore } from './maps.js';
import type { Projects } from './projects.js';

export type ProductState = 'missing' | 'present' | 'done';

export interface Product {
  key: 'map' | 'outline' | 'section';
  title: string;
  state: ProductState;
  /** zuständige Personen (Karten der Mindmap, Abschnitt der Gliederung) */
  owners: number[];
  docId?: number;
  detail?: string;
}

export interface Grading {
  points: number | null;
  feedback: string;
  notes: string;
  final: boolean;
  updatedAt: number;
}

export interface QueueScope {
  scope: string;
  title: string;
  people: { id: number; name: string }[];
  products: Product[];
}

export class GradingError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

const empty = (): Grading => ({ points: null, feedback: '', notes: '', final: false, updatedAt: 0 });

export class Gradings {
  constructor(private db: Db, private projects: Projects, private maps: MapStore, private now: () => number = Date.now) {}

  /** Alles für die Korrekturseite eines Projekts. */
  async overview(projectId: number) {
    const board = await this.projects.board(projectId);
    const scopes: QueueScope[] = [];
    const people = (ids: (m: (typeof board.members)[number]) => boolean) => board.members.filter(ids).map((m) => ({ id: m.userId, name: m.name }));
    const defs =
      board.mode === 'single'
        ? board.members.map((m) => ({ scope: 'u' + m.userId, title: m.name, people: [{ id: m.userId, name: m.name }] }))
        : board.groups.map((g, i) => ({ scope: 'g' + g.id, title: g.title || `Gruppe ${i + 1}`, people: people((m) => m.groupId === g.id) }));
    const docs = await this.db.selectFrom('documents').selectAll().where('project_id', '=', projectId).orderBy('position').orderBy('id').execute();
    for (const d of defs) {
      const { map } = await this.maps.get(projectId, d.scope);
      const cards = Object.values(map.cards).filter((c) => c.kind === 'card');
      const products: Product[] = [];
      const owners = [...new Set(cards.map((c) => c.owner).filter((o): o is number => o !== null))];
      products.push({ key: 'map', title: 'Mindmap', state: cards.length ? 'present' : 'missing', owners, detail: cards.length ? `${cards.length} Karten` : undefined });
      products.push({
        key: 'outline',
        title: 'Gliederung',
        state: map.outline ? 'done' : 'missing',
        owners: [],
        detail: map.outline ? `${map.outline.sections.length} Abschnitte` : undefined,
      });
      const own = docs.filter((x) => x.scope === d.scope);
      if (own.length) {
        for (const x of own) products.push({ key: 'section', title: x.title, state: x.done_at !== null ? 'done' : 'present', owners: x.owner_id !== null ? [x.owner_id] : [], docId: x.id, detail: x.section_title });
      } else if (map.outline) {
        for (const sec of map.outline.sections) products.push({ key: 'section', title: map.cards[sec.id]?.title || sec.title, state: 'missing', owners: sec.owners });
      }
      scopes.push({ ...d, products });
    }
    const unassigned = board.mode === 'group' ? people((m) => m.groupId === null) : [];
    const rows = await this.db.selectFrom('gradings').selectAll().where('project_id', '=', projectId).execute();
    const gradings: Record<number, Grading> = {};
    for (const r of rows) gradings[r.user_id] = { points: r.points, feedback: r.feedback, notes: r.notes, final: r.final_at !== null, updatedAt: Number(r.updated_at) };
    return { mode: board.mode, scopes, unassigned, gradings };
  }

  async get(projectId: number, userId: number): Promise<Grading> {
    const r = await this.db.selectFrom('gradings').selectAll().where('project_id', '=', projectId).where('user_id', '=', userId).executeTakeFirst();
    return r ? { points: r.points, feedback: r.feedback, notes: r.notes, final: r.final_at !== null, updatedAt: Number(r.updated_at) } : empty();
  }

  async save(projectId: number, userId: number, graderId: number, patch: Partial<Omit<Grading, 'updatedAt'>>): Promise<Grading> {
    const member = await this.db.selectFrom('group_members').select('user_id').where('project_id', '=', projectId).where('user_id', '=', userId).executeTakeFirst();
    if (!member) throw new GradingError('Diese Person gehört nicht zum Projekt', 404);
    if (patch.points !== undefined && patch.points !== null && (!Number.isInteger(patch.points) || patch.points < 0 || patch.points > 15)) throw new GradingError('Notenpunkte 0 bis 15');
    const cur = await this.get(projectId, userId);
    const next = { ...cur, ...patch };
    const now = this.now();
    const values = { points: next.points, feedback: next.feedback, notes: next.notes, final_at: next.final ? now : null, graded_by: graderId, updated_at: now };
    if (cur.updatedAt) await this.db.updateTable('gradings').set(values).where('project_id', '=', projectId).where('user_id', '=', userId).execute();
    else await this.db.insertInto('gradings').values({ project_id: projectId, user_id: userId, ...values }).execute();
    return { ...next, updatedAt: now };
  }
}
