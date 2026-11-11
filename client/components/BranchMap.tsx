'use client';
/**
 * Mindmap als Äste (Wunsch Jo, 11. November 2026): Thema in der Mitte, geschwungene farbige Äste, die nach außen
 * dünner werden, Text direkt am Ast, Unteräste in der Farbe ihres Hauptasts, wahlweise eine Form je Knoten.
 * Gleiche Daten wie die Karten-Fläche (MindMap.tsx): Hauptast = Cluster (wird Abschnitt der Gliederung),
 * Unterast = Karte im Cluster (mit zuständiger Person). Die Lage ergibt sich automatisch; x/y der Karten-Fläche
 * bleiben unberührt, damit beide Ansichten nebeneinander funktionieren.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { COLUMN_COLORS } from '@/lib/colors';
import type { MapCard, MapOp, MapShape, MindMap as MapData } from '@/lib/types';
import { Icon } from './Icon';
import type { Person } from './MindMap';
import b from './branchmap.module.css';

const ROW = 46; // Höhe je Unterast
const GAP = 22; // Abstand zwischen Hauptästen
const MAIN_X = 230; // Abstand Mitte → Hauptast
const SUB_X = 250; // Abstand Hauptast → Unterast
const newId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

const SHAPES: { key: MapShape; label: string }[] = [
  { key: 'none', label: 'Ohne Form' },
  { key: 'rect', label: 'Rechteck' },
  { key: 'oval', label: 'Oval' },
  { key: 'diamond', label: 'Raute' },
  { key: 'para', label: 'Parallelogramm' },
];

interface Node {
  card: MapCard;
  side: 1 | -1;
  x: number;
  y: number;
  color: string;
  depth: 1 | 2;
  parentX: number;
  parentY: number;
}

/** Lesereihenfolge wie die Gliederung: von oben nach unten, dann links nach rechts. */
function readingOrder(cards: MapCard[]): MapCard[] {
  return [...cards].sort((a, b) => (Math.abs(a.y - b.y) < 60 ? a.x - b.x : a.y - b.y));
}

/** Getaperter Ast als gefüllte Fläche: dick am Anfang, dünn am Ende. */
function branch(x0: number, y0: number, x1: number, y1: number, w0: number, w1: number): string {
  const mx = (x0 + x1) / 2;
  const top = `M${x0},${y0 - w0 / 2} C${mx},${y0 - w0 / 2} ${mx},${y1 - w1 / 2} ${x1},${y1 - w1 / 2}`;
  const bottom = `L${x1},${y1 + w1 / 2} C${mx},${y1 + w1 / 2} ${mx},${y0 + w0 / 2} ${x0},${y0 + w0 / 2} Z`;
  return top + ' ' + bottom;
}

function layout(map: MapData): { nodes: Node[]; loose: MapCard[]; height: number } {
  const roots = map.roots.map((id) => map.cards[id]).filter(Boolean);
  const mains = readingOrder(roots.filter((c) => c.kind === 'cluster'));
  const loose = roots.filter((c) => c.kind === 'card');
  const size = (c: MapCard) => Math.max(1, c.children.length) * ROW + GAP;
  // Erste Hälfte rechts, zweite links (im Uhrzeigersinn lesbar)
  const total = mains.reduce((s, c) => s + size(c), 0);
  const right: MapCard[] = [];
  let acc = 0;
  for (const c of mains) {
    if (acc < total / 2 || right.length === 0) {
      right.push(c);
      acc += size(c);
    }
  }
  const left = mains.filter((c) => !right.includes(c));
  const nodes: Node[] = [];
  const place = (list: MapCard[], side: 1 | -1) => {
    const h = list.reduce((s, c) => s + size(c), 0);
    let y = -h / 2;
    list.forEach((c) => {
      const idx = mains.indexOf(c);
      const color = c.color ?? COLUMN_COLORS[(idx + 1) % COLUMN_COLORS.length];
      const sz = size(c);
      const my = y + sz / 2;
      const mx = side * MAIN_X;
      nodes.push({ card: c, side, x: mx, y: my, color, depth: 1, parentX: 0, parentY: 0 });
      const kids = c.children.map((id) => map.cards[id]).filter(Boolean);
      const ordered = [...kids].sort((a, b) => a.y - b.y || a.x - b.x);
      ordered.forEach((k, i) => {
        const ky = my - ((ordered.length - 1) * ROW) / 2 + i * ROW;
        nodes.push({ card: k, side, x: mx + side * SUB_X, y: ky, color, depth: 2, parentX: mx, parentY: my });
      });
      y += sz;
    });
    return h;
  };
  const hr = place(right, 1);
  const hl = place(left, -1);
  return { nodes, loose, height: Math.max(hr, hl, 200) };
}

export function BranchMap({ map, topic, people, canEdit, send }: { map: MapData; topic: string; people: Person[]; canEdit: boolean; send: (op: MapOp) => Promise<boolean> }) {
  const { nodes, loose, height } = useMemo(() => layout(map), [map]);
  const [sel, setSel] = useState<string | null>(null);
  const [edit, setEdit] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [cam, setCam] = useState({ x: 0, y: 0, k: 1 });
  const wrap = useRef<HTMLDivElement>(null);
  const pan = useRef<{ sx: number; sy: number; x: number; y: number } | null>(null);
  const selected = sel ? map.cards[sel] : null;

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
    if (!id || !map.cards[id] || map.cards[id].title === draft.trim()) return;
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
      if (selected.kind === 'cluster') void addChild(selected.id);
      else if (selected.parent) void addChild(selected.parent);
    } else if (e.key === 'Enter' || e.key === 'F2') {
      e.preventDefault();
      startEdit(selected.id, selected.title);
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      void remove(selected.id);
    }
  }

  const label = (n: Node) => {
    const c = n.card;
    const shape = c.shape ?? 'none';
    const owner = c.owner != null ? people.find((p) => p.id === c.owner)?.name : null;
    const text = c.title || (n.depth === 1 ? 'Ohne Titel' : '…');
    const isSel = sel === c.id;
    // Text sitzt am Ende des Asts, nach außen ausgerichtet
    const style: React.CSSProperties = {
      left: n.x,
      top: n.y,
      ['--c' as string]: n.color,
      transform: `translate(${n.side === 1 ? '0' : '-100%'}, ${shape === 'none' ? '-100%' : '-50%'})`,
    };
    return (
      <div
        key={c.id}
        className={`${b.node} ${b['s_' + shape]} ${n.depth === 1 ? b.main : b.sub} ${isSel ? b.sel : ''} ${n.side === -1 ? b.left : ''}`}
        style={style}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => setSel(c.id)}
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
            placeholder={n.depth === 1 ? 'Abschnitt' : 'Idee'}
          />
        ) : (
          <span className={b.text}>{text}</span>
        )}
        {owner && <span className={b.owner}>{owner}</span>}
        {isSel && canEdit && edit !== c.id && (
          <button className={b.plus} title="Unterast hinzufügen (Tab)" onClick={(e) => (e.stopPropagation(), void addChild(c.kind === 'cluster' ? c.id : c.parent!))}>
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
      <div className={b.stage} style={{ transform: `translate(${cam.x}px, ${cam.y}px) scale(${cam.k})` }}>
        <svg className={b.svg} width="1" height="1" overflow="visible" aria-hidden="true">
          {nodes.map((n) => {
            const end = n.x + n.side * (n.depth === 1 ? 150 : 140);
            const start = n.depth === 1 ? n.side * 40 : n.parentX + n.side * 150;
            const sy = n.depth === 1 ? 0 : n.parentY;
            return (
              <g key={n.card.id} fill={n.color}>
                <path d={branch(start, sy, n.x, n.y, n.depth === 1 ? 14 : 6, n.depth === 1 ? 6 : 2.5)} opacity={n.depth === 1 ? 0.95 : 0.8} />
                {/* Linie unter dem Text: der Ast läuft unter der Beschriftung weiter */}
                <path d={branch(n.x, n.y, end, n.y, n.depth === 1 ? 6 : 2.5, n.depth === 1 ? 3 : 1.5)} opacity={n.depth === 1 ? 0.95 : 0.8} />
              </g>
            );
          })}
        </svg>
        <div className={b.root} onPointerDown={(e) => e.stopPropagation()}>
          <span>{topic}</span>
          {canEdit && (
            <button className={b.plus} title="Neuen Hauptast hinzufügen" onClick={addMain}>
              +
            </button>
          )}
        </div>
        {nodes.map(label)}
        {loose.length > 0 && (
          <div className={b.loose} style={{ top: height / 2 + 40 }} onPointerDown={(e) => e.stopPropagation()}>
            <strong>Noch keinem Ast zugeordnet</strong> (in der Karten-Ansicht in einen Cluster ziehen):{' '}
            {loose.map((c) => c.title || 'Ohne Titel').join(' · ')}
          </div>
        )}
      </div>

      {selected && canEdit && (
        <div className={b.bar} onPointerDown={(e) => e.stopPropagation()}>
          <span className={b.barTitle}>{selected.title || 'Ohne Titel'}</span>
          <select value={selected.shape ?? 'none'} onChange={(e) => void send({ type: 'update', id: selected.id, patch: { shape: e.target.value as MapShape } })} title="Form">
            {SHAPES.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
          {selected.kind === 'cluster' && (
            <span className={b.colors}>
              {COLUMN_COLORS.map((c) => (
                <button key={c} className={b.swatch} style={{ background: c }} title="Farbe des Asts" onClick={() => void send({ type: 'update', id: selected.id, patch: { color: c } })} />
              ))}
            </span>
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
          <button className="btn" onClick={() => startEdit(selected.id, selected.title)}>
            <Icon name="pen" size={14} /> Umbenennen
          </button>
          <button className="btn" onClick={() => void addChild(selected.kind === 'cluster' ? selected.id : selected.parent!)}>
            + Unterast
          </button>
          <button className="btn icon" onClick={() => void remove(selected.id)} title="Löschen">
            <Icon name="close" size={14} />
          </button>
        </div>
      )}
      {nodes.length === 0 && canEdit && (
        <div className={b.hint}>
          Tippe auf <strong>+</strong> am Thema, um den ersten Ast anzulegen. Jeder Hauptast wird ein Abschnitt der Gliederung, Unteräste sind die Ideen
          dazu. <kbd>Tab</kbd> legt einen Unterast an, <kbd>Enter</kbd> benennt um.
        </div>
      )}
    </div>
  );
}
