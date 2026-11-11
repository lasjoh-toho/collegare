import { z } from 'zod';
import type { Db } from '../db/index.js';

/**
 * Mindmap der Phase „Orientierung“ (Konzept Abschnitt 4, Issue #7): Karten auf einer Fläche, Cluster als Rahmen
 * mit Karten darin, Pfeile, Zuordnung zu Personen und „Gliederung übernehmen“.
 *
 * Gestaltung nach brausa (ProjectMap), aber vereinfacht: Cluster sind eine Ebene tief und nicht skaliert;
 * Koordinaten von Karten in einem Cluster zählen ab der linken oberen Ecke des Cluster-Inhalts (unter dem Kopf).
 * Der Server ist maßgeblich: Änderungen kommen als Operationen, werden geprüft, angewandt und verteilt.
 */

export const HEADER = 30;
export const PAD = 10;
const MAX_CARDS = 500;

export const SHAPES = ['none', 'rect', 'oval', 'diamond', 'para'] as const;
export type Shape = (typeof SHAPES)[number];
export const ROUTES = ['metro', 'ortho', 'curve', 'straight'] as const;
export type Route = (typeof ROUTES)[number];
export const SIDES = ['t', 'r', 'b', 'l'] as const;
export type Side = (typeof SIDES)[number];

export interface MapCard {
  id: string;
  kind: 'card' | 'cluster';
  title: string;
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
  color: string | null;
  parent: string | null;
  /** zuständige Person (Grundlage der „Fertig“-Sperre je Abschnitt) */
  owner: number | null;
  /** Form in der Ast-Ansicht (Konzept 4, Mindmap): ohne Form, Rechteck, Oval, Raute, Parallelogramm */
  shape?: Shape;
  /** Linie in der Ast-Ansicht: U-Bahn (45°), rechtwinklig, Kurve, gerade */
  route?: Route;
  /** Lage des Knicks auf der Linie, 0 = nah am Ursprung, 1 = nah am Ziel */
  bend?: number;
  /** von Hand gesetzte Lage in der Ast-Ansicht (null = automatisch); unabhängig von x/y der Karten-Fläche */
  bx?: number | null;
  by?: number | null;
  /** von Hand gesetzter Ansatz des Asts an der Form davor: Seite und Stelle (0..1) entlang der Seite; null = automatisch */
  start?: { side: Side; t: number } | null;
  /** Abzweigung: Ast beginnt am Zwischenstopp i des Geschwister-Asts from (gleicher Ursprung); null = an der Form */
  fork?: { from: string; i: number } | null;
  /** Ast-Ansicht: Karte hängt an dieser Karte desselben Clusters (beliebig tief); null = direkt am Cluster */
  under?: string | null;
  /** Zwischenstopps des Asts (Ast-Ansicht), in Reihenfolge vom Ursprung zum Ziel */
  via?: ([number, number] | [number, number, number, number])[];
  /** Karten im Cluster, hinten nach vorn */
  children: string[];
}

export interface MapLink {
  id: string;
  from: string;
  to: string;
}

export interface OutlineSection {
  /** ID des Clusters, aus dem der Abschnitt stammt */
  id: string;
  title: string;
  cards: string[];
  owners: number[];
}

export interface MindMap {
  v: 1;
  cards: Record<string, MapCard>;
  /** oberste Ebene, hinten nach vorn */
  roots: string[];
  links: MapLink[];
  outline: { sections: OutlineSection[]; at: number; by: number } | null;
}

export const emptyMap = (): MindMap => ({ v: 1, cards: {}, roots: [], links: [], outline: null });

const Id = z.string().regex(/^[A-Za-z0-9_-]{4,40}$/);
const Num = z.number().finite().min(-100_000).max(100_000);
const Start = z.object({ side: z.enum(SIDES), t: z.number().min(0).max(1) }).nullable();
const Fork = z.object({ from: Id, i: z.number().int().min(0).max(11) }).nullable();
/** Zwischenstopp: x, y und optional der Bézier-Griff hx, hy (Vektor vom Stopp aus) */
const Via = z.array(z.union([z.tuple([Num, Num]), z.tuple([Num, Num, Num, Num])])).max(12);
const Size = z.number().finite().min(60).max(4000);
const Color = z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable();

export const MapOp = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('add'),
    card: z.object({
      id: Id,
      kind: z.enum(['card', 'cluster']),
      title: z.string().max(200).default(''),
      text: z.string().max(5000).default(''),
      x: Num,
      y: Num,
      w: Size,
      h: Size,
      color: Color.default(null),
      parent: Id.nullable().default(null),
      owner: z.number().int().nullable().default(null),
      shape: z.enum(SHAPES).optional(),
      route: z.enum(ROUTES).optional(),
      bend: z.number().min(0).max(1).optional(),
      bx: Num.nullable().optional(),
      by: Num.nullable().optional(),
      start: Start.optional(),
      fork: Fork.optional(),
      under: Id.nullable().optional(),
      via: Via.optional(),
    }),
  }),
  z.object({
    type: z.literal('update'),
    id: Id,
    patch: z
      .object({ title: z.string().max(200), text: z.string().max(5000), color: Color, owner: z.number().int().nullable(), w: Size, h: Size, shape: z.enum(SHAPES), route: z.enum(ROUTES), bend: z.number().min(0).max(1), bx: Num.nullable(), by: Num.nullable(), start: Start, fork: Fork, under: Id.nullable(), via: Via })
      .partial(),
  }),
  z.object({ type: z.literal('move'), id: Id, x: Num, y: Num, parent: Id.nullable() }),
  z.object({ type: z.literal('remove'), ids: z.array(Id).min(1).max(MAX_CARDS) }),
  z.object({ type: z.literal('link'), id: Id, from: Id, to: Id }),
  z.object({ type: z.literal('unlink'), id: Id }),
  z.object({ type: z.literal('outline') }),
]);
export type MapOp = z.infer<typeof MapOp>;

export class MapError extends Error {}

/** Absolute Lage einer Karte auf der Fläche. */
export function absolute(m: MindMap, id: string): { x: number; y: number } {
  const c = m.cards[id];
  const p = c.parent ? m.cards[c.parent] : null;
  return p ? { x: p.x + PAD + c.x, y: p.y + HEADER + c.y } : { x: c.x, y: c.y };
}

/** Cluster wächst mit seinen Karten (wie growToFit in brausa), schrumpft aber nicht von selbst. */
function growToFit(m: MindMap, clusterId: string) {
  const k = m.cards[clusterId];
  for (const id of k.children) {
    const c = m.cards[id];
    // Karten nicht links oder oberhalb des Inhalts
    if (c.x < 0) c.x = 0;
    if (c.y < 0) c.y = 0;
    k.w = Math.max(k.w, c.x + c.w + 2 * PAD);
    k.h = Math.max(k.h, HEADER + c.y + c.h + PAD);
  }
}

function detach(m: MindMap, id: string) {
  const c = m.cards[id];
  const list = c.parent ? m.cards[c.parent]?.children : m.roots;
  if (list) {
    const i = list.indexOf(id);
    if (i >= 0) list.splice(i, 1);
  }
}

function checkParent(m: MindMap, parent: string | null, kind: MapCard['kind'], self?: string) {
  if (parent === null) return;
  const p = m.cards[parent];
  if (!p || p.kind !== 'cluster') throw new MapError('Karten lassen sich nur in Cluster legen');
  if (kind === 'cluster') throw new MapError('Cluster lassen sich nicht ineinander legen');
  if (parent === self) throw new MapError('Ungültiges Ziel');
}

/** Reihenfolge wie beim Lesen: Zeilen von oben nach unten, in einer Zeile von links nach rechts. */
function readingOrder<T extends { x: number; y: number; h: number }>(items: T[]): T[] {
  const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
  const rows: T[][] = [];
  for (const it of sorted) {
    const row = rows[rows.length - 1];
    // gleiche Zeile, wenn sich die Oberkante innerhalb der halben Höhe der Zeilenersten befindet
    if (row && it.y < row[0].y + row[0].h / 2) row.push(it);
    else rows.push([it]);
  }
  return rows.flatMap((r) => r.sort((a, b) => a.x - b.x));
}

export function buildOutline(m: MindMap): OutlineSection[] {
  const clusters = readingOrder(m.roots.map((id) => m.cards[id]).filter((c) => c.kind === 'cluster'));
  return clusters.map((k) => {
    const cards = readingOrder(k.children.map((id) => m.cards[id])).map((c) => c.id);
    const owners = [...new Set(cards.map((id) => m.cards[id].owner).filter((o): o is number => o !== null))];
    return { id: k.id, title: k.title || 'Ohne Titel', cards, owners };
  });
}

/**
 * Wendet eine Operation an (verändert m). `people` sind die Personen, denen Karten zugeordnet werden dürfen.
 */
export function applyOp(m: MindMap, op: MapOp, actor: number, people: Set<number>, now = Date.now()): void {
  const need = (id: string) => {
    const c = m.cards[id];
    if (!c) throw new MapError('Karte nicht gefunden (vielleicht gerade gelöscht)');
    return c;
  };
  const checkOwner = (o: number | null | undefined) => {
    if (o != null && !people.has(o)) throw new MapError('Diese Person gehört nicht zur Gruppe');
  };
  switch (op.type) {
    case 'add': {
      if (m.cards[op.card.id]) throw new MapError('Karte gibt es schon');
      if (Object.keys(m.cards).length >= MAX_CARDS) throw new MapError(`Höchstens ${MAX_CARDS} Karten je Mindmap`);
      checkParent(m, op.card.parent, op.card.kind);
      checkOwner(op.card.owner);
      const c: MapCard = { ...op.card, children: [] };
      m.cards[c.id] = c;
      if (c.parent) {
        m.cards[c.parent].children.push(c.id);
        growToFit(m, c.parent);
      } else m.roots.push(c.id);
      return;
    }
    case 'update': {
      const c = need(op.id);
      checkOwner(op.patch.owner);
      Object.assign(c, op.patch);
      if (c.kind === 'cluster') growToFit(m, c.id);
      else if (c.parent) growToFit(m, c.parent);
      return;
    }
    case 'move': {
      const c = need(op.id);
      checkParent(m, op.parent, c.kind, c.id);
      detach(m, c.id);
      c.x = op.x;
      c.y = op.y;
      c.parent = op.parent;
      // nach vorn holen
      if (op.parent) {
        m.cards[op.parent].children.push(c.id);
        growToFit(m, op.parent);
      } else m.roots.push(c.id);
      return;
    }
    case 'remove': {
      const gone = new Set<string>();
      for (const id of op.ids) {
        const c = m.cards[id];
        if (!c) continue;
        // Karten eines gelöschten Clusters bleiben an ihrer Stelle liegen
        for (const ch of [...c.children]) {
          const a = absolute(m, ch);
          const k = m.cards[ch];
          k.parent = null;
          k.x = a.x;
          k.y = a.y;
          m.roots.push(ch);
        }
        c.children = [];
        detach(m, id);
        delete m.cards[id];
        gone.add(id);
      }
      m.links = m.links.filter((l) => !gone.has(l.from) && !gone.has(l.to));
      return;
    }
    case 'link': {
      need(op.from);
      need(op.to);
      if (op.from === op.to) throw new MapError('Ein Pfeil braucht zwei Karten');
      if (m.links.some((l) => l.id === op.id || (l.from === op.from && l.to === op.to))) return;
      m.links.push({ id: op.id, from: op.from, to: op.to });
      return;
    }
    case 'unlink':
      m.links = m.links.filter((l) => l.id !== op.id);
      return;
    case 'outline': {
      const sections = buildOutline(m);
      if (!sections.length) throw new MapError('Für eine Gliederung zuerst Karten in Cluster legen');
      m.outline = { sections, at: now, by: actor };
      return;
    }
  }
}

/** Robustes Einlesen: Unbekanntes fällt auf eine leere Mindmap zurück. */
export function parseMap(json: string | undefined): MindMap {
  if (!json) return emptyMap();
  try {
    const m = JSON.parse(json) as MindMap;
    return m && m.v === 1 && m.cards && Array.isArray(m.roots) ? { ...emptyMap(), ...m } : emptyMap();
  } catch {
    return emptyMap();
  }
}

/** Ablage und Reihenfolge: Operationen auf dieselbe Mindmap laufen nacheinander. */
export class MapStore {
  private queues = new Map<string, Promise<unknown>>();
  constructor(private db: Db) {}

  async get(projectId: number, scope: string): Promise<{ map: MindMap; version: number }> {
    const row = await this.db.selectFrom('maps').select(['data', 'version']).where('project_id', '=', projectId).where('scope', '=', scope).executeTakeFirst();
    return { map: parseMap(row?.data), version: row?.version ?? 0 };
  }

  /**
   * Themen-Mindmap in eine noch leere Mindmap übernehmen (Gruppe beginnt mit dem, was die Klasse gesammelt hat).
   * Zuständigkeiten und Gliederung werden nicht mitgenommen.
   */
  seed(projectId: number, scope: string, source: MindMap): Promise<{ map: MindMap; version: number }> {
    return this.queue(projectId, scope, async () => {
      const { map, version } = await this.get(projectId, scope);
      if (Object.keys(map.cards).length) throw new MapError('Diese Mindmap ist nicht mehr leer.');
      const copy: MindMap = JSON.parse(JSON.stringify(source));
      for (const c of Object.values(copy.cards)) c.owner = null;
      copy.outline = null;
      await this.save(projectId, scope, copy, version);
      return { map: copy, version: version + 1 };
    });
  }

  private async save(projectId: number, scope: string, map: MindMap, version: number) {
    const data = JSON.stringify(map);
    const now = Date.now();
    if (version === 0) await this.db.insertInto('maps').values({ project_id: projectId, scope, data, version: 1, updated_at: now }).execute();
    else await this.db.updateTable('maps').set({ data, version: version + 1, updated_at: now }).where('project_id', '=', projectId).where('scope', '=', scope).execute();
  }

  private queue<T>(projectId: number, scope: string, run: () => Promise<T>): Promise<T> {
    const key = `${projectId}:${scope}`;
    const prev = this.queues.get(key) ?? Promise.resolve();
    const next = prev.then(run, run);
    const tail = next.catch(() => undefined);
    this.queues.set(key, tail);
    void tail.then(() => {
      if (this.queues.get(key) === tail) this.queues.delete(key);
    });
    return next;
  }

  apply(projectId: number, scope: string, op: MapOp, actor: number, people: Set<number>): Promise<{ map: MindMap; version: number }> {
    return this.queue(projectId, scope, async () => {
      const { map, version } = await this.get(projectId, scope);
      applyOp(map, op, actor, people);
      await this.save(projectId, scope, map, version);
      return { map, version: version + 1 };
    });
  }
}
