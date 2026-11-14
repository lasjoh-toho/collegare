'use client';
/**
 * Gruppenbildung als Kanban (Konzept Phase 0), Gestaltung nach brausa CardKanban.svelte:
 * Säulen mit farbigem Punkt, Titel, Zähler und Zahnrad; zart eingefärbte Spaltenflächen;
 * Karten mit Farbkante, Ziehen mit Einfügemarke, Ablagezone unten, Karten-Ansicht als Dialog.
 *
 * Erste Säule „Noch ohne Gruppe“. Lehrkräfte ziehen alle Karten; Lernende im Wahlmodus nur die eigene.
 * Ohne Ziehen geht alles auch über „Verschieben nach …“ in der Karten-Ansicht (Tastatur, Screenreader).
 */
import { useRef, useState } from 'react';
import { ApiError, del, get, patch, post } from '@/lib/api';
import { COLUMN_COLORS, groupColor } from '@/lib/colors';
import type { Board, BoardMember, ProjectSettings } from '@/lib/types';
import k from './board.module.css';

const POOL = '__pool';

interface Props {
  projectId: number;
  board: Board;
  settings: ProjectSettings;
  role: 'teacher' | 'student';
  meId: number;
  onError: (msg: string) => void;
}

interface Drag {
  userId: number;
  x: number;
  y: number;
  col: string | null;
  before: number | '__end' | null;
}

export function GroupBoard({ projectId, board, settings, role, meId, onError }: Props) {
  const teacher = role === 'teacher';
  const choiceOpen =
    !teacher && settings.groupFormation !== 'teacher' && (settings.choiceDeadline === null || Date.now() <= settings.choiceDeadline);
  const myGroup = board.members.find((m) => m.userId === meId)?.groupId ?? null;

  const [drag, setDrag] = useState<Drag | null>(null);
  const [gear, setGear] = useState<number | null>(null);
  const [viewing, setViewing] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [editing, setEditing] = useState<number | null>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  // Themen aus der Themen-Mindmap als Gruppen übernehmen (Wunsch Jo, 14. November 2026)
  const [fromMap, setFromMap] = useState<{ title: string; kind: 'cluster' | 'card'; exists: boolean; on: boolean }[] | null>(null);
  async function openFromMap() {
    try {
      const r = await get<{ suggestions: { title: string; kind: 'cluster' | 'card'; exists: boolean }[] }>(`/api/projects/${projectId}/groups/vorschlaege`);
      setFromMap(r.suggestions.map((x) => ({ ...x, on: !x.exists && x.kind === 'cluster' })));
    } catch (e) {
      onError(e instanceof ApiError ? e.message : String(e));
    }
  }
  async function takeFromMap() {
    const titles = (fromMap ?? []).filter((x) => x.on && x.title.trim()).map((x) => x.title.trim());
    setFromMap(null);
    if (titles.length) await run(post(`/api/projects/${projectId}/groups/viele`, { titles }));
  }

  const columns = [{ id: POOL, title: 'Noch ohne Gruppe', color: '#a3a39e', groupId: null as number | null }, ...board.groups.map((g, i) => ({ id: String(g.id), title: g.title, color: groupColor(g.color, i), groupId: g.id as number | null }))];
  const membersOf = (gid: number | null) => board.members.filter((m) => m.groupId === gid).sort((a, b) => a.position - b.position);
  const canDrag = (m: BoardMember) => teacher || (choiceOpen && m.userId === meId);

  const run = async (p: Promise<unknown>) => {
    try {
      await p;
    } catch (e) {
      onError(e instanceof ApiError ? e.message : String(e));
    }
  };

  function moveTo(userId: number, groupId: number | null, position: number) {
    if (teacher) return run(post(`/api/projects/${projectId}/moves`, { userId, groupId, position }));
    return run(post(`/api/projects/${projectId}/choose`, { groupId }));
  }

  function down(e: React.PointerEvent, m: BoardMember) {
    if (e.button !== 0 || (e.target as HTMLElement).closest('button')) return;
    if (!canDrag(m)) return void setViewing(m.userId);
    e.preventDefault();
    const sx = e.clientX;
    const sy = e.clientY;
    let active = false;
    let last: Drag | null = null;
    const move = (ev: PointerEvent) => {
      if (!active && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 5) return;
      if (!active) document.body.classList.add('dragging');
      active = true;
      const el = document.elementFromPoint(ev.clientX, ev.clientY);
      const col = el?.closest<HTMLElement>('[data-col]')?.dataset.col ?? null;
      const under = el?.closest<HTMLElement>('[data-mcard]');
      let before: Drag['before'] = null;
      if (under && Number(under.dataset.mcard) !== m.userId) {
        const r = under.getBoundingClientRect();
        const next = under.nextElementSibling as HTMLElement | null;
        before = ev.clientY < r.top + r.height / 2 ? Number(under.dataset.mcard) : next?.dataset.mcard ? Number(next.dataset.mcard) : '__end';
      }
      last = { userId: m.userId, x: ev.clientX, y: ev.clientY, col, before };
      setDrag(last);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      document.body.classList.remove('dragging');
      setDrag(null);
      if (!active) return void setViewing(m.userId);
      const d = last;
      if (!d?.col) return;
      const groupId = d.col === POOL ? null : Number(d.col);
      const list = membersOf(groupId).filter((x) => x.userId !== m.userId);
      const at = typeof d.before === 'number' ? list.findIndex((x) => x.userId === d.before) : -1;
      void moveTo(m.userId, groupId, at < 0 ? list.length : at);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  async function addGroup() {
    const title = newTitle.trim();
    setAdding(false);
    setNewTitle('');
    if (!teacher && !title) return;
    await run(post(`/api/projects/${projectId}/groups`, { title }));
  }

  const viewed = viewing !== null ? board.members.find((m) => m.userId === viewing) : undefined;
  const canEditTitle = (gid: number | null) => gid !== null && (teacher || (settings.studentsSetTopic && gid === myGroup));
  const count = (gid: number | null) => membersOf(gid).length;

  return (
    <div className={k.wrap}>
      {!teacher && (
        <p className={k.hint}>
          {choiceOpen
            ? settings.groupFormation === 'open'
              ? 'Zieh deine Karte in eine Gruppe oder lege eine neue an.'
              : `Zieh deine Karte in eine Gruppe (höchstens ${settings.groupMax} Personen).`
            : 'Die Gruppen teilt deine Lehrkraft ein.'}
          {choiceOpen && settings.choiceDeadline !== null && ` Wahl offen bis ${new Date(settings.choiceDeadline).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })}.`}
        </p>
      )}
      <div className={k.board} ref={boardRef} style={{ ['--n' as string]: columns.length }}>
        <div className={k.cols}>
          {columns.map((c, i) => (
            <div key={c.id} className={k.col}>
            <div className={k.colhead} style={{ ['--cc' as string]: c.color }} onDoubleClick={() => canEditTitle(c.groupId) && setEditing(c.groupId)}>
              <span className={k.dot} />
              {editing !== null && editing === c.groupId ? (
                <input
                  className={k.titleInput}
                  defaultValue={c.title}
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') e.currentTarget.blur();
                    if (e.key === 'Escape') setEditing(null);
                  }}
                  onBlur={(e) => {
                    setEditing(null);
                    if (e.currentTarget.value !== c.title) void run(patch(`/api/projects/${projectId}/groups/${c.groupId}`, { title: e.currentTarget.value }));
                  }}
                />
              ) : (
                <span className={k.name} title={c.title}>
                  {c.groupId === null ? c.title : c.title || <span className="muted">Thema offen</span>}
                </span>
              )}
              <span className={k.n}>
                {count(c.groupId)}
                {c.groupId !== null && settings.groupFormation !== 'teacher' ? ` / ${settings.groupMax}` : ''}
              </span>
              {!teacher && choiceOpen && c.groupId !== myGroup && (c.groupId === null || count(c.groupId) < settings.groupMax) && (
                <button className="btn icon" title="Hierher wechseln" onClick={() => void moveTo(meId, c.groupId, 0)}>
                  ↓
                </button>
              )}
              {canEditTitle(c.groupId) && (
                <button className={`btn icon ${gear === c.groupId ? 'on' : ''}`} title="Einstellungen der Säule" onClick={() => setGear(gear === c.groupId ? null : c.groupId)}>
                  ⚙
                </button>
              )}
              {gear !== null && gear === c.groupId && (
                <div className={`pop ${k.colset}`}>
                  <input className="input" defaultValue={c.title} placeholder="Thema" onBlur={(e) => e.currentTarget.value !== c.title && void run(patch(`/api/projects/${projectId}/groups/${c.groupId}`, { title: e.currentTarget.value }))} />
                  {teacher && (
                    <>
                      <div className={k.swatches}>
                        {COLUMN_COLORS.map((col) => (
                          <button key={col} className={`${k.sw} ${col === c.color ? k.swOn : ''}`} style={{ background: col }} aria-label={col} onClick={() => void run(patch(`/api/projects/${projectId}/groups/${c.groupId}`, { color: col }))} />
                        ))}
                      </div>
                      <div className="row">
                        <button className="btn icon" aria-label="nach links" disabled={i <= 1} onClick={() => void reorder(c.groupId!, -1)}>
                          ←
                        </button>
                        <button className="btn icon" aria-label="nach rechts" disabled={i >= columns.length - 1} onClick={() => void reorder(c.groupId!, 1)}>
                          →
                        </button>
                        <span className="grow" />
                        <button
                          className="btn danger"
                          onClick={() => {
                            setGear(null);
                            void run(del(`/api/projects/${projectId}/groups/${c.groupId}`));
                          }}
                        >
                          Säule entfernen
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
            <div className={`${k.cell} ${drag?.col === c.id ? k.over : ''}`} data-col={c.id} style={{ ['--cc' as string]: c.color }}>
              {membersOf(c.groupId).map((m) => (
                <div
                  key={m.userId}
                  className={`${k.card} ${drag?.userId === m.userId ? k.ghost : ''} ${drag?.before === m.userId ? k.before : ''} ${m.userId === meId ? k.me : ''} ${canDrag(m) ? k.draggable : ''}`}
                  data-mcard={m.userId}
                  style={{ ['--c' as string]: c.color }}
                  role="button"
                  tabIndex={0}
                  onPointerDown={(e) => down(e, m)}
                  onKeyDown={(e) => e.key === 'Enter' && setViewing(m.userId)}
                >
                  <div className={k.t}>{m.name}</div>
                  {m.roleLabel && <div className={k.x}>{m.roleLabel}</div>}
                </div>
              ))}
              {drag?.col === c.id && drag.before === '__end' && <div className={k.endMark} />}
            </div>
            </div>
          ))}
          <div className={`${k.colhead} ${k.add}`}>
            {(teacher || (choiceOpen && settings.groupFormation === 'open')) &&
              (adding ? (
                <input
                  className="input"
                  autoFocus
                  value={newTitle}
                  placeholder="Thema (kann leer bleiben)"
                  onChange={(e) => setNewTitle(e.target.value)}
                  onKeyDown={(e) => (e.key === 'Enter' ? void addGroup() : e.key === 'Escape' && setAdding(false))}
                  onBlur={() => void addGroup()}
                />
              ) : (
                <>
                  <button className="btn" onClick={() => setAdding(true)}>
                    + {teacher ? 'Gruppe' : 'Neue Gruppe'}
                  </button>
                  {teacher && (
                    <button className="btn" onClick={() => void openFromMap()} title="Gruppen aus der Themen-Mindmap">
                      Aus der Themen-Mindmap …
                    </button>
                  )}
                </>
              ))}
          </div>
        </div>

      </div>

      {fromMap && (
        <div className="modal-bg" onPointerDown={(e) => e.target === e.currentTarget && setFromMap(null)}>
          <div className="modal" role="dialog" aria-label="Gruppen aus der Themen-Mindmap">
            <h2>Gruppen aus der Themen-Mindmap</h2>
            {fromMap.length === 0 ? (
              <p className="muted">Die Themen-Mindmap hat noch keine Cluster oder Karten.</p>
            ) : (
              <>
                <p className="muted">Wähle die Themen, aus denen Gruppen werden. Du kannst sie hier umbenennen und später im Board weiter anpassen.</p>
                <div className={k.fromMap}>
                  {fromMap.map((x, i) => (
                    <label key={i} className={k.fromMapRow}>
                      <input type="checkbox" checked={x.on} onChange={(e) => setFromMap(fromMap.map((y, j) => (j === i ? { ...y, on: e.target.checked } : y)))} />
                      <input className="input" value={x.title} maxLength={255} onChange={(e) => setFromMap(fromMap.map((y, j) => (j === i ? { ...y, title: e.target.value, on: true } : y)))} />
                      <span className="muted">{x.kind === 'cluster' ? 'Cluster' : 'Karte'}{x.exists ? ' · gibt es schon' : ''}</span>
                    </label>
                  ))}
                </div>
              </>
            )}
            <div className="row">
              <span className="grow" />
              <button className="btn" onClick={() => setFromMap(null)}>
                Abbrechen
              </button>
              <button className="btn primary" disabled={!fromMap.some((x) => x.on)} onClick={() => void takeFromMap()}>
                {(() => {
                  const n = fromMap.filter((x) => x.on).length;
                  return n === 1 ? 'Eine Gruppe anlegen' : `${n} Gruppen anlegen`;
                })()}
              </button>
            </div>
          </div>
        </div>
      )}

      {drag && (
        <div className={k.float} style={{ left: drag.x + 8, top: drag.y + 8 }}>
          {board.members.find((m) => m.userId === drag.userId)?.name}
        </div>
      )}

      {viewed && (
        <MemberViewer
          member={viewed}
          projectId={projectId}
          columns={columns}
          settings={settings}
          teacher={teacher}
          sameGroup={myGroup !== null && viewed.groupId === myGroup}
          canMove={canDrag(viewed)}
          onMove={(gid) => moveTo(viewed.userId, gid, Number.MAX_SAFE_INTEGER)}
          run={run}
          onClose={() => setViewing(null)}
        />
      )}
    </div>
  );

  async function reorder(groupId: number, by: number) {
    const ids = board.groups.map((g) => g.id);
    const i = ids.indexOf(groupId);
    if (i < 0 || i + by < 0 || i + by >= ids.length) return;
    [ids[i], ids[i + by]] = [ids[i + by], ids[i]];
    await run(post(`/api/projects/${projectId}/groups/order`, { order: ids }));
  }
}

function MemberViewer(props: {
  member: BoardMember;
  projectId: number;
  columns: { id: string; title: string; groupId: number | null }[];
  settings: ProjectSettings;
  teacher: boolean;
  sameGroup: boolean;
  canMove: boolean;
  onMove: (gid: number | null) => Promise<unknown>;
  run: (p: Promise<unknown>) => Promise<void>;
  onClose: () => void;
}) {
  const { member: m, projectId, columns, settings, teacher, run } = props;
  const canRole = teacher || props.sameGroup;
  const roles = settings.roles;
  const [free, setFree] = useState(m.roleLabel && !roles.includes(m.roleLabel) ? m.roleLabel : '');

  return (
    <div className="modal-bg" onPointerDown={(e) => e.target === e.currentTarget && props.onClose()}>
      <div className="modal" role="dialog" aria-label={m.name}>
        <h2>{m.name}</h2>
        {props.canMove && (
          <div className="field">
            <label>Verschieben nach …</label>
            <select value={m.groupId ?? ''} onChange={(e) => void props.onMove(e.target.value === '' ? null : Number(e.target.value))}>
              {columns.map((c) => (
                <option key={c.id} value={c.groupId ?? ''}>
                  {c.groupId === null ? c.title : c.title || 'Gruppe ohne Thema'}
                </option>
              ))}
            </select>
          </div>
        )}
        {canRole && m.groupId !== null && (
          <div className="field">
            <label>Rolle in der Gruppe</label>
            <select value={m.roleLabel && roles.includes(m.roleLabel) ? m.roleLabel : m.roleLabel ? '__free' : ''} onChange={(e) => e.target.value !== '__free' && void run(post(`/api/projects/${projectId}/roles`, { userId: m.userId, label: e.target.value || null }))}>
              <option value="">keine</option>
              {roles.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
              {settings.freeRoles && <option value="__free">eigene Rolle …</option>}
            </select>
            {settings.freeRoles && (
              <input className="input" placeholder="eigene Rolle" value={free} onChange={(e) => setFree(e.target.value)} onBlur={() => free.trim() && void run(post(`/api/projects/${projectId}/roles`, { userId: m.userId, label: free.trim() }))} />
            )}
          </div>
        )}
        <div className="row">
          {teacher && (
            <button
              className="btn danger"
              onClick={() => {
                if (confirm(`${m.name} aus dem Projekt entfernen? Die Zugangscodes werden gesperrt.`)) {
                  void run(del(`/api/projects/${projectId}/students/${m.userId}`));
                  props.onClose();
                }
              }}
            >
              Aus dem Projekt entfernen
            </button>
          )}
          <span className="grow" />
          <button className="btn primary" onClick={props.onClose}>
            Fertig
          </button>
        </div>
      </div>
    </div>
  );
}
