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
import { useEffect, useMemo, useState } from 'react';
import { isChatDrag, readChatDrop } from '@/lib/chatDrag';
import {
  addItem,
  alignRows,
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
import g from './gliederung.module.css';

const ITEM_MIME = 'application/x-collegare-lineitem';
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
}

/** Ziel eines Ablegens aus der Mindmap (Zeiger, kein HTML-Ziehen): steht als data-line-drop an Punkten und am Ende */
export interface LineDropTarget {
  kind: LineKind;
  point: string | null;
}
export function lineTargetAt(x: number, y: number): LineDropTarget | null {
  for (const n of document.elementsFromPoint(x, y)) {
    const raw = (n as HTMLElement).closest?.('[data-line-drop]')?.getAttribute('data-line-drop');
    if (raw) {
      try {
        return JSON.parse(raw) as LineDropTarget;
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
    const t = (n as HTMLElement).closest?.('[data-line-drop]');
    if (t) return void t.setAttribute('data-line-over', '1');
  }
}

export function useLineTab(kinds: LineKind[]): [LineKind, (k: LineKind) => void] {
  const [tab, setTab] = useState<LineKind>(kinds[0] ?? 'ausarb');
  useEffect(() => {
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

export function Gliederung(props: GliederungProps) {
  const { map, send, kinds, tab, onTab, onClose } = props;
  const lines = linesOf(map);
  const [both, setBoth] = useState(false);
  const [mine, setMine] = useState(false);
  const hasItems = (['praes', 'ausarb'] as const).some((k) => lines[k].points.some((p) => p.items.length || p.sub.some((s) => s.items.length)));
  const editable = props.canEdit && !lines.locked;
  const put = (next: Lines) => send({ type: 'lines', lines: next });
  const color = LINE_COLOR[tab];

  return (
    <div className={g.wrap} style={{ ['--metro' as string]: color }}>
      <div className={g.top}>
        {kinds.length > 1 ? (
          <div className={g.tabs} role="tablist" aria-label="Gliederung">
            <button role="tab" aria-selected={tab === 'praes'} className={`${g.tab} ${tab === 'praes' ? g.on : ''}`} style={{ ['--t' as string]: LINE_COLOR.praes }} onClick={() => onTab('praes')}>
              Präsentation
            </button>
            <button className={g.both} onClick={() => setBoth(true)} title="Beide Linien nebeneinander (Vollbild)" aria-label="Beide Linien nebeneinander">
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
    </div>
  );
}

interface LineCtx extends GliederungProps {
  lines: Lines;
  editable: boolean;
  put: (l: Lines) => Promise<boolean>;
  mine: boolean;
}

function useDrops(ctx: LineCtx, kind: LineKind) {
  const { lines, put, meId, editable } = ctx;
  const [over, setOver] = useState<string | null>(null);
  const accept = (e: React.DragEvent) => editable && (isChatDrag(e) || e.dataTransfer.types.includes(ITEM_MIME));
  /** point: Ziel-Punkt (null = neuer Punkt am Ende), into: in dieses Objekt legen, before: vor dieses Objekt */
  const drop = (e: React.DragEvent, point: string | null, into: string | null = null, before: string | null = null) => {
    if (!accept(e)) return;
    e.preventDefault();
    e.stopPropagation();
    setOver(null);
    const moving = e.dataTransfer.getData(ITEM_MIME);
    if (moving) {
      if (moving === into || moving === before) return;
      let l = lines;
      let target = point;
      if (!target) {
        const np = newPoint('Neuer Punkt');
        l = clone(l);
        l[kind].points.push(np);
        target = np.id;
      }
      return void put(moveItem(l, moving, { kind, point: target, into, before }));
    }
    const d = readChatDrop(e);
    if (!d) return;
    const label = (d.note?.title || d.body.split('\n')[0] || 'Beitrag').slice(0, 200);
    const it = { note: d.note?.id ?? null, card: null, label, kind: d.note ? 'note' : 'chat', visible: true, by: meId };
    if (!point) {
      const np = newPoint(label);
      const l = clone(lines);
      l[kind].points.push(np);
      return void put(addItem(l, kind, np.id, it));
    }
    let l = addItem(lines, kind, point, it, into);
    if (before) {
      // neues Objekt landet am Ende; vor das Ziel schieben
      const found = l[kind].points.flatMap((p) => [p, ...p.sub]).find((p) => p.id === point);
      const last = found ? lastItem(found.items, into) : null;
      if (last) l = moveItem(l, last.id, { kind, point, before });
    }
    void put(l);
  };
  const allow = (key: string) => (e: React.DragEvent) => {
    if (!accept(e)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = e.dataTransfer.types.includes(ITEM_MIME) ? 'move' : 'copy';
    if (over !== key) setOver(key);
  };
  return { over, setOver, drop, allow };
}
function lastItem(items: LineItem[], into: string | null): LineItem | null {
  if (!into) return items[items.length - 1] ?? null;
  for (const it of items) {
    if (it.id === into) return it.items[it.items.length - 1] ?? null;
    const f = lastItem(it.items, into);
    if (f) return f;
  }
  return null;
}

function Line(ctx: LineCtx & { kind: LineKind }) {
  const { kind, lines, editable, put } = ctx;
  const pts = lines[kind].points;
  const live = pts.filter((p) => !p.removed);
  const gone = useMemo(() => pts.flatMap((p) => [p, ...p.sub]).filter((p) => p.removed), [pts]);
  const dz = useDrops(ctx, kind);
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const endTarget = JSON.stringify({ kind, point: null });

  return (
    <div className={g.line}>
      {!live.length && (
        <p className={`muted ${g.hint}`}>
          {editable
            ? 'Noch leer. Zieht Äste und Ideen aus der Mindmap hierher oder tippt dort „In die Gliederung“. Notizen zieht ihr auf einen Punkt.'
            : lines.locked
              ? 'Die Gliederung ist gesperrt.'
              : 'Noch keine Gliederung.'}
        </p>
      )}
      <ol className={g.track}>
        {live.map((p, i) => (
          <PointView key={p.id} ctx={ctx} kind={kind} p={p} first={i === 0} last={i === live.length - 1} dz={dz} />
        ))}
        {editable && (
          <li
            className={`${g.end} ${dz.over === 'end' ? g.over : ''}`}
            data-line-drop={endTarget}
            onDragOver={dz.allow('end')}
            onDragLeave={() => dz.setOver(null)}
            onDrop={(e) => dz.drop(e, null)}
          >
            <span className={g.stopEmpty} aria-hidden />
            {adding ? (
              <form
                className={g.addForm}
                onSubmit={(e) => {
                  e.preventDefault();
                  if (title.trim()) {
                    const l = clone(lines);
                    l[kind].points.push(newPoint(title.trim()));
                    void put(l);
                  }
                  setTitle('');
                  setAdding(false);
                }}
              >
                <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} onBlur={() => !title.trim() && setAdding(false)} placeholder="Titel des neuen Punkts" maxLength={200} />
              </form>
            ) : (
              <button className={g.addBtn} onClick={() => setAdding(true)}>
                <Icon name="plus" size={14} /> Punkt · oder hierher ziehen
              </button>
            )}
          </li>
        )}
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

const titleOf = (m: MindMap, p: LinePoint) => (p.card && m.cards[p.card]?.title) || p.title || 'Ohne Titel';

function PointView({ ctx, kind, p, first, last, dz, sub = false }: { ctx: LineCtx; kind: LineKind; p: LinePoint; first: boolean; last: boolean; dz: ReturnType<typeof useDrops>; sub?: boolean }) {
  const { lines, editable, put, map, people } = ctx;
  const [edit, setEdit] = useState(false);
  const [draft, setDraft] = useState('');
  const card = p.card ? map.cards[p.card] : null;
  const ownerId = card?.owner ?? p.owner;
  const owner = ownerId != null ? people.find((x) => x.id === ownerId)?.name : null;
  const key = 'p:' + p.id;
  const subs = p.sub.filter((s) => !s.removed);
  const shared = ctx.kinds.length > 1 && sharedKeys(lines).has('k' + p.key);
  const other: LineKind = kind === 'praes' ? 'ausarb' : 'praes';

  async function rename() {
    setEdit(false);
    const t = draft.trim();
    if (!t || t === titleOf(map, p)) return;
    // Punkte aus der Mindmap: der Titel gehört der Karte, damit beide gleich bleiben
    if (card) await ctx.send({ type: 'update', id: card.id, patch: { title: t.slice(0, 200) } });
    else await put(patchPoint(lines, kind, p.id, (x) => (x.title = t.slice(0, 200))));
  }

  return (
    <li className={`${g.point} ${sub ? g.sub : ''} ${p.card ? '' : g.dashed} ${p.hidden ? g.hiddenPt : ''}`}>
      <div
        className={`${g.head} ${dz.over === key ? g.over : ''}`}
        data-line-drop={JSON.stringify({ kind, point: p.id })}
        onDragOver={dz.allow(key)}
        onDragLeave={() => dz.setOver(null)}
        onDrop={(e) => dz.drop(e, p.id)}
      >
        <span className={g.stop} aria-hidden />
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
          <span
            className={g.title}
            onDoubleClick={() => editable && (setDraft(titleOf(map, p)), setEdit(true))}
            title={p.card ? 'aus der Mindmap' : 'nur in der Gliederung (nicht in der Mindmap)'}
          >
            {titleOf(map, p)}
          </span>
        )}
        {shared && (
          <span className={g.sharedMark} title={`auch in der ${LINE_LABEL[other]}`} style={{ ['--o' as string]: LINE_COLOR[other] }} aria-label={`auch in der ${LINE_LABEL[other]}`} />
        )}
        {owner && <span className={g.owner}>{owner}</span>}
        {editable && (
          <span className={g.actions}>
            {!card && !sub && (
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
            <button className="btn icon" disabled={first} onClick={() => void put(movePoint(lines, kind, p.id, -1))} title="Nach oben" aria-label="Nach oben">
              <Icon name="up" size={13} />
            </button>
            <button className="btn icon" disabled={last} onClick={() => void put(movePoint(lines, kind, p.id, 1))} title="Nach unten" aria-label="Nach unten">
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
      {p.items.length > 0 && <Items ctx={ctx} kind={kind} point={p.id} items={p.items} dz={dz} depth={0} />}
      {subs.length > 0 && (
        <ol className={g.subs}>
          {subs.map((s, i) => (
            <PointView key={s.id} ctx={ctx} kind={kind} p={s} first={i === 0} last={i === subs.length - 1} dz={dz} sub />
          ))}
        </ol>
      )}
    </li>
  );
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

/** Beide Linien nebeneinander, gleiche Punkte in derselben Zeile und durch eine Querverbindung gekoppelt */
function Parallel(ctx: LineCtx) {
  const { lines } = ctx;
  const rows = alignRows(
    lines.praes.points.filter((p) => !p.removed),
    lines.ausarb.points.filter((p) => !p.removed),
  );
  const dzA = useDrops(ctx, 'praes');
  const dzB = useDrops(ctx, 'ausarb');
  const cell = (kind: LineKind, p: LinePoint | null, dz: ReturnType<typeof useDrops>, i: number) =>
    p ? (
      <ol className={`${g.track} ${g.pTrack}`} style={{ ['--metro' as string]: LINE_COLOR[kind] }}>
        <PointView ctx={ctx} kind={kind} p={p} first={i === 0} last={false} dz={dz} />
      </ol>
    ) : (
      <div className={g.gap} style={{ ['--metro' as string]: LINE_COLOR[kind] }} />
    );
  return (
    <div className={g.parallel}>
      <div className={g.pHint}>
        Gleiche Punkte stehen in einer Zeile und sind verbunden. Mit <Icon name="copy" size={12} /> übernehmt ihr einen Punkt in die andere Linie; Objekte zieht ihr von überall auf die Punkte.
      </div>
      {rows.map((r, i) => (
        <div key={(r.left?.id ?? '') + (r.right?.id ?? '')} className={`${g.row} ${r.left && r.right ? g.linked : ''}`}>
          <div className={g.left}>{cell('praes', r.left, dzA, i)}</div>
          <div className={g.bridge} aria-hidden>
            <span className={g.rail} style={{ background: LINE_COLOR.praes }} />
            {r.left && r.right && <span className={g.connector} />}
            <span className={g.rail} style={{ background: LINE_COLOR.ausarb }} />
          </div>
          <div className={g.right}>{cell('ausarb', r.right, dzB, i)}</div>
        </div>
      ))}
      {ctx.editable && (
        <div className={g.row}>
          <div className={g.left}>
            <div className={`${g.endP} ${dzA.over === 'end' ? g.over : ''}`} onDragOver={dzA.allow('end')} onDragLeave={() => dzA.setOver(null)} onDrop={(e) => dzA.drop(e, null)} data-line-drop={JSON.stringify({ kind: 'praes', point: null })}>
              hierher ziehen: neuer Punkt
            </div>
          </div>
          <div className={g.bridge} aria-hidden>
            <span className={g.rail} style={{ background: LINE_COLOR.praes }} />
            <span className={g.rail} style={{ background: LINE_COLOR.ausarb }} />
          </div>
          <div className={g.right}>
            <div className={`${g.endP} ${dzB.over === 'end' ? g.over : ''}`} onDragOver={dzB.allow('end')} onDragLeave={() => dzB.setOver(null)} onDrop={(e) => dzB.drop(e, null)} data-line-drop={JSON.stringify({ kind: 'ausarb', point: null })}>
              hierher ziehen: neuer Punkt
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
