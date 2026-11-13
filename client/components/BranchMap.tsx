'use client';
/**
 * Mindmap als Äste (Wunsch Jo, 11. November 2026): Thema in der Mitte, Äste als gleichmäßig dicke Linien im
 * U-Bahn-Stil mit Pfeilspitze; je Ast wählbar: U-Bahn (45°), rechtwinklig, Kurve oder gerade, dazu die Lage des
 * Knicks. Knoten sind eckige Flächen (andere Formen wählbar) und lassen sich frei ziehen. Lockere Ideen ohne Form.
 * Gleiche Daten wie die Karten-Fläche (MindMap.tsx): Hauptast = Cluster (wird Abschnitt der Gliederung),
 * Unterast = Karte im Cluster (mit zuständiger Person). Die Lage ergibt sich automatisch; x/y der Karten-Fläche
 * bleiben unberührt, damit beide Ansichten nebeneinander funktionieren.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { COLUMN_COLORS } from '@/lib/colors';
import type { MapCard, MapFork, MapOp, MapRoute, MapShape, MapStart, MapVia, MindMap as MapData } from '@/lib/types';
import { cardFromChat, isChatDrag, readChatDrop } from '@/lib/chatDrag';
import { Icon } from './Icon';
import type { Person } from './MindMap';
import b from './branchmap.module.css';

const ROW = 46; // Höhe je Unterast
const GAP = 22; // Abstand zwischen Hauptästen
const MAIN_X = 230; // Abstand Mitte → Hauptast
const SUB_X = 250; // Abstand Hauptast → Unterast
const newId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

const ROUTES: { key: MapRoute; label: string }[] = [
  { key: 'metro', label: 'U-Bahn (45°)' },
  { key: 'ortho', label: 'Rechtwinklig' },
  { key: 'curve', label: 'Kurve' },
  { key: 'straight', label: 'Gerade' },
];

const SHAPES: { key: MapShape; label: string }[] = [
  { key: 'none', label: 'Ohne Form' },
  { key: 'rect', label: 'Rechteck' },
  { key: 'oval', label: 'Oval' },
  { key: 'diamond', label: 'Raute' },
  { key: 'para', label: 'Parallelogramm' },
];

interface Geo {
  n: Node;
  from: Box;
  a: { p: V; dir: V };
  z: { p: V; dir: V };
  via: V[];
  hv: V[];
  tip: V;
  w: number;
  d: string;
  kind: MapRoute;
  fork: MapFork | null;
  color: string;
}

interface Node {
  card: MapCard;
  side: 1 | -1;
  x: number;
  y: number;
  color: string;
  depth: number;
  /** lockere Idee: Karte ohne Ast, wie „no shape“ (Text unterbricht den Ast), noch kein Abschnitt */
  idea: boolean;
  parentId: string | null;
}

/** Lesereihenfolge wie die Gliederung: von oben nach unten, dann links nach rechts. */
function readingOrder(cards: MapCard[]): MapCard[] {
  return [...cards].sort((a, b) => (Math.abs(a.y - b.y) < 60 ? a.x - b.x : a.y - b.y));
}

/** Linienzug mit abgerundeten Ecken (Radius r), wie auf einem U-Bahn-Plan. */
function rounded(pts: [number, number][], r = 12): string {
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const [px, py] = pts[i - 1];
    const [cx, cy] = pts[i];
    const [nx, ny] = pts[i + 1];
    const l1 = Math.hypot(cx - px, cy - py);
    const l2 = Math.hypot(nx - cx, ny - cy);
    const rr = Math.min(r, l1 / 2, l2 / 2);
    if (rr < 0.5) {
      d += ` L${cx},${cy}`;
      continue;
    }
    const ax = cx - ((cx - px) / l1) * rr;
    const ay = cy - ((cy - py) / l1) * rr;
    const bx = cx + ((nx - cx) / l2) * rr;
    const by = cy + ((ny - cy) / l2) * rr;
    d += ` L${ax},${ay} Q${cx},${cy} ${bx},${by}`;
  }
  const [lx, ly] = pts[pts.length - 1];
  return d + ` L${lx},${ly}`;
}

const LEAD = 18; // gerades Stück vor der Pfeilspitze
const LINE = 5; // alle Äste gleich dick (Wunsch Jo)
const TIP = 1.25; // Länge der Spitze in Linienbreiten (stumpfer, Wunsch Jo)

type V = [number, number];
interface Box {
  x: number; // Mitte
  y: number;
  w: number;
  h: number;
}

/**
 * Anschluss an der Form: Der Ast verlässt die Form an der Seite, die zum Ziel zeigt, und dort an der Stelle, die dem
 * Ziel am nächsten ist (an allen vier Seiten, an jeder Stelle). Ergebnis: Punkt und Richtung nach außen.
 */
function port(box: Box, tx: number, ty: number, middle = false): { p: V; dir: V } {
  const dx = tx - box.x;
  const dy = ty - box.y;
  const m = 8; // nicht ganz in die Ecke
  // Seite nach dem Abstand außerhalb der Form wählen, nicht nach dem Winkel (breite Formen sonst fast nur oben/unten)
  if (Math.abs(dx) - box.w / 2 >= Math.abs(dy) - box.h / 2) {
    const s = dx >= 0 ? 1 : -1;
    const y = middle ? box.y : Math.max(box.y - box.h / 2 + m, Math.min(box.y + box.h / 2 - m, ty));
    return { p: [box.x + (s * box.w) / 2, y], dir: [s, 0] };
  }
  const s = dy >= 0 ? 1 : -1;
  const x = middle ? box.x : Math.max(box.x - box.w / 2 + m, Math.min(box.x + box.w / 2 - m, tx));
  return { p: [x, box.y + (s * box.h) / 2], dir: [0, s] };
}

/** Raute und Oval: Anschluss nur in der Mitte einer Seite, sonst endet der Ast neben der Form. */
const pointy = (c: MapCard | null, idea: boolean) => !!c && ['diamond', 'oval'].includes(c.shape ?? (idea ? 'none' : 'rect'));

const axis = (v: V): V => (Math.abs(v[0]) >= Math.abs(v[1]) ? [Math.sign(v[0]) || 1, 0] : [0, Math.sign(v[1]) || 1]);

/**
 * Ein Teilstück von a (Richtung da hinaus) nach e (Richtung de aus e zurück zu a), als Punktfolge.
 * U-Bahn: gerade, 45° schräg, gerade; bend legt fest, wo die Schräge liegt.
 */
function leg(kind: MapRoute, bend: number, a: V, da: V, e: V, de: V): V[] {
  const horizA = da[0] !== 0;
  const horizB = de[0] !== 0;
  const dx = e[0] - a[0];
  const dy = e[1] - a[1];
  const sx = Math.sign(dx) || 1;
  const sy = Math.sign(dy) || 1;
  if (kind === 'ortho') {
    if (horizA && horizB) {
      const mx = a[0] + dx * bend;
      return [a, [mx, a[1]], [mx, e[1]], e];
    }
    if (!horizA && !horizB) {
      const my = a[1] + dy * bend;
      return [a, [a[0], my], [e[0], my], e];
    }
    return horizA ? [a, [e[0], a[1]], e] : [a, [a[0], e[1]], e];
  }
  if (horizA && horizB) {
    // waagerecht – schräg – waagerecht
    const free = Math.abs(dx) - Math.abs(dy);
    if (free < 0) return [a, [a[0] + dx * bend, a[1]], [a[0] + dx * bend, e[1]], e];
    const x1 = a[0] + sx * free * bend;
    return [a, [x1, a[1]], [x1 + sx * Math.abs(dy), e[1]], e];
  }
  if (!horizA && !horizB) {
    const free = Math.abs(dy) - Math.abs(dx);
    if (free < 0) return [a, [a[0], a[1] + dy * bend], [e[0], a[1] + dy * bend], e];
    const y1 = a[1] + sy * free * bend;
    return [a, [a[0], y1], [e[0], y1 + sy * Math.abs(dx)], e];
  }
  const d = Math.min(Math.abs(dx), Math.abs(dy));
  // waagerecht hinaus, senkrecht hinein (oder umgekehrt): Schräge dazwischen
  if (horizA) return [a, [e[0] - sx * d, a[1]], [e[0], a[1] + sy * d], e];
  return [a, [a[0], e[1] - sy * d], [a[0] + sx * d, e[1]], e];
}

const endOf = (b: V, db: V): V => [b[0] + db[0] * LEAD, b[1] + db[1] * LEAD]; // vor der Pfeilspitze

/**
 * Bézier-Griffe an den Zwischenstopps (Vektor vom Stopp zum vorderen Griff; der hintere liegt gespiegelt gegenüber).
 * Von Hand gesetzt (hs) oder automatisch: Richtung von davor nach danach, Länge nach dem kürzeren Nachbarabstand.
 */
function handles(a: V, da: V, via: V[], end: V, db: V, bend: number, hs: (V | null)[] = []): V[] {
  const pts: V[] = [a, ...via, end];
  return via.map((w, j) => {
    if (hs[j]) return hs[j]!;
    const prev = pts[j];
    const next = pts[j + 2];
    const v: V = [next[0] - prev[0], next[1] - prev[1]];
    const l = Math.hypot(v[0], v[1]) || 1;
    const len = Math.min(Math.hypot(w[0] - prev[0], w[1] - prev[1]), Math.hypot(next[0] - w[0], next[1] - w[1])) * (0.25 + 0.4 * bend);
    return [(v[0] / l) * len, (v[1] / l) * len];
  });
}

/**
 * Weg von Anschluss a (Richtung da nach außen) über die Zwischenstopps zu Anschluss b (Richtung db nach außen aus
 * dem Ziel). Zwischen zwei Stopps läuft die Linie im gewählten Stil; das letzte Stück zeigt gerade in das Ziel.
 */
function route(kind: MapRoute, bend: number, a: V, da: V, via: V[], b: V, db: V, hs: (V | null)[] = []): string {
  const end: V = endOf(b, db);
  if (kind === 'straight') return rounded([a, ...via, b], 10);
  const stops: V[] = [a, ...via, end];
  if (kind === 'curve') {
    // Bézierkurve durch alle Stopps; an jedem Stopp ein Griff (von Hand gezogen oder automatisch glatt)
    const hv = handles(a, da, via, end, db, bend, hs);
    let d = `M${a[0]},${a[1]}`;
    for (let i = 0; i < stops.length - 1; i++) {
      const p = stops[i];
      const q = stops[i + 1];
      const dist = Math.hypot(q[0] - p[0], q[1] - p[1]);
      // mit Stopps nach der Länge des Teilstücks, sonst schlägt die Kurve kurz vor dem Ziel eine Schleife
      const k = via.length ? dist * (0.15 + 0.35 * bend) : Math.max(40, dist * (0.2 + 0.6 * bend));
      const c1: V = i === 0 ? [p[0] + da[0] * k, p[1] + da[1] * k] : [p[0] + hv[i - 1][0], p[1] + hv[i - 1][1]];
      const c2: V = i === stops.length - 2 ? [q[0] + db[0] * k, q[1] + db[1] * k] : [q[0] - hv[i][0], q[1] - hv[i][1]];
      d += ` C${c1[0]},${c1[1]} ${c2[0]},${c2[1]} ${q[0]},${q[1]}`;
    }
    return d + ` L${b[0]},${b[1]}`;
  }
  const pts: V[] = [a];
  for (let i = 0; i < stops.length - 1; i++) {
    const p = stops[i];
    const q = stops[i + 1];
    const last = i === stops.length - 2;
    // An Zwischenstopps knickt die Linie nur einmal (L bzw. gerade + 45°), das sieht ruhiger aus als ein Z
    const dp: V = i === 0 ? da : last ? (db[0] !== 0 ? [0, Math.sign(q[1] - p[1]) || 1] : [Math.sign(q[0] - p[0]) || 1, 0]) : axis([q[0] - p[0], q[1] - p[1]]);
    const dq: V = last ? db : dp[0] !== 0 ? [0, Math.sign(p[1] - q[1]) || 1] : [Math.sign(p[0] - q[0]) || 1, 0];
    pts.push(...leg(kind, bend, p, dp, q, dq).slice(1));
  }
  return rounded([...pts, b], 14);
}

/** Von Hand gesetzter Ansatz: Seite und Stelle entlang der Seite. */
function anchorAt(box: Box, st: MapStart): { p: V; dir: V } {
  const l = box.x - box.w / 2;
  const t = box.y - box.h / 2;
  if (st.side === 'l') return { p: [l, t + st.t * box.h], dir: [-1, 0] };
  if (st.side === 'r') return { p: [l + box.w, t + st.t * box.h], dir: [1, 0] };
  if (st.side === 't') return { p: [l + st.t * box.w, t], dir: [0, -1] };
  return { p: [l + st.t * box.w, t + box.h], dir: [0, 1] };
}

/** Nächste Stelle am Rand der Form zu einem Punkt (beim Ziehen des Ansatzes). */
function anchorFrom(box: Box, [x, y]: V): MapStart {
  const l = box.x - box.w / 2;
  const r = box.x + box.w / 2;
  const t = box.y - box.h / 2;
  const btm = box.y + box.h / 2;
  const cl = (v: number) => Math.max(0, Math.min(1, v));
  const tx = cl((x - l) / box.w);
  const ty = cl((y - t) / box.h);
  const opts: [MapStart, number][] = [
    [{ side: 'l', t: ty }, Math.abs(x - l)],
    [{ side: 'r', t: ty }, Math.abs(x - r)],
    [{ side: 't', t: tx }, Math.abs(y - t)],
    [{ side: 'b', t: tx }, Math.abs(y - btm)],
  ];
  opts.sort((p, q) => p[1] - q[1]);
  const st = opts[0][0];
  return { side: st.side, t: Math.round(st.t * 100) / 100 };
}

/** Abstand eines Punkts zu einer Strecke (zum Einfügen eines Zwischenstopps an der richtigen Stelle). */
function segDist([px, py]: V, [ax, ay]: V, [bx, by]: V): number {
  const l2 = (bx - ax) ** 2 + (by - ay) ** 2 || 1;
  const t = Math.max(0, Math.min(1, ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / l2));
  return Math.hypot(px - ax - t * (bx - ax), py - ay - t * (by - ay));
}

const snap = (v: number) => Math.round(v / 10) * 10;

/** Spitze ohne Widerhaken: so breit wie die Linie, kurz und an der Spitze leicht gerundet. */
function arrow(x: number, y: number, [dx, dy]: [number, number], w: number): string {
  const px = (-dy * w) / 2;
  const py = (dx * w) / 2;
  const bx = x - dx * w * TIP;
  const by = y - dy * w * TIP;
  const f = 0.22; // Anteil der Flanke, der in die Rundung geht
  const l: V = [x + (bx + px - x) * f, y + (by + py - y) * f];
  const r: V = [x + (bx - px - x) * f, y + (by - py - y) * f];
  return `M${bx + px},${by + py} L${l[0]},${l[1]} Q${x},${y} ${r[0]},${r[1]} L${bx - px},${by - py} Z`;
}

/** Farbe leicht abwandeln (k-te Abzweigung): Farbton abwechselnd nach beiden Seiten, etwas heller. */
function shade(hex: string, k: number): string {
  if (!k || !/^#[0-9a-f]{6}$/i.test(hex)) return hex;
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, bl = (n & 255) / 255;
  const mx = Math.max(r, g, bl), mn = Math.min(r, g, bl);
  let h = 0;
  const l = (mx + mn) / 2;
  const d = mx - mn;
  const sat = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  if (d) h = mx === r ? ((g - bl) / d) % 6 : mx === g ? (bl - r) / d + 2 : (r - g) / d + 4;
  const step = Math.ceil(k / 2);
  const h2 = (h * 60 + (k % 2 ? 1 : -1) * 9 * step + 360) % 360;
  const l2 = Math.min(0.68, l + 0.035 * step);
  const c = (1 - Math.abs(2 * l2 - 1)) * sat;
  const x = c * (1 - Math.abs(((h2 / 60) % 2) - 1));
  const m = l2 - c / 2;
  const [a, b2, e] = h2 < 60 ? [c, x, 0] : h2 < 120 ? [x, c, 0] : h2 < 180 ? [0, c, x] : h2 < 240 ? [0, x, c] : h2 < 300 ? [x, 0, c] : [c, 0, x];
  return '#' + [a, b2, e].map((v) => Math.round((v + m) * 255).toString(16).padStart(2, '0')).join('');
}

const IDEA = '#9a9a94';

/** Gültiger Knoten, an dem eine Karte in der Ast-Ansicht hängt (gleicher Cluster bzw. beide lose, kein Kreis). */
function underOf(map: MapData, c: MapCard): string | null {
  const u = c.under ? map.cards[c.under] : null;
  if (!u || u.id === c.id || u.kind !== 'card' || c.kind !== 'card' || u.parent !== c.parent) return null;
  let x: MapCard | undefined = u;
  for (let guard = 0; x?.under && guard < 50; guard++) {
    if (x.under === c.id) return null;
    x = map.cards[x.under];
  }
  return u.id;
}

function layout(map: MapData): { nodes: Node[]; height: number } {
  // Knoten an Knoten: Karten mit „under“ hängen in der Ast-Ansicht an einer anderen Karte (beliebig tief)
  const subs = new Map<string, MapCard[]>();
  for (const c of Object.values(map.cards)) {
    const u = underOf(map, c);
    if (u) subs.set(u, [...(subs.get(u) ?? []), c]);
  }
  const byY = (l: MapCard[]) => [...l].sort((a, b) => a.y - b.y || a.x - b.x);
  const rows = (c: MapCard): number => {
    const l = subs.get(c.id) ?? [];
    return l.length ? l.reduce((sum, k) => sum + rows(k), 0) : 1;
  };
  const direct = (c: MapCard) => c.children.map((id) => map.cards[id]).filter((k) => k && !underOf(map, k));
  const roots = map.roots.map((id) => map.cards[id]).filter((c) => c && !underOf(map, c));
  const all = readingOrder(roots);
  const mains = all.filter((c) => c.kind === 'cluster');
  const size = (c: MapCard) => (c.kind === 'card' ? rows(c) * ROW : Math.max(1, direct(c).reduce((sum, k) => sum + rows(k), 0)) * ROW + GAP);
  // Erste Hälfte rechts, zweite links (im Uhrzeigersinn lesbar)
  const right: MapCard[] = [];
  let acc = 0;
  const total2 = all.reduce((s, c) => s + size(c), 0);
  for (const c of all) {
    if (acc < total2 / 2 || right.length === 0) {
      right.push(c);
      acc += size(c);
    }
  }
  const left = all.filter((c) => !right.includes(c));
  const nodes: Node[] = [];
  /** Kinder eines Knotens auffächern, jedes so hoch wie seine eigenen Unteräste */
  const fan = (list: MapCard[], pn: Node, idea: boolean) => {
    const ordered = byY(list);
    let y = pn.y - (ordered.reduce((sum, k) => sum + rows(k), 0) * ROW) / 2;
    for (const k of ordered) {
      const r = rows(k);
      const ky = k.by ?? y + (r * ROW) / 2;
      const kx = k.bx ?? pn.x + pn.side * (pn.depth === 1 ? SUB_X : SUB_X * 0.8);
      const node: Node = { card: k, side: kx >= pn.x ? 1 : -1, x: kx, y: ky, color: pn.color, depth: pn.depth + 1, idea, parentId: pn.card.id };
      nodes.push(node);
      fan(subs.get(k.id) ?? [], node, idea);
      y += r * ROW;
    }
  };
  const place = (list: MapCard[], side: 1 | -1) => {
    const h = list.reduce((s, c) => s + size(c), 0);
    let y = -h / 2;
    list.forEach((c) => {
      const idx = mains.indexOf(c);
      const idea = c.kind === 'card';
      const color = c.color ?? (idea ? IDEA : COLUMN_COLORS[(idx + 1) % COLUMN_COLORS.length]);
      const sz = size(c);
      const autoY = y + sz / 2;
      const mx = c.bx ?? side * (MAIN_X + 60);
      const my = c.by ?? autoY;
      const s: 1 | -1 = mx >= 0 ? 1 : -1;
      const node: Node = { card: c, side: s, x: mx, y: my, color, depth: 1, idea, parentId: null };
      nodes.push(node);
      fan(idea ? (subs.get(c.id) ?? []) : direct(c), node, idea);
      y += sz;
    });
    return h;
  };
  const hr = place(right, 1);
  const hl = place(left, -1);
  return { nodes, height: Math.max(hr, hl, 200) };
}

export function BranchMap({ map, topic, people, canEdit, send }: { map: MapData; topic: string; people: Person[]; canEdit: boolean; send: (op: MapOp, join?: boolean) => Promise<boolean> }) {
  const { nodes, height } = useMemo(() => layout(map), [map]);
  const mains = nodes.filter((n) => n.depth === 1 && !n.idea);
  const [sel, setSel] = useState<string | null>(null);
  const [edit, setEdit] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [cam, setCam] = useState({ x: 0, y: 0, k: 1 });
  const wrap = useRef<HTMLDivElement>(null);
  const pan = useRef<{ sx: number; sy: number; x: number; y: number } | null>(null);
  const selected = sel ? map.cards[sel] : null;
  const stage = useRef<HTMLDivElement>(null);
  const [sizes, setSizes] = useState<Record<string, [number, number]>>({});
  const drag = useRef<{ id: string; sx: number; sy: number; x: number; y: number; moved: boolean } | null>(null);
  const [dragPos, setDragPos] = useState<{ id: string; x: number; y: number } | null>(null);
  const [hd, setHd] = useState<{ id: string; kind: 'start' | 'via' | 'hand'; i: number; x: number; y: number; moved?: boolean } | null>(null);
  // angetippter Punkt am gewählten Ast (Stopp, Bézier-Griff oder Ansatz): Entf entfernt nur ihn
  const [pick, setPick] = useState<{ kind: 'start' | 'via' | 'hand'; i: number } | null>(null);
  useEffect(() => setPick(null), [sel]);

  // Breiten der Knoten messen, damit die Linien genau an den Kanten ansetzen
  useLayoutEffect(() => {
    const el = stage.current;
    if (!el) return;
    const next: Record<string, [number, number]> = {};
    el.querySelectorAll<HTMLElement>('[data-node]').forEach((n) => (next[n.dataset.node!] = [n.offsetWidth, n.offsetHeight]));
    if (Object.keys(next).length !== Object.keys(sizes).length || Object.entries(next).some(([k, v]) => sizes[k]?.[0] !== v[0] || sizes[k]?.[1] !== v[1])) setSizes(next);
  });

  const pos = (n: Node) => (dragPos && dragPos.id === n.card.id ? { x: dragPos.x, y: dragPos.y } : { x: n.x, y: n.y });

  useEffect(() => {
    if (sel && !map.cards[sel]) setSel(null);
  }, [map, sel]);

  // Ganze Mindmap einpassen, wenn sich die Größe ändert
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const fit = () => {
      const k = Math.min(1.1, Math.max(0.35, Math.min(el.clientWidth / (2 * (MAIN_X + SUB_X) + 420), el.clientHeight / (height + 120))));
      setCam({ x: el.clientWidth / 2, y: el.clientHeight / 2, k });
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [height]);

  async function addMain() {
    const id = newId();
    const max = Math.max(0, ...Object.values(map.cards).filter((c) => !c.parent).map((c) => c.y + c.h));
    if (await send({ type: 'add', card: { id, kind: 'cluster', title: 'Neuer Ast', text: '', x: 0, y: max + 40, w: 340, h: 230, color: null, parent: null, owner: null } })) {
      setSel(id);
      startEdit(id, 'Neuer Ast');
    }
  }

  /** Schnell denken: lockere Idee direkt am Thema, ohne Abschnitt */
  async function addIdea() {
    const id = newId();
    const max = Math.max(0, ...Object.values(map.cards).filter((c) => !c.parent).map((c) => c.y + c.h));
    if (await send({ type: 'add', card: { id, kind: 'card', title: '', text: '', x: 0, y: max + 30, w: 180, h: 100, color: null, parent: null, owner: null } })) {
      setSel(id);
      startEdit(id, '');
    }
  }

  /** Lockere Idee an einen Hauptast hängen */
  async function attach(id: string, parentId: string) {
    const p = map.cards[parentId];
    if (!p) return;
    const y = p.children.reduce((m, c) => Math.max(m, (map.cards[c]?.y ?? 0) + (map.cards[c]?.h ?? 0) + 10), 0);
    await send({ type: 'move', id, x: 0, y, parent: parentId });
  }

  /** Lockere Idee wird Hauptast (Abschnitt der Gliederung) */
  async function promote(id: string) {
    const c = map.cards[id];
    if (!c) return;
    const nid = newId();
    if (await send({ type: 'add', card: { id: nid, kind: 'cluster', title: c.title, text: c.text, x: c.x, y: c.y, w: 340, h: 230, color: null, parent: null, owner: null, shape: c.shape } })) {
      await send({ type: 'remove', ids: [id] }, true);
      setSel(nid);
    }
  }

  /** Beitrag aus dem Chat: auf einen Knoten gezogen hängt er dort, sonst lockere Idee an der Stelle */
  async function dropChat(e: React.DragEvent) {
    const d = readChatDrop(e);
    if (!d || !canEdit) return;
    e.preventDefault();
    const { title, text } = cardFromChat(d);
    const at = toStage(e);
    const onId = (e.target as HTMLElement).closest<HTMLElement>('[data-node]')?.dataset.node;
    const on = onId && onId !== '__root' ? map.cards[onId] : null;
    const id = newId();
    const base = { id, kind: 'card' as const, title, text, w: 180, h: 100, color: null, owner: null };
    let ok: boolean;
    if (on?.kind === 'cluster') {
      const y = on.children.reduce((m, c) => Math.max(m, (map.cards[c]?.y ?? 0) + (map.cards[c]?.h ?? 0) + 10), 0);
      ok = await send({ type: 'add', card: { ...base, x: 0, y, parent: on.id } });
    } else if (on) {
      const p = on.parent ? map.cards[on.parent] : null;
      const y = p ? p.children.reduce((m, c) => Math.max(m, (map.cards[c]?.y ?? 0) + (map.cards[c]?.h ?? 0) + 10), 0) : on.y + on.h + 20;
      ok = await send({ type: 'add', card: { ...base, x: p ? 0 : on.x + on.w + 30, y, parent: on.parent, under: on.id } });
    } else {
      const max = Math.max(0, ...Object.values(map.cards).filter((c) => !c.parent).map((c) => c.y + c.h));
      ok = await send({ type: 'add', card: { ...base, x: 0, y: max + 30, parent: null, bx: Math.round(at[0]), by: Math.round(at[1]) } });
    }
    if (ok) setSel(id);
  }

  /** Neue Idee direkt an einem Knoten (Unterast oder lockere Idee), beliebig tief */
  async function addUnder(nodeId: string) {
    const n = map.cards[nodeId];
    if (!n) return;
    if (n.kind === 'cluster') return addChild(n.id);
    const id = newId();
    const p = n.parent ? map.cards[n.parent] : null;
    const y = p ? p.children.reduce((m, c) => Math.max(m, (map.cards[c]?.y ?? 0) + (map.cards[c]?.h ?? 0) + 10), 0) : n.y + n.h + 20;
    const x = p ? 0 : n.x + n.w + 30;
    if (await send({ type: 'add', card: { id, kind: 'card', title: '', text: '', x, y, w: 180, h: 100, color: null, parent: n.parent, owner: null, under: n.id } })) {
      setSel(id);
      startEdit(id, '');
    }
  }

  async function addChild(parentId: string) {
    const p = map.cards[parentId];
    if (!p) return;
    const id = newId();
    const y = p.children.reduce((m, c) => Math.max(m, (map.cards[c]?.y ?? 0) + (map.cards[c]?.h ?? 0) + 10), 0);
    if (await send({ type: 'add', card: { id, kind: 'card', title: '', text: '', x: 0, y, w: 180, h: 100, color: null, parent: parentId, owner: null } })) {
      setSel(id);
      startEdit(id, '');
    }
  }

  function startEdit(id: string, text: string) {
    if (!canEdit) return;
    setEdit(id);
    setDraft(text);
  }

  async function commit() {
    const id = edit;
    setEdit(null);
    wrap.current?.focus({ preventScroll: true });
    if (!id || !map.cards[id]) return;
    // Leer gelassene neue Idee verschwindet wieder
    if (!draft.trim() && !map.cards[id].title && map.cards[id].kind === 'card' && !map.cards[id].text) {
      await send({ type: 'remove', ids: [id] });
      return;
    }
    if (map.cards[id].title === draft.trim()) return;
    await send({ type: 'update', id, patch: { title: draft.trim().slice(0, 200) } });
  }

  async function remove(id: string) {
    const c = map.cards[id];
    if (!c) return;
    const ids = c.kind === 'cluster' ? [id, ...c.children] : [id];
    if (ids.length > 1 && !confirm(`Ast „${c.title || 'Ohne Titel'}“ mit ${c.children.length} Unterästen löschen?`)) return;
    if (await send({ type: 'remove', ids })) setSel(null);
  }

  function onKey(e: React.KeyboardEvent) {
    if (edit || !selected || !canEdit) return;
    if (e.key === 'Tab') {
      e.preventDefault();
      void addUnder(selected.id);
    } else if (e.key === 'Enter' || e.key === 'F2') {
      e.preventDefault();
      startEdit(selected.id, selected.title);
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      if (pick) return void removePick();
      void remove(selected.id);
    } else if (e.key === 'Escape' && pick) setPick(null);
  }

  /** Nur den angetippten Punkt entfernen: Stopp weg, Bézier-Griff wieder automatisch, Ansatz wieder automatisch */
  async function removePick() {
    const c = selected;
    const p = pick;
    if (!c || !p) return;
    setPick(null);
    const via = c.via ?? [];
    if (p.kind === 'start') await send({ type: 'update', id: c.id, patch: { start: null, fork: null } });
    else if (p.kind === 'hand' && via[p.i]) await send({ type: 'update', id: c.id, patch: { via: via.map((v, j): MapVia => (j === p.i ? [v[0], v[1]] : v)) } });
    else if (p.kind === 'via' && via[p.i]) {
      if (await send({ type: 'update', id: c.id, patch: { via: via.filter((_, j) => j !== p.i) } })) await shiftForks(c.id, p.i, -1);
    }
  }

  /** Koordinaten in der Mindmap aus einem Zeiger-Ereignis */
  const toStage = (e: { clientX: number; clientY: number }): V => {
    const r = wrap.current!.getBoundingClientRect();
    return [(e.clientX - r.left - cam.x) / cam.k, (e.clientY - r.top - cam.y) / cam.k];
  };

  // Linien je Ast: Ansatz (automatisch, von Hand oder als Abzweigung), Zwischenstopps, Ziel
  const byId = new Map(nodes.map((n) => [n.card.id, n]));
  /** führt die Kette der Abzweigungen von n zurück zu id? (dann wäre es ein Kreis) */
  const forksFrom = (n: Node, id: string): boolean => {
    let f = n.card.fork?.from;
    for (let guard = 0; f && guard < 50; guard++) {
      if (f === id) return true;
      f = byId.get(f)?.card.fork?.from;
    }
    return false;
  };
  /** Zwischenstopp eines Geschwister-Asts in der Nähe (beim Ziehen des Ansatzes): dort abzweigen */
  const snapFork = (n: Node, [x, y]: V): MapFork | null => {
    for (const o of nodes) {
      if (o === n || o.parentId !== n.parentId || o.card.id === n.card.id || forksFrom(o, n.card.id)) continue;
      const i = (o.card.via ?? []).findIndex((v) => Math.hypot(v[0] - x, v[1] - y) < 18 / cam.k);
      if (i >= 0) return { from: o.card.id, i };
    }
    return null;
  };
  const memo = new Map<string, Geo>();
  const busy = new Set<string>();
  const geoOf = (n: Node): Geo => {
    const done = memo.get(n.card.id);
    if (done) return done;
    busy.add(n.card.id);
    const parent = n.parentId ? (byId.get(n.parentId) ?? null) : null;
    const me = pos(n);
    const pp = parent ? pos(parent) : { x: 0, y: 0 };
    const sz = (id: string, d: [number, number]) => sizes[id] ?? d;
    const [pw, ph] = sz(parent ? parent.card.id : '__root', [160, 48]);
    const [cw, ch] = sz(n.card.id, [120, 32]);
    const from: Box = { x: pp.x, y: pp.y, w: pw, h: ph };
    const to: Box = { x: me.x, y: me.y, w: cw, h: ch };
    const h = hd && hd.id === n.card.id ? hd : null;
    const via: V[] = (n.card.via ?? []).map((v, i) => (h && h.kind === 'via' && h.i === i ? [h.x, h.y] : [v[0], v[1]]));
    const hs: (V | null)[] = (n.card.via ?? []).map((v, i) => (h && h.kind === 'hand' && h.i === i ? [h.x - via[i][0], h.y - via[i][1]] : v.length === 4 ? [v[2], v[3]] : null));
    const first = via[0] ?? [me.x, me.y];
    const last = via[via.length - 1] ?? [pp.x, pp.y];
    const kind = n.card.route ?? (n.idea ? 'curve' : 'metro');
    const bend = n.card.bend ?? 0.5;
    // Abzweigung: beim Ziehen des Ansatzes rastet er an Stopps der Geschwister-Äste ein
    const wantFork = h && h.kind === 'start' ? snapFork(n, [h.x, h.y]) : (n.card.fork ?? null);
    const trunkNode = wantFork ? byId.get(wantFork.from) : undefined;
    const trunk = wantFork && trunkNode && trunkNode !== n && trunkNode.parentId === n.parentId && !busy.has(trunkNode.card.id) ? geoOf(trunkNode) : null;
    const fork = trunk && wantFork && trunk.via.length > wantFork.i ? wantFork : null;
    let a: { p: V; dir: V };
    if (fork && trunk) {
      const p = trunk.via[fork.i];
      const tv: V = [first[0] - p[0], first[1] - p[1]];
      let dir: V = axis(tv);
      if (trunk.kind === 'curve' && kind !== 'metro' && kind !== 'ortho') {
        // tangential aus der Kurve heraus, in die Richtung, in der das Ziel liegt
        const t = trunk.hv[fork.i];
        const l = Math.hypot(t[0], t[1]) || 1;
        const sg = t[0] * tv[0] + t[1] * tv[1] >= 0 ? 1 : -1;
        dir = [(sg * t[0]) / l, (sg * t[1]) / l];
      }
      a = { p, dir };
    } else {
      const start = h && h.kind === 'start' ? anchorFrom(from, [h.x, h.y]) : n.card.start;
      a = start ? anchorAt(from, start) : port(from, first[0], first[1], pointy(parent?.card ?? null, false));
    }
    const z = port(to, last[0], last[1], pointy(n.card, n.idea));
    const w = LINE;
    const tip: V = z.p;
    const stop: V = [tip[0] + z.dir[0] * w * TIP, tip[1] + z.dir[1] * w * TIP];
    const d = route(kind, bend, a.p, a.dir, via, stop, z.dir, hs);
    const hv = kind === 'curve' ? handles(a.p, a.dir, via, endOf(stop, z.dir), z.dir, bend, hs) : [];
    // Farbe: eigene Wahl, sonst bei jeder Abzweigung leicht abgewandelt
    let color = n.color;
    if (!n.card.color) {
      if (fork && trunk) color = shade(trunk.color, nodes.filter((o) => o.parentId === n.parentId && o.card.fork?.from === fork.from).indexOf(n) + 1);
      else if (parent) color = shade(geoOf(parent).color, nodes.filter((o) => o.parentId === parent.card.id).indexOf(n) + 1);
    }
    const g: Geo = { n, from, a, z, via, hv, tip, w, d, kind, fork, color };
    busy.delete(n.card.id);
    memo.set(n.card.id, g);
    return g;
  };
  const geo = nodes.map(geoOf);
  const colorOf = (id: string) => memo.get(id)?.color ?? byId.get(id)?.color ?? IDEA;

  const selGeo = sel ? geo.find((g) => g.n.card.id === sel) ?? null : null;

  /** Zwischenstopp dort einfügen, wo geklickt wurde (zwischen den nächsten beiden Punkten) */
  async function addVia(g: Geo, at: V) {
    const pts: V[] = [g.a.p, ...g.via, g.z.p];
    let best = 0;
    for (let i = 1; i < pts.length - 1; i++) if (segDist(at, pts[i], pts[i + 1]) < segDist(at, pts[best], pts[best + 1])) best = i;
    const via = [...(g.n.card.via ?? [])];
    if (via.length >= 12) return;
    via.splice(best, 0, [snap(at[0]), snap(at[1])] as MapVia);
    setSel(g.n.card.id);
    if (await send({ type: 'update', id: g.n.card.id, patch: { via } })) await shiftForks(g.n.card.id, best, 1);
  }

  /** Abzweigungen an einem Ast nachführen, wenn dort ein Stopp eingefügt (+1) oder entfernt (-1, null: alle) wird */
  async function shiftForks(id: string, at: number | null, delta: 1 | -1) {
    for (const o of nodes) {
      const f = o.card.fork;
      if (!f || f.from !== id) continue;
      if (at === null || (delta < 0 && f.i === at)) await send({ type: 'update', id: o.card.id, patch: { fork: null } }, true);
      else if (f.i > at || (delta > 0 && f.i === at)) await send({ type: 'update', id: o.card.id, patch: { fork: { from: id, i: f.i + delta } } }, true);
    }
  }

  /** Griffe für Ansatz, Zwischenstopps und Bézier-Griffe (sg: welcher der beiden gespiegelten Griffe) */
  const handleDrag = (g: Geo, kind: 'start' | 'via' | 'hand', i: number, sg = 1) => {
    // beim Bézier-Griff wird der vordere Griff gespeichert; der hintere zieht gespiegelt mit
    const at = (e: React.PointerEvent): [number, number] => {
      const [x, y] = toStage(e);
      if (kind === 'via') return [snap(x), snap(y)];
      if (kind === 'hand') return [g.via[i][0] + sg * (x - g.via[i][0]), g.via[i][1] + sg * (y - g.via[i][1])];
      return [x, y];
    };
    return {
      onPointerDown: (e: React.PointerEvent) => {
        e.stopPropagation();
        const [x, y] = at(e);
        setHd({ id: g.n.card.id, kind, i, x, y });
        setPick({ kind, i });
        wrap.current?.focus({ preventScroll: true });
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      },
      onPointerMove: (e: React.PointerEvent) => {
        if (!hd) return;
        const [x, y] = at(e);
        if (!hd.moved && Math.hypot(x - hd.x, y - hd.y) < 2) return;
        setHd({ ...hd, x, y, moved: true });
      },
      onPointerUp: () => {
        const h = hd;
        if (!h) return;
        // nur angetippt (zum Auswählen für Entf): nichts speichern
        if (!h.moved) return setHd(null);
        const c = g.n.card;
        const r = Math.round;
        const patch =
          h.kind === 'start'
            ? (() => {
                const f = snapFork(g.n, [h.x, h.y]);
                return f ? { fork: f, start: null } : { start: anchorFrom(g.from, [h.x, h.y]), fork: null };
              })()
            : { via: (c.via ?? []).map((v, j): MapVia => (j !== h.i ? v : h.kind === 'via' ? (v.length === 4 ? [h.x, h.y, v[2], v[3]] : [h.x, h.y]) : [v[0], v[1], r(h.x - v[0]), r(h.y - v[1])])) };
        void send({ type: 'update', id: c.id, patch }).then(() => setHd(null));
      },
    };
  };

  /** nur zum Sammeln: selbst markiert oder im markierten Hauptast */
  const collected = (c: MapCard) => !!c.collect || (!!c.parent && !!map.cards[c.parent]?.collect);

  const label = (n: Node) => {
    const c = n.card;
    const shape = c.shape ?? (n.idea ? 'none' : 'rect');
    const p = pos(n);
    const owner = c.owner != null ? people.find((p) => p.id === c.owner)?.name : null;
    const text = c.title || (n.depth === 1 && !n.idea ? 'Ohne Titel' : '…');
    const isSel = sel === c.id;
    // Text sitzt am Ende des Asts, nach außen ausgerichtet
    const style: React.CSSProperties = {
      left: p.x,
      top: p.y,
      ['--c' as string]: colorOf(c.id),
      transform: 'translate(-50%, -50%)',
    };
    return (
      <div
        key={c.id}
        className={`${b.node} ${b['s_' + shape]} ${n.depth === 1 && !n.idea ? b.main : b.sub} ${n.idea ? b.idea : ''} ${isSel ? b.sel : ''} ${n.side === -1 ? b.left : ''} ${collected(c) ? b.collect : ''}`}
        title={collected(c) ? 'Nur zum Sammeln: kommt nicht in die Gliederung' : undefined}
        style={style}
        data-node={c.id}
        onPointerDown={(e) => {
          e.stopPropagation();
          // Plus-Knopf im Knoten: nicht einfangen, sonst landet sein Klick beim Knoten statt beim Knopf
          if (!canEdit || edit === c.id || (e.target as HTMLElement).closest('button')) return;
          drag.current = { id: c.id, sx: e.clientX, sy: e.clientY, x: p.x, y: p.y, moved: false };
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d || d.id !== c.id) return;
          const mx = (e.clientX - d.sx) / cam.k;
          const my = (e.clientY - d.sy) / cam.k;
          if (!d.moved && Math.hypot(mx, my) < 4) return;
          d.moved = true;
          setDragPos({ id: c.id, x: d.x + mx, y: d.y + my });
        }}
        onPointerUp={() => {
          const d = drag.current;
          drag.current = null;
          if (d?.moved && dragPos) void send({ type: 'update', id: c.id, patch: { bx: Math.round(dragPos.x), by: Math.round(dragPos.y) } }).then(() => setDragPos(null));
          else setDragPos(null);
        }}
        onClick={() => (setSel(c.id), wrap.current?.focus({ preventScroll: true }))}
        onDoubleClick={() => startEdit(c.id, c.title)}
      >
        {edit === c.id ? (
          <input
            className={b.input}
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              if (e.key === 'Escape') setEdit(null);
              e.stopPropagation();
            }}
            placeholder={n.depth === 1 && !n.idea ? 'Abschnitt' : 'Idee'}
          />
        ) : (
          <span className={b.text}>{text}</span>
        )}
        {owner && <span className={b.owner}>{owner}</span>}
        {isSel && canEdit && edit !== c.id && (
          <button className={b.plus} title="Idee hier anhängen (Tab)" onClick={(e) => (e.stopPropagation(), void addUnder(c.id))}>
            +
          </button>
        )}
      </div>
    );
  };

  return (
    <div
      ref={wrap}
      className={b.wrap}
      tabIndex={0}
      onKeyDown={onKey}
      // Der Browser scrollt die Fläche beim Fokussieren sonst still mit (overflow: hidden); dann säßen Griffe und
      // Zeiger versetzt. Die Fläche bewegt sich nur über die Kamera.
      onDragOver={(e) => {
        if (!canEdit || !isChatDrag(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }}
      onDrop={(e) => void dropChat(e)}
      onScroll={(e) => {
        e.currentTarget.scrollTop = 0;
        e.currentTarget.scrollLeft = 0;
      }}
      onPointerDown={(e) => {
        setSel(null);
        pan.current = { sx: e.clientX, sy: e.clientY, x: cam.x, y: cam.y };
        (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
      }}
      onPointerMove={(e) => {
        const p = pan.current;
        if (p) setCam((c) => ({ ...c, x: p.x + e.clientX - p.sx, y: p.y + e.clientY - p.sy }));
      }}
      onPointerUp={() => (pan.current = null)}
      onWheel={(e) => {
        const r = wrap.current!.getBoundingClientRect();
        const mx = e.clientX - r.left;
        const my = e.clientY - r.top;
        setCam((c) => {
          const k = Math.min(2.5, Math.max(0.25, c.k * Math.exp(-e.deltaY * 0.0015)));
          return { k, x: mx - ((mx - c.x) * k) / c.k, y: my - ((my - c.y) * k) / c.k };
        });
      }}
    >
      <div ref={stage} className={b.stage} style={{ transform: `translate(${cam.x}px, ${cam.y}px) scale(${cam.k})` }}>
        <svg className={b.svg} width="1" height="1" overflow="visible" aria-hidden="true">
          {geo.map((g) => (
            <g key={g.n.card.id} style={{ color: g.color }}>
              <path d={g.d} fill="none" stroke="currentColor" strokeWidth={g.w} strokeLinecap="butt" strokeLinejoin="round" opacity={g.n.idea ? 0.75 : 1} />
              <path d={arrow(g.tip[0], g.tip[1], [-g.z.dir[0], -g.z.dir[1]], g.w)} fill="currentColor" opacity={g.n.idea ? 0.75 : 1} />
              {sel === g.n.card.id && canEdit && g.hv.map((h, i) => (
                <line key={i} className={b.tangent} x1={g.via[i][0] - h[0]} y1={g.via[i][1] - h[1]} x2={g.via[i][0] + h[0]} y2={g.via[i][1] + h[1]} />
              ))}
              {/* breiter unsichtbarer Streifen: Ast anklicken wählt ihn, Doppelklick setzt einen Zwischenstopp */}
              <path
                className={b.hit}
                d={g.d}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => (setSel(g.n.card.id), setPick(null), wrap.current?.focus({ preventScroll: true }))}
                onDoubleClick={(e) => canEdit && void addVia(g, toStage(e))}
              >
                <title>{canEdit ? 'Doppelklick: Zwischenstopp setzen' : ''}</title>
              </path>
            </g>
          ))}
        </svg>
        <div className={b.root} data-node="__root" onPointerDown={(e) => e.stopPropagation()}>
          <span>{topic}</span>
          {canEdit && (
            <button className={b.plus} title="Neue Idee (Tab)" onClick={addIdea}>
              +
            </button>
          )}
        </div>
        {nodes.map(label)}
        {selGeo && canEdit && (
          <>
            {/* Stopps der Geschwister-Äste: hierhin den Ansatz ziehen, um abzuzweigen */}
            {geo
              .filter((o) => o !== selGeo && o.n.parentId === selGeo.n.parentId && !forksFrom(o.n, selGeo.n.card.id))
              .flatMap((o) => o.via.map((v, i) => <div key={`t${o.n.card.id}${i}`} className={`${b.target} ${hd?.kind === 'start' && selGeo.fork?.from === o.n.card.id && selGeo.fork.i === i ? b.on : ''}`} style={{ left: v[0], top: v[1], ['--c' as string]: o.color }} />))}
            <div
              className={`${b.handle} ${b.start} ${selGeo.fork ? b.forked : ''} ${pick?.kind === 'start' ? b.picked : ''}`}
              style={{ left: selGeo.a.p[0], top: selGeo.a.p[1], ['--c' as string]: selGeo.color }}
              title="Ansatz verschieben; auf einen Stopp eines anderen Asts ziehen: dort abzweigen (Doppelklick: wieder automatisch)"
              {...handleDrag(selGeo, 'start', -1)}
              onDoubleClick={() => void send({ type: 'update', id: selGeo.n.card.id, patch: { start: null, fork: null } })}
            />
            {selGeo.via.map((v, i) => (
              <div
                key={i}
                className={`${b.handle} ${b.stop} ${pick?.kind === 'via' && pick.i === i ? b.picked : ''}`}
                style={{ left: v[0], top: v[1], ['--c' as string]: selGeo.color }}
                title="Zwischenstopp ziehen (antippen und Entf oder Doppelklick: entfernen)"
                {...handleDrag(selGeo, 'via', i)}
                onDoubleClick={() => void send({ type: 'update', id: selGeo.n.card.id, patch: { via: selGeo.n.card.via!.filter((_, j) => j !== i) } }).then((ok) => void (ok && shiftForks(selGeo.n.card.id, i, -1)))}
              />
            ))}
            {selGeo.hv.flatMap((h, i) =>
              [1, -1].map((sg) => (
                <div
                  key={`h${i}${sg}`}
                  className={`${b.handle} ${b.hand} ${pick?.kind === 'hand' && pick.i === i ? b.picked : ''}`}
                  style={{ left: selGeo.via[i][0] + sg * h[0], top: selGeo.via[i][1] + sg * h[1], ['--c' as string]: selGeo.color }}
                  title="Bézier-Griff: Richtung und Schwung der Kurve (antippen und Entf oder Doppelklick: wieder automatisch)"
                  {...handleDrag(selGeo, 'hand', i, sg)}
                  onDoubleClick={() => void send({ type: 'update', id: selGeo.n.card.id, patch: { via: selGeo.n.card.via!.map((v, j): MapVia => (j === i ? [v[0], v[1]] : v)) } })}
                />
              )),
            )}
          </>
        )}
      </div>

      {canEdit && (
        <div className={b.adders} onPointerDown={(e) => e.stopPropagation()}>
          <button className="btn" onClick={addIdea} title="Lockere Idee am Thema (Tab)">
            + Idee
          </button>
          <button className="btn" onClick={addMain} title="Hauptast: wird ein Abschnitt der Gliederung">
            + Abschnitt
          </button>
        </div>
      )}
      {selected && canEdit && (
        <div className={b.bar} onPointerDown={(e) => e.stopPropagation()}>
          <span className={b.barTitle}>{selected.title || 'Ohne Titel'}</span>
          <select value={selected.shape ?? (selected.kind === 'card' && !selected.parent ? 'none' : 'rect')} onChange={(e) => void send({ type: 'update', id: selected.id, patch: { shape: e.target.value as MapShape } })} title="Form">
            {SHAPES.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
          <select value={selected.route ?? (selected.kind === 'card' && !selected.parent ? 'curve' : 'metro')} onChange={(e) => void send({ type: 'update', id: selected.id, patch: { route: e.target.value as MapRoute } })} title="Linie">
            {ROUTES.map((r) => (
              <option key={r.key} value={r.key}>
                {r.label}
              </option>
            ))}
          </select>
          {(selected.route ?? 'metro') !== 'straight' && (
            <label className={b.bend} title="Wo die Linie abknickt">
              Knick
              <input type="range" min={0} max={100} defaultValue={Math.round((selected.bend ?? 0.5) * 100)} key={selected.id + (selected.bend ?? '')} onPointerUp={(e) => void send({ type: 'update', id: selected.id, patch: { bend: Number(e.currentTarget.value) / 100 } })} onKeyUp={(e) => void send({ type: 'update', id: selected.id, patch: { bend: Number(e.currentTarget.value) / 100 } })} />
            </label>
          )}
          {selected.bx != null && (
            <button className="btn" onClick={() => void send({ type: 'update', id: selected.id, patch: { bx: null, by: null } })} title="Wieder automatisch anordnen">
              Lage automatisch
            </button>
          )}
          {selGeo && (
            <button
              className="btn"
              disabled={(selected.via?.length ?? 0) >= 12}
              title="Zwischenstopp auf dem Ast setzen (auch per Doppelklick auf die Linie), dann ziehen"
              onClick={() => {
                const pts: V[] = [selGeo.a.p, ...selGeo.via, selGeo.z.p];
                const [p, q] = [pts[pts.length - 2], pts[pts.length - 1]];
                void addVia(selGeo, [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2]);
              }}
            >
              + Stopp
            </button>
          )}
          {((selected.via?.length ?? 0) > 0 || selected.start || selected.fork) && (
            <button className="btn" onClick={() => void send({ type: 'update', id: selected.id, patch: { via: [], start: null, fork: null } }).then((ok) => void (ok && shiftForks(selected.id, null, -1)))} title="Zwischenstopps und Abzweigung entfernen, Ansatz wieder automatisch">
              Linie zurücksetzen
            </button>
          )}
          <span className={b.colors}>
            {COLUMN_COLORS.map((c) => (
              <button key={c} className={b.swatch} style={{ background: c }} title="Farbe des Asts" onClick={() => void send({ type: 'update', id: selected.id, patch: { color: c } })} />
            ))}
            {selected.color && selected.kind === 'card' && (
              <button className={`${b.swatch} ${b.auto}`} title="Farbe automatisch: leicht abgewandelt vom Ast davor" onClick={() => void send({ type: 'update', id: selected.id, patch: { color: null } })}>
                A
              </button>
            )}
          </span>
          {selected.kind === 'card' && !selected.parent && (
            <>
              <button className="btn primary" onClick={() => void promote(selected.id)} title="Wird ein Abschnitt der Gliederung">
                Als Abschnitt
              </button>
              {mains.length > 0 && (
                <select value="" onChange={(e) => e.target.value && void attach(selected.id, e.target.value)} title="An einen Abschnitt hängen">
                  <option value="">Hängen an …</option>
                  {mains.map((m) => (
                    <option key={m.card.id} value={m.card.id}>
                      {m.card.title || 'Ohne Titel'}
                    </option>
                  ))}
                </select>
              )}
            </>
          )}
          {selected.kind === 'card' && selected.parent && (
            <select value={selected.parent} onChange={(e) => void (e.target.value === '_' ? send({ type: 'move', id: selected.id, x: 0, y: 0, parent: null }) : attach(selected.id, e.target.value))} title="Verschieben">
              {mains.map((m) => (
                <option key={m.card.id} value={m.card.id}>
                  an {m.card.title || 'Ohne Titel'}
                </option>
              ))}
              <option value="_">lösen (lockere Idee)</option>
            </select>
          )}
          {selected.kind === 'card' && (
            <select value={selected.owner ?? ''} onChange={(e) => void send({ type: 'update', id: selected.id, patch: { owner: e.target.value ? Number(e.target.value) : null } })} title="Wer schreibt dazu?">
              <option value="">niemand zuständig</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          )}
          {(selected.kind === 'cluster' || selected.parent) && (
            <button
              className={`btn ${selected.collect ? 'on' : ''}`}
              aria-pressed={!!selected.collect}
              onClick={() => void send({ type: 'update', id: selected.id, patch: { collect: !selected.collect } })}
              title={selected.kind === 'cluster' ? 'Ast nur zum Sammeln: wird kein Abschnitt der Gliederung' : 'Karte nur zum Sammeln: wird kein Textabschnitt'}
            >
              Nur sammeln
            </button>
          )}
          <button className="btn" onClick={() => startEdit(selected.id, selected.title)}>
            <Icon name="pen" size={14} /> Umbenennen
          </button>
          <button className="btn" onClick={() => void addUnder(selected.id)} title="Neue Idee an diesem Knoten (Tab)">
            + Unterast
          </button>
          <button className="btn icon" onClick={() => void remove(selected.id)} title="Löschen">
            <Icon name="close" size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
