'use client';
/**
 * Mindmap der Phase „Orientierung“, Gestaltung nach brausa (ProjectMap.svelte): gepunktete Fläche, Karten mit
 * farbiger Kopfleiste und Markdown-Text, Cluster als Rahmenkarten, Pfeile über den Punkt am rechten Rand,
 * Ziehen zum Verschieben (in einen Cluster hinein oder heraus), Größe unten rechts, Mausrad zoomt.
 *
 * Vereinfacht gegenüber brausa: Cluster sind eine Ebene tief und werden nicht verkleinert dargestellt.
 * Der Server ist maßgeblich; die Ansicht schickt Operationen und zeigt den verteilten Stand.
 *
 * Wünsche von Jo vom 20. November 2026: neobrutalistisch (kräftiger Rand, sichtbare Schatten, Ebenen durch Schatten),
 * Farben wie die Äste der Ast-Ansicht, Text direkt in der Karte schreiben (oben unter dem Titel), darunter liegen Karten
 * in der Karte (`under`), die mit ihr wandern und sich von oben nach unten sortieren; Text je Karte oder für die ganze
 * Mindmap ausblenden.
 *
 * Wunsch von Jo vom 21. November 2026 (Konzept 8h.9): eine Karte, die im Cluster direkt unter den Rand gezogen wird,
 * dockt an eine Linie oben im Cluster an (`docked`). Die Punkte stehen dort in voller Breite untereinander, sind
 * zugeklappt (nur Titelleiste) und klappen mit einem Klick auf die Titelleiste auf; ein Klick auf den Anschlusspunkt
 * löst sie wieder.
 *
 * Jo, 22. November 2026 (Konzept 8h.10): Die Linie läuft am linken Rand des Clusters, die Anschlusspunkte sitzen auf dem
 * Rand. Oben links in der Ecke steht ein weißer Startkreis: darauf gezogen wird eine Karte der erste Punkt. Auf die
 * Linie gezogen wird sie an dieser Stelle zwischen die Punkte gesetzt.
 */
import { cardFromChat, isChatDrag, readChatDrop } from '@/lib/chatDrag';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { usePasteRules } from '@/lib/pasteRules';
import { branchColors, underOf, type LineHook } from './BranchMap';
import { Icon } from './Icon';
import { COLUMN_COLORS } from '@/lib/colors';
import { renderMarkdown } from '@/lib/markdown';
import { CardEditor } from './CardEditor';
import { isDimmed, isPicked, pickOps, type MapCard, type MapDim, type MapOp, type MindMap as MapData } from '@/lib/types';
import m from './mindmap.module.css';

export const HEADER = 30;
export const PAD = 10;
const CARD = { w: 180, h: 100 };
const CLUSTER = { w: 340, h: 230 };

export interface Person {
  id: number;
  name: string;
}

interface Cam {
  x: number;
  y: number;
  k: number;
}
interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

type Gesture =
  | { kind: 'pan'; sx: number; sy: number; cam: Cam; moved: boolean }
  | { kind: 'pinch'; d: number; mx: number; my: number; cam: Cam }
  | { kind: 'move'; id: string; sx: number; sy: number; dx: number; dy: number; moved: boolean; over: string | null; x0: number; y0: number; head: boolean }
  | { kind: 'resize'; id: string; sx: number; sy: number; w: number; h: number; nw: number; nh: number }
  | { kind: 'wire'; from: string; x: number; y: number; to: string | null };

const newId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');

/** Absolute Lage einer Karte (Karten im Cluster zählen ab dem Cluster-Inhalt). */
export function absRect(map: MapData, id: string): Rect {
  const c = map.cards[id];
  const p = c.parent ? map.cards[c.parent] : null;
  return p ? { x: p.x + PAD + c.x, y: p.y + HEADER + c.y, w: c.w, h: c.h } : { x: c.x, y: c.y, w: c.w, h: c.h };
}

/** Schnittpunkt der Linie vom Mittelpunkt zu (tx, ty) mit dem Rand (wie edgePoint in brausa). */
function edgePoint(r: Rect, tx: number, ty: number) {
  const cx = r.x + r.w / 2,
    cy = r.y + r.h / 2;
  const dx = tx - cx,
    dy = ty - cy;
  if (!dx && !dy) return { x: cx, y: cy };
  const s = Math.min(Math.abs(r.w / 2 / (dx || 1e-9)), Math.abs(r.h / 2 / (dy || 1e-9)));
  return { x: cx + dx * s, y: cy + dy * s };
}

/** Sofortige Anzeige einer Verschiebung, bis der Server den neuen Stand schickt. */
function localMove(map: MapData, id: string, x: number, y: number, parent: string | null): MapData {
  const next: MapData = { ...map, cards: { ...map.cards }, roots: map.roots.filter((r) => r !== id) };
  const c = { ...map.cards[id], x, y, parent };
  if (map.cards[id].parent) {
    const old = map.cards[map.cards[id].parent!];
    next.cards[old.id] = { ...old, children: old.children.filter((ch) => ch !== id) };
  }
  next.cards[id] = c;
  if (parent) {
    const p = next.cards[parent];
    next.cards[parent] = { ...p, children: [...p.children, id], w: Math.max(p.w, x + c.w + 2 * PAD), h: Math.max(p.h, HEADER + y + c.h + PAD) };
  } else next.roots.push(id);
  return next;
}

export function MindMap({
  map,
  people,
  canEdit,
  send,
  dim = 'none',
  onToGroup,
  line,
}: {
  map: MapData;
  people: Person[];
  canEdit: boolean;
  send: (op: MapOp, join?: boolean) => Promise<boolean>;
  dim?: MapDim;
  /** Themen-Mindmap, Lehrkraft: aus einer Idee eine Gruppe machen */
  onToGroup?: (title: string) => void;
  /** Gliederung daneben (Konzept 8h) */
  line?: LineHook;
}) {
  const el = useRef<HTMLDivElement>(null);
  const [cam, setCam] = useState<Cam>({ x: 40, y: 40, k: 1 });
  const [sel, setSel] = useState<string | null>(null);
  const [selLink, setSelLink] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [g, setG] = useState<Gesture | null>(null);
  const [shown, setShown] = useState<MapData>(map);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const fitted = useRef(false);
  const rules = usePasteRules();
  // direkt in der Karte schreiben: Titel oder Text
  const [inline, setInline] = useState<{ id: string; field: 'title' | 'text' } | null>(null);
  const [draft, setDraft] = useState('');
  // Text für die ganze Mindmap ausblenden (je Gerät)
  const [hideAll, setHideAll] = useState(false);
  // bei „Text aus“ einzelne Texte wieder zeigen, ohne die Einstellung für alle zu ändern (nur hier, nicht gespeichert)
  const [textOn, setTextOn] = useState<Set<string>>(new Set());
  useEffect(() => {
    try {
      setHideAll(localStorage.getItem('collegare-karten-ohne-text') === '1');
    } catch {}
  }, []);
  const toggleHideAll = () =>
    setHideAll((h) => {
      try {
        localStorage.setItem('collegare-karten-ohne-text', h ? '0' : '1');
      } catch {}
      setTextOn(new Set());
      return !h;
    });
  const colors = useMemo(() => branchColors(shown), [shown]);
  /** Karten in Karten: je Karte die darin liegenden, von oben nach unten */
  const nest = useMemo(() => {
    const out = new Map<string, MapCard[]>();
    for (const c of Object.values(shown.cards)) {
      const u = underOf(shown, c);
      if (u) out.set(u, [...(out.get(u) ?? []), c]);
    }
    for (const l of out.values()) l.sort((a, b) => a.y - b.y || a.x - b.x);
    return out;
  }, [shown]);
  const nested = (c: MapCard) => !!underOf(shown, c);
  /** angedockte Punkte eines Clusters (Linie oben), von oben nach unten */
  const docks = useMemo(() => {
    const out = new Map<string, MapCard[]>();
    for (const k of Object.values(shown.cards)) {
      if (k.kind !== 'cluster') continue;
      const l = k.children.map((id) => shown.cards[id]).filter((c) => c && c.kind === 'card' && c.docked && !underOf(shown, c));
      if (l.length) out.set(k.id, l.sort((a, b) => a.y - b.y || a.x - b.x));
    }
    return out;
  }, [shown]);
  const isDocked = (c: MapCard) => !!c.docked && !!c.parent && c.kind === 'card' && !underOf(shown, c);
  // aufgeklappte Punkte an der Linie (je Gerät, nicht gespeichert); zugeklappt ist der Normalfall
  const [openDock, setOpenDock] = useState<Set<string>>(new Set());
  const toggleDock = (id: string) =>
    setOpenDock((s0) => {
      const n = new Set(s0);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  // Höhe der Linie oben im Cluster: die übrigen Karten beginnen darunter
  const [dockH, setDockH] = useState<Record<string, number>>({});
  const [dockEnd, setDockEnd] = useState<Record<string, number>>({});
  // Ziel beim Ziehen: Startkreis oder Linie eines Clusters (zum Hervorheben)
  const [dockOver, setDockOver] = useState<string | null>(null);
  useLayoutEffect(() => {
    const next: Record<string, number> = {};
    const ends: Record<string, number> = {};
    el.current?.querySelectorAll<HTMLElement>('[data-dock]').forEach((n) => {
      next[n.dataset.dock!] = n.offsetHeight + 10;
      // die Linie endet am letzten Anschlusspunkt
      const ports = n.querySelectorAll<HTMLElement>('[data-port]');
      const last = ports[ports.length - 1];
      if (last) ends[n.dataset.dock!] = (last.parentElement?.offsetTop ?? 0) + last.offsetTop + last.offsetHeight / 2;
    });
    if (Object.keys(next).length !== Object.keys(dockH).length || Object.entries(next).some(([k, v]) => dockH[k] !== v)) setDockH(next);
    if (Object.keys(ends).length !== Object.keys(dockEnd).length || Object.entries(ends).some(([k, v]) => dockEnd[k] !== v)) setDockEnd(ends);
  });
  // Höhe des Texts unter dem Kopf eines Clusters: seine Karten beginnen darunter
  const [ctext, setCtext] = useState<Record<string, number>>({});
  useLayoutEffect(() => {
    const next: Record<string, number> = {};
    el.current?.querySelectorAll<HTMLElement>('[data-ctext]').forEach((n) => (next[n.dataset.ctext!] = n.offsetHeight));
    if (Object.keys(next).length !== Object.keys(ctext).length || Object.entries(next).some(([k, v]) => ctext[k] !== v)) setCtext(next);
  });
  const top = (clusterId: string) => HEADER + (ctext[clusterId] ?? 0) + (dockH[clusterId] ?? 0);
  /** Beginn der Linie oben im Cluster (unter Kopf und Text) */
  const dockTop = (clusterId: string) => HEADER + (ctext[clusterId] ?? 0);
  // gemessene Höhen: Karten wachsen mit Text und darin liegenden Karten; was darunter liegt, rückt nach unten
  const [hts, setHts] = useState<Record<string, number>>({});
  useLayoutEffect(() => {
    const next: Record<string, number> = {};
    el.current?.querySelectorAll<HTMLElement>('[data-card][data-free]').forEach((n) => (next[n.dataset.card!] = n.offsetHeight));
    if (Object.keys(next).length !== Object.keys(hts).length || Object.entries(next).some(([k, v]) => hts[k] !== v)) setHts(next);
  });
  const push = useMemo(() => {
    const off: Record<string, number> = {};
    const lists = [shown.roots, ...Object.values(shown.cards).filter((c) => c.kind === 'cluster').map((c) => c.children)];
    for (const ids of lists) {
      const cs = ids.map((id) => shown.cards[id]).filter((c) => c && c.kind === 'card' && !c.docked && !underOf(shown, c)).sort((a, b) => a.y - b.y);
      for (let i = 0; i < cs.length; i++) {
        const c = cs[i];
        for (let j = 0; j < i; j++) {
          const a = cs[j];
          // nur, wenn sie ohne Wachsen nicht übereinander lägen
          if (a.x >= c.x + c.w || c.x >= a.x + a.w || a.y + a.h > c.y) continue;
          const need = a.y + (off[a.id] ?? 0) + (hts[a.id] ?? a.h) + 10 - c.y;
          if (need > (off[c.id] ?? 0)) off[c.id] = need;
        }
      }
    }
    return off;
  }, [shown, hts]);
  /** Fläche eines Clusters: so groß, dass auch gewachsene Karten hineinpassen */
  const clusterH = (k: MapCard, h: number) => {
    const inner = k.children.map((id) => shown.cards[id]).filter((c) => c && !underOf(shown, c) && !isDocked(c)).reduce((m, c) => Math.max(m, c.y + (push[c.id] ?? 0) + (hts[c.id] ?? c.h)), 0);
    return Math.max(h, HEADER + inner + PAD) + (ctext[k.id] ?? 0) + (dockH[k.id] ?? 0);
  };
  /** Lage in der Welt; Karten in Karten und Cluster mit Text nach dem, was wirklich zu sehen ist */
  const rectAbs = (id: string): Rect => {
    const c = shown.cards[id];
    const dom = el.current?.querySelector<HTMLElement>(`[data-card="${id}"]`);
    if (c && dom && el.current) {
      const r = dom.getBoundingClientRect();
      const b = el.current.getBoundingClientRect();
      return { x: (r.left - b.left - cam.x) / cam.k, y: (r.top - b.top - cam.y) / cam.k, w: r.width / cam.k, h: r.height / cam.k };
    }
    const p = c?.parent ? shown.cards[c.parent] : null;
    const a = absRect(shown, id);
    return p ? { ...a, y: a.y + (ctext[p.id] ?? 0) } : a;
  };

  // neuer Stand vom Server ersetzt die vorläufige Anzeige
  useEffect(() => setShown(map), [map]);
  useEffect(() => {
    if (sel && !map.cards[sel]) setSel(null);
    if (selLink && !map.links.some((l) => l.id === selLink)) setSelLink(null);
    if (editing && !map.cards[editing]) setEditing(null);
  }, [map, sel, selLink, editing]);

  const personName = useMemo(() => new Map(people.map((p) => [p.id, p.name])), [people]);

  const toWorld = useCallback(
    (clientX: number, clientY: number, c: Cam = cam) => {
      const r = el.current!.getBoundingClientRect();
      return { x: (clientX - r.left - c.x) / c.k, y: (clientY - r.top - c.y) / c.k };
    },
    [cam],
  );

  /** Alles sichtbar machen (Taste 0, Knopf „Einpassen“). */
  const fit = useCallback(() => {
    const box = el.current?.getBoundingClientRect();
    if (!box) return;
    const ids = shown.roots;
    if (!ids.length) return setCam({ x: 40, y: 40, k: 1 });
    const rs = ids.map((id) => absRect(shown, id));
    const x0 = Math.min(...rs.map((r) => r.x)),
      y0 = Math.min(...rs.map((r) => r.y));
    const x1 = Math.max(...rs.map((r) => r.x + r.w)),
      y1 = Math.max(...rs.map((r) => r.y + r.h));
    const k = Math.min(1.4, Math.max(0.2, Math.min((box.width - 80) / (x1 - x0), (box.height - 120) / (y1 - y0))));
    setCam({ k, x: (box.width - (x1 - x0) * k) / 2 - x0 * k, y: 70 + (box.height - 120 - (y1 - y0) * k) / 2 - y0 * k });
  }, [shown]);

  useEffect(() => {
    if (!fitted.current && map.roots.length) {
      fitted.current = true;
      fit();
    }
  }, [map, fit]);

  /** Wo eine neue Karte hinkommt: in den Cluster unter dem Punkt oder frei auf die Fläche. */
  function placeAt(wx: number, wy: number, kind: MapCard['kind']) {
    const size = kind === 'cluster' ? CLUSTER : CARD;
    if (kind === 'card') {
      const hit = [...shown.roots].reverse().find((id) => {
        const c = shown.cards[id];
        return c.kind === 'cluster' && wx >= c.x && wx <= c.x + c.w && wy >= c.y + top(c.id) && wy <= c.y + c.h + (ctext[c.id] ?? 0);
      });
      if (hit) {
        const k = shown.cards[hit];
        return { parent: hit, x: Math.max(0, wx - k.x - PAD - size.w / 2), y: Math.max(0, wy - k.y - top(k.id) - 15), ...size };
      }
    }
    return { parent: null, x: wx - size.w / 2, y: wy - 15, ...size };
  }

  async function addAt(wx: number, wy: number, kind: MapCard['kind']) {
    if (!canEdit) return;
    const id = newId();
    const p = placeAt(wx, wy, kind);
    const ok = await send({
      type: 'add',
      card: { id, kind, title: kind === 'cluster' ? 'Neuer Cluster' : '', text: '', color: kind === 'cluster' ? COLUMN_COLORS[3] : null, owner: null, ...p },
    });
    if (ok) {
      setSel(id);
      if (kind === 'card') (setDraft(''), setInline({ id, field: 'title' }));
    }
  }

  function addCenter(kind: MapCard['kind']) {
    const r = el.current!.getBoundingClientRect();
    // leicht versetzt, damit mehrere neue Karten nicht genau übereinander liegen
    const j = (Object.keys(shown.cards).length % 5) * 24;
    const w = toWorld(r.left + r.width / 2 + j, r.top + r.height / 2 + j);
    void addAt(w.x, w.y, kind);
  }

  function remove() {
    if (!canEdit) return;
    if (selLink) {
      void send({ type: 'unlink', id: selLink });
      setSelLink(null);
    } else if (sel) {
      const c = shown.cards[sel];
      if (c.kind === 'cluster' && c.children.length && !confirm(`Cluster „${c.title}“ löschen? Die ${c.children.length} Karten darin bleiben liegen.`)) return;
      void send({ type: 'remove', ids: [sel] });
      setSel(null);
    }
  }

  // ------------------------------------------------------------ Zeiger

  function cardAt(clientX: number, clientY: number, except?: string): string | null {
    for (const n of document.elementsFromPoint(clientX, clientY)) {
      const id = (n as HTMLElement).closest?.('[data-card]')?.getAttribute('data-card');
      if (id && id !== except) return id;
    }
    return null;
  }

  /** liegt b (auch tief) in a? */
  const inside = (a: string, b: string): boolean => {
    let x = shown.cards[b];
    for (let guard = 0; x && guard < 50; guard++) {
      if (x.id === a) return true;
      const u = underOf(shown, x);
      x = u ? shown.cards[u] : (undefined as unknown as MapCard);
    }
    return false;
  };
  /** Startkreis oder Linie eines Clusters unter dem Zeiger (gezogene Karten lassen den Zeiger durch) */
  function dockAt(id: string, clientX: number, clientY: number): { cluster: string; start: boolean } | null {
    if (shown.cards[id]?.kind !== 'card') return null;
    for (const n of document.elementsFromPoint(clientX, clientY)) {
      const h = n as HTMLElement;
      const st = h.closest?.('[data-dock-start]')?.getAttribute('data-dock-start');
      if (st) return { cluster: st, start: true };
      const ln = h.closest?.('[data-dock-line]')?.getAttribute('data-dock-line');
      if (ln) return { cluster: ln, start: false };
      if (h.closest?.('[data-card]')) return null;
    }
    return null;
  }
  /** Stelle an der Linie (Index unter den übrigen Punkten) nach der Zeigerhöhe; first: ganz vorn (Startkreis) */
  function dockOrder(cluster: string, id: string, clientY: number, first = false): number {
    if (first) return 0;
    const list = (docks.get(cluster) ?? []).filter((x) => x.id !== id);
    return list.filter((x) => {
      const r = el.current?.querySelector<HTMLElement>(`[data-card="${x.id}"]`)?.getBoundingClientRect();
      return r ? clientY > r.top + r.height / 2 : true;
    }).length;
  }

  /**
   * Wohin eine gezogene Karte fällt: in eine Karte (dann liegt sie darin), an die obere Kante einer Karte in einer
   * Karte (davor einsortiert), in einen Cluster oder auf die Fläche. Cluster fallen immer auf die Fläche.
   */
  function dropTarget(id: string, clientX: number, clientY: number): { cluster: string | null; card: string | null; before: boolean } {
    const none = { cluster: null, card: null, before: false };
    if (shown.cards[id].kind !== 'card') return none;
    let hit: string | null = null;
    for (const n of document.elementsFromPoint(clientX, clientY)) {
      const cid = (n as HTMLElement).closest?.('[data-card]')?.getAttribute('data-card');
      if (cid && cid !== id && !inside(id, cid)) {
        hit = cid;
        break;
      }
    }
    const u = hit ? shown.cards[hit] : null;
    if (!u) return none;
    if (u.kind === 'cluster') return { cluster: u.id, card: null, before: false };
    const dom = el.current?.querySelector<HTMLElement>(`[data-card="${u.id}"]`);
    const r = dom?.getBoundingClientRect();
    const before = !!r && (nested(u) || isDocked(u)) && clientY - r.top < Math.min(16, r.height * 0.3);
    return { cluster: u.parent, card: u.id, before };
  }
  const dropCluster = (id: string, x: number, y: number) => {
    const t = dropTarget(id, x, y);
    return t.card ?? t.cluster;
  };

  function down(e: React.PointerEvent) {
    if (editing) return;
    const t = e.target as HTMLElement;
    if (t.closest('[data-ui]') || t.closest('input, textarea')) return;
    if (inline) void commitInline();
    el.current!.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      setG({ kind: 'pinch', d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, cam });
      return;
    }
    const handle = t.closest('[data-handle]')?.getAttribute('data-handle');
    const linkId = t.closest('[data-link]')?.getAttribute('data-link');
    const id = t.closest('[data-card]')?.getAttribute('data-card') ?? null;
    if (linkId) {
      setSelLink(linkId);
      setSel(null);
      return;
    }
    setSelLink(null);
    if (!id) {
      setSel(null);
      setG({ kind: 'pan', sx: e.clientX, sy: e.clientY, cam, moved: false });
      return;
    }
    setSel(id);
    if (!canEdit) {
      setG({ kind: 'pan', sx: e.clientX, sy: e.clientY, cam, moved: false });
      return;
    }
    const c = shown.cards[id];
    if (handle === 'resize') setG({ kind: 'resize', id, sx: e.clientX, sy: e.clientY, w: c.w, h: c.h, nw: c.w, nh: c.h });
    else if (handle === 'connect') {
      const w = toWorld(e.clientX, e.clientY);
      setG({ kind: 'wire', from: id, x: w.x, y: w.y, to: null });
    } else {
      // Ausgangslage merken (die Anzeige verschiebt die Karte beim Ziehen per transform)
      const r0 = rectAbs(id);
      const head = t.closest('[data-part]')?.getAttribute('data-part') === 'head' && t.closest('[data-card]')?.getAttribute('data-card') === id;
      setG({ kind: 'move', id, sx: e.clientX, sy: e.clientY, dx: 0, dy: 0, moved: false, over: null, x0: r0.x, y0: r0.y, head });
    }
  }

  function move(e: React.PointerEvent) {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (!g) return;
    if (g.kind === 'pinch' && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const k = Math.min(2.5, Math.max(0.15, (g.cam.k * d) / g.d));
      const r = el.current!.getBoundingClientRect();
      const mx = (a.x + b.x) / 2 - r.left,
        my = (a.y + b.y) / 2 - r.top;
      const ox = g.mx - r.left,
        oy = g.my - r.top;
      setCam({ k, x: mx - ((ox - g.cam.x) / g.cam.k) * k, y: my - ((oy - g.cam.y) / g.cam.k) * k });
    } else if (g.kind === 'pan') {
      const dx = e.clientX - g.sx,
        dy = e.clientY - g.sy;
      if (Math.abs(dx) + Math.abs(dy) > 3 || g.moved) {
        setCam({ ...g.cam, x: g.cam.x + dx, y: g.cam.y + dy });
        if (!g.moved) setG({ ...g, moved: true });
      }
    } else if (g.kind === 'move') {
      const dx = e.clientX - g.sx,
        dy = e.clientY - g.sy;
      const dk = dockAt(g.id, e.clientX, e.clientY);
      const dkKey = dk ? (dk.start ? 'start:' : 'line:') + dk.cluster : null;
      if (dkKey !== dockOver) setDockOver(dkKey);
      setG({ ...g, dx, dy, moved: g.moved || Math.abs(dx) + Math.abs(dy) > 3, over: dk ? null : dropCluster(g.id, e.clientX, e.clientY) });
      line?.hover(e.clientX, e.clientY);
    } else if (g.kind === 'resize') {
      setG({ ...g, nw: Math.max(100, g.w + (e.clientX - g.sx) / cam.k), nh: Math.max(HEADER + 30, g.h + (e.clientY - g.sy) / cam.k) });
    } else if (g.kind === 'wire') {
      const w = toWorld(e.clientX, e.clientY);
      setG({ ...g, x: w.x, y: w.y, to: cardAt(e.clientX, e.clientY, g.from) });
    }
  }

  function up(e: React.PointerEvent) {
    pointers.current.delete(e.pointerId);
    if (!g) return;
    if (g.kind === 'pinch') {
      // zweiter Finger bleibt liegen: ruhig weiter, ohne zu springen
      setG(null);
      return;
    }
    setG(null);
    if (dockOver) setDockOver(null);
    if (g.kind === 'move' && g.moved) {
      line?.hover(null);
      if (line?.drop(g.id, e.clientX, e.clientY)) return;
      void dropMoved(g.id, g.x0 + g.dx / cam.k, g.y0 + g.dy / cam.k, e.clientX, e.clientY);
    } else if (g.kind === 'move' && g.head && shown.cards[g.id] && isDocked(shown.cards[g.id])) {
      // Klick auf die Titelleiste eines Punkts an der Linie: auf- oder zuklappen
      toggleDock(g.id);
    } else if (g.kind === 'resize') {
      void send({ type: 'update', id: g.id, patch: { w: Math.round(g.nw), h: Math.round(g.nh) } });
    } else if (g.kind === 'wire' && g.to) {
      void send({ type: 'link', id: newId(), from: g.from, to: g.to });
    }
  }

  /** Verschieben abschließen: in eine Karte legen, davor einsortieren, in einen Cluster oder frei auf die Fläche */
  async function dropMoved(id: string, nx: number, ny: number, cx: number, cy: number) {
    const c = shown.cards[id];
    const dk = dockAt(id, cx, cy);
    const t = dk ? { cluster: dk.cluster, card: null, before: false } : dropTarget(id, cx, cy);
    // alles, was in der Karte liegt, wandert mit (gleicher Cluster)
    const desc: string[] = [];
    const collect = (k: string) => (nest.get(k) ?? []).forEach((x) => (desc.push(x.id), collect(x.id)));
    collect(id);
    const follow = async (parent: string | null) => {
      for (const d of desc) if (shown.cards[d].parent !== parent) await send({ type: 'move', id: d, x: 0, y: 0, parent }, true);
    };
    if (dk) return dock(id, dk.cluster, dockOrder(dk.cluster, id, cy, dk.start), desc, follow);
    if (t.card && t.before && isDocked(shown.cards[t.card])) {
      // an der Linie vor diesem Punkt einreihen
      const host = shown.cards[t.card];
      const list = (docks.get(host.parent!) ?? []).filter((x) => x.id !== id);
      return dock(id, host.parent!, Math.max(0, list.findIndex((x) => x.id === host.id)), desc, follow);
    }
    if (t.card) {
      const host = shown.cards[t.card];
      const under = t.before ? (host.under ?? null) : host.id;
      const sibs = (under ? (nest.get(under) ?? []) : []).filter((x) => x.id !== id);
      const y = t.before ? host.y - 0.5 : sibs.reduce((m, x) => Math.max(m, x.y), 0) + 1;
      if (c.parent !== host.parent || Math.round(c.y) !== Math.round(y)) {
        if (!(await send({ type: 'move', id, x: 0, y, parent: host.parent }))) return;
        await send({ type: 'update', id, patch: { under, ...(c.docked ? { docked: false } : {}) } }, true);
      } else if (!(await send({ type: 'update', id, patch: { under, ...(c.docked ? { docked: false } : {}) } }))) return;
      await follow(host.parent);
      return;
    }
    let x = nx,
      y = ny;
    if (t.cluster) {
      const k = shown.cards[t.cluster];
      // direkt unter den Rand gezogen: an die Linie oben im Cluster
      const rel = ny - k.y - dockTop(k.id);
      if (c.kind === 'card' && rel < (dockH[k.id] ?? 0) + 18) return dock(id, k.id, dockOrder(k.id, id, cy), desc, follow);
      x = Math.max(0, nx - k.x - PAD);
      y = Math.max(0, ny - k.y - top(k.id));
    }
    x = Math.round(x);
    y = Math.round(y);
    setShown((s) => localMove(s, id, x, y, t.cluster));
    if (!(await send({ type: 'move', id, x, y, parent: t.cluster }))) return;
    if (c.under || c.docked) await send({ type: 'update', id, patch: { ...(c.under ? { under: null } : {}), ...(c.docked ? { docked: false } : {}) } }, true);
    await follow(t.cluster);
  }

  /**
   * an die Linie im Cluster andocken, an Stelle `index`; y ist an der Linie nur die Reihenfolge (0, 10, 20 …) und wird
   * für alle Punkte neu vergeben (der Server rückt negative Lagen zurecht, Zwischenwerte gehen also nicht)
   */
  async function dock(id: string, cluster: string, index: number, desc: string[], follow: (p: string | null) => Promise<void>) {
    const c = shown.cards[id];
    const list = (docks.get(cluster) ?? []).filter((x) => x.id !== id);
    list.splice(Math.min(index, list.length), 0, c);
    const y = list.indexOf(c) * 10;
    setShown((s) => {
      const n = localMove(s, id, 0, y, cluster);
      n.cards[id] = { ...n.cards[id], docked: true, under: null };
      list.forEach((x, i) => x.id !== id && (n.cards[x.id] = { ...n.cards[x.id], y: i * 10 }));
      return n;
    });
    if (!(await send({ type: 'move', id, x: 0, y, parent: cluster }))) return;
    await send({ type: 'update', id, patch: { docked: true, ...(c.under ? { under: null } : {}) } }, true);
    for (let i = 0; i < list.length; i++) if (list[i].id !== id && list[i].y !== i * 10) await send({ type: 'move', id: list[i].id, x: 0, y: i * 10, parent: cluster }, true);
    if (desc.length) await follow(cluster);
  }

  /** Klick auf den Anschlusspunkt: vom Linienanfang lösen, unter die übrigen Karten des Clusters legen */
  async function undock(id: string) {
    const c = shown.cards[id];
    const k = c?.parent ? shown.cards[c.parent] : null;
    if (!c || !k || !canEdit) return;
    const bottom = k.children
      .map((x) => shown.cards[x])
      .filter((x) => x && x.id !== id && !underOf(shown, x) && !isDocked(x))
      .reduce((m0, x) => Math.max(m0, x.y + (push[x.id] ?? 0) + (hts[x.id] ?? x.h) + 12), 0);
    if (!(await send({ type: 'move', id, x: 0, y: Math.round(bottom), parent: k.id }))) return;
    await send({ type: 'update', id, patch: { docked: false } }, true);
    setOpenDock((s0) => {
      const n = new Set(s0);
      n.delete(id);
      return n;
    });
  }

  /** Karten eines Clusters von oben nach unten in eine Reihe stellen */
  async function sortCluster(k: MapCard) {
    const list = k.children.map((cid) => shown.cards[cid]).filter((c) => c && !nested(c) && !isDocked(c));
    list.sort((a, b) => a.y - b.y || a.x - b.x);
    let y = 0;
    for (let i = 0; i < list.length; i++) {
      const dom = el.current?.querySelector<HTMLElement>(`[data-card="${list[i].id}"]`);
      const h = dom ? dom.offsetHeight : list[i].h;
      if (!(await send({ type: 'move', id: list[i].id, x: 0, y, parent: k.id }, i > 0))) return;
      y += Math.round(h) + 12;
    }
    const w = Math.max(...list.map((c) => c.w), 160) + 2 * PAD;
    if (k.w < w) await send({ type: 'update', id: k.id, patch: { w } }, true);
  }

  async function commitInline() {
    const it = inline;
    setInline(null);
    if (!it) return;
    const c = shown.cards[it.id];
    if (!c) return;
    const v = it.field === 'title' ? draft.trim().slice(0, 200) : draft.slice(0, 5000);
    if (v !== c[it.field]) await send({ type: 'update', id: c.id, patch: { [it.field]: v } });
  }
  const startInline = (id: string, field: 'title' | 'text') => {
    if (!canEdit) return;
    const c = shown.cards[id];
    if (!c) return;
    // Karten aus „Notizen und Quellen“ folgen der Notiz: dort bearbeiten
    if (c.noteId && field === 'text') return setEditing(id);
    setSel(id);
    setDraft(c[field]);
    setInline({ id, field });
  };

  function wheel(e: React.WheelEvent) {
    if ((e.target as HTMLElement).closest('[data-ui]')) return;
    const r = el.current!.getBoundingClientRect();
    const k = Math.min(2.5, Math.max(0.15, cam.k * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015))));
    const mx = e.clientX - r.left,
      my = e.clientY - r.top;
    setCam({ k, x: mx - ((mx - cam.x) / cam.k) * k, y: my - ((my - cam.y) / cam.k) * k });
  }

  function dblclick(e: React.MouseEvent) {
    // Ziel nach Lage bestimmen: die Fläche fängt den Zeiger ein, e.target ist dann die Fläche selbst
    const t = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null) ?? (e.target as HTMLElement);
    if (t.closest('input, textarea, [data-ui]')) return;
    const id = cardAt(e.clientX, e.clientY);
    // Doppelklick auf den Kopf: Titel, auf den Text: Text direkt in der Karte schreiben
    const part = t.closest('[data-part]');
    if (id && part?.getAttribute('data-part') === 'head' && part.closest('[data-card]')?.getAttribute('data-card') === id) return startInline(id, 'title');
    if (id && part?.getAttribute('data-part') === 'text') return startInline(id, 'text');
    if (id && shown.cards[id].kind === 'card') return startInline(id, 'text');
    const w = toWorld(e.clientX, e.clientY);
    void addAt(w.x, w.y, 'card');
  }

  // Tastatur wie in brausa: Entf löscht, Esc hebt die Auswahl auf, N legt eine Karte an, 0 passt ein
  useEffect(() => {
    function key(e: KeyboardEvent) {
      const t = e.target as HTMLElement;
      if (editing || inline || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable) return;
      if (e.key === 'Delete' || e.key === 'Backspace') remove();
      else if (e.key === 'Escape') (setSel(null), setSelLink(null));
      else if (e.key === 'F2' && sel) startInline(sel, 'title');
      else if (e.key.toLowerCase() === 'n' && !e.ctrlKey && !e.metaKey) addCenter('card');
      else if (e.key === '0') fit();
      else return;
      e.preventDefault();
    }
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });

  // ------------------------------------------------------------ Darstellung

  const lines = shown.links.flatMap((l) => {
    if (!shown.cards[l.from] || !shown.cards[l.to]) return [];
    const a = rectAbs(l.from),
      b = rectAbs(l.to);
    const p = edgePoint(a, b.x + b.w / 2, b.y + b.h / 2);
    const q = edgePoint(b, a.x + a.w / 2, a.y + a.h / 2);
    return [{ l, p, q }];
  });

  async function togglePick(c: MapCard, whole = false) {
    if (line) return line.toggle(c, whole);
    const ops = pickOps(map, c, whole);
    for (let i = 0; i < ops.length; i++) if (!(await send(ops[i], i > 0))) return;
  }

  function renderCard(id: string, inCard = false, inDock = false): React.ReactNode {
    const c = shown.cards[id];
    if (!c) return null;
    // Karten, die in einer Karte liegen, erscheinen dort (nicht frei im Cluster), angedockte an der Linie oben
    if (!inCard && nested(c)) return null;
    if (!inCard && !inDock && isDocked(c)) return null;
    // Punkte an der Linie sind zugeklappt, bis jemand die Titelleiste anklickt
    const folded = inDock && !openDock.has(id);
    const moving = g?.kind === 'move' && g.id === id && g.moved;
    const size = g?.kind === 'resize' && g.id === id ? { w: g.nw, h: g.nh } : { w: c.w, h: c.h };
    const color = colors.get(id) ?? c.color ?? '#9a9a94';
    const owner = c.owner != null ? personName.get(c.owner) : undefined;
    const kids = folded ? [] : (nest.get(id) ?? []);
    const showText = !folded && (hideAll ? textOn.has(id) : !c.hideText);
    const level = c.kind === 'cluster' ? 0 : inCard ? 2 : c.parent ? 1 : 1;
    const over = g?.kind === 'move' && g.moved && g.over === id;
    const cls = [
      m.card,
      c.kind === 'cluster' ? m.cluster : '',
      inCard ? m.inner : '',
      inDock ? m.docked : '',
      sel === id ? m.sel : '',
      moving ? m.moving : '',
      g?.kind === 'wire' && g.to === id ? m.wired : '',
      over ? m.drop : '',
      isDimmed(map, c, dim) || line?.greyed.has(id) ? (c.kind === 'cluster' ? m.dimFrame : m.dim) : '',
    ].join(' ');
    const isInline = (f: 'title' | 'text') => inline?.id === id && inline.field === f;
    const textBlock = showText && (c.text || isInline('text') || (canEdit && sel === id)) && (
      <div className={m.textWrap} data-part="text" data-ctext={c.kind === 'cluster' ? id : undefined}>
        {isInline('text') ? (
          <textarea
            className={m.textInput}
            autoFocus
            value={draft}
            rows={Math.min(12, Math.max(3, draft.split('\n').length + 1))}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => void commitInline()}
            onPointerDown={(e) => e.stopPropagation()}
            onPaste={(e) => {
              // längeres Einsetzen läuft über den Karten-Editor, damit die Einfüge-Regeln gelten
              const t = e.clipboardData.getData('text/plain');
              if (rules && t.length >= rules.threshold) {
                e.preventDefault();
                setInline(null);
                setEditing(id);
              }
            }}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Escape') setInline(null);
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) (e.target as HTMLTextAreaElement).blur();
            }}
            placeholder="Text …"
          />
        ) : c.text ? (
          <div className={m.text} dangerouslySetInnerHTML={{ __html: renderMarkdown(c.text) }} />
        ) : (
          <div className={`${m.text} ${m.placeholder}`}>Doppelklick: Text schreiben</div>
        )}
      </div>
    );
    return (
      <div
        key={id}
        className={cls}
        data-card={id}
        data-free={inCard || inDock ? undefined : ''}
        data-clip={`${c.kind === 'cluster' ? 'Cluster' : 'Karte'} „${c.title || 'Ohne Titel'}“`}
        style={
          {
            ...(inCard || inDock
              ? {}
              : {
                  left: c.x,
                  top: c.y + (push[id] ?? 0),
                  width: size.w,
                  // Cluster: feste Fläche (wächst mit Text und Karten), Karten so hoch wie ihr Inhalt
                  ...(c.kind === 'cluster' ? { height: clusterH(c, size.h) } : { minHeight: (showText && c.text) || kids.length || (g?.kind === 'resize' && g.id === id) ? size.h : HEADER + 12 }),
                }),
            '--c': color,
            '--lvl': level,
            transform: moving ? `translate(${g.dx / cam.k}px, ${g.dy / cam.k}px)` : undefined,
          } as unknown as React.CSSProperties
        }
      >
        <div className={m.head} style={{ minHeight: HEADER }} data-part="head">
          {isInline('title') ? (
            <input
              className={m.titleInput}
              autoFocus
              value={draft}
              maxLength={200}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => void commitInline()}
              onPointerDown={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Escape') setInline(null);
                if (e.key === 'Enter') {
                  // weiter zum Text, wie beim Schreiben auf einer Karteikarte
                  const keep = id;
                  void commitInline().then(() => c.kind === 'card' && showText && startInline(keep, 'text'));
                }
              }}
              placeholder={c.kind === 'cluster' ? 'Titel des Clusters' : 'Titel'}
            />
          ) : (
            <span className={m.t}>{c.title || (c.kind === 'cluster' ? 'Cluster ohne Titel' : 'Ohne Titel')}</span>
          )}
          {(line ? line.has(id) : isPicked(map, c)) && (
            <span className={m.mark} title="In der Gliederung">
              <Icon name="check" size={12} />
            </span>
          )}
          {inDock && (nest.get(id)?.length || c.text) ? (
            <span className={m.fold} title={folded ? 'Aufklappen (Klick auf die Titelleiste)' : 'Zuklappen'}>
              {folded ? '▸' : '▾'}
              {folded && nest.get(id)?.length ? ` ${nest.get(id)!.length}` : ''}
            </span>
          ) : null}
          {owner && (
            <span className={m.owner} title={`zuständig: ${owner}`}>
              {initials(owner)}
            </span>
          )}
        </div>
        {textBlock}
        {c.kind === 'card' && kids.length > 0 && <div className={m.nest}>{kids.map((k) => renderCard(k.id, true))}</div>}
        {c.kind === 'cluster' && (canEdit || docks.get(id)) && (
          <span
            className={`${m.dockStart} ${dockOver === 'start:' + id ? m.dockHot : ''}`}
            data-dock-start={id}
            title="Startkreis: eine Karte hierher ziehen, dann wird sie der erste Punkt der Linie"
          />
        )}
        {c.kind === 'cluster' && docks.get(id) && (
          <span className={`${m.dockLine} ${dockOver === 'line:' + id ? m.dockHot : ''}`} data-dock-line={id} style={{ height: dockTop(id) + 8 + (dockEnd[id] ?? 0) }} title="Linie: eine Karte hierher ziehen, dann steht sie an dieser Stelle zwischen den Punkten" />
        )}
        {c.kind === 'cluster' && docks.get(id) && (
          <div className={m.dock} data-dock={id} style={{ top: dockTop(id) + 8, left: 0, right: PAD }}>
            {docks.get(id)!.map((d) => (
              <div key={d.id} className={m.stop}>
                <button
                  className={m.port}
                  data-port
                  data-ui
                  disabled={!canEdit}
                  onClick={() => void undock(d.id)}
                  title="Anschlusspunkt: Klick löst die Karte wieder von der Linie"
                  aria-label={`„${d.title || 'Ohne Titel'}“ von der Linie lösen`}
                />
                {renderCard(d.id, false, true)}
              </div>
            ))}
          </div>
        )}
        {c.kind === 'cluster' && (
          <div className={m.body} style={{ top: top(id), left: PAD }}>
            {c.children.map((k) => renderCard(k))}
          </div>
        )}
        {canEdit && !inCard && !inDock && (
          <>
            <span className={`${m.h} ${m.connect}`} data-handle="connect" title="Pfeil ziehen" />
            <span className={`${m.h} ${m.resize}`} data-handle="resize" />
          </>
        )}
      </div>
    );
  }

  const selCard = sel ? shown.cards[sel] : null;
  const selBar = (() => {
    if (!canEdit || (!selCard && !selLink) || g) return null;
    const box = el.current?.getBoundingClientRect();
    if (!box) return null;
    if (selLink) {
      const ln = lines.find((x) => x.l.id === selLink);
      if (!ln) return null;
      return { x: ((ln.p.x + ln.q.x) / 2) * cam.k + cam.x, y: ((ln.p.y + ln.q.y) / 2) * cam.k + cam.y + 14, above: false };
    }
    const r = rectAbs(sel!);
    const sx = r.x * cam.k + cam.x,
      sy = r.y * cam.k + cam.y;
    const above = sy > 70;
    return { x: Math.min(Math.max(sx + (r.w * cam.k) / 2, 200), box.width - 200), y: above ? sy - 10 : Math.min(sy + r.h * cam.k + 10, box.height - 50), above };
  })();

  return (
    <div
      ref={el}
      className={`${m.board} ${g?.kind === 'pan' && g.moved ? m.panning : ''}`}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onDoubleClick={dblclick}
      onDragOver={(e) => {
        if (!canEdit || !isChatDrag(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }}
      onDrop={(e) => {
        const d = readChatDrop(e);
        if (!d || !canEdit) return;
        e.preventDefault();
        // Beitrag aus dem Chat wird eine Karte an der Stelle (im Cluster darunter, falls einer da ist)
        const w = toWorld(e.clientX, e.clientY);
        const p = placeAt(w.x, w.y, 'card');
        const id = newId();
        void send({ type: 'add', card: { id, kind: 'card', ...cardFromChat(d), color: null, owner: null, ...p } }).then((ok) => ok && setSel(id));
      }}
      onWheel={wheel}
      onContextMenu={(e) => e.preventDefault()}
      style={{ backgroundPosition: `${cam.x}px ${cam.y}px`, backgroundSize: `${22 * cam.k}px ${22 * cam.k}px` }}
    >
      <div className={m.world} style={{ transform: `translate(${cam.x}px, ${cam.y}px) scale(${cam.k})` }}>
        <svg className={m.links}>
          <defs>
            <marker id="cg-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0 0 10 5 0 10z" fill="context-stroke" />
            </marker>
          </defs>
          {lines.map(({ l, p, q }) => (
            <g key={l.id} data-link={l.id} className={selLink === l.id ? m.lsel : ''}>
              <line className={m.hit} x1={p.x} y1={p.y} x2={q.x} y2={q.y} />
              <line className={m.ln} x1={p.x} y1={p.y} x2={q.x} y2={q.y} markerEnd="url(#cg-arrow)" />
            </g>
          ))}
          {g?.kind === 'wire' &&
            (() => {
              const s = edgePoint(rectAbs(g.from), g.x, g.y);
              return <line className={`${m.ln} ${m.wire}`} x1={s.x} y1={s.y} x2={g.x} y2={g.y} markerEnd="url(#cg-arrow)" />;
            })()}
        </svg>
        {shown.roots.map((r) => renderCard(r))}
      </div>

      <div className={m.tools} data-ui>
        {canEdit && (
          <>
            <button className="btn" onClick={() => addCenter('card')} title="Neue Karte (N)">
              + Karte
            </button>
            <button className="btn" onClick={() => addCenter('cluster')} title="Rahmen, in den Karten gezogen werden">
              + Cluster
            </button>
          </>
        )}
        <button className={`btn ${hideAll ? 'on' : ''}`} aria-pressed={hideAll} onClick={toggleHideAll} title={hideAll ? 'Texte wieder zeigen' : 'Texte aller Karten ausblenden'}>
          <Icon name="textOff" size={13} /> <span className={m.long}>Text {hideAll ? 'zeigen' : 'aus'}</span>
        </button>
        <button className="btn" onClick={fit} title="Alles zeigen (0)">
          Einpassen
        </button>
        <button className="btn icon" onClick={() => setCam((c) => ({ ...c, k: Math.min(2.5, c.k * 1.2) }))} title="Vergrößern">
          +
        </button>
        <button className="btn icon" onClick={() => setCam((c) => ({ ...c, k: Math.max(0.15, c.k / 1.2) }))} title="Verkleinern">
          −
        </button>
      </div>

      {selBar && (
        <div className={`${m.selbar} ${selBar.above ? '' : m.below}`} style={{ left: selBar.x, top: selBar.y }} data-ui onPointerDown={(e) => e.stopPropagation()}>
          {selCard && !selLink && (
            <>
              {COLUMN_COLORS.map((col) => (
                <button key={col} className={`${m.swatch} ${selCard.color === col ? m.on : ''}`} style={{ background: col }} title="Farbe" onClick={() => void send({ type: 'update', id: selCard.id, patch: { color: col } })} />
              ))}
              <button className={`${m.swatch} ${m.none}`} title="Ohne Farbe" onClick={() => void send({ type: 'update', id: selCard.id, patch: { color: null } })} />
              {selCard.kind === 'card' && (
                <select
                  className={m.person}
                  value={selCard.owner ?? ''}
                  title="Wer kümmert sich darum?"
                  onChange={(e) => void send({ type: 'update', id: selCard.id, patch: { owner: e.target.value ? Number(e.target.value) : null } })}
                >
                  <option value="">niemand zugeordnet</option>
                  {people.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              )}
              {(selCard.kind === 'cluster' || selCard.parent) && (
                <button
                  className={`btn ${isPicked(map, selCard) ? 'on' : ''}`}
                  aria-pressed={isPicked(map, selCard)}
                  title={selCard.kind === 'cluster' ? 'Dieser Cluster wird ein Abschnitt der Gliederung' : 'Diese Karte wird ein Unterpunkt in ihrem Abschnitt'}
                  onClick={() => void togglePick(selCard)}
                >
                  {isPicked(map, selCard) ? '✓ Gliederung' : 'In die Gliederung'}
                </button>
              )}
              {selCard.kind === 'cluster' && selCard.children.some((id) => !map.cards[id]?.pick) && (
                <button className="btn" onClick={() => void togglePick(selCard, true)} title="Cluster übernehmen">
                  Ganzer Cluster
                </button>
              )}
              {onToGroup && selCard.title.trim() && (
                <button className="btn" onClick={() => onToGroup(selCard.title.trim())} title="Aus dieser Idee eine Gruppe machen">
                  Zur Gruppe
                </button>
              )}
              {hideAll ? (
                <button
                  className={`btn ${textOn.has(selCard.id) ? '' : 'on'}`}
                  aria-pressed={!textOn.has(selCard.id)}
                  onClick={() =>
                    setTextOn((s0) => {
                      const n = new Set(s0);
                      if (n.has(selCard.id)) n.delete(selCard.id);
                      else n.add(selCard.id);
                      return n;
                    })
                  }
                  title={textOn.has(selCard.id) ? 'Text dieser Karte wieder ausblenden' : 'Nur den Text dieser Karte zeigen („Text aus“ bleibt für alle anderen)'}
                >
                  <Icon name="textOff" size={13} /> Text {textOn.has(selCard.id) ? 'aus' : 'zeigen'}
                </button>
              ) : (
                <button
                  className={`btn ${selCard.hideText ? 'on' : ''}`}
                  aria-pressed={!!selCard.hideText}
                  onClick={() => void send({ type: 'update', id: selCard.id, patch: { hideText: !selCard.hideText } })}
                  title={selCard.hideText ? 'Text dieser Karte wieder zeigen' : 'Text dieser Karte ausblenden'}
                >
                  <Icon name="textOff" size={13} /> Text
                </button>
              )}
              {line?.preview && (selCard.kind === 'cluster' || nest.get(selCard.id)?.length) && (
                <button className="btn" onClick={() => line.preview!(selCard.id)} title="Diesen Cluster vorübergehend als Gliederung anzeigen">
                  <Icon name="outline" size={13} /> Als Gliederung
                </button>
              )}
              {selCard.kind === 'cluster' && selCard.children.length > 1 && (
                <button className="btn" onClick={() => void sortCluster(selCard)} title="Karten von oben nach unten in eine Reihe stellen">
                  Ordnen
                </button>
              )}
              {selCard.under && (
                <button className="btn" onClick={() => void send({ type: 'update', id: selCard.id, patch: { under: null } })} title="Aus der Karte herausnehmen">
                  Herausnehmen
                </button>
              )}
              <button className="btn" onClick={() => setEditing(selCard.id)}>
                Bearbeiten
              </button>
            </>
          )}
          <button className="btn danger" onClick={remove} title="Löschen (Entf)">
            {selLink ? 'Pfeil löschen' : 'Löschen'}
          </button>
        </div>
      )}

      {editing && shown.cards[editing] && <CardEditor card={shown.cards[editing]} onClose={() => setEditing(null)} send={send} />}
    </div>
  );
}
