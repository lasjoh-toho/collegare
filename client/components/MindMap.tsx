'use client';
/**
 * Mindmap der Phase „Orientierung“, Gestaltung nach brausa (ProjectMap.svelte): gepunktete Fläche, Karten mit
 * farbiger Kopfleiste und Markdown-Text, Cluster als Rahmenkarten, Pfeile über den Punkt am rechten Rand,
 * Ziehen zum Verschieben (in einen Cluster hinein oder heraus), Größe unten rechts, Mausrad zoomt.
 *
 * Vereinfacht gegenüber brausa: Cluster sind eine Ebene tief und werden nicht verkleinert dargestellt.
 * Der Server ist maßgeblich; die Ansicht schickt Operationen und zeigt den verteilten Stand.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { COLUMN_COLORS } from '@/lib/colors';
import { renderMarkdown } from '@/lib/markdown';
import type { MapCard, MapOp, MindMap as MapData } from '@/lib/types';
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
  | { kind: 'move'; id: string; sx: number; sy: number; dx: number; dy: number; moved: boolean; over: string | null }
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
}: {
  map: MapData;
  people: Person[];
  canEdit: boolean;
  send: (op: MapOp) => Promise<boolean>;
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
        return c.kind === 'cluster' && wx >= c.x && wx <= c.x + c.w && wy >= c.y + HEADER && wy <= c.y + c.h;
      });
      if (hit) {
        const k = shown.cards[hit];
        return { parent: hit, x: Math.max(0, wx - k.x - PAD - size.w / 2), y: Math.max(0, wy - k.y - HEADER - 15), ...size };
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
      if (kind === 'card') setEditing(id);
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

  /** Cluster, in den eine gezogene Karte fällt (Cluster selbst fallen immer auf die Fläche). */
  function dropCluster(id: string, clientX: number, clientY: number): string | null {
    if (shown.cards[id].kind !== 'card') return null;
    const under = cardAt(clientX, clientY, id);
    const u = under ? shown.cards[under] : null;
    return u ? (u.kind === 'cluster' ? u.id : u.parent) : null;
  }

  function down(e: React.PointerEvent) {
    if (editing) return;
    const t = e.target as HTMLElement;
    if (t.closest('[data-ui]')) return;
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
    } else setG({ kind: 'move', id, sx: e.clientX, sy: e.clientY, dx: 0, dy: 0, moved: false, over: null });
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
      setG({ ...g, dx, dy, moved: g.moved || Math.abs(dx) + Math.abs(dy) > 3, over: dropCluster(g.id, e.clientX, e.clientY) });
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
    if (g.kind === 'move' && g.moved) {
      const a = absRect(shown, g.id);
      const nx = a.x + g.dx / cam.k,
        ny = a.y + g.dy / cam.k;
      // Ziel: Cluster unter dem Zeiger (nur für Karten), sonst die freie Fläche
      const target = dropCluster(g.id, e.clientX, e.clientY);
      let x = nx,
        y = ny;
      if (target) {
        const k = shown.cards[target];
        x = Math.max(0, nx - k.x - PAD);
        y = Math.max(0, ny - k.y - HEADER);
      }
      x = Math.round(x);
      y = Math.round(y);
      setShown((s) => localMove(s, g.id, x, y, target));
      void send({ type: 'move', id: g.id, x, y, parent: target });
    } else if (g.kind === 'resize') {
      void send({ type: 'update', id: g.id, patch: { w: Math.round(g.nw), h: Math.round(g.nh) } });
    } else if (g.kind === 'wire' && g.to) {
      void send({ type: 'link', id: newId(), from: g.from, to: g.to });
    }
  }

  function wheel(e: React.WheelEvent) {
    if ((e.target as HTMLElement).closest('[data-ui]')) return;
    const r = el.current!.getBoundingClientRect();
    const k = Math.min(2.5, Math.max(0.15, cam.k * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015))));
    const mx = e.clientX - r.left,
      my = e.clientY - r.top;
    setCam({ k, x: mx - ((mx - cam.x) / cam.k) * k, y: my - ((my - cam.y) / cam.k) * k });
  }

  function dblclick(e: React.MouseEvent) {
    const id = cardAt(e.clientX, e.clientY);
    if (id && shown.cards[id].kind === 'card') return setEditing(id);
    if (id && shown.cards[id].kind === 'cluster') {
      // Doppelklick auf den Kopf eines Clusters benennt ihn, in den Inhalt legt eine Karte an
      const k = shown.cards[id];
      const w = toWorld(e.clientX, e.clientY);
      if (w.y < k.y + HEADER) return setEditing(id);
    }
    const w = toWorld(e.clientX, e.clientY);
    void addAt(w.x, w.y, 'card');
  }

  // Tastatur wie in brausa: Entf löscht, Esc hebt die Auswahl auf, N legt eine Karte an, 0 passt ein
  useEffect(() => {
    function key(e: KeyboardEvent) {
      const t = e.target as HTMLElement;
      if (editing || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable) return;
      if (e.key === 'Delete' || e.key === 'Backspace') remove();
      else if (e.key === 'Escape') (setSel(null), setSelLink(null));
      else if (e.key === 'F2' && sel) setEditing(sel);
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
    const a = absRect(shown, l.from),
      b = absRect(shown, l.to);
    const p = edgePoint(a, b.x + b.w / 2, b.y + b.h / 2);
    const q = edgePoint(b, a.x + a.w / 2, a.y + a.h / 2);
    return [{ l, p, q }];
  });

  function renderCard(id: string): React.ReactNode {
    const c = shown.cards[id];
    const moving = g?.kind === 'move' && g.id === id && g.moved;
    const size = g?.kind === 'resize' && g.id === id ? { w: g.nw, h: g.nh } : { w: c.w, h: c.h };
    const color = c.color ?? 'var(--line)';
    const owner = c.owner != null ? personName.get(c.owner) : undefined;
    const cls = [m.card, c.kind === 'cluster' ? m.cluster : '', sel === id ? m.sel : '', moving ? m.moving : '', g?.kind === 'wire' && g.to === id ? m.wired : '', g?.kind === 'move' && g.moved && g.over === id ? m.drop : ''].join(' ');
    return (
      <div
        key={id}
        className={cls}
        data-card={id}
        style={
          {
            left: c.x,
            top: c.y,
            width: size.w,
            height: size.h,
            '--c': color,
            transform: moving ? `translate(${g.dx / cam.k}px, ${g.dy / cam.k}px)` : undefined,
          } as React.CSSProperties
        }
      >
        <div className={m.head} style={{ height: HEADER }}>
          <span className={m.t}>{c.title || (c.kind === 'cluster' ? 'Cluster ohne Titel' : 'Ohne Titel')}</span>
          {owner && (
            <span className={m.owner} title={`zuständig: ${owner}`}>
              {initials(owner)}
            </span>
          )}
        </div>
        {c.kind === 'card' && c.text && <div className={m.text} dangerouslySetInnerHTML={{ __html: renderMarkdown(c.text) }} />}
        {c.kind === 'cluster' && (
          <div className={m.body} style={{ top: HEADER, left: PAD }}>
            {c.children.map(renderCard)}
          </div>
        )}
        {canEdit && (
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
    const r = absRect(shown, sel!);
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
              const s = edgePoint(absRect(shown, g.from), g.x, g.y);
              return <line className={`${m.ln} ${m.wire}`} x1={s.x} y1={s.y} x2={g.x} y2={g.y} markerEnd="url(#cg-arrow)" />;
            })()}
        </svg>
        {shown.roots.map(renderCard)}
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

function CardEditor({ card, onClose, send }: { card: MapCard; onClose: () => void; send: (op: MapOp) => Promise<boolean> }) {
  const [title, setTitle] = useState(card.title);
  const [text, setText] = useState(card.text);
  async function save() {
    if (title !== card.title || text !== card.text) {
      const ok = await send({ type: 'update', id: card.id, patch: card.kind === 'card' ? { title, text } : { title } });
      if (!ok) return;
    }
    onClose();
  }
  return (
    <div className="modal-bg" data-ui onPointerDown={(e) => (e.stopPropagation(), e.target === e.currentTarget && void save())}>
      <div className="modal" role="dialog" aria-label={card.kind === 'cluster' ? 'Cluster benennen' : 'Karte bearbeiten'} onKeyDown={(e) => (e.key === 'Enter' && (e.ctrlKey || e.metaKey) ? void save() : e.key === 'Escape' && onClose())}>
        <h2>{card.kind === 'cluster' ? 'Cluster benennen' : 'Karte'}</h2>
        <div className="field">
          <label>Titel</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} autoFocus onKeyDown={(e) => e.key === 'Enter' && card.kind === 'cluster' && void save()} />
        </div>
        {card.kind === 'card' && (
          <div className="field">
            <label>Text (Markdown: **fett**, *kursiv*, - Liste)</label>
            <textarea rows={7} value={text} onChange={(e) => setText(e.target.value)} maxLength={5000} />
          </div>
        )}
        <div className="row">
          <span className="muted">Strg+Enter speichert</span>
          <span className="grow" />
          <button className="btn" onClick={onClose}>
            Abbrechen
          </button>
          <button className="btn primary" onClick={() => void save()}>
            Fertig
          </button>
        </div>
      </div>
    </div>
  );
}
