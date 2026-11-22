'use client';
/**
 * Rahmen aller Projektseiten (docs/gestaltung.md, Abschnitt 6): oben links Name und Klasse, ein Klick öffnet
 * das Seitenmenü mit Projekt, Gruppe, Phasen (Anleitung, Zustand, Link) und unten dem Tag/Nacht-Schalter.
 * Vorbild ist die Info aus /lernen in Autogra.fi. Auf breiten Bildschirmen lässt sich das Menü anheften.
 */
import { useEffect, useState } from 'react';
import { watchCopy } from '@/lib/clip';
import { get, href, post } from '@/lib/api';
import { groupColor } from '@/lib/colors';
import { conceptOf, currentPhase, phaseDone, phaseList, phasePath, type DocSummary, type PhaseKey } from '@/lib/phases';
import type { Me, ProjectView } from '@/lib/types';
import { ChatPanel } from './ChatPanel';
import { NotesPanel } from './NotesPanel';
import { Icon } from './Icon';
import { InfoButton, type InfoSpec } from './InfoButton';
import { ThemeSwitch } from './ThemeSwitch';
import sh from './shell.module.css';

const PIN_KEY = 'collegare-menu-pinned';
const SIDE_KEY = 'collegare-leiste';
const SIDE_W_KEY = 'collegare-leiste-breite';
const clampSide = (w: number) => Math.round(Math.max(280, Math.min(w, 900, innerWidth * 0.7)));
type Side = 'chat' | 'notes' | 'history' | null;

/** Bereich der aktuellen Seite für den Link zur Gliederung (z. B. Testbereich), nicht die Themen-Mindmap */
function outlineScope(): string {
  if (typeof window === 'undefined') return '';
  const b = new URLSearchParams(location.search).get('bereich');
  return b && b !== 'p' ? `&bereich=${encodeURIComponent(b)}` : '';
}

/** ein Schritt im Verlauf (Bento, Pinnwand) */
export interface UndoEntry {
  label: string;
  at?: number;
}
/**
 * Rückgängig/Wiederholen der Seite (Wunsch Jo, 0.7.5): die Pfeile stehen immer rechts oben in der Kopfzeile, der
 * dritte Knopf öffnet den Verlauf als Leiste. Einträge in zeitlicher Reihenfolge; go(n) geht n Schritte zurück (n < 0)
 * oder vor (n > 0).
 */
export interface UndoSpec {
  canUndo: boolean;
  canRedo: boolean;
  entries?: { undo: UndoEntry[]; redo: UndoEntry[] } | null;
  onUndo: () => void;
  onRedo: () => void;
  onGo?: (steps: number) => void;
  /** der Verlauf wird gezeigt: die Seite holt die Einträge */
  onHistory?: () => void;
}

interface Props {
  me: Me;
  project: ProjectView;
  /** wo man gerade ist, z. B. „Mindmap“ */
  where: string;
  /** zugehörige Phase (hervorgehoben im Menü), null = Übersicht */
  phase?: PhaseKey | null;
  /** Knöpfe rechts in der Kopfzeile */
  actions?: React.ReactNode;
  /** Stand der Abschnitte, falls die Seite ihn schon hat (sonst lädt das Menü ihn selbst) */
  docs?: DocSummary | null;
  /** volle Höhe ohne Seitenrollen (Editoren, Mindmap) */
  fill?: boolean;
  /** Erklärung hinter dem i-Knopf neben dem Titel */
  info?: InfoSpec;
  /** weitere Teile hinter „where“ in der Mitte der Kopfzeile (z. B. Titel der Präsentation und Speicherstand) */
  crumbs?: React.ReactNode;
  /** ersetzt die Überschrift „Projekt / where“ in der Mitte der Kopfzeile (Folien: Auswahl der Präsentation) */
  center?: React.ReactNode;
  /** Rückgängig/Wiederholen mit Verlauf (Folien, Pinnwand) */
  undo?: UndoSpec;
  children: React.ReactNode;
}

export function ProjectShell({ me, project, where, phase = null, actions, docs, fill = false, info, crumbs, center, undo, children }: Props) {
  const [open, setOpen] = useState(false);
  const [pinPref, setPinPref] = useState(false);
  const [wide, setWide] = useState(false);
  const [ownDocs, setOwnDocs] = useState<DocSummary | null>(null);
  // Chat oder Notizen als Leiste am rechten Rand (immer nur eine), je Gerät gemerkt
  const [side, setSide] = useState<Side>(null);
  // Breite der Leiste, am linken Rand ziehbar (Wunsch Jo), je Gerät gemerkt
  const [sideW, setSideW] = useState(360);
  useEffect(() => {
    try {
      const w = Number(localStorage.getItem(SIDE_W_KEY));
      if (w) setSideW(clampSide(w));
    } catch {}
  }, []);
  function dragSide(e: React.PointerEvent) {
    e.preventDefault();
    const startX = e.clientX;
    const startW = sideW;
    let w = startW;
    const move = (ev: PointerEvent) => {
      w = clampSide(startW + startX - ev.clientX);
      setSideW(w);
    };
    const up = () => {
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', up);
      document.body.style.cursor = '';
      try {
        localStorage.setItem(SIDE_W_KEY, String(w));
      } catch {}
    };
    document.body.style.cursor = 'col-resize';
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
  }
  // Herkunftsmarke beim Kopieren innerhalb des Projekts (Karten-Editor, Konzept 8d.3)
  useEffect(() => watchCopy(project.id, me.name), [project.id, me.name]);
  useEffect(() => {
    try {
      const v = localStorage.getItem(SIDE_KEY) ?? (localStorage.getItem('collegare-chat-offen') === '1' ? 'chat' : '');
      setSide(v === 'chat' || v === 'notes' || v === 'history' ? v : null);
    } catch {}
  }, []);
  const toggleSide = (v: Side) => {
    setSide(v);
    try {
      localStorage.setItem(SIDE_KEY, v ?? '');
    } catch {}
  };
  useEffect(() => {
    if (docs === undefined) get<DocSummary>(`/api/projects/${project.id}/documents`).then(setOwnDocs, () => setOwnDocs(null));
  }, [docs, project.id]);
  // Anheften nur auf breiten Bildschirmen; am Handy bleibt es ein Menü zum Aufklappen
  const pinned = pinPref && wide;
  // Auf breiten Bildschirmen schiebt das aufgeklappte Menü den Inhalt zur Seite, statt die Kacheln zu überdecken
  const pushed = pinned || (open && wide);

  useEffect(() => {
    try {
      setPinPref(localStorage.getItem(PIN_KEY) === '1');
    } catch {
      /* ohne Speicher nicht angeheftet */
    }
    const mq = matchMedia('(min-width: 1100px)');
    const onChange = () => setWide(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [open]);

  const pin = (v: boolean) => {
    setPinPref(v);
    setOpen(false);
    try {
      localStorage.setItem(PIN_KEY, v ? '1' : '0');
    } catch {
      /* egal */
    }
  };

  const teacher = project.role === 'teacher';
  const chatOn = project.settings.chatAll !== false || (project.settings.chatGroups !== false && project.mode === 'group');
  const showChat = chatOn && side === 'chat' && where !== 'Chat';
  const showNotes = side === 'notes' && where !== 'Notizen und Quellen';
  const showHistory = side === 'history' && !!undo?.onGo;
  const wantHistory = showHistory ? undo?.onHistory : undefined;
  useEffect(() => {
    wantHistory?.();
    // nur beim Öffnen der Leiste (die Seite schickt danach jede Änderung mit)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showHistory]);
  const phases = phaseList(project.settings, project.mode === 'single', Date.now(), conceptOf(project, me.id)).filter((p) => p.state !== 'off');
  const done = phaseDone(project, me.id, docs === undefined ? ownDocs : docs);
  const now = currentPhase(phases, done);
  const myGroup = project.board.groups.find((g) => g.id === project.myGroupId) ?? null;
  const groupIndex = myGroup ? project.board.groups.indexOf(myGroup) : 0;
  const mates = myGroup ? project.board.members.filter((m) => m.groupId === myGroup.id && m.userId !== me.id) : [];
  const firstName = me.name.split(' ')[0];
  // Lernende kommen in eine noch nicht freigegebene Phase nur über einen alten Link: freundlich vertrösten
  const gate = !teacher && phase ? (phases.find((p) => p.key === phase && p.state === 'upcoming') ?? null) : null;

  async function logout() {
    await post('/api/auth/logout').catch(() => {});
    location.href = href('/');
  }
  async function back() {
    await post('/api/auth/unimpersonate').catch(() => {});
    location.href = href('/verwaltung/lehrkraefte/');
  }

  return (
    <div className={`${sh.shell} ${pinned ? sh.pinned : ''} ${pushed ? sh.pushed : ''} ${fill ? sh.fill : ''} ${showChat || showNotes || showHistory ? sh.chatOpen : ''}`} style={{ '--side-w': `${sideW}px` } as React.CSSProperties}>
      <header className={sh.head}>
        <button className={sh.who} onClick={() => (pinned ? pin(false) : setOpen((o) => !o))} aria-expanded={open || pinned} aria-controls="seitenmenue" title="Seitenmenü">
          <Icon name="menu" size={18} />
          <span className={sh.whoName}>{me.name}</span>
        </button>
        {project.werkstatt && (
          // Werkstatt: der Kopf führt zurück ins Portal (Jo, 22. November 2026), sonst hängt man in den Werkzeugen fest
          <a className={`btn ${sh.portalBack}`} href={href(where === 'Material' ? '/materialien/' : '/werkzeuge/')} title="Zurück zum Portal">
            <Icon name="back" size={15} /> <span className={sh.portalBackText}>Portal</span>
          </a>
        )}
        <div className={`${sh.whereBox} ${center ? sh.centerBox : ''}`}>
          {center ?? (
            <div className={sh.where}>
              <span className={sh.project}>{project.title}</span>
              <span className={sh.sep}>/</span>
              <strong>{where}</strong>
            </div>
          )}
          {crumbs}
          {info && <InfoButton project={project} spec={info} />}
        </div>
        <div className={sh.actions}>
          {me.impersonated && (
            <button className="btn" onClick={back} title="Zurück zur Verwaltung">
              <span className="chip" style={{ background: 'var(--attr-soft)', color: 'var(--attr)' }}>Ansicht als {me.name}</span>
            </button>
          )}
          {actions}
          {undo && (
            <span className={sh.undoGroup}>
              <button className="btn icon" onClick={undo.onUndo} disabled={!undo.canUndo} title="Rückgängig (Strg+Z)" aria-label="Rückgängig">
                <Icon name="undo" size={16} />
              </button>
              <button className="btn icon" onClick={undo.onRedo} disabled={!undo.canRedo} title="Wiederholen (Strg+Y)" aria-label="Wiederholen">
                <Icon name="redo" size={16} />
              </button>
              {undo.onGo && (
                <button className={`btn icon ${showHistory ? 'on' : ''}`} onClick={() => toggleSide(showHistory ? null : 'history')} title={showHistory ? 'Verlauf ausblenden' : 'Verlauf zeigen'} aria-pressed={showHistory} aria-label="Verlauf">
                  <Icon name="history" size={16} />
                </button>
              )}
            </span>
          )}
          {where !== 'Gliederung' && project.settings.phases.orientation?.state !== 'off' && (teacher || project.settings.tools?.outline !== false) && (
            // synchrone Gliederung: beide Linien nebeneinander (Jo, 22. November 2026)
            <a className="btn icon" href={href(`/projekt/gliederung/?id=${project.id}${outlineScope()}`)} title="Gliederung: Präsentation und Ausarbeitung nebeneinander" aria-label="Gliederung">
              <Icon name="outline" size={16} />
            </a>
          )}
          {where !== 'Notizen und Quellen' && (
            <button className={`btn icon ${showNotes ? 'on' : ''}`} onClick={() => toggleSide(showNotes ? null : 'notes')} title={showNotes ? 'Notizen ausblenden' : 'Notizen zeigen'} aria-pressed={showNotes} aria-label="Notizen und Quellen">
              <Icon name="notes" size={16} />
            </button>
          )}
          {chatOn && where !== 'Chat' && (
            <button className={`btn icon ${showChat ? 'on' : ''}`} onClick={() => toggleSide(showChat ? null : 'chat')} title={showChat ? 'Chat ausblenden' : 'Chat zeigen'} aria-pressed={showChat} aria-label="Chat">
              <Icon name="chat" size={16} />
            </button>
          )}
        </div>
      </header>

      {open && !pushed && <div className={sh.scrim} onClick={() => setOpen(false)} />}
      <aside id="seitenmenue" className={`${sh.menu} ${open || pinned ? sh.open : ''}`} aria-label="Seitenmenü" aria-hidden={!(open || pinned)}>
        <div className={sh.menuTop}>
          <div className="grow">
            <div className={sh.hello}>Hallo {firstName}!</div>
            <div className="muted">{teacher ? 'Ansicht für die Lehrkraft' : 'Hier findest du alles zu deinem Projekt.'}</div>
          </div>
          {wide && <button className={`btn icon ${sh.pinBtn}`} onClick={() => pin(!pinned)} title={pinned ? 'Lösen' : 'Anheften'} aria-label={pinned ? 'Seitenmenü lösen' : 'Seitenmenü anheften'}>
            <Icon name="pin" size={15} />
          </button>}
          <button className={`btn icon ${sh.closeBtn}`} onClick={() => setOpen(false)} aria-label="Schließen">
            <Icon name="close" size={16} />
          </button>
        </div>

        <div className={sh.task}>
          <div className={sh.course}>
            <Icon name="doc" size={13} /> {project.course.title}
            {project.settings.subject ? ` · ${project.settings.subject}` : ''}
          </div>
          <div className={sh.taskTitle}>{project.title}</div>
          {project.settings.brief && <p className={sh.brief}>{project.settings.brief}</p>}
        </div>

        {!teacher && project.mode === 'group' && (
          <div className={sh.group}>
            {myGroup ? (
              <>
                <span className="dot" style={{ background: groupColor(myGroup.color, groupIndex) }} />
                <div>
                  <strong>{myGroup.title}</strong>
                  <div className="muted">{mates.length ? `mit ${mates.map((m) => m.name).join(', ')}` : 'noch allein in der Gruppe'}</div>
                </div>
              </>
            ) : (
              <span className="muted">Du bist noch in keiner Gruppe.</span>
            )}
          </div>
        )}

        {project.werkstatt ? (
          <WerkstattNav project={project} me={me} where={where} />
        ) : (
        <nav className={sh.phases} aria-label="Phasen">
          <a className={`${sh.overview} ${phase === null && where === 'Übersicht' ? sh.here : ''}`} href={href(`/projekt/?id=${project.id}`)}>
            <Icon name="grid" size={16} /> Übersicht aller Oberflächen
          </a>
          <a className={`${sh.overview} ${where === 'Material' ? sh.here : ''}`} href={href(`/projekt/material/?id=${project.id}`)}>
            <Icon name="info" size={16} /> Material zum Einarbeiten
          </a>
          {chatOn && (
            <a className={`${sh.overview} ${where === 'Chat' ? sh.here : ''}`} href={href(`/projekt/chat/?id=${project.id}`)}>
              <Icon name="chat" size={16} /> Chat
            </a>
          )}
          {phases.map((p, i) => {
            const path = phasePath(p.key, project.settings);
            const reachable = !!path && (teacher || p.state === 'open' || p.state === 'closed');
            const cls = [sh.phase, p.key === now ? sh.now : '', p.key === phase ? sh.here : '', done[p.key] ? sh.isDone : '', sh[p.state]].join(' ');
            const body = (
              <>
                <span className={sh.phaseIcon}>
                  <Icon name={p.icon} size={17} />
                </span>
                <span className={sh.phaseText}>
                  <span className={sh.phaseHead}>
                    <span className={sh.phaseNo}>{i + 1}</span> {p.title}
                    {done[p.key] && p.key !== now ? (
                      <span className={`${sh.badge} ${sh.doneBadge}`}>✓ erledigt</span>
                    ) : (
                      <span className={sh.badge}>{p.key === now && p.badge === 'offen' ? 'jetzt dran' : path || p.state === 'upcoming' ? p.badge : 'folgt'}</span>
                    )}
                  </span>
                  <span className={sh.help}>{p.help}</span>
                </span>
              </>
            );
            // Hover über einem Schritt hebt in der Übersicht die Kacheln dieses Schritts hervor
            const hover = {
              onMouseEnter: () => dispatchEvent(new CustomEvent('collegare:phase-hover', { detail: p.key })),
              onMouseLeave: () => dispatchEvent(new CustomEvent('collegare:phase-hover', { detail: null })),
            };
            return reachable ? (
              <a key={p.key} {...hover} className={cls} href={href(path!.replace('{id}', String(project.id)))}>
                {body}
              </a>
            ) : (
              <div key={p.key} {...hover} className={cls} aria-disabled="true">
                {body}
              </div>
            );
          })}
        </nav>
        )}

        <div className={sh.menuFoot}>
          <ThemeSwitch />
          <span className="grow" />
          {(!me.projectId || teacher) && (
            <a className="btn" href={href('/')} title="Alle Projekte">
              <Icon name="grid" size={15} /> Projekte
            </a>
          )}
          <button className="btn" onClick={logout} title="Abmelden">
            <Icon name="logout" size={15} />
          </button>
        </div>
      </aside>

      <main className={sh.body}>
        {gate ? (
          <div className={`panel ${sh.gate}`}>
            <Icon name="clock" size={22} />
            <div>
              <strong>{gate.title} ist {gate.badge} freigegeben.</strong>
              <p className="muted">Bis dahin findest du im Seitenmenü, was gerade dran ist.</p>
            </div>
          </div>
        ) : (
          children
        )}
      </main>
      {showChat && (
        <aside className={sh.chat} aria-label="Chat">
          <div className={sh.sideGrip} onPointerDown={dragSide} title="Breite ziehen" aria-hidden="true" />
          <ChatPanel me={me} project={project} panel onClose={() => toggleSide(null)} />
        </aside>
      )}
      {showHistory && undo && (
        <aside className={sh.chat} aria-label="Verlauf">
          <div className={sh.sideGrip} onPointerDown={dragSide} title="Breite ziehen" aria-hidden="true" />
          <HistoryPanel undo={undo} onClose={() => toggleSide(null)} />
        </aside>
      )}
      {showNotes && (
        <aside className={sh.chat} aria-label="Notizen und Quellen">
          <div className={sh.sideGrip} onPointerDown={dragSide} title="Breite ziehen" aria-hidden="true" />
          <NotesPanel me={me} project={project} panel onClose={() => toggleSide(null)} />
        </aside>
      )}
    </div>
  );
}

function ago(at?: number) {
  if (!at) return '';
  const s = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (s < 60) return 'gerade eben';
  if (s < 3600) return `vor ${Math.round(s / 60)} Min.`;
  return new Date(at).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
}

/** Verlauf der Änderungen: oben, was sich wiederholen lässt, darunter „Jetzt“ und die früheren Schritte; ein Klick springt dorthin */
function HistoryPanel({ undo, onClose }: { undo: UndoSpec; onClose: () => void }) {
  const past = undo.entries?.undo ?? [];
  const future = undo.entries?.redo ?? [];
  const n = past.length;
  const go = (steps: number) => steps && undo.onGo?.(steps);
  return (
    <div className={sh.history}>
      <div className={sh.historyBar}>
        <Icon name="history" size={16} />
        <strong className="grow">Verlauf</strong>
        <button className="btn icon" onClick={onClose} title="Schließen" aria-label="Verlauf schließen">
          <Icon name="close" size={16} />
        </button>
      </div>
      {!undo.entries ? (
        <p className="muted">Der Verlauf wird geladen …</p>
      ) : (
        <ol className={sh.historyList}>
          {future
            .map((e, j) => (
              <li key={`r${j}`}>
                <button className={`${sh.historyItem} ${sh.historyFuture}`} onClick={() => go(j + 1)} title="Bis hierher wiederholen">
                  <span className="grow">{e.label}</span>
                  <span className="muted">{ago(e.at)}</span>
                </button>
              </li>
            ))
            .reverse()}
          <li>
            <div className={sh.historyNow}>Jetzt</div>
          </li>
          {past
            .map((e, i) => (
              <li key={`u${i}`}>
                <button className={sh.historyItem} onClick={() => go(i + 1 - n)} disabled={i === n - 1} title={i === n - 1 ? 'Der aktuelle Stand' : 'Bis hierher zurück'}>
                  <span className="grow">{e.label}</span>
                  <span className="muted">{ago(e.at)}</span>
                </button>
              </li>
            ))
            .reverse()}
          <li>
            <button className={sh.historyItem} onClick={() => go(-n)} disabled={!n} title="Alle Schritte zurücknehmen">
              <span className="grow muted">Ausgangszustand</span>
            </button>
          </li>
          {!n && !future.length && <li className="muted">Noch keine Änderungen.</li>}
        </ol>
      )}
    </div>
  );
}

/**
 * Seitenmenü in der Werkstatt einer Lehrkraft (Jo, 20. November 2026): statt der Phasen die Werkzeuge und der Weg zurück
 * zu „Werkzeuge“ und „Materialien“ im Portal.
 */
function WerkstattNav({ project, me, where }: { project: ProjectView; me: Me; where: string }) {
  const tools: [string, string, string, string][] = [
    ['Mindmap', 'map', `/projekt/mindmap/?id=${project.id}&bereich=t${me.id}`, 'Mindmap'],
    ['Notizen und Quellen', 'notes', `/projekt/notizen/?id=${project.id}&bereich=t${me.id}`, 'Notizen und Quellen'],
    ['Textabschnitte', 'doc', `/projekt/ausarbeitung/?id=${project.id}&bereich=t${me.id}`, 'Ausarbeitung'],
    ['Pinnwand-Präsentation', 'present', `/projekt/pinnwand/?id=${project.id}&bereich=t${me.id}`, 'Pinnwand'],
    ['Folien-Präsentation', 'slides', `/projekt/folien/?id=${project.id}&bereich=t${me.id}`, 'Folien'],
  ];
  return (
    <nav className={sh.phases} aria-label="Werkzeuge">
      <a className={sh.overview} href={href('/werkzeuge/')}>
        <Icon name="tools" size={16} /> Alle Werkzeuge
      </a>
      <a className={`${sh.overview} ${where === 'Material' ? sh.here : ''}`} href={href('/materialien/')}>
        <Icon name="library" size={16} /> Materialien
      </a>
      {tools.map(([title, icon, path, w]) => (
        <a key={title} className={`${sh.phase} ${where === w ? sh.here : ''}`} href={href(path)}>
          <span className={sh.phaseIcon}>
            <Icon name={icon} size={17} />
          </span>
          <span className={sh.phaseText}>
            <span className={sh.phaseHead}>{title}</span>
          </span>
        </a>
      ))}
    </nav>
  );
}
