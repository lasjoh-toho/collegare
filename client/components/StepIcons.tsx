'use client';
/**
 * Schritte eines Projekts als quadratische Symbole auf der Projektkarte (Wunsch Jo, nach Autogra.fi): vorgesehene
 * Schritte erscheinen, die gerade offenen farbig, die anderen grau. Ein Klick öffnet „Schritte für die Lernenden“.
 *
 * Seit 22. November 2026 (Jo) ist das ein großes, immer gleich liegendes Fenster über der Übersicht statt eines kleinen
 * Aufklappers, der beim Scrollen mitsprang und zuging. Darin je Schritt: vorgesehen, offen / zu / Zeitraum / nach
 * Freigabe, die Daten in einer Zeile, die Oberflächen des Schritts als Alternativen zum Ankreuzen (z. B. Präsentation:
 * Pinnwand, Folien) und unten der Zeitplan als Gantt-Grafik zum Ziehen.
 */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { get, patch } from '@/lib/api';
import { PHASE_ORDER, fmtDay, phaseList, phaseTools, toolOn, type PhaseKey } from '@/lib/phases';
import type { PhaseSetting, ProjectSettings, ProjectView } from '@/lib/types';
import { Icon } from './Icon';
import st from './steps.module.css';

type Phases = ProjectSettings['phases'];
const DAY = 86_400_000;
const SETTINGS = { groupFormation: 'teacher', groupMin: 2, groupMax: 4, choiceDeadline: null, finishLock: true, docTypes: {} } as unknown as ProjectSettings;

/** Tagesanfang in Ortszeit */
const dayStart = (ms: number) => {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};
/** Ende eines Tages: 23:59 Ortszeit, damit „bis Freitag“ den ganzen Freitag einschließt */
const dayEnd = (ms: number) => dayStart(ms) + DAY - 60_000;
const toDate = (ms: number | null) => {
  if (ms === null) return '';
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const fromDate = (v: string, end: boolean) => {
  if (!v) return null;
  const [y, m, d] = v.split('-').map(Number);
  const ms = new Date(y, m - 1, d).getTime();
  return end ? dayEnd(ms) : ms;
};

export function StepIcons({
  projectId,
  phases,
  editable,
  small = false,
  wide = false,
  onChange,
}: {
  projectId: number;
  phases: Phases;
  editable: boolean;
  small?: boolean;
  /** Symbole über die ganze Breite der Karte verteilen (wie die Schritt-Knöpfe auf den Karten in Autogra.fi) */
  wide?: boolean;
  onChange?: (p: Phases) => void;
}) {
  const [open, setOpen] = useState(false);
  const list = phaseList({ ...SETTINGS, phases }, false);
  const shown = list.filter((p) => p.state !== 'off');
  return (
    <div className={`${st.wrap} ${small ? st.small : ''} ${wide ? st.wide : ''}`}>
      <div className={st.icons}>
        {shown.map((p) => (
          <button
            key={p.key}
            type="button"
            className={`${st.icon} ${p.state === 'open' ? st.open : st.grey}`}
            title={`${p.title}: ${p.badge}`}
            aria-label={`${p.title}: ${p.badge}`}
            onClick={(e) => {
              e.preventDefault();
              if (editable) setOpen(true);
            }}
            disabled={!editable}
          >
            <Icon name={p.icon} size={small ? 13 : 15} />
          </button>
        ))}
        {!shown.length && <span className="muted">keine Schritte vorgesehen</span>}
        {editable && (
          <button type="button" className={`btn icon ${st.edit}`} onClick={() => setOpen(true)} title="Schritte festlegen" aria-label="Schritte festlegen" aria-expanded={open}>
            <Icon name="gear" size={13} />
          </button>
        )}
      </div>
      {open && createPortal(<StepsDialog projectId={projectId} onClose={() => setOpen(false)} onPhases={onChange} />, document.body)}
    </div>
  );
}

/** Fenster „Schritte für die Lernenden“: immer gleich groß und an derselben Stelle, unabhängig vom Knopf. */
export function StepsDialog({ projectId, onClose, onPhases }: { projectId: number; onClose: () => void; onPhases?: (p: Phases) => void }) {
  const [view, setView] = useState<ProjectView | null>(null);
  const [s, setS] = useState<ProjectSettings | null>(null);
  const [err, setErr] = useState('');
  const [saved, setSaved] = useState(false);
  // immer der neueste Stand, auch wenn zwei Änderungen schnell nacheinander kommen
  const cur = useRef<ProjectSettings | null>(null);
  const savedTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    get<ProjectView>(`/api/projects/${projectId}`).then(
      (v) => {
        setView(v);
        setS(v.settings);
        cur.current = v.settings;
      },
      (e) => setErr(e instanceof Error ? e.message : String(e)),
    );
  }, [projectId]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    addEventListener('keydown', key);
    const before = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      removeEventListener('keydown', key);
      document.body.style.overflow = before;
    };
  }, [onClose]);

  async function save(part: Partial<ProjectSettings>) {
    const prev = cur.current!;
    const next = { ...prev, ...part };
    cur.current = next;
    setS(next);
    setErr('');
    try {
      await patch(`/api/projects/${projectId}`, { settings: part });
      if (part.phases) onPhases?.(next.phases);
      setSaved(true);
      clearTimeout(savedTimer.current);
      savedTimer.current = setTimeout(() => setSaved(false), 1500);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Speichern fehlgeschlagen');
      cur.current = prev;
      setS(prev);
    }
  }
  const setPhase = (key: string, ph: PhaseSetting) => save({ phases: { ...cur.current!.phases, [key]: ph } });
  const setPhases = (phases: Phases) => save({ phases });

  const single = view?.mode === 'single';
  const list = s ? phaseList(s, single) : [];
  // Wer ein Konzept freigegeben bekommen kann: Gruppen, bei Einzelarbeit die Lernenden
  const concepts: { id: number; title: string }[] = !view
    ? []
    : single
      ? view.board.members.map((m) => ({ id: m.userId, title: m.name }))
      : view.board.groups.map((g) => ({ id: g.id, title: g.title }));

  return (
    <div className={`modal-bg ${st.bg}`} onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={st.dialog} role="dialog" aria-label="Schritte für die Lernenden">
        <header className={st.dHead}>
          <div className="grow">
            <h2>Schritte für die Lernenden</h2>
            {view && <div className="muted">{view.title}</div>}
          </div>
          {saved && <span className={st.saved}>✓ gespeichert</span>}
          <button className="btn icon" onClick={onClose} aria-label="Schließen" title="Schließen (Esc)">
            <Icon name="close" size={16} />
          </button>
        </header>
        <div className={st.dBody}>
          {!s && !err && <p className="muted">Lädt …</p>}
          {s &&
            PHASE_ORDER.map(({ key, title, icon }) => {
              const ph: PhaseSetting = s.phases[key] ?? { state: 'on', from: null, to: null };
              const info = list.find((x) => x.key === key)!;
              const planned = ph.state !== 'off';
              const tools = phaseTools(key);
              return (
                <section key={key} className={`${st.step} ${planned ? '' : st.off}`}>
                  <div className={st.stepHead}>
                    <label className={st.name} title="Vorgesehen: erscheint im Seitenmenü der Lernenden">
                      <input type="checkbox" checked={planned} onChange={(e) => void setPhase(key, { ...ph, state: e.target.checked ? 'on' : 'off' })} />
                      <span className={`${st.icon} ${st.mini} ${info.state === 'open' ? st.open : st.grey}`}>
                        <Icon name={icon} size={12} />
                      </span>
                      <strong>{title}</strong>
                    </label>
                    {planned && <span className={st.badge}>{info.badge}</span>}
                  </div>
                  {planned && (
                    <div className={st.stateRow}>
                      <span className="seg">
                        {(
                          [
                            ['on', 'offen'],
                            ['closed', 'zu'],
                            ['scheduled', 'Zeitraum'],
                            ['release', 'nach Freigabe'],
                          ] as const
                        ).map(([v, l]) => (
                          <button
                            key={v}
                            type="button"
                            className={`btn ${ph.state === v ? 'on' : ''}`}
                            title={v === 'release' ? 'Start nach Konzept und Freigabe: öffnet für eine Gruppe, sobald du ihr Konzept freigegeben hast' : undefined}
                            onClick={() => void setPhase(key, { ...ph, state: v })}
                          >
                            {l}
                          </button>
                        ))}
                      </span>
                      {(ph.state === 'scheduled' || ph.state === 'release') && (
                        <span className={st.dates}>
                          {ph.state === 'scheduled' && (
                            <>
                              <span className="muted">von</span>
                              <input type="date" value={toDate(ph.from)} onChange={(e) => void setPhase(key, { ...ph, from: fromDate(e.target.value, false) })} aria-label={`${title} von`} />
                            </>
                          )}
                          <span className="muted">bis</span>
                          <input type="date" value={toDate(ph.to)} onChange={(e) => void setPhase(key, { ...ph, to: fromDate(e.target.value, true) })} aria-label={`${title} bis`} />
                        </span>
                      )}
                    </div>
                  )}
                  {planned && tools.length > 1 && (
                    <div className={st.tools} aria-label={`Oberflächen für ${title}`}>
                      {tools.map((t) => (
                        <label key={t.key} className={st.tool} title={t.sub}>
                          <input
                            type="checkbox"
                            checked={toolOn(s, t)}
                            onChange={(e) =>
                              void (t.docType
                                ? save({ docTypes: { ...cur.current!.docTypes, [t.docType]: e.target.checked } })
                                : save({ tools: { ...(cur.current!.tools ?? {}), [t.key]: e.target.checked } }))
                            }
                          />
                          <Icon name={t.icon} size={13} /> {t.title.replace(/-Präsentation$/, '')}
                        </label>
                      ))}
                    </div>
                  )}
                  {planned && ph.state === 'release' && (
                    <div className={st.release}>
                      <div className="muted">{single ? 'Konzept freigegeben für:' : 'Konzept freigegeben für die Gruppen:'}</div>
                      {!concepts.length && <span className="muted">{single ? 'Noch keine Lernenden im Projekt.' : 'Noch keine Gruppen.'}</span>}
                      <div className={st.tools}>
                        {concepts.map((c) => {
                          const on = (s.conceptReleased ?? []).includes(c.id);
                          return (
                            <label key={c.id} className={`${st.tool} ${on ? st.toolOn : ''}`}>
                              <input
                                type="checkbox"
                                checked={on}
                                onChange={(e) => {
                                  const rest = (cur.current!.conceptReleased ?? []).filter((x) => x !== c.id);
                                  void save({ conceptReleased: e.target.checked ? [...rest, c.id] : rest });
                                }}
                              />
                              {c.title}
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </section>
              );
            })}
          {s && <Gantt phases={s.phases} onChange={(p) => void setPhases(p)} />}
          {err && <p className={st.err}>{err}</p>}
        </div>
      </div>
    </div>
  );
}

/**
 * Zeitplan als Gantt-Grafik (Jo, 22. November 2026): je vorgesehenem Schritt ein Balken. Ziehen verschiebt, die Enden
 * ändern Beginn und Ende, Ziehen in einer leeren Zeile legt einen Zeitraum an. Gespeichert wird beim Loslassen.
 */
function Gantt({ phases, onChange }: { phases: Phases; onChange: (p: Phases) => void }) {
  const track = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ key: PhaseKey; mode: 'move' | 'from' | 'to' | 'new'; x0: number; from: number; to: number } | null>(null);
  const [live, setLive] = useState<{ key: PhaseKey; from: number; to: number } | null>(null);
  const today = dayStart(Date.now());
  const rows = PHASE_ORDER.filter(({ key }) => (phases[key]?.state ?? 'on') !== 'off');

  // Sichtbarer Zeitraum: von einer Woche vor heute bzw. dem frühesten Beginn bis mindestens fünf Wochen weiter
  const times = rows.flatMap(({ key }) => [phases[key]?.from, phases[key]?.to]).filter((x): x is number => typeof x === 'number');
  const start = dayStart(Math.min(today - 7 * DAY, ...times.map((t) => t - 2 * DAY)));
  const end = dayStart(Math.max(start + 42 * DAY, ...times.map((t) => t + 4 * DAY)));
  const days = Math.round((end - start) / DAY);
  const pct = (ms: number) => ((ms - start) / (end - start)) * 100;

  const dayAt = (clientX: number) => {
    const r = track.current!.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    return start + Math.floor(f * days) * DAY;
  };
  const dayW = () => track.current!.getBoundingClientRect().width / days;

  function down(e: React.PointerEvent, key: PhaseKey, mode: 'move' | 'from' | 'to' | 'new') {
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const ph = phases[key];
    if (mode === 'new') {
      const d = dayAt(e.clientX);
      setDrag({ key, mode, x0: e.clientX, from: d, to: dayEnd(d) });
      setLive({ key, from: d, to: dayEnd(d) });
    } else {
      const from = ph.from ?? today;
      const to = ph.to ?? dayEnd(from + 6 * DAY);
      setDrag({ key, mode, x0: e.clientX, from, to });
      setLive({ key, from, to });
    }
  }
  function move(e: React.PointerEvent) {
    if (!drag) return;
    const n = Math.round((e.clientX - drag.x0) / dayW());
    let { from, to } = drag;
    if (drag.mode === 'move') {
      from += n * DAY;
      to += n * DAY;
    } else if (drag.mode === 'from') from = Math.min(dayStart(to), from + n * DAY);
    else if (drag.mode === 'to') to = Math.max(dayEnd(from), to + n * DAY);
    else {
      const d = dayAt(e.clientX);
      from = Math.min(drag.from, d);
      to = dayEnd(Math.max(drag.from, d));
    }
    setLive({ key: drag.key, from, to });
  }
  function up() {
    if (drag && live) {
      const ph = phases[drag.key] ?? { state: 'on', from: null, to: null };
      const state = ph.state === 'release' ? 'release' : 'scheduled';
      const changed = live.from !== ph.from || live.to !== ph.to || ph.state !== state;
      if (changed) onChange({ ...phases, [drag.key]: { state, from: state === 'release' ? ph.from : live.from, to: live.to } });
    }
    setDrag(null);
    setLive(null);
  }

  // Wochenbeginne (Montag) als Raster
  const weeks: number[] = [];
  for (let t = start; t <= end; t += DAY) if (new Date(t).getDay() === 1) weeks.push(t);

  return (
    <section className={st.gantt}>
      <div className={st.ganttHead}>
        <strong>Zeitplan</strong>
        <span className="muted">Balken ziehen verschiebt, an den Enden ziehen ändert Beginn und Ende, in einer leeren Zeile ziehen legt einen Zeitraum an.</span>
      </div>
      <div className={st.gGrid}>
        <div />
        <div className={st.gScale}>
          {weeks.map((w) => (
            <span key={w} style={{ left: `${pct(w)}%` }}>
              {new Date(w).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })}
            </span>
          ))}
        </div>
        {rows.map(({ key, title, icon }) => {
          const ph = phases[key] ?? { state: 'on', from: null, to: null };
          const l = live?.key === key ? live : null;
          const from = l ? l.from : ph.from;
          const to = l ? l.to : ph.to;
          const timed = ph.state === 'scheduled' || l;
          let bar: React.ReactNode = null;
          if (timed && (from !== null || to !== null)) {
            const a = from ?? start;
            const b = to ?? end;
            bar = (
              <div
                className={`${st.bar} ${l ? st.barLive : ''}`}
                style={{ left: `${pct(a)}%`, width: `${Math.max(0.8, pct(b) - pct(a))}%` }}
                onPointerDown={(e) => down(e, key, 'move')}
                title={`${title}: ${from ? fmtDay(from) : 'offen'} – ${to ? fmtDay(to) : 'offen'}`}
              >
                <span className={`${st.handle} ${st.hFrom}`} onPointerDown={(e) => down(e, key, 'from')} />
                <span className={st.barText}>{from && to ? `${Math.round((dayStart(to) - dayStart(from)) / DAY) + 1} Tage` : ''}</span>
                <span className={`${st.handle} ${st.hTo}`} onPointerDown={(e) => down(e, key, 'to')} />
              </div>
            );
          } else if (ph.state === 'on') bar = <div className={`${st.bar} ${st.barOpen}`} style={{ left: 0, width: '100%' }}>offen</div>;
          else if (ph.state === 'release')
            bar = (
              <div className={`${st.bar} ${st.barRelease}`} style={{ left: `${pct(today)}%`, width: `${Math.max(4, (ph.to ? pct(ph.to) : 100) - pct(today))}%` }} onPointerDown={(e) => down(e, key, 'to')}>
                nach Freigabe{ph.to ? ` bis ${fmtDay(ph.to)}` : ''}
              </div>
            );
          return (
            <div key={key} className={st.gRow}>
              <span className={st.gLabel}>
                <Icon name={icon} size={13} /> {title}
              </span>
              <div
                className={st.gTrack}
                ref={key === rows[0].key ? track : undefined}
                onPointerDown={(e) => (ph.state === 'scheduled' || ph.state === 'on' || ph.state === 'closed') && !timed && down(e, key, 'new')}
                onPointerMove={move}
                onPointerUp={up}
                onPointerCancel={up}
              >
                {weeks.map((w) => (
                  <span key={w} className={st.gWeek} style={{ left: `${pct(w)}%` }} />
                ))}
                <span className={st.gToday} style={{ left: `${pct(today)}%` }} title="heute" />
                {bar}
                {ph.state === 'closed' && !l && <span className={st.gClosed}>zu</span>}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
