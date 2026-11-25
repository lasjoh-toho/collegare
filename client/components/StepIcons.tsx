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
import { PHASE_ORDER, fmtDay, fmtDayTime, phaseList, phaseTools, toolOn, type PhaseKey } from '@/lib/phases';
import type { PhaseSetting, ProjectSettings, ProjectView, Showing } from '@/lib/types';
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
                          <span className={st.cLabel} title="Zweiter Block: ab diesem Tag kommentierst du, die Lernenden können noch überarbeiten. Leer = ohne Rückmeldephase.">
                            Rückmeldung ab
                          </span>
                          <input
                            type="date"
                            className={st.cInput}
                            value={toDate(ph.comment ?? null)}
                            onChange={(e) => void setPhase(key, { ...ph, comment: fromDate(e.target.value, false) })}
                            aria-label={`${title}: Rückmeldung der Lehrkraft ab`}
                          />
                          {ph.to !== null && (
                            <>
                              <span className="muted" title="Danach ist die Bearbeitung gesperrt. Lesen und Exportieren geht weiter.">
                                bis
                              </span>
                              <input type="date" value={toDate(ph.to)} onChange={(e) => void setPhase(key, { ...ph, to: fromDate(e.target.value, true) })} aria-label={`${title} bis`} />
                            </>
                          )}
                          <label className={st.noEnd} title="Ohne Sperre: der Schritt bleibt offen, bis du ihn schließt">
                            <input
                              type="checkbox"
                              checked={ph.to === null}
                              onChange={(e) =>
                                void setPhase(key, {
                                  ...ph,
                                  to: e.target.checked ? null : dayEnd(Math.max(ph.comment ?? 0, ph.from ?? 0, dayStart(Date.now())) + 13 * DAY),
                                })
                              }
                            />
                            kein Ende
                          </label>
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
          {s && <Gantt phases={s.phases} showings={s.showings ?? []} onChange={(p) => void setPhases(p)} />}
          {s && s.phases.presentation?.state !== 'off' && (
            <Showings phases={s.phases} showings={s.showings ?? []} who={concepts} single={single} onChange={(x) => void save({ showings: x })} />
          )}
          {err && <p className={st.err}>{err}</p>}
        </div>
      </div>
    </div>
  );
}


type Mode = 'move' | 'from' | 'comment' | 'to' | 'new';
interface Live {
  key: PhaseKey;
  from: number | null;
  comment: number | null;
  to: number | null;
}

/**
 * Zeitplan als Gantt-Grafik (Jo, 22. November 2026). Seit 25. November 2026 je Schritt zwei verbundene Blöcke in einer
 * Zeile: zuerst Bearbeiten, ab „Rückmeldung“ kommentiert die Lehrkraft, am Ende ist die Bearbeitung gesperrt. Der
 * Bereich bleibt danach offen zum Lesen und Exportieren. Ohne Ende läuft der Balken aus. Wochenenden sind
 * andersfarbig. Ziehen verschiebt, die Enden ändern Beginn und Ende, die Fuge zwischen den Blöcken den Beginn der
 * Rückmeldung (am rechten Ende herausziehen legt sie an, ganz nach rechts ziehen nimmt sie weg). Ziehen in einer
 * Zeile ohne Zeitraum legt einen an. Gespeichert wird beim Loslassen.
 */
function Gantt({ phases, showings, onChange }: { phases: Phases; showings: Showing[]; onChange: (p: Phases) => void }) {
  const track = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<(Live & { mode: Mode; x0: number }) | null>(null);
  const [live, setLive] = useState<Live | null>(null);
  const today = dayStart(Date.now());
  const rows = PHASE_ORDER.filter(({ key }) => (phases[key]?.state ?? 'on') !== 'off');

  // Sichtbarer Zeitraum: von einer Woche vor heute bzw. dem frühesten Beginn bis mindestens sechs Wochen weiter
  const times = [
    ...rows.flatMap(({ key }) => [phases[key]?.from, phases[key]?.comment, phases[key]?.to]),
    ...showings.map((x) => x.at),
  ].filter((x): x is number => typeof x === 'number');
  const start = dayStart(Math.min(today - 7 * DAY, ...times.map((t) => t - 2 * DAY)));
  const open = rows.some(({ key }) => phases[key]?.state === 'scheduled' && phases[key]?.to === null);
  const end = dayStart(Math.max(start + 42 * DAY, ...times.map((t) => t + (open ? 10 : 4) * DAY)));
  const days = Math.round((end - start) / DAY);
  const pct = (ms: number) => ((ms - start) / (end - start)) * 100;

  const dayAt = (clientX: number) => {
    const r = track.current!.getBoundingClientRect();
    const f = Math.min(0.9999, Math.max(0, (clientX - r.left) / r.width));
    return start + Math.floor(f * days) * DAY;
  };
  const dayW = () => track.current!.getBoundingClientRect().width / days;

  function down(e: React.PointerEvent, key: PhaseKey, mode: Mode) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const ph = phases[key] ?? { state: 'on', from: null, to: null };
    let l: Live;
    if (mode === 'new') {
      const d = dayAt(e.clientX);
      l = { key, from: d, comment: null, to: dayEnd(d) };
    } else {
      const from = ph.state === 'release' ? null : (ph.from ?? today);
      l = { key, from, comment: ph.comment ?? null, to: ph.to };
      // Fuge ohne Rückmeldephase sitzt am rechten Ende
      if (mode === 'comment' && l.comment === null) l.comment = dayStart(ph.to ?? end - DAY) + DAY;
      if (mode === 'to' && l.to === null) l.to = dayEnd(end - DAY);
    }
    setDrag({ ...l, mode, x0: e.clientX });
    setLive(l);
  }
  function move(e: React.PointerEvent) {
    if (!drag) return;
    const n = Math.round((e.clientX - drag.x0) / dayW()) * DAY;
    let { from, comment, to } = drag;
    const first = from ?? today;
    if (drag.mode === 'move') {
      if (from !== null) from += n;
      if (comment !== null) comment += n;
      if (to !== null) to += n;
    } else if (drag.mode === 'from') {
      from = Math.min(dayStart(comment !== null ? comment - DAY : (to ?? end)), first + n);
    } else if (drag.mode === 'comment') {
      const max = to !== null ? dayStart(to) + DAY : end;
      comment = Math.max(dayStart(first) + DAY, Math.min(max, comment! + n));
    } else if (drag.mode === 'to') {
      to = Math.max(dayEnd(comment ?? first), to! + n);
    } else {
      const d = dayAt(e.clientX);
      from = Math.min(drag.from!, d);
      to = dayEnd(Math.max(drag.from!, d));
    }
    setLive({ key: drag.key, from, comment, to });
  }
  function up() {
    if (drag && live) {
      const ph = phases[drag.key] ?? { state: 'on', from: null, to: null };
      const state = ph.state === 'release' ? 'release' : 'scheduled';
      // Fuge ganz rechts: keine Rückmeldephase
      let comment = live.comment;
      if (comment !== null && ((live.to !== null && comment > live.to) || comment >= end)) comment = null;
      const next: PhaseSetting = { state, from: state === 'release' ? ph.from : live.from, comment, to: live.to };
      const changed = next.from !== ph.from || next.to !== ph.to || (next.comment ?? null) !== (ph.comment ?? null) || ph.state !== state;
      if (changed) onChange({ ...phases, [drag.key]: next });
    }
    setDrag(null);
    setLive(null);
  }

  // Raster: Wochenbeginne (Montag) und Wochenenden
  const weeks: number[] = [];
  const weekends: number[] = [];
  for (let t = start; t < end; t += DAY) {
    const wd = new Date(t).getDay();
    if (wd === 1) weeks.push(t);
    if (wd === 6 || (wd === 0 && t === start)) weekends.push(t);
  }
  const weekendEls = weekends.map((w) => {
    const len = new Date(w).getDay() === 6 ? 2 : 1;
    return <span key={w} className={st.gWeekend} style={{ left: `${pct(w)}%`, width: `${pct(w + len * DAY) - pct(w)}%` }} />;
  });

  return (
    <section className={st.gantt}>
      <div className={st.ganttHead}>
        <strong>Zeitplan</strong>
        <span className="muted">
          Je Schritt zwei Blöcke: <span className={st.keyWork} /> bearbeiten, <span className={st.keyComment} /> du kommentierst, danach ist die Bearbeitung gesperrt. Die Bereiche bleiben
          offen zum Lesen und Exportieren. Die Fuge zwischen den Blöcken ziehen; am rechten Ende herausziehen legt die Rückmeldung an.
        </span>
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
        {rows.map(({ key, title, icon }, i) => {
          const ph = phases[key] ?? { state: 'on', from: null, to: null };
          const l = live?.key === key ? live : null;
          const release = ph.state === 'release';
          const timed = ph.state === 'scheduled' || release || !!l;
          const from = l ? l.from : release ? null : ph.from;
          const comment = l ? l.comment : (ph.comment ?? null);
          const to = l ? l.to : ph.to;
          const a = release ? Math.max(start, today) : (from ?? start);
          const b = to ?? end;
          const noEnd = to === null;
          // Fuge: Beginn der Rückmeldung, bei Ziehen über das Ende hinaus wie „keine“
          const c = comment !== null && comment > a && comment <= b ? comment : null;
          let bar: React.ReactNode = null;
          if (timed) {
            const tip = `${title}: ${release ? 'nach Freigabe' : from ? fmtDay(from) : 'offen'} – ${to ? fmtDay(to) : 'kein Ende'}${c ? `, Rückmeldung ab ${fmtDay(c)}` : ''}`;
            const work = c ?? b;
            const n = Math.round((dayStart(work - 1) - dayStart(a)) / DAY) + 1;
            bar = (
              <>
                <div
                  className={`${st.bar} ${st.barWork} ${release ? st.barRelease : ''} ${l ? st.barLive : ''} ${noEnd && !c ? st.barNoEnd : ''} ${c ? st.joinR : ''}`}
                  style={{ left: `${pct(a)}%`, width: `${Math.max(0.8, pct(work) - pct(a))}%` }}
                  onPointerDown={(e) => down(e, key, release ? 'to' : 'move')}
                  title={tip}
                >
                  <span className={st.barText}>{release ? 'nach Freigabe' : `${n} ${n === 1 ? 'Tag' : 'Tage'}`}</span>
                </div>
                {c && (
                  <div
                    className={`${st.bar} ${st.barComment} ${l ? st.barLive : ''} ${noEnd ? st.barNoEnd : ''} ${st.joinL}`}
                    style={{ left: `${pct(c)}%`, width: `${Math.max(0.8, pct(b) - pct(c))}%` }}
                    onPointerDown={(e) => down(e, key, release ? 'to' : 'move')}
                    title={tip}
                  >
                    <span className={st.barText}>{noEnd ? 'Rückmeldung, kein Ende' : 'Rückmeldung'}</span>
                  </div>
                )}
                {!release && <span className={`${st.handle} ${st.hFrom}`} style={{ left: `${pct(a)}%` }} onPointerDown={(e) => down(e, key, 'from')} title="Beginn" />}
                <span
                  className={`${st.handle} ${st.hJoint} ${c ? '' : st.hJointAdd}`}
                  style={{ left: `${pct(c ?? b)}%` }}
                  onPointerDown={(e) => down(e, key, 'comment')}
                  title={c ? `Rückmeldung ab ${fmtDay(c)}: ziehen; ganz nach rechts ziehen nimmt sie weg` : 'Nach links ziehen: ab hier kommentierst du'}
                />
                {!noEnd && <span className={`${st.handle} ${st.hTo}`} style={{ left: `${pct(b)}%` }} onPointerDown={(e) => down(e, key, 'to')} title={`gesperrt nach ${fmtDay(b)}`} />}
                {noEnd && !c && <span className={st.noEndTag}>kein Ende</span>}
                {!noEnd && b < end && <span className={st.lockTag} style={{ left: `${pct(b)}%` }} title="Bearbeitung gesperrt, lesen und exportieren geht weiter">🔒</span>}
              </>
            );
          } else if (ph.state === 'on') bar = <div className={`${st.bar} ${st.barOpen}`} style={{ left: 0, width: '100%' }}>offen</div>;
          return (
            <div key={key} className={st.gRow}>
              <span className={st.gLabel}>
                <Icon name={icon} size={13} /> {title}
              </span>
              <div
                className={st.gTrack}
                ref={i === 0 ? track : undefined}
                onPointerDown={(e) => !timed && down(e, key, 'new')}
                onPointerMove={move}
                onPointerUp={up}
                onPointerCancel={up}
              >
                {weekendEls}
                {weeks.map((w) => (
                  <span key={w} className={st.gWeek} style={{ left: `${pct(w)}%` }} />
                ))}
                <span className={st.gToday} style={{ left: `${pct(today)}%` }} title="heute" />
                {bar}
                {key === 'presentation' &&
                  showings.map((x) => <span key={x.id} className={st.gShow} style={{ left: `${pct(x.at)}%` }} title={`Vorführtermin ${fmtDayTime(x.at)}${x.label ? `: ${x.label}` : ''}`} />)}
                {ph.state === 'closed' && !l && <span className={st.gClosed}>zu</span>}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/** Schultag im gezoomten Zeitstrahl der Vorführtermine: 7:30 bis 17:00 */
const H0 = 7.5;
const H1 = 17;
const HOUR_PX = 72;
const CHIP_PX = 92;
const WEEKEND_PX = 26;
const SNAP = 15 * 60_000;

/**
 * Vorführtermine (Jo, 25. November 2026) in einem eigenen, gezoomten Zeitstrahl: Schultage stundengenau, Wochenenden
 * schmal und andersfarbig. Klick auf eine freie Stelle legt einen Termin an, Ziehen verschiebt ihn (auf 15 Minuten),
 * ein Klick öffnet ihn zum Bearbeiten (Gruppe, Dauer, Bezeichnung). Die Lernenden sehen ihren Termin im Schritt
 * Präsentation.
 */
function Showings({
  phases,
  showings,
  who,
  single,
  onChange,
}: {
  phases: Phases;
  showings: Showing[];
  who: { id: number; title: string }[];
  single: boolean;
  onChange: (x: Showing[]) => void;
}) {
  const today = dayStart(Date.now());
  const pres = phases.presentation ?? { state: 'on', from: null, to: null };
  // Fenster: Rückmeldung bzw. Zeitraum der Präsentation, sonst zwei Wochen ab heute, mit allen Terminen
  const ats = showings.map((x) => x.at);
  const base0 = dayStart(Math.min(pres.comment ?? pres.from ?? today, ...ats));
  const base1 = dayStart(Math.max(pres.to ?? base0 + 13 * DAY, base0 + 6 * DAY, ...ats));
  const [shift, setShift] = useState(0);
  const first = base0 + shift * 7 * DAY;
  const last = Math.min(base1 + shift * 7 * DAY, first + 41 * DAY);
  const [sel, setSel] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ id: string; x0: number; at: number; moved: boolean } | null>(null);
  const [liveAt, setLiveAt] = useState<number | null>(null);
  const strip = useRef<HTMLDivElement>(null);

  // Tage mit Breite und Lage im Streifen
  const segs: { day: number; x: number; w: number; weekend: boolean }[] = [];
  for (let d = first, x = 0; d <= last; d += DAY) {
    const wd = new Date(d).getDay();
    const weekend = wd === 0 || wd === 6;
    const w = weekend ? WEEKEND_PX : (H1 - H0) * HOUR_PX;
    segs.push({ day: d, x, w, weekend });
    x += w;
  }
  const width = segs.reduce((n, s) => n + s.w, 0);
  const xOf = (t: number) => {
    const sg = segs.find((s) => s.day === dayStart(t));
    if (!sg) return null;
    if (sg.weekend) return sg.x + sg.w / 2;
    const h = (t - sg.day) / 3_600_000;
    return sg.x + Math.min(Math.max(h - H0, 0), H1 - H0) * HOUR_PX;
  };
  const timeAt = (clientX: number) => {
    const x = clientX - strip.current!.getBoundingClientRect().left;
    const sg = segs.find((s) => x >= s.x && x < s.x + s.w) ?? segs[segs.length - 1];
    if (sg.weekend) return null;
    const t = sg.day + (H0 + (x - sg.x) / HOUR_PX) * 3_600_000;
    return Math.round(t / SNAP) * SNAP;
  };

  const sorted = [...showings].sort((a, b) => a.at - b.at);
  // Überschneidungen (auch nur der Beschriftung) in bis zu drei Spuren
  const atOf = (x: Showing) => (drag?.id === x.id && liveAt !== null ? liveAt : x.at);
  const wOf = (x: Showing) => Math.max(CHIP_PX, (x.min / 60) * HOUR_PX);
  const lane = new Map<string, number>();
  const lastEnd = [-1, -1, -1];
  for (const x of sorted) {
    const left = xOf(atOf(x)) ?? 0;
    let l = lastEnd.findIndex((e) => left >= e + 2);
    if (l < 0) l = lastEnd.indexOf(Math.min(...lastEnd));
    lane.set(x.id, l);
    lastEnd[l] = left + wOf(x);
  }
  const lanes = Math.max(1, ...[...lane.values()].map((l) => l + 1));
  const name = (x: Showing) => who.find((w) => w.id === x.who)?.title ?? x.label ?? '';
  const cur = showings.find((x) => x.id === sel) ?? null;
  const put = (x: Showing) => onChange(showings.map((y) => (y.id === x.id ? x : y)));

  function add(e: React.PointerEvent) {
    if (e.target !== e.currentTarget && !(e.target as HTMLElement).dataset.slot) return;
    const at = timeAt(e.clientX);
    if (at === null) return;
    // nächste Gruppe ohne Termin vorschlagen
    const free = who.find((w) => !showings.some((x) => x.who === w.id));
    const x: Showing = { id: Math.random().toString(36).slice(2, 10), at, min: 30, who: free?.id ?? null, label: '' };
    onChange([...showings, x]);
    setSel(x.id);
  }

  const hours: number[] = [];
  for (let h = Math.ceil(H0); h < H1; h++) hours.push(h);

  return (
    <section className={st.gantt}>
      <div className={st.ganttHead}>
        <strong>Vorführtermine</strong>
        <span className="muted">Gezoomt auf die Schultage (7:30–17 Uhr). Klick auf eine freie Stelle legt einen Termin an, ziehen verschiebt ihn, ein Klick öffnet ihn.</span>
      </div>
      <div className={st.zNav}>
        <button type="button" className="btn" onClick={() => setShift(shift - 1)}>
          ‹ Woche früher
        </button>
        <span className="muted">
          {fmtDay(first)} – {fmtDay(last)}
        </span>
        <button type="button" className="btn" onClick={() => setShift(shift + 1)}>
          Woche später ›
        </button>
        {shift !== 0 && (
          <button type="button" className="btn" onClick={() => setShift(0)}>
            zur Präsentation
          </button>
        )}
      </div>
      <div className={st.zScroll}>
        <div ref={strip} className={st.zStrip} style={{ width, height: 40 + lanes * 26 }} onPointerDown={add}>
          {segs.map((sg) => (
            <div key={sg.day} className={`${st.zDay} ${sg.weekend ? st.zWeekend : ''}`} style={{ left: sg.x, width: sg.w }} data-slot="1">
              <span className={st.zDayHead} data-slot="1">
                {sg.weekend
                  ? new Date(sg.day).toLocaleDateString('de-DE', { weekday: 'short' }).slice(0, 2)
                  : new Date(sg.day).toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' })}
              </span>
              {!sg.weekend &&
                hours.map((h) => (
                  <span key={h} className={st.zHour} style={{ left: (h - H0) * HOUR_PX }} data-slot="1">
                    {h}
                  </span>
                ))}
            </div>
          ))}
          {xOf(Date.now()) !== null && <span className={st.gToday} style={{ left: xOf(Date.now())!, top: 18 }} />}
          {sorted.map((x) => {
            const at = atOf(x);
            const left = xOf(at);
            if (left === null) return null;
            const w = wOf(x);
            return (
              <button
                key={x.id}
                type="button"
                className={`${st.zShow} ${sel === x.id ? st.zSel : ''} ${x.who === null ? st.zFree : ''}`}
                style={{ left, width: w, top: 24 + (lane.get(x.id) ?? 0) * 26 }}
                title={`${fmtDayTime(at)} · ${x.min} Min.${name(x) ? ` · ${name(x)}` : ''}`}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                  setDrag({ id: x.id, x0: e.clientX, at: x.at, moved: false });
                }}
                onPointerMove={(e) => {
                  if (!drag || drag.id !== x.id) return;
                  if (Math.abs(e.clientX - drag.x0) < 4 && !drag.moved) return;
                  const t = timeAt(e.clientX - (drag.x0 - (strip.current!.getBoundingClientRect().left + (xOf(drag.at) ?? 0))));
                  if (t !== null) setLiveAt(t);
                  if (!drag.moved) setDrag({ ...drag, moved: true });
                }}
                onPointerUp={() => {
                  if (drag?.moved && liveAt !== null && liveAt !== x.at) put({ ...x, at: liveAt });
                  else if (!drag?.moved) setSel(sel === x.id ? null : x.id);
                  setDrag(null);
                  setLiveAt(null);
                }}
              >
                <span>{new Date(at).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}</span> {name(x) || 'frei'}
              </button>
            );
          })}
        </div>
      </div>
      {cur && (
        <div className={st.zEdit}>
          <input
            type="date"
            value={toDate(cur.at)}
            onChange={(e) => {
              const d = fromDate(e.target.value, false);
              if (d !== null) put({ ...cur, at: d + (cur.at - dayStart(cur.at)) });
            }}
            aria-label="Tag"
          />
          <input
            type="time"
            step={300}
            value={new Date(cur.at).toTimeString().slice(0, 5)}
            onChange={(e) => {
              const [h, m] = e.target.value.split(':').map(Number);
              if (!Number.isNaN(h)) put({ ...cur, at: dayStart(cur.at) + (h * 60 + (m || 0)) * 60_000 });
            }}
            aria-label="Uhrzeit"
          />
          <select value={cur.min} onChange={(e) => put({ ...cur, min: Number(e.target.value) })} aria-label="Dauer">
            {[10, 15, 20, 30, 45, 60, 90].map((m) => (
              <option key={m} value={m}>
                {m} Min.
              </option>
            ))}
          </select>
          <select value={cur.who ?? ''} onChange={(e) => put({ ...cur, who: e.target.value ? Number(e.target.value) : null })} aria-label={single ? 'Person' : 'Gruppe'}>
            <option value="">{single ? 'noch niemand' : 'noch keine Gruppe'}</option>
            {who.map((w) => (
              <option key={w.id} value={w.id}>
                {w.title}
              </option>
            ))}
          </select>
          <input className={st.zLabel} value={cur.label} maxLength={80} placeholder="Bezeichnung, z. B. Raum 204" onChange={(e) => put({ ...cur, label: e.target.value })} />
          <button
            type="button"
            className="btn"
            onClick={() => {
              onChange(showings.filter((x) => x.id !== cur.id));
              setSel(null);
            }}
          >
            Löschen
          </button>
        </div>
      )}
      {!showings.length && <p className="muted">Noch keine Vorführtermine.</p>}
    </section>
  );
}
