'use client';
/**
 * Gliederung als U-Bahn-Linie (Konzept 8h, Wünsche von Jo vom 20. November 2026). Erscheint neben der Mindmap und
 * neben „Notizen und Quellen“. Zwei Linien: Präsentation (rot) und Ausarbeitung (blau), darüber zwei große Reiter und
 * dazwischen der Schalter „beides“ für die Vollbild-Ansicht mit beiden Linien nebeneinander.
 *
 * - Stationen (weiße Kreise) sind Punkte der Gliederung, Unterpunkte kleiner. Punkte ohne Karte in der Mindmap sind
 *   gestrichelt, ausgeblendete blass; entfernte stehen unten zum Zurückholen.
 * - Auf Punkte zieht man Objekte (Notizen aus dem Thread, Karten aus der Mindmap). Objekte lassen sich
 *   untereinander sortieren und ineinander legen; dann wandern sie gemeinsam. Jedes Objekt hat ein Auge.
 * - Das Schloss sperrt die Gliederung (auch gegen Änderungen aus der Mindmap), sobald sie mit Karten überarbeitet ist.
 *
 * Gesendet wird die ganze Gliederung als Map-Op `lines`; der Server leitet daraus `pick` und `outline` ab.
 */
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { get } from '@/lib/api';
import { isChatDrag, readChatDrop } from '@/lib/chatDrag';
import {
  addItem,
  allPoints,
  flatPoints,
  pointFromCard,
  indentPoint,
  insertAfterRow,
  MAX_LEVELS,
  alignRows,
  alignPoint,
  movePointAfter,
  clone,
  copyPoint,
  deletePoint,
  dropItem,
  LINE_COLOR,
  LINE_LABEL,
  linesOf,
  moveItem,
  movePoint,
  newPoint,
  patchItem,
  patchPoint,
  sharedKeys,
  type LineItem,
  type LineKind,
  type LinePoint,
  type Lines,
} from '@/lib/lines';
import type { MapOp, MindMap } from '@/lib/types';
import { Icon } from './Icon';
import { useTeacherAsk, type TeacherGroup } from './TeacherAsk';
import g from './gliederung.module.css';

const ITEM_MIME = 'application/x-collegare-lineitem';
/** ein Punkt der Gliederung wird gezogen: {kind, id} */
const POINT_MIME = 'application/x-collegare-linepoint';
const TAB_KEY = 'collegare-gliederung-linie';
const KIND: Record<string, string> = { note: 'Notiz', source: 'Quelle', link: 'Link', image: 'Bild', data: 'Daten', video: 'Video', audio: 'Audio', hand: 'Handschrift', card: 'Karte', cluster: 'Ast', chat: 'Chat' };

export interface GliederungProps {
  map: MindMap;
  send: (op: MapOp, join?: boolean) => Promise<boolean>;
  people: { id: number; name: string }[];
  canEdit: boolean;
  meId: number;
  kinds: LineKind[];
  tab: LineKind;
  onTab: (k: LineKind) => void;
  /** aktueller Titel und Art einer Notiz (sonst gilt der Schnappschuss im Objekt) */
  noteInfo?: (id: number) => { label: string; kind: string } | undefined;
  show?: (msg: string) => void;
  onClose?: () => void;
  /** rechts (vor der Gliederung: Mindmap, Cluster, Notizen) oder links (beim Schreiben) */
  side?: 'left' | 'right';
  /** „beides“ öffnet die Seite Gliederung (sonst ein Vollbild über der Seite) */
  bothHref?: string;
  /** Projekt und Bereich: für „Texte vergleichen“ in der Parallelansicht */
  docs?: { project: number; scope: string | null };
  /** Lehrkraft in einer Gruppe: vor dem Ändern nachfragen (Nachricht an die Gruppe oder trotzdem ändern) */
  teacher?: TeacherGroup;
}

/** Ziel eines Ablegens aus der Mindmap (Zeiger, kein HTML-Ziehen): steht als data-line-drop an Punkten und am Ende */
export interface LineDropTarget {
  kind: LineKind;
  point: string | null;
  /** abgelegt direkt auf der Linie: neuer Punkt unter dieser Zeile (null = ganz oben) */
  after?: string | null;
}
/**
 * Stelle auf der Linie unter dem Zeiger: die letzte Station, deren Mitte darüber liegt. y ist die Höhe im Schienen-
 * Element (für den Geisterkreis).
 */
export function railSpot(rail: HTMLElement, clientY: number): { after: string | null; y: number } {
  const track = rail.parentElement!;
  let after: string | null = null;
  for (const h of track.querySelectorAll<HTMLElement>('[data-row]')) {
    const r = h.getBoundingClientRect();
    if (r.top + r.height / 2 < clientY) after = h.dataset.row!;
  }
  return { after, y: clientY - rail.getBoundingClientRect().top };
}
export function lineTargetAt(x: number, y: number): LineDropTarget | null {
  for (const n of document.elementsFromPoint(x, y)) {
    const el = (n as HTMLElement).closest?.('[data-line-drop]') as HTMLElement | null;
    const raw = el?.getAttribute('data-line-drop');
    if (raw) {
      try {
        const t = JSON.parse(raw) as LineDropTarget;
        if (el!.hasAttribute('data-line-rail')) t.after = railSpot(el!, y).after ?? t.after ?? null;
        return t;
      } catch {
        return null;
      }
    }
  }
  return null;
}
/** Hervorheben des Ziels, während eine Karte aus der Mindmap gezogen wird */
export function hoverLineTarget(x: number | null, y = 0) {
  document.querySelectorAll('[data-line-over]').forEach((n) => n.removeAttribute('data-line-over'));
  if (x === null) return;
  for (const n of document.elementsFromPoint(x, y)) {
    const t = (n as HTMLElement).closest?.('[data-line-drop]') as HTMLElement | null;
    if (t) {
      if (t.hasAttribute('data-line-rail')) t.style.setProperty('--gy', railSpot(t, y).y + 'px');
      return void t.setAttribute('data-line-over', '1');
    }
  }
}

/** Seite der Gliederung: rechts bei Mindmap und Cluster, links beim Schreiben; beim Wechsel gleitet die Seite hinüber */
const SIDE_KEY = 'collegare-gliederung-seite';
function useSideSlide(side: 'left' | 'right') {
  useEffect(() => {
    let prev: string | null = null;
    try {
      prev = sessionStorage.getItem(SIDE_KEY);
      sessionStorage.setItem(SIDE_KEY, side);
    } catch {}
    if (!prev || prev === side) return;
    const b = document.body;
    b.dataset.gSlide = side;
    const t = window.setTimeout(() => delete b.dataset.gSlide, 700);
    return () => window.clearTimeout(t);
  }, [side]);
}

/** prefer: auf Schreibseiten die passende Linie vorwählen (Ausarbeitung bzw. Präsentation), statt der zuletzt gewählten */
export function useLineTab(kinds: LineKind[], prefer?: LineKind): [LineKind, (k: LineKind) => void] {
  const [tab, setTab] = useState<LineKind>(prefer && kinds.includes(prefer) ? prefer : (kinds[0] ?? 'ausarb'));
  useEffect(() => {
    if (prefer && kinds.includes(prefer)) return;
    try {
      const t = localStorage.getItem(TAB_KEY) as LineKind | null;
      if (t && kinds.includes(t)) setTab(t);
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kinds.join()]);
  useEffect(() => {
    if (!kinds.includes(tab) && kinds[0]) setTab(kinds[0]);
  }, [kinds, tab]);
  return [
    tab,
    (k: LineKind) => {
      setTab(k);
      try {
        localStorage.setItem(TAB_KEY, k);
      } catch {}
    },
  ];
}

export function Gliederung(props0: GliederungProps) {
  const ask = useTeacherAsk(props0.teacher, props0.send);
  const props = { ...props0, send: ask.guarded };
  const { map, send, kinds, tab, onTab, onClose, side = 'right' } = props;
  const lines = linesOf(map);
  useSideSlide(side);
  const [both, setBoth] = useState(false);
  const [mine, setMine] = useState(false);
  const hasItems = (['praes', 'ausarb'] as const).some((k) => flatPoints(lines[k].points).some((r) => r.p.items.length));
  const editable = props.canEdit && !lines.locked;
  const put = (next: Lines) => send({ type: 'lines', lines: next });
  const color = LINE_COLOR[tab];

  return (
    <div className={`${g.wrap} ${side === 'left' ? g.fromLeft : g.fromRight}`} style={{ ['--metro' as string]: color }}>
      <div className={g.top}>
        {kinds.length > 1 ? (
          <div className={g.tabs} role="tablist" aria-label="Gliederung">
            <button role="tab" aria-selected={tab === 'praes'} className={`${g.tab} ${tab === 'praes' ? g.on : ''}`} style={{ ['--t' as string]: LINE_COLOR.praes }} onClick={() => onTab('praes')}>
              Präsentation
            </button>
            <button className={g.both} onClick={() => (props.bothHref ? (location.href = props.bothHref) : setBoth(true))} title="Beide Linien nebeneinander (Vollbild)" aria-label="Beide Linien nebeneinander">
              <Icon name="parallel" size={16} />
              <span>beides</span>
            </button>
            <button role="tab" aria-selected={tab === 'ausarb'} className={`${g.tab} ${tab === 'ausarb' ? g.on : ''}`} style={{ ['--t' as string]: LINE_COLOR.ausarb }} onClick={() => onTab('ausarb')}>
              Ausarbeitung
            </button>
          </div>
        ) : (
          <h3 className={g.single}>Gliederung · {LINE_LABEL[tab]}</h3>
        )}
        <div className={g.tools}>
          {(hasItems || lines.locked) && props.canEdit && (
            <button
              className={`btn icon ${lines.locked ? 'on' : ''}`}
              aria-pressed={lines.locked}
              onClick={() => void put({ ...clone(lines), locked: !lines.locked })}
              title={lines.locked ? 'Gesperrt: Die Gliederung ändert sich nicht, auch nicht aus der Mindmap. Klicken zum Öffnen.' : 'Gliederung sperren, damit die Überarbeitung mit Karten erhalten bleibt'}
              aria-label={lines.locked ? 'Gliederung entsperren' : 'Gliederung sperren'}
            >
              <Icon name={lines.locked ? 'lock' : 'unlock'} size={15} />
            </button>
          )}
          <label className={g.mine} title="Nur Objekte zeigen, die du angehängt hast">
            <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> nur meine
          </label>
          {onClose && (
            <button className="btn icon" onClick={onClose} title="Schließen" aria-label="Gliederung schließen">
              <Icon name="close" size={15} />
            </button>
          )}
        </div>
      </div>
      <Line {...props} kind={tab} lines={lines} editable={editable} put={put} mine={mine} />
      {both && (
        <div className={g.full} role="dialog" aria-label="Präsentation und Ausarbeitung nebeneinander">
          <div className={g.fullHead}>
            <span className={g.fullTitle} style={{ color: LINE_COLOR.praes }}>
              Präsentation
            </span>
            <Icon name="parallel" size={18} />
            <span className={g.fullTitle} style={{ color: LINE_COLOR.ausarb }}>
              Ausarbeitung
            </span>
            <span className="grow" />
            <label className={g.mine}>
              <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> nur meine
            </label>
            <button className="btn" onClick={() => setBoth(false)}>
              <Icon name="close" size={14} /> Schließen
            </button>
          </div>
          <Parallel {...props} lines={lines} editable={editable} put={put} mine={mine} />
        </div>
      )}
      {ask.dialog}
    </div>
  );
}

interface LineCtx extends GliederungProps {
  lines: Lines;
  editable: boolean;
  put: (l: Lines) => Promise<boolean>;
  mine: boolean;
  /** Parallelansicht: Texte der Abschnitte zum Vergleich ausklappen */
  compare?: boolean;
}

/** Texte der Abschnitte beider Linien (für „Texte vergleichen“), nach Abschnitt; lädt alle 15 Sekunden neu */
function useSectionTexts(docs: GliederungProps['docs'], on: boolean) {
  const [texts, setTexts] = useState<Record<LineKind, Record<string, string>> | null>(null);
  const project = docs?.project;
  const scope = docs?.scope ?? null;
  useEffect(() => {
    if (!on || !project) return;
    let live = true;
    const group = (r: { docs: { sectionId: string; body: string | null }[] }) => {
      const out: Record<string, string> = {};
      for (const d of r.docs) if (d.body?.trim()) out[d.sectionId] = (out[d.sectionId] ? out[d.sectionId] + '\n\n' : '') + d.body.trim();
      return out;
    };
    const load = () =>
      Promise.all((['praes', 'ausarb'] as const).map((k) => get<{ docs: { sectionId: string; body: string | null }[] }>(`/api/projects/${project}/documents?linie=${k}${scope ? `&bereich=${encodeURIComponent(scope)}` : ''}`))).then(
        ([a, b]) => live && setTexts({ praes: group(a), ausarb: group(b) }),
        () => {},
      );
    void load();
    const t = setInterval(load, 15000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [on, project, scope]);
  return texts;
}

/** Text eines Abschnitts schlicht lesbar: Überschriften fett, Auszeichnungen und Escapes weg */
function SectionText({ body }: { body: string | undefined }) {
  if (!body) return <p className={g.noText}>noch kein Text</p>;
  return (
    <div className={g.text}>
      {body.split('\n').map((line, i) => {
        const h = /^#{1,6}\s+/.test(line);
        const t = line.replace(/^#{1,6}\s+/, '').replace(/\\([\\*_`[\]{}^])/g, '$1').replace(/(\*\*|__)(.+?)\1/g, '$2');
        return h ? <b key={i}>{t}</b> : t.trim() ? <p key={i}>{t}</p> : null;
      })}
    </div>
  );
}

function useDrops(ctx: LineCtx, kind: LineKind) {
  const { lines, put, meId, editable } = ctx;
  const [over, setOver] = useState<string | null>(null);
  const accept = (e: React.DragEvent) => editable && (isChatDrag(e) || e.dataTransfer.types.includes(ITEM_MIME) || e.dataTransfer.types.includes(POINT_MIME));
  /**
   * point: Ziel-Punkt (null = neuer Punkt am Ende), into: in dieses Objekt legen, before: vor dieses Objekt,
   * after: abgelegt auf der Linie, neuer Punkt unter dieser Zeile (null = ganz oben)
   */
  const drop = (e: React.DragEvent, point: string | null, into: string | null = null, before: string | null = null, after?: string | null) => {
    const fresh = (l0: Lines, title: string) => {
      const np = newPoint(title);
      const l = after !== undefined ? insertAfterRow(l0, kind, after, np) : clone(l0);
      if (after === undefined) l[kind].points.push(np);
      return { l, id: np.id };
    };
    if (!accept(e)) return;
    e.preventDefault();
    e.stopPropagation();
    setOver(null);
    const pointRaw = e.dataTransfer.getData(POINT_MIME);
    if (pointRaw) {
      // Punkt auf die Linie gezogen: dort einsetzen; auf einen Punkt gezogen: dahinter; ans Ende: ans Ende
      const pm = JSON.parse(pointRaw) as { kind: LineKind; id: string };
      const rows = flatPoints(lines[kind].points);
      const at = after !== undefined ? after : point ? point : rows.length ? '^' + lines[kind].points[lines[kind].points.length - 1].id : null;
      if (at === pm.id || at === '^' + pm.id) return;
      return void put(movePointAfter(lines, kind, pm.kind, pm.id, at));
    }
    const moving = e.dataTransfer.getData(ITEM_MIME);
    if (moving) {
      if (moving === into || moving === before) return;
      let l = lines;
      let target = point;
      if (!target) {
        const f = fresh(l, findItemLabel(lines, moving) ?? 'Neuer Punkt');
        l = f.l;
        target = f.id;
      }
      return void put(moveItem(l, moving, { kind, point: target, into, before }));
    }
    const d = readChatDrop(e);
    if (!d) return;
    const label = (d.note?.title || d.body.split('\n')[0] || 'Beitrag').slice(0, 200);
    const it = { note: d.note?.id ?? null, card: null, label, kind: d.note ? 'note' : 'chat', visible: true, by: meId };
    if (!point) {
      const f = fresh(lines, label);
      return void put(addItem(f.l, kind, f.id, it));
    }
    let l = addItem(lines, kind, point, it, into);
    if (before) {
      // neues Objekt landet am Ende; vor das Ziel schieben
      const found = flatPoints(l[kind].points).find((r) => r.p.id === point)?.p;
      const last = found ? lastItem(found.items, into) : null;
      if (last) l = moveItem(l, last.id, { kind, point, before });
    }
    void put(l);
  };
  const allow = (key: string) => (e: React.DragEvent) => {
    if (!accept(e)) return;
    e.preventDefault();
    e.stopPropagation();
    // Punkt aus der anderen Linie: wird verdoppelt (Kopiecursor)
    const fromOther = e.dataTransfer.types.includes(POINT_MIME + '-' + (kind === 'praes' ? 'ausarb' : 'praes'));
    e.dataTransfer.dropEffect = !fromOther && (e.dataTransfer.types.includes(ITEM_MIME) || e.dataTransfer.types.includes(POINT_MIME)) ? 'move' : 'copy';
    if (over !== key) setOver(key);
  };
  return { over, setOver, drop, allow };
}
function findItemLabel(l: Lines, id: string): string | null {
  for (const k of ['praes', 'ausarb'] as const)
    for (const r of flatPoints(l[k].points)) {
      const f = findIn(r.p.items, id);
      if (f) return f.label;
    }
  return null;
}
const findIn = (items: LineItem[], id: string): LineItem | null => {
  for (const it of items) {
    if (it.id === id) return it;
    const f = findIn(it.items, id);
    if (f) return f;
  }
  return null;
};
function lastItem(items: LineItem[], into: string | null): LineItem | null {
  if (!into) return items[items.length - 1] ?? null;
  for (const it of items) {
    if (it.id === into) return it.items[it.items.length - 1] ?? null;
    const f = lastItem(it.items, into);
    if (f) return f;
  }
  return null;
}

/**
 * Schiene über der Linie: Objekte direkt auf die Linie legen erzeugt dort einen neuen Punkt. Ein Klick auf die Linie
 * öffnet an der Stelle die Eingabe, die zugleich sucht (Jo, 22. November 2026).
 */
function Rail({ ctx, kind, dz, fallback = null }: { ctx: LineCtx; kind: LineKind; dz: ReturnType<typeof useDrops>; fallback?: string | null }) {
  const [at, setAt] = useState<{ after: string | null; y: number } | null>(null);
  return (
    <>
    <div
      className={`${g.rail} ${dz.over === 'rail' || at ? g.railOver : ''}`}
      style={at ? { ['--gy' as string]: at.y + 'px' } : undefined}
      onClick={(e) => {
        const spot = railSpot(e.currentTarget, e.clientY);
        setAt({ after: spot.after ?? fallback, y: spot.y });
      }}
      data-line-drop={JSON.stringify({ kind, point: null, after: fallback })}
      data-line-rail=""
      onDragOver={(e) => {
        dz.allow('rail')(e);
        e.currentTarget.style.setProperty('--gy', railSpot(e.currentTarget, e.clientY).y + 'px');
      }}
      onDragLeave={() => dz.setOver(null)}
      onDrop={(e) => dz.drop(e, null, null, null, railSpot(e.currentTarget, e.clientY).after ?? fallback)}
      title="Klicken: neuer Punkt an dieser Stelle (oder suchen). Hierher ziehen: neuer Punkt mit dem Objekt"
    />
    {at && (
      <div className={g.railInput} style={{ top: at.y }}>
        <PointSearch ctx={ctx} kind={kind} after={at.after} onDone={() => setAt(null)} />
      </div>
    )}
    </>
  );
}

/**
 * Eingabe für einen neuen Punkt, die zugleich sucht: Karten und Äste der Mindmap, Punkte der anderen Linie (werden
 * verdoppelt) und entfernte Punkte (kommen zurück). Enter ohne Auswahl legt einen neuen Punkt mit dem Text an.
 * after: Zeile, hinter der eingesetzt wird (null = ganz oben, undefined = am Ende).
 */
type Hit = { kind: 'card' | 'other' | 'gone'; id: string; title: string; note: string };
function PointSearch({ ctx, kind, after, onDone }: { ctx: LineCtx; kind: LineKind; after: string | null | undefined; onDone: () => void }) {
  const { lines, map, put } = ctx;
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(-1);
  const other: LineKind = kind === 'praes' ? 'ausarb' : 'praes';
  const hits = useMemo((): Hit[] => {
    const t = q.trim().toLowerCase();
    if (!t) return [];
    const here = allPoints(lines[kind].points).filter((p) => !p.removed);
    const cardsHere = new Set(here.map((p) => p.card).filter(Boolean));
    const keysHere = new Set(here.map((p) => p.key));
    const out: Hit[] = [];
    const has = (s: string) => s.toLowerCase().includes(t);
    for (const p of allPoints(lines[kind].points)) if (p.removed && has(titleOf(map, p))) out.push({ kind: 'gone', id: p.id, title: titleOf(map, p), note: 'entfernt, zurückholen' });
    if (ctx.kinds.length > 1)
      for (const p of allPoints(lines[other].points))
        if (!p.removed && !keysHere.has(p.key) && has(titleOf(map, p))) out.push({ kind: 'other', id: p.id, title: titleOf(map, p), note: `aus der ${LINE_LABEL[other]}` });
    for (const c of Object.values(map.cards))
      if (c.title && !cardsHere.has(c.id) && !keysHere.has(c.id) && has(c.title)) out.push({ kind: 'card', id: c.id, title: c.title, note: c.kind === 'cluster' ? 'Ast aus der Mindmap' : 'Karte aus der Mindmap' });
    return out.slice(0, 7);
  }, [q, lines, map, kind, other, ctx.kinds.length]);
  const endAt = () => {
    const pts = lines[kind].points.filter((p) => !p.removed);
    return pts.length ? '^' + pts[pts.length - 1].id : null;
  };
  const place = (l: Lines, p: LinePoint) => {
    if (after !== undefined) return insertAfterRow(l, kind, after, p);
    const n = clone(l);
    n[kind].points.push(p);
    return n;
  };
  function pick(i: number) {
    const h = hits[i];
    const at = after === undefined ? endAt() : after;
    if (!h) {
      const t = q.trim();
      if (t) void put(place(lines, newPoint(t.slice(0, 200))));
    } else if (h.kind === 'card') {
      void put(place(lines, pointFromCard(map, map.cards[h.id], true)));
    } else if (h.kind === 'other') {
      void put(movePointAfter(lines, kind, other, h.id, at));
    } else {
      const l = patchPoint(lines, kind, h.id, (x) => (x.removed = false));
      void put(at === h.id || at === '^' + h.id ? l : movePointAfter(l, kind, kind, h.id, at));
    }
    onDone();
  }
  return (
    <form
      className={g.search}
      onSubmit={(e) => {
        e.preventDefault();
        pick(sel);
      }}
    >
      <input
        autoFocus
        value={q}
        onChange={(e) => (setQ(e.target.value), setSel(-1))}
        onBlur={() => !q.trim() && setTimeout(onDone, 150)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onDone();
          if (e.key === 'ArrowDown') (e.preventDefault(), setSel((i) => Math.min(hits.length - 1, i + 1)));
          if (e.key === 'ArrowUp') (e.preventDefault(), setSel((i) => Math.max(-1, i - 1)));
        }}
        placeholder="Neuer Punkt oder suchen …"
        maxLength={200}
        aria-label="Neuer Punkt oder suchen"
      />
      {q.trim() && (
        <ul className={g.hits} role="listbox">
          <li role="option" aria-selected={sel === -1} className={sel === -1 ? g.hitOn : ''} onMouseDown={(e) => (e.preventDefault(), pick(-1))}>
            <Icon name="plus" size={12} /> <b>{q.trim()}</b> <span>neuer Punkt</span>
          </li>
          {hits.map((h, i) => (
            <li key={h.kind + h.id} role="option" aria-selected={sel === i} className={sel === i ? g.hitOn : ''} onMouseDown={(e) => (e.preventDefault(), pick(i))}>
              <b>{h.title}</b> <span>{h.note}</span>
            </li>
          ))}
        </ul>
      )}
    </form>
  );
}

function Line(ctx: LineCtx & { kind: LineKind }) {
  const { kind, lines, editable, put } = ctx;
  const pts = lines[kind].points;
  const rows = useMemo(() => flatPoints(pts), [pts]);
  const gone = useMemo(() => allRemoved(pts), [pts]);
  const dz = useDrops(ctx, kind);

  return (
    <div className={g.line}>
      {!rows.length && <p className={`muted ${g.hint}`}>{lines.locked ? 'Die Gliederung ist gesperrt.' : 'Noch leer.'}</p>}
      <ol className={g.track}>
        {editable && <Rail ctx={ctx} kind={kind} dz={dz} />}
        {rows.map((r, i) => (
          <PointView key={r.p.id} ctx={ctx} kind={kind} p={r.p} level={r.level} rows={rows} index={i} dz={dz} />
        ))}
        {editable && <EndPlus ctx={ctx} kind={kind} dz={dz} />}
      </ol>
      {gone.length > 0 && (
        <details className={g.gone}>
          <summary>Entfernt ({gone.length})</summary>
          {gone.map((p) => (
            <div key={p.id} className={g.goneRow}>
              <span className={g.goneTitle}>{titleOf(ctx.map, p)}</span>
              {editable && (
                <>
                  <button className="btn" onClick={() => void put(patchPoint(lines, kind, p.id, (x) => (x.removed = false)))}>
                    Zurückholen
                  </button>
                  <button className="btn icon" onClick={() => void put(deletePoint(lines, kind, p.id))} title="Endgültig löschen" aria-label="Endgültig löschen">
                    <Icon name="close" size={14} />
                  </button>
                </>
              )}
            </div>
          ))}
        </details>
      )}
    </div>
  );
}

/** Plus im Kreis am Ende der Linie (Jo, 22. November 2026): neuer Punkt; auch Ziel zum Ablegen am Ende */
function EndPlus({ ctx, kind, dz }: { ctx: LineCtx; kind: LineKind; dz: ReturnType<typeof useDrops> }) {
  const [adding, setAdding] = useState(false);
  return (
    <li
      className={`${g.end} ${dz.over === 'end' ? g.over : ''}`}
      data-line-drop={JSON.stringify({ kind, point: null })}
      onDragOver={dz.allow('end')}
      onDragLeave={() => dz.setOver(null)}
      onDrop={(e) => dz.drop(e, null)}
    >
      <button className={g.plusStop} onClick={() => setAdding(true)} title="Neuer Punkt am Ende der Linie" aria-label="Neuer Punkt">
        <Icon name="plus" size={14} />
      </button>
      {adding ? (
        <div className={g.addForm}>
          <PointSearch ctx={ctx} kind={kind} after={undefined} onDone={() => setAdding(false)} />
        </div>
      ) : (
        <button type="button" className={g.endLabel} onClick={() => setAdding(true)}>
          neuer Punkt
        </button>
      )}
    </li>
  );
}

function allRemoved(pts: LinePoint[], out: LinePoint[] = []): LinePoint[] {
  for (const p of pts) {
    if (p.removed) out.push(p);
    else allRemoved(p.sub, out);
  }
  return out;
}

const titleOf = (m: MindMap, p: LinePoint) => (p.card && m.cards[p.card]?.title) || p.title || 'Ohne Titel';
const depthBelow = (p: LinePoint): number => (p.sub.length ? 1 + Math.max(...p.sub.map(depthBelow)) : 0);

/** Eine Station; alle Ebenen sitzen auf derselben Linie (groß, mittel, Punkt in der Linie, Strich) */
function PointView({ ctx, kind, p, level, rows, index, dz }: { ctx: LineCtx; kind: LineKind; p: LinePoint; level: number; rows: { p: LinePoint; level: number }[]; index: number; dz: ReturnType<typeof useDrops> }) {
  const { lines, editable, put, map, people } = ctx;
  const [edit, setEdit] = useState(false);
  const [draft, setDraft] = useState('');
  const [flip, setFlip] = useState(false);
  const card = p.card ? map.cards[p.card] : null;
  const ownerId = p.noOwners ? p.owner : (card?.owner ?? p.owner);
  const owner = ownerId != null ? people.find((x) => x.id === ownerId)?.name : null;
  const key = 'p:' + p.id;
  const shared = ctx.kinds.length > 1 && sharedKeys(lines).has('k' + p.key);
  const other: LineKind = kind === 'praes' ? 'ausarb' : 'praes';
  // Geschwister für oben/unten
  const sib = rows.filter((r, i) => r.level === level && sameParent(rows, i, index));
  const pos = sib.findIndex((r) => r.p.id === p.id);
  const prevSame = rows.slice(0, index).reverse().find((r) => r.level <= level);
  const canIndent = !!prevSame && prevSame.level === level && level + depthBelow(p) < MAX_LEVELS - 1;

  async function rename() {
    setEdit(false);
    const t = draft.trim();
    if (!t || t === titleOf(map, p)) return;
    // Punkte aus der Mindmap: der Titel gehört der Karte, damit beide gleich bleiben
    if (card) await ctx.send({ type: 'update', id: card.id, patch: { title: t.slice(0, 200) } });
    else await put(patchPoint(lines, kind, p.id, (x) => (x.title = t.slice(0, 200))));
  }

  return (
    <li className={`${g.point} ${g['l' + level]} ${p.card ? '' : g.dashed} ${p.hidden ? g.hiddenPt : ''} ${p.color ? g.colored : ''}`} style={p.color ? { ['--pc' as string]: p.color } : undefined}>
      <div
        className={`${g.head} ${dz.over === key ? g.over : ''}`}
        data-row={p.id}
        draggable={editable && !edit}
        onDragStart={(e) => {
          // Punkt samt Unterpunkten ziehen: auf die Linie (dazwischen einsetzen) oder auf einen anderen Punkt (dahinter)
          if ((e.target as HTMLElement).closest('button, select, input')) return e.preventDefault();
          e.dataTransfer.setData(POINT_MIME, JSON.stringify({ kind, id: p.id }));
          e.dataTransfer.setData(POINT_MIME + '-' + kind, '1');
          e.dataTransfer.setData('text/plain', titleOf(map, p));
          e.dataTransfer.effectAllowed = 'move';
        }}
        data-line-drop={JSON.stringify({ kind, point: p.id })}
        onDragOver={dz.allow(key)}
        onDragLeave={() => dz.setOver(null)}
        onDrop={(e) => dz.drop(e, p.id)}
      >
        <span className={g.stop} data-stop aria-hidden />
        {edit ? (
          <input
            className={g.titleInput}
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => void rename()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              if (e.key === 'Escape') setEdit(false);
            }}
            maxLength={200}
          />
        ) : (
          <span className={g.title} onDoubleClick={() => editable && (setDraft(titleOf(map, p)), setEdit(true))} title={p.card ? 'aus der Mindmap' : 'nur in der Gliederung (nicht in der Mindmap)'}>
            {titleOf(map, p)}
          </span>
        )}
        {shared && (
          <button
            className={`${g.sharedMark} ${flip ? g.sharedOn : ''}`}
            onClick={() => setFlip((f) => !f)}
            aria-pressed={flip}
            title={`Auch in der ${LINE_LABEL[other]}: Karte umdrehen und die Rückseite zeigen`}
            aria-label={`Rückseite: ${LINE_LABEL[other]}`}
            style={{ ['--o' as string]: LINE_COLOR[other] }}
          />
        )}
        {owner && <span className={g.owner}>{owner}</span>}
        {editable && (
          <span className={g.actions}>
            {!card && level === 0 && (
              <select
                className={g.ownerSel}
                value={p.owner ?? ''}
                onChange={(e) => void put(patchPoint(lines, kind, p.id, (x) => (x.owner = e.target.value ? Number(e.target.value) : null)))}
                title="Wer ist zuständig?"
                aria-label="Zuständig"
              >
                <option value="">niemand</option>
                {people.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </select>
            )}
            {ctx.kinds.length > 1 && !shared && (
              <button className="btn icon" onClick={() => void put(copyPoint(lines, kind, p.id))} title={`Auch in die ${LINE_LABEL[other]} übernehmen`} aria-label={`In die ${LINE_LABEL[other]}`}>
                <Icon name="copy" size={13} />
              </button>
            )}
            {level > 0 && (
              <button className="btn icon" onClick={() => void put(indentPoint(lines, kind, p.id, -1))} title="Eine Ebene höher" aria-label="Ausrücken">
                <Icon name="outdent" size={13} />
              </button>
            )}
            {canIndent && (
              <button className="btn icon" onClick={() => void put(indentPoint(lines, kind, p.id, 1))} title="Eine Ebene tiefer (unter den Punkt davor)" aria-label="Einrücken">
                <Icon name="indent" size={13} />
              </button>
            )}
            <button className="btn icon" disabled={pos <= 0} onClick={() => void put(movePoint(lines, kind, p.id, -1))} title="Nach oben" aria-label="Nach oben">
              <Icon name="up" size={13} />
            </button>
            <button className="btn icon" disabled={pos < 0 || pos >= sib.length - 1} onClick={() => void put(movePoint(lines, kind, p.id, 1))} title="Nach unten" aria-label="Nach unten">
              <Icon name="down" size={13} />
            </button>
            <button
              className="btn icon"
              onClick={() => void put(patchPoint(lines, kind, p.id, (x) => (x.hidden = !x.hidden)))}
              title={p.hidden ? 'Ausgeblendet: zählt nicht für Ausarbeitung und Folien. Klicken zum Einblenden.' : 'Ausblenden (bleibt in der Gliederung, erscheint in der Mindmap grau)'}
              aria-label={p.hidden ? 'Einblenden' : 'Ausblenden'}
            >
              <Icon name={p.hidden ? 'eyeOff' : 'eye'} size={13} />
            </button>
            <button className="btn icon" onClick={() => void put(patchPoint(lines, kind, p.id, (x) => (x.removed = true)))} title="Aus der Gliederung nehmen (in der Mindmap grau)" aria-label="Entfernen">
              <Icon name="close" size={13} />
            </button>
          </span>
        )}
      </div>
      {flip && shared && <Backside ctx={ctx} kind={kind} p={p} onClose={() => setFlip(false)} />}
      {p.items.length > 0 && <Items ctx={ctx} kind={kind} point={p.id} items={p.items} dz={dz} depth={0} />}
    </li>
  );
}

/**
 * Rückseite eines Punkts (Jo, 22. November 2026): derselbe Punkt in der anderen Linie, wie die Rückseite einer Karte.
 * Unterschiede sind markiert: Unterpunkte nur dort (+) oder nur hier (−), anderer Titel, ausgeblendet, Objekte.
 */
function Backside({ ctx, kind, p, onClose }: { ctx: LineCtx; kind: LineKind; p: LinePoint; onClose: () => void }) {
  const { lines, map } = ctx;
  const other: LineKind = kind === 'praes' ? 'ausarb' : 'praes';
  const twin = allPoints(lines[other].points).find((x) => x.key === p.key && !x.removed);
  if (!twin) return null;
  const subsOf = (x: LinePoint) => flatPoints(x.sub).map((r) => ({ key: r.p.key, title: titleOf(map, r.p), level: r.level }));
  const front = subsOf(p);
  const back = subsOf(twin);
  const frontKeys = new Set(front.map((r) => r.key));
  const backKeys = new Set(back.map((r) => r.key));
  const onlyHere = front.filter((r) => !backKeys.has(r.key));
  const diffTitle = titleOf(map, twin) !== titleOf(map, p);
  const count = (items: LineItem[]): number => items.reduce((n, it) => n + 1 + count(it.items), 0);
  const same = !diffTitle && !onlyHere.length && back.every((r) => frontKeys.has(r.key)) && twin.hidden === p.hidden && count(twin.items) === count(p.items);
  return (
    <div className={g.back} style={{ ['--o' as string]: LINE_COLOR[other] }} role="region" aria-label={`Rückseite: ${LINE_LABEL[other]}`}>
      <div className={g.backHead}>
        <span className={g.backKind}>Rückseite · {LINE_LABEL[other]}</span>
        <span className="grow" />
        {ctx.kinds.length > 1 && (
          <button className={g.backGo} onClick={() => ctx.onTab(other)} title={`Zur ${LINE_LABEL[other]} wechseln`}>
            zur {LINE_LABEL[other]}
          </button>
        )}
        <button className="btn icon" onClick={onClose} title="Karte zurückdrehen" aria-label="Rückseite schließen">
          <Icon name="close" size={12} />
        </button>
      </div>
      <div className={`${g.backTitle} ${diffTitle ? g.diff : ''}`}>{titleOf(map, twin)}</div>
      {twin.hidden && <div className={g.backNote}>dort ausgeblendet</div>}
      {back.length > 0 && (
        <ul className={g.backSubs}>
          {back.map((r) => (
            <li key={'b' + r.key} className={frontKeys.has(r.key) ? '' : g.onlyThere} style={{ paddingInlineStart: r.level * 12 }} title={frontKeys.has(r.key) ? 'auf beiden Seiten' : `nur in der ${LINE_LABEL[other]}`}>
              {frontKeys.has(r.key) ? '·' : '+'} {r.title}
            </li>
          ))}
          {onlyHere.map((r) => (
            <li key={'f' + r.key} className={g.onlyHere} title={`nur in der ${LINE_LABEL[kind]}`}>
              − {r.title}
            </li>
          ))}
        </ul>
      )}
      {!back.length && onlyHere.length > 0 && (
        <ul className={g.backSubs}>
          {onlyHere.map((r) => (
            <li key={'f' + r.key} className={g.onlyHere} title={`nur in der ${LINE_LABEL[kind]}`}>
              − {r.title}
            </li>
          ))}
        </ul>
      )}
      {count(twin.items) > 0 && (
        <div className={g.backNote}>
          {count(twin.items)} {count(twin.items) === 1 ? 'Objekt' : 'Objekte'}: {twin.items.map((it) => it.label).join(', ')}
        </div>
      )}
      {same && <div className={g.backNote}>Beide Seiten stimmen überein.</div>}
    </div>
  );
}
/** Haben die Zeilen i und j (gleiche Ebene) denselben Elternpunkt? Kein flacherer Punkt dazwischen. */
function sameParent(rows: { level: number }[], i: number, j: number): boolean {
  const lv = rows[j].level;
  const [a, b] = i < j ? [i, j] : [j, i];
  for (let k = a + 1; k < b; k++) if (rows[k].level < lv) return false;
  return true;
}

function Items({ ctx, kind, point, items, dz, depth }: { ctx: LineCtx; kind: LineKind; point: string; items: LineItem[]; dz: ReturnType<typeof useDrops>; depth: number }) {
  const { lines, editable, put, mine, meId, map } = ctx;
  const shared = ctx.kinds.length > 1 ? sharedKeys(lines) : new Set<string>();
  return (
    <ul className={g.items}>
      {items
        .filter((it) => !mine || it.by === meId || it.items.some((x) => x.by === meId))
        .map((it) => {
          const key = 'i:' + it.id;
          const info = it.note ? ctx.noteInfo?.(it.note) : undefined;
          const label = (info ? info.label : it.card ? map.cards[it.card]?.title : undefined) || it.label || 'Objekt';
          const kindLabel = KIND[info?.kind ?? it.kind] ?? it.kind;
          const both = (it.note && shared.has('n' + it.note)) || (it.card && shared.has('c' + it.card));
          return (
            <li
              key={it.id}
              className={`${g.item} ${it.visible ? '' : g.hiddenItem} ${dz.over === key ? g.over : ''} ${dz.over === 'b:' + it.id ? g.before : ''}`}
              style={{ ['--lvl' as string]: depth }}
              draggable={editable}
              onDragStart={(e) => {
                e.stopPropagation();
                e.dataTransfer.setData(ITEM_MIME, it.id);
                e.dataTransfer.setData('text/plain', label);
                e.dataTransfer.effectAllowed = 'move';
              }}
              onDragOver={(e) => {
                // obere Kante: davor einsortieren, sonst hineinlegen
                const r = e.currentTarget.getBoundingClientRect();
                const top = e.clientY - r.top < Math.min(14, r.height * 0.3);
                dz.allow(top ? 'b:' + it.id : key)(e);
              }}
              onDragLeave={() => dz.setOver(null)}
              onDrop={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                const top = e.clientY - r.top < Math.min(14, r.height * 0.3);
                dz.drop(e, point, top ? null : it.id, top ? it.id : null);
              }}
            >
              <div className={g.itemHead}>
                <span className={g.kind}>{kindLabel}</span>
                <span className={g.itemTitle}>{label}</span>
                {both && <span className={g.bothTag}>in beiden</span>}
                {editable && (
                  <>
                    <button
                      className="btn icon"
                      onClick={() => void put(patchItem(lines, it.id, (x) => (x.visible = !x.visible)))}
                      title={it.visible ? 'Sichtbar: erscheint auf derselben Folie bzw. im selben Absatz. Klicken zum Ausblenden.' : 'Ausgeblendet: bleibt als Beleg dabei. Klicken zum Einblenden.'}
                      aria-label={it.visible ? 'Ausblenden' : 'Einblenden'}
                      aria-pressed={it.visible}
                    >
                      <Icon name={it.visible ? 'eye' : 'eyeOff'} size={13} />
                    </button>
                    <button className="btn icon" onClick={() => void put(dropItem(lines, it.id))} title="Abhängen (die Notiz bleibt)" aria-label="Abhängen">
                      <Icon name="close" size={13} />
                    </button>
                  </>
                )}
              </div>
              {it.items.length > 0 && <Items ctx={ctx} kind={kind} point={point} items={it.items} dz={dz} depth={depth + 1} />}
            </li>
          );
        })}
    </ul>
  );
}

/**
 * Beide Linien nebeneinander (Jo, 22. November 2026): gleiche Punkte auf einer Höhe, verbunden durch eine hellgraue
 * Linie. Stehen gleiche Punkte vertauscht, verbindet sie eine graue Linie mit zwei Bögen; ein Klick darauf stellt den
 * Punkt der Präsentation seinem Gegenstück gegenüber. Am Ende jeder Linie ein Plus für einen neuen Punkt.
 */
function Parallel(ctx: LineCtx) {
  const { lines, editable, put, map } = ctx;
  const texts = useSectionTexts(ctx.docs, !!ctx.compare);
  const [shut, setShut] = useState<Set<string>>(new Set());
  const sectionOf = (p: LinePoint) => (p.card && map.cards[p.card] ? p.card : p.id);
  const rows = alignRows(
    lines.praes.points.filter((p) => !p.removed),
    lines.ausarb.points.filter((p) => !p.removed),
  );
  const dzA = useDrops(ctx, 'praes');
  const dzB = useDrops(ctx, 'ausarb');
  // Hauptpunkt vor der Zeile i in einer Linie (für Ablegen auf der Linie in einer Lücke oder über dem ersten Punkt)
  const prevOf = (side: 'left' | 'right', i: number) => {
    for (let k = i - 1; k >= 0; k--) if (rows[k][side]) return '^' + rows[k][side]!.id;
    return null;
  };
  // vertauschte Paare: links nur in Zeile i, rechts nur in Zeile j, gleicher Schlüssel
  const swaps = rows.flatMap((r, i) => {
    if (!r.left || r.right) return [];
    const j = rows.findIndex((x) => !x.left && x.right?.key === r.left!.key);
    return j >= 0 ? [{ i, j, id: r.left.id }] : [];
  });
  const box = useRef<HTMLDivElement>(null);
  const [arcs, setArcs] = useState<{ id: string; d: string }[]>([]);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const on = () => setTick((t) => t + 1);
    addEventListener('resize', on);
    return () => removeEventListener('resize', on);
  }, []);
  useLayoutEffect(() => {
    const b = box.current?.getBoundingClientRect();
    if (!b || !box.current) return;
    const stop = (i: number, side: string) => {
      const el = box.current!.querySelector<HTMLElement>(`[data-prow="${i}"] [data-side="${side}"] [data-stop]`);
      const r = el?.getBoundingClientRect();
      return r ? { x: r.left + r.width / 2 - b.left + box.current!.scrollLeft, y: r.top + r.height / 2 - b.top + box.current!.scrollTop } : null;
    };
    const next = swaps.flatMap((s) => {
      const a = stop(s.i, 'left');
      const z = stop(s.j, 'right');
      if (!a || !z) return [];
      const mx = (a.x + z.x) / 2;
      return [{ id: s.id, d: `M${a.x} ${a.y} C${mx} ${a.y} ${mx} ${z.y} ${z.x} ${z.y}` }];
    });
    if (JSON.stringify(next) !== JSON.stringify(arcs)) setArcs(next);
  });
  void tick;
  const cell = (kind: LineKind, p: LinePoint | null, dz: ReturnType<typeof useDrops>, i: number) => {
    const flat = p ? flatPoints([p]) : [];
    return (
      <ol className={`${g.track} ${g.pTrack}`} style={{ ['--metro' as string]: LINE_COLOR[kind] }}>
        {editable && <Rail ctx={ctx} kind={kind} dz={dz} fallback={prevOf(kind === 'praes' ? 'left' : 'right', i)} />}
        {flat.map((r, i) => (
          <PointView key={r.p.id} ctx={ctx} kind={kind} p={r.p} level={r.level} rows={flat} index={i} dz={dz} />
        ))}
        {!p && <li className={g.gap} />}
      </ol>
    );
  };
  return (
    <div className={g.parallel} ref={box} data-parallel>
      <svg className={g.arcs} aria-hidden={!arcs.length}>
        {arcs.map((a) => (
          <g key={a.id} className={editable ? g.arcLive : ''} onClick={() => editable && void put(alignPoint(lines, 'praes', a.id, rows))}>
            <title>Vertauscht: klicken, damit beide Punkte einander gegenüberstehen</title>
            <path className={g.arcHit} d={a.d} />
            <path className={g.arc} d={a.d} />
          </g>
        ))}
      </svg>
      {rows.map((r, i) => {
        const rk = (r.left?.id ?? '') + (r.right?.id ?? '');
        const open = !shut.has(rk);
        return (
        <Fragment key={rk}>
        <div className={g.row} data-prow={i}>
          <div className={`${g.left} ${g.mirror}`} data-side="left">
            {cell('praes', r.left, dzA, i)}
          </div>
          <div className={g.bridge} aria-hidden data-bridge>
            {r.left && r.right && <span className={g.connector} />}
          </div>
          <div className={g.right} data-side="right">
            {cell('ausarb', r.right, dzB, i)}
          </div>
        </div>
        {ctx.compare && (
          <div className={`${g.row} ${g.textRow} ${open ? '' : g.textShut}`}>
            <div className={`${g.left} ${g.textCell}`} style={{ ['--metro' as string]: LINE_COLOR.praes }}>
              {open && r.left && <SectionText body={texts?.praes[sectionOf(r.left)]} />}
            </div>
            <div className={g.bridge}>
              <button
                className={g.textToggle}
                onClick={() => setShut((s0) => {
                  const n = new Set(s0);
                  if (n.has(rk)) n.delete(rk);
                  else n.add(rk);
                  return n;
                })}
                aria-expanded={open}
                title={open ? 'Texte einklappen' : 'Texte ausklappen'}
                aria-label={open ? 'Texte einklappen' : 'Texte ausklappen'}
              >
                <Icon name={open ? 'up' : 'down'} size={12} />
              </button>
            </div>
            <div className={`${g.right} ${g.textCell}`} style={{ ['--metro' as string]: LINE_COLOR.ausarb }}>
              {open && r.right && <SectionText body={texts?.ausarb[sectionOf(r.right)]} />}
            </div>
          </div>
        )}
        </Fragment>
        );
      })}
      {editable && (
        <div className={g.row}>
          <div className={`${g.left} ${g.mirror}`}>
            <ol className={`${g.track} ${g.endTrack}`} style={{ ['--metro' as string]: LINE_COLOR.praes }}>
              <EndPlus ctx={ctx} kind="praes" dz={dzA} />
            </ol>
          </div>
          <div className={g.bridge} aria-hidden />
          <div className={g.right}>
            <ol className={`${g.track} ${g.endTrack}`} style={{ ['--metro' as string]: LINE_COLOR.ausarb }}>
              <EndPlus ctx={ctx} kind="ausarb" dz={dzB} />
            </ol>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Seite „Gliederung“ (Jo, 22. November 2026): beide Linien nebeneinander oder eine Linie links (die Seite zeigt daneben
 * die Ausarbeitung bzw. die Präsentation). Sperre und „nur meine“ stehen oben rechts über der Fläche.
 */
export function GliederungBoard(props0: GliederungProps & { mode: 'both' | LineKind }) {
  const ask = useTeacherAsk(props0.teacher, props0.send);
  const props = { ...props0, send: ask.guarded };
  const { map, send, mode } = props;
  const lines = linesOf(map);
  const [mine, setMine] = useState(false);
  const [compare, setCompare] = useState(false);
  const editable = props.canEdit && !lines.locked;
  const put = (next: Lines) => send({ type: 'lines', lines: next });
  const hasItems = (['praes', 'ausarb'] as const).some((k) => flatPoints(lines[k].points).some((r) => r.p.items.length));
  const ctx: LineCtx = { ...props, lines, editable, put, mine, compare };
  return (
    <div className={`${g.board} ${mode === 'both' ? '' : g.boardSingle}`} style={{ ['--metro' as string]: LINE_COLOR[mode === 'both' ? 'ausarb' : mode] }}>
      <div className={g.boardTools}>
        {(hasItems || lines.locked) && props.canEdit && (
          <button
            className={`btn icon ${lines.locked ? 'on' : ''}`}
            aria-pressed={lines.locked}
            onClick={() => void put({ ...clone(lines), locked: !lines.locked })}
            title={lines.locked ? 'Gesperrt: Die Gliederung ändert sich nicht, auch nicht aus der Mindmap. Klicken zum Öffnen.' : 'Gliederung sperren, damit die Überarbeitung mit Karten erhalten bleibt'}
            aria-label={lines.locked ? 'Gliederung entsperren' : 'Gliederung sperren'}
          >
            <Icon name={lines.locked ? 'lock' : 'unlock'} size={15} />
          </button>
        )}
        {mode === 'both' && props.docs && (
          <label className={g.mine} title="Unter jedem Punkt die Texte aus Präsentation und Ausarbeitung nebeneinander, auf gleicher Höhe">
            <input type="checkbox" checked={compare} onChange={(e) => setCompare(e.target.checked)} /> Texte vergleichen
          </label>
        )}
        <label className={g.mine} title="Nur Objekte zeigen, die du angehängt hast">
          <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> nur meine
        </label>
      </div>
      {mode === 'both' ? <Parallel {...ctx} /> : <Line {...ctx} kind={mode} />}
      {ask.dialog}
    </div>
  );
}

/** Vorübergehende Ansicht eines Asts oder Clusters als Linie (Wunsch Jo, 21. November 2026); nichts wird gespeichert */
export function LinePreview({ rows, color, onClose, onTake, taken }: { rows: { id: string; title: string; level: number }[]; color: string; onClose: () => void; onTake?: () => void; taken?: boolean }) {
  return (
    <div className={g.preview} style={{ ['--metro' as string]: color }} role="dialog" aria-label="Als Gliederung" data-ui onPointerDown={(e) => e.stopPropagation()}>
      <div className={g.previewHead}>
        <span className={g.previewTitle}>Als Gliederung</span>
        <span className="grow" />
        {onTake && (
          <button className={`btn ${taken ? 'on' : ''}`} onClick={onTake} disabled={taken} title="In die Gliederung übernehmen">
            {taken ? <><Icon name="check" size={13} /> In der Gliederung</> : 'Übernehmen'}
          </button>
        )}
        <button className="btn icon" onClick={onClose} title="Schließen" aria-label="Schließen">
          <Icon name="close" size={14} />
        </button>
      </div>
      <ol className={g.track}>
        {rows.map((r) => (
          <li key={r.id} className={`${g.point} ${g['l' + r.level]}`}>
            <div className={g.head}>
              <span className={g.stop} aria-hidden />
              <span className={g.title}>{r.title}</span>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
