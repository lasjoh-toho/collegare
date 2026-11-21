/**
 * Gliederung als U-Bahn-Linien (Konzept 8h): Typen wie im Server (server/src/projects/outlineLines.ts) und kleine
 * Helfer, die eine neue Fassung der Linien bauen. Gesendet wird immer die ganze Gliederung (Map-Op `lines`).
 */
import type { MapCard, MindMap } from './types';

export type LineKind = 'praes' | 'ausarb';
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
export interface LinePoint {
  id: string;
  key: string;
  card: string | null;
  title: string;
  owner: number | null;
  hidden: boolean;
  removed: boolean;
  items: LineItem[];
  sub: LinePoint[];
}
export interface Lines {
  praes: { points: LinePoint[] };
  ausarb: { points: LinePoint[] };
  locked: boolean;
  at: number | null;
}

export const LINE_LABEL: Record<LineKind, string> = { praes: 'Präsentation', ausarb: 'Ausarbeitung' };
/** Linienfarben: rot wie PowerPoint-Streifen, blau wie Word (docs/gestaltung.md) */
export const LINE_COLOR: Record<LineKind, string> = { praes: '#c43e1c', ausarb: '#2b579a' };

export const emptyLines = (): Lines => ({ praes: { points: [] }, ausarb: { points: [] }, locked: false, at: null });
export const linesOf = (m: MindMap): Lines => (m as MindMap & { lines?: Lines }).lines ?? emptyLines();
export const rid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
export const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

export function allPoints(points: LinePoint[]): LinePoint[] {
  return points.flatMap((p) => [p, ...allPoints(p.sub)]);
}
/** Punkt beliebig tief finden (bis zu vier Ebenen), samt Liste, Elternpunkt und Ebene (0 = Hauptpunkt) */
export function findPoint(points: LinePoint[], id: string, parent: LinePoint | null = null, level = 0): { p: LinePoint; list: LinePoint[]; parent: LinePoint | null; level: number } | null {
  for (const p of points) {
    if (p.id === id) return { p, list: points, parent, level };
    const f = findPoint(p.sub, id, p, level + 1);
    if (f) return f;
  }
  return null;
}
/** Ebenen der Gliederung: groß, mittel, Punkt in der Linie, Strich */
export const MAX_LEVELS = 4;
const depthOf = (p: LinePoint): number => 1 + Math.max(0, ...p.sub.map(depthOf));

/** Punkte als flache Liste mit Ebene (für die Darstellung: alle Stationen sitzen auf derselben Linie) */
export function flatPoints(points: LinePoint[], level = 0, out: { p: LinePoint; level: number }[] = []) {
  for (const p of points) {
    if (p.removed) continue;
    out.push({ p, level });
    flatPoints(p.sub, level + 1, out);
  }
  return out;
}

/** Einrücken: wird letzter Unterpunkt des Punkts davor; Ausrücken: steht hinter dem Elternpunkt */
export function indentPoint(l0: Lines, kind: LineKind, id: string, dir: 1 | -1): Lines {
  const l = clone(l0);
  const pts = l[kind].points;
  const hit = findPoint(pts, id);
  if (!hit) return l0;
  const i = hit.list.indexOf(hit.p);
  if (dir === 1) {
    const prev = hit.list.slice(0, i).reverse().find((x) => !x.removed);
    if (!prev || hit.level + depthOf(hit.p) >= MAX_LEVELS) return l0;
    hit.list.splice(i, 1);
    prev.sub.push(hit.p);
    return l;
  }
  if (!hit.parent) return l0;
  const up = findPoint(pts, hit.parent.id)!;
  hit.list.splice(i, 1);
  // die folgenden Geschwister werden Unterpunkte des ausgerückten Punkts (wie in einer Textgliederung)
  hit.p.sub.push(...hit.list.splice(i));
  up.list.splice(up.list.indexOf(up.p) + 1, 0, hit.p);
  return l;
}

/**
 * Neuer Punkt direkt auf der Linie, unter der Zeile `after` (null = ganz oben): hat diese Zeile Unterpunkte, wird er
 * deren erster, sonst steht er auf derselben Ebene dahinter. So erscheint er genau dort, wo man ihn abgelegt hat.
 */
export function insertAfterRow(l0: Lines, kind: LineKind, after: string | null, p: LinePoint): Lines {
  const l = clone(l0);
  const pts = l[kind].points;
  // „^id“: immer auf derselben Ebene hinter dem Punkt samt seinen Unterpunkten (Zelle der Ansicht „beides“)
  const sibling = !!after?.startsWith('^');
  const hit = after ? findPoint(pts, sibling ? after.slice(1) : after) : null;
  if (!hit) pts.unshift(p);
  else if (!sibling && hit.p.sub.some((s) => !s.removed)) hit.p.sub.unshift(p);
  else hit.list.splice(hit.list.indexOf(hit.p) + 1, 0, p);
  return l;
}
/** Objekt irgendwo in einer Liste (beliebig tief) finden, samt der Liste, in der es steht */
export function findItem(items: LineItem[], id: string): { it: LineItem; list: LineItem[] } | null {
  for (const it of items) {
    if (it.id === id) return { it, list: items };
    const f = findItem(it.items, id);
    if (f) return f;
  }
  return null;
}
export function findItemIn(l: Lines, id: string): { it: LineItem; list: LineItem[]; kind: LineKind; point: LinePoint } | null {
  for (const kind of ['praes', 'ausarb'] as const)
    for (const p of allPoints(l[kind].points)) {
      const f = findItem(p.items, id);
      if (f) return { ...f, kind, point: p };
    }
  return null;
}
const containsItem = (it: LineItem, id: string): boolean => it.id === id || it.items.some((x) => containsItem(x, id));

/** neuer Punkt aus einer Karte der Mindmap; ein Ast bringt seine Karten als Unterpunkte mit */
export function pointFromCard(m: MindMap, c: MapCard, withChildren: boolean, room = MAX_LEVELS - 1): LinePoint {
  // ein Ast bringt seine Karten mit, eine Karte die Karten, die an ihr hängen (Karten in Karten), solange Ebenen reichen
  const sub = withChildren && room > 0 ? kidsOf(m, c).map((k) => pointFromCard(m, k, true, room - 1)) : [];
  return { id: rid(), key: c.id, card: c.id, title: c.title, owner: null, hidden: false, removed: false, items: [], sub };
}
function kidsOf(m: MindMap, k: MapCard): MapCard[] {
  const list =
    k.kind === 'cluster'
      ? k.children.map((x) => m.cards[x]).filter((x) => x && !(x.under && m.cards[x.under]?.parent === k.id))
      : Object.values(m.cards).filter((x) => x.under === k.id && x.id !== k.id && x.parent === k.parent);
  return list.sort((a, b) => a.y - b.y || a.x - b.x);
}
export const newPoint = (title: string): LinePoint => {
  const id = rid();
  return { id, key: id, card: null, title, owner: null, hidden: false, removed: false, items: [], sub: [] };
};

/** Ist die Karte (nicht entfernt) in dieser Linie? */
export const cardPoint = (l: Lines, kind: LineKind, card: string) => allPoints(l[kind].points).find((p) => p.card === card && !p.removed) ?? null;

/**
 * Karte bzw. Ast in die Linie nehmen. Eine Karte eines übernommenen Asts wird dessen Unterpunkt; fehlt der Ast, kommt er
 * mit. Steht die Karte schon als entfernter Punkt in der Linie, wird sie zurückgeholt. target: an diesen Punkt hängen.
 */
export function addCard(m: MindMap, l0: Lines, kind: LineKind, c: MapCard, opts: { whole?: boolean; target?: string | null; after?: string | null } = {}): Lines {
  if (opts.after !== undefined && !allPoints(l0[kind].points).some((p) => p.card === c.id && !p.removed)) {
    const l1 = clone(l0);
    for (const p of allPoints(l1[kind].points)) if (p.card === c.id) deleteIn(l1[kind].points, p.id);
    return insertAfterRow(l1, kind, opts.after, pointFromCard(m, c, opts.whole ?? false));
  }
  const l = clone(l0);
  const pts = l[kind].points;
  const old = allPoints(pts).find((p) => p.card === c.id);
  if (old) {
    old.removed = false;
    old.hidden = false;
    if (opts.whole && c.kind === 'cluster') for (const k of c.children) if (m.cards[k] && !old.sub.some((s) => s.card === k)) old.sub.push(pointFromCard(m, m.cards[k], false));
    return l;
  }
  const target = opts.target ? findPoint(pts, opts.target) : null;
  if (target) {
    // auf einen Punkt: dessen Unterpunkt; ein Ast bringt seine Karten mit, solange die vier Ebenen reichen;
    // auf der untersten Ebene: dahinter in denselben Abschnitt
    const cluster = c.kind === 'cluster';
    const room = MAX_LEVELS - 1 - target.level; // Ebenen unter dem Ziel
    if (room >= (cluster ? 2 : 1)) target.p.sub.push(pointFromCard(m, c, cluster));
    else target.list.splice(target.list.indexOf(target.p) + 1, 0, pointFromCard(m, c, cluster && room >= 1));
    return l;
  }
  if (c.kind === 'card' && c.parent && m.cards[c.parent]) {
    let host = pts.find((p) => p.card === c.parent);
    if (!host) {
      host = pointFromCard(m, m.cards[c.parent], false);
      pts.push(host);
    }
    host.removed = false;
    host.sub.push(pointFromCard(m, c, false));
    return l;
  }
  pts.push(pointFromCard(m, c, opts.whole ?? false));
  return l;
}

/** Karte aus der Linie nehmen: bleibt als „entfernt“ gespeichert, damit die Mindmap sie ausgegraut zeigt */
export function removeCard(l0: Lines, kind: LineKind, card: string): Lines {
  const l = clone(l0);
  for (const p of allPoints(l[kind].points)) if (p.card === card) p.removed = true;
  return l;
}

export function patchPoint(l0: Lines, kind: LineKind, id: string, f: (p: LinePoint) => void): Lines {
  const l = clone(l0);
  const hit = findPoint(l[kind].points, id);
  if (hit) f(hit.p);
  return l;
}
export function movePoint(l0: Lines, kind: LineKind, id: string, dir: -1 | 1): Lines {
  const l = clone(l0);
  const hit = findPoint(l[kind].points, id);
  if (!hit) return l;
  const i = hit.list.indexOf(hit.p);
  const j = i + dir;
  if (j < 0 || j >= hit.list.length) return l;
  [hit.list[i], hit.list[j]] = [hit.list[j], hit.list[i]];
  return l;
}
const deleteIn = (pts: LinePoint[], id: string) => {
  const hit = findPoint(pts, id);
  if (hit) hit.list.splice(hit.list.indexOf(hit.p), 1);
};
/** endgültig löschen (nur eigene Punkte der Gliederung oder schon entfernte) */
export function deletePoint(l0: Lines, kind: LineKind, id: string): Lines {
  const l = clone(l0);
  const hit = findPoint(l[kind].points, id);
  if (hit) hit.list.splice(hit.list.indexOf(hit.p), 1);
  return l;
}
/** Punkt in die andere Linie übernehmen (gleicher Schlüssel: verbindet beide in der Ansicht „beides“) */
export function copyPoint(l0: Lines, from: LineKind, id: string): Lines {
  const l = clone(l0);
  const to: LineKind = from === 'praes' ? 'ausarb' : 'praes';
  const hit = findPoint(l[from].points, id);
  if (!hit) return l;
  const fresh = (p: LinePoint): LinePoint => ({ ...clone(p), id: rid(), items: clone(p.items).map(reId), sub: p.sub.map(fresh) });
  if (hit.parent) {
    let host = allPoints(l[to].points).find((p) => p.key === hit.parent!.key);
    if (!host) {
      host = { ...fresh(hit.parent), sub: [] };
      l[to].points.push(host);
    }
    if (!allPoints(l[to].points).some((s) => s.key === hit.p.key)) host.sub.push(fresh(hit.p));
  } else if (!allPoints(l[to].points).some((p) => p.key === hit.p.key)) l[to].points.push(fresh(hit.p));
  return l;
}
const reId = (it: LineItem): LineItem => ({ ...it, id: rid(), items: it.items.map(reId) });

/** Objekt an einen Punkt hängen (oder in ein anderes Objekt legen) */
export function addItem(l0: Lines, kind: LineKind, point: string, it: Omit<LineItem, 'id' | 'items'>, into?: string | null): Lines {
  const l = clone(l0);
  const hit = findPoint(l[kind].points, point);
  if (!hit) return l;
  const item: LineItem = { ...it, id: rid(), items: [] };
  const host = into ? findItem(hit.p.items, into) : null;
  (host ? host.it.items : hit.p.items).push(item);
  return l;
}
/** Objekt verschieben: an einen Punkt (ans Ende), in ein anderes Objekt oder vor ein Objekt (Reihenfolge) */
export function moveItem(l0: Lines, id: string, to: { kind: LineKind; point: string; into?: string | null; before?: string | null }): Lines {
  const l = clone(l0);
  const src = findItemIn(l, id);
  if (!src) return l;
  if (to.into && containsItem(src.it, to.into)) return l0;
  const hit = findPoint(l[to.kind].points, to.point);
  if (!hit) return l0;
  src.list.splice(src.list.indexOf(src.it), 1);
  if (to.into) {
    const host = findItem(hit.p.items, to.into);
    (host ? host.it.items : hit.p.items).push(src.it);
  } else if (to.before) {
    const b = findItem(hit.p.items, to.before);
    if (b) b.list.splice(b.list.indexOf(b.it), 0, src.it);
    else hit.p.items.push(src.it);
  } else hit.p.items.push(src.it);
  return l;
}
export function patchItem(l0: Lines, id: string, f: (it: LineItem) => void): Lines {
  const l = clone(l0);
  const hit = findItemIn(l, id);
  if (hit) f(hit.it);
  return l;
}
export function dropItem(l0: Lines, id: string): Lines {
  const l = clone(l0);
  const hit = findItemIn(l, id);
  if (hit) hit.list.splice(hit.list.indexOf(hit.it), 1);
  return l;
}

/** Karten, die in der Gliederung ausgeblendet oder entfernt wurden und in keiner Linie mehr sichtbar sind (Mindmap: grau) */
export function greyedCards(l: Lines): Set<string> {
  const seen = new Map<string, boolean>();
  for (const kind of ['praes', 'ausarb'] as const)
    for (const p of allPoints(l[kind].points)) {
      if (!p.card) continue;
      const live = !p.hidden && !p.removed;
      seen.set(p.card, (seen.get(p.card) ?? false) || live);
    }
  return new Set([...seen].filter(([, live]) => !live).map(([c]) => c));
}

/** Schlüssel, die in beiden Linien vorkommen (Punkte oder Objekte): verbinden die Linien in der Ansicht „beides“ */
export function sharedKeys(l: Lines): Set<string> {
  const keys = (kind: LineKind) => {
    const s = new Set<string>();
    const items = (its: LineItem[]) => its.forEach((it) => (it.note && s.add('n' + it.note), it.card && s.add('c' + it.card), items(it.items)));
    for (const p of allPoints(l[kind].points)) {
      if (!p.removed) s.add('k' + p.key);
      items(p.items);
    }
    return s;
  };
  const a = keys('praes');
  return new Set([...keys('ausarb')].filter((k) => a.has(k)));
}

/**
 * Zeilen für die Ansicht „beides“: Hauptpunkte beider Linien nebeneinander, gleiche Schlüssel in derselben Zeile
 * (längste gemeinsame Folge, wie bei einem Textvergleich), der Rest dazwischen einsortiert.
 */
export function alignRows(a: LinePoint[], b: LinePoint[]): { left: LinePoint | null; right: LinePoint | null }[] {
  const n = a.length,
    m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i].key === b[j].key ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const rows: { left: LinePoint | null; right: LinePoint | null }[] = [];
  let i = 0,
    j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[i].key === b[j].key) rows.push({ left: a[i++], right: b[j++] });
    else if (j >= m || (i < n && dp[i + 1][j] >= dp[i][j + 1])) rows.push({ left: a[i++], right: null });
    else rows.push({ left: null, right: b[j++] });
  }
  return rows;
}

/** Linien, die Lernende sehen (Einstellung der Lehrkraft); Lehrkräfte sehen immer beide */
export function visibleKinds(setting: 'both' | 'praes' | 'ausarb' | undefined, teacher: boolean): LineKind[] {
  if (teacher || !setting || setting === 'both') return ['praes', 'ausarb'];
  return [setting];
}

/**
 * Ast bzw. Cluster vorübergehend als Gliederung (Vorschau, nichts wird gespeichert): der Knoten oben, darunter seine
 * Karten und die Karten in Karten, von oben nach unten, höchstens vier Ebenen.
 */
export function previewRows(m: MindMap, id: string): { id: string; title: string; level: number }[] {
  const c = m.cards[id];
  if (!c) return [];
  const out: { id: string; title: string; level: number }[] = [];
  const seen = new Set<string>();
  const walk = (k: MapCard, level: number) => {
    if (seen.has(k.id) || level >= MAX_LEVELS) return;
    seen.add(k.id);
    out.push({ id: k.id, title: k.title || 'Ohne Titel', level });
    for (const x of kidsOf(m, k)) walk(x, level + 1);
  };
  walk(c, 0);
  return out;
}
