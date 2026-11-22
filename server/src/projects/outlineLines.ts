/**
 * Gliederung als U-Bahn-Linien (Konzept 8h, Wünsche von Jo vom 20. November 2026).
 *
 * Je Gruppe gibt es zwei Linien: eine für die Präsentation (rot) und eine für die Ausarbeitung (blau). Stationen sind
 * Punkte der Gliederung (Abschnitte) mit Unterpunkten. Ein Punkt verweist auf eine Karte der Mindmap oder ist neu in der
 * Gliederung entstanden (dann gestrichelt dargestellt). An Punkten hängen Objekte (Notizen, Karten), die wiederum
 * Objekte enthalten können und dann gemeinsam wandern. Ausgeblendete und entfernte Punkte bleiben gespeichert, damit
 * die Mindmap sie ausgegraut zeigen und man sie zurückholen kann.
 *
 * Die Linien liegen in der Mindmap-JSON (`map.lines`) und laufen über dieselbe Operationsschlange wie die Mindmap,
 * damit Mindmap und Seitenmenü immer denselben Stand zeigen. Daraus abgeleitet werden `card.pick` (in der Gliederung)
 * und `map.outline` (Abschnitte für Ausarbeitung, Korrektur und Pinnwand).
 */
import { z } from 'zod';
import type { MindMap, OutlineSection } from './maps.js';

const Id = z.string().regex(/^[A-Za-z0-9_-]{4,40}$/);
const Title = z.string().max(200);

/** Objekt an einem Punkt: Notiz aus „Notizen und Quellen“ oder Karte der Mindmap, mit Titel als Schnappschuss */
export interface LineItem {
  id: string;
  note?: number | null;
  card?: string | null;
  label: string;
  kind: string;
  visible: boolean;
  by: number | null;
  items: LineItem[];
}
const Item: z.ZodType<LineItem> = z.lazy(() =>
  z.object({
    id: Id,
    note: z.number().int().positive().nullable().optional(),
    card: Id.nullable().optional(),
    label: Title,
    kind: z.string().max(20),
    visible: z.boolean(),
    by: z.number().int().nullable(),
    items: z.array(Item).max(30),
  }),
);

export interface LinePoint {
  id: string;
  /** gleicher Schlüssel in beiden Linien = derselbe Gedanke (verbindet Präsentation und Ausarbeitung) */
  key: string;
  card: string | null;
  title: string;
  owner: number | null;
  hidden: boolean;
  removed: boolean;
  items: LineItem[];
  sub: LinePoint[];
}
const Point: z.ZodType<LinePoint> = z.lazy(() =>
  z.object({
    id: Id,
    key: Id,
    card: Id.nullable(),
    title: Title,
    owner: z.number().int().nullable(),
    hidden: z.boolean(),
    removed: z.boolean(),
    items: z.array(Item).max(30),
    sub: z.array(Point).max(40),
  }),
);

export const LineKind = z.enum(['praes', 'ausarb']);
export type LineKind = z.infer<typeof LineKind>;

export const Lines = z.object({
  praes: z.object({ points: z.array(Point).max(60) }),
  ausarb: z.object({ points: z.array(Point).max(60) }),
  /** Schloss: Die Gliederung ändert sich nur noch, wenn jemand es öffnet (auch nicht aus der Mindmap) */
  locked: z.boolean(),
  /** wann die Gliederung zum ersten Mal Punkte bekam (früher „Gliederung übernehmen“) */
  at: z.number().nullable(),
});
export type Lines = z.infer<typeof Lines>;

export class LinesError extends Error {}

export const emptyLines = (): Lines => ({ praes: { points: [] }, ausarb: { points: [] }, locked: false, at: null });

const rid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

/** Alte Mindmaps ohne Linien: aus den übernommenen Ästen (pick) beide Linien gleich aufbauen. */
export function linesFromPicks(m: MindMap, sections: OutlineSection[]): Lines {
  const mk = (sec: OutlineSection): LinePoint => ({
    id: rid(),
    key: sec.id,
    card: m.cards[sec.id] ? sec.id : null,
    title: sec.title,
    owner: null,
    hidden: false,
    removed: false,
    items: [],
    sub: sec.cards
      .filter((c) => m.cards[c])
      .map((c) => ({ id: rid(), key: c, card: c, title: m.cards[c].title, owner: null, hidden: false, removed: false, items: [], sub: [] })),
  });
  const praes = sections.map(mk);
  const ausarb = sections.map(mk);
  return { praes: { points: praes }, ausarb: { points: ausarb }, locked: false, at: sections.length ? (m.outline?.at ?? Date.now()) : null };
}

function walk(points: LinePoint[], f: (p: LinePoint, depth: number) => void, depth = 0) {
  for (const p of points) {
    f(p, depth);
    walk(p.sub, f, depth + 1);
  }
}
function walkItems(items: LineItem[], f: (it: LineItem, depth: number) => void, depth = 0) {
  for (const it of items) {
    f(it, depth);
    walkItems(it.items, f, depth + 1);
  }
}

/** Gleiche Linien ohne das Schloss? (zum Prüfen, ob bei geschlossenem Schloss nur das Schloss geändert wird) */
const sameContent = (a: Lines, b: Lines) => JSON.stringify({ ...a, locked: false, at: null }) === JSON.stringify({ ...b, locked: false, at: null });

/** Welche Linie trägt die Abschnitte für die Ausarbeitung (Dokumente, Korrektur): die Ausarbeitung, sonst die Präsentation */
export function leadingLine(l: Lines): LinePoint[] {
  const live = (ps: LinePoint[]) => ps.filter((p) => !p.hidden && !p.removed);
  return live(l.ausarb.points).length ? l.ausarb.points : l.praes.points;
}

export function outlineFrom(m: MindMap, l: Lines, points: LinePoint[] = leadingLine(l)): OutlineSection[] {
  return points
    .filter((p) => !p.hidden && !p.removed)
    .map((p) => {
      const live: LinePoint[] = [];
      const collect = (list: LinePoint[]) => list.forEach((s) => !s.hidden && !s.removed && (live.push(s), collect(s.sub)));
      collect(p.sub);
      const cards = live.filter((s) => s.card && m.cards[s.card]).map((s) => s.card!);
      const owners = [...new Set([...cards.map((id) => m.cards[id].owner), ...live.map((s) => s.owner), p.owner].filter((o): o is number => o != null))];
      const id = p.card && m.cards[p.card] ? p.card : p.id;
      // tiefere Ebenen (2 bis 4) als Zwischenüberschriften für den Schreibeditor
      const subs: { id: string; title: string; level: number }[] = [];
      const deep = (list: LinePoint[], d: number) => list.forEach((s) => {
        if (s.hidden || s.removed) return;
        subs.push({ id: s.card && m.cards[s.card] ? s.card : s.id, title: (s.card && m.cards[s.card]?.title) || s.title || 'Ohne Titel', level: d + 2 });
        deep(s.sub, d + 1);
      });
      deep(p.sub, 0);
      return { id, title: (p.card && m.cards[p.card]?.title) || p.title || 'Ohne Titel', cards, owners, ...(subs.length ? { subs } : {}) };
    });
}

/** Karten, die in einer Linie als (nicht entfernter) Punkt stehen */
export function cardsInLines(l: Lines): Set<string> {
  const s = new Set<string>();
  for (const k of ['praes', 'ausarb'] as const) walk(l[k].points, (p) => p.card && !p.removed && s.add(p.card));
  return s;
}

/** Linien prüfen und übernehmen; leitet pick und outline ab. */
export function applyLines(m: MindMap, next: Lines, actor: number, people: Set<number>, now = Date.now()): void {
  const prev = m.lines ?? emptyLines();
  if (prev.locked && next.locked && !sameContent(prev, next)) throw new LinesError('Die Gliederung ist gesperrt. Zum Ändern das Schloss öffnen.');
  for (const k of ['praes', 'ausarb'] as const) {
    const ids = new Set<string>();
    walk(next[k].points, (p, depth) => {
      if (depth > 3) throw new LinesError('Die Gliederung hat höchstens vier Ebenen');
      if (ids.has(p.id)) throw new LinesError('Punkt doppelt in der Gliederung');
      ids.add(p.id);
      if (p.owner != null && !people.has(p.owner)) throw new LinesError('Diese Person gehört nicht zur Gruppe');
      // Karten, die es nicht (mehr) gibt, werden zu eigenen Punkten der Gliederung
      if (p.card && !m.cards[p.card]) p.card = null;
      if (p.card) p.title = m.cards[p.card].title.slice(0, 200);
      walkItems(p.items, (it, d) => {
        if (d > 2) throw new LinesError('Karten lassen sich höchstens dreifach ineinander legen');
        if (it.card && !m.cards[it.card]) it.card = null;
      });
    });
  }
  const anyPoint = next.praes.points.length + next.ausarb.points.length > 0;
  next.at = prev.at ?? (anyPoint ? now : null);
  m.lines = next;
  const inLine = cardsInLines(next);
  for (const c of Object.values(m.cards)) c.pick = inLine.has(c.id);
  const sections = outlineFrom(m, next);
  // Abschnitte der Präsentationslinie für die Präsentation im Schreibeditor (Konzept 8h.10)
  const praes = outlineFrom(m, next, next.praes.points);
  m.outline = next.at ? { sections, praes, at: next.at, by: m.outline?.by ?? actor } : null;
}

/** Vor dem Löschen von Karten: Punkte behalten ihren Titel und gelten dann als eigene Punkte der Gliederung */
export function forgetCards(m: MindMap, gone: Set<string>): void {
  if (!m.lines) return;
  for (const k of ['praes', 'ausarb'] as const)
    walk(m.lines[k].points, (p) => {
      if (p.card && gone.has(p.card)) {
        p.title = m.cards[p.card]?.title || p.title;
        p.card = null;
      }
      walkItems(p.items, (it) => {
        if (it.card && gone.has(it.card)) it.card = null;
      });
    });
}
