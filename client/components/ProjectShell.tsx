'use client';
/**
 * Rahmen aller Projektseiten (docs/gestaltung.md, Abschnitt 6): oben links Name und Klasse, ein Klick öffnet
 * das Seitenmenü mit Projekt, Gruppe, Phasen (Anleitung, Zustand, Link) und unten dem Tag/Nacht-Schalter.
 * Vorbild ist die Info aus /lernen in Autogra.fi. Auf breiten Bildschirmen lässt sich das Menü anheften.
 */
import { useEffect, useState } from 'react';
import { get, href, post } from '@/lib/api';
import { groupColor } from '@/lib/colors';
import { currentPhase, phaseDone, phaseList, phasePath, type DocSummary, type PhaseKey } from '@/lib/phases';
import type { Me, ProjectView } from '@/lib/types';
import { ChatPanel } from './ChatPanel';
import { NotesPanel } from './NotesPanel';
import { Icon } from './Icon';
import { ThemeSwitch } from './ThemeSwitch';
import sh from './shell.module.css';

const PIN_KEY = 'collegare-menu-pinned';
const SIDE_KEY = 'collegare-leiste';
type Side = 'chat' | 'notes' | null;

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
  children: React.ReactNode;
}

export function ProjectShell({ me, project, where, phase = null, actions, docs, fill = false, children }: Props) {
  const [open, setOpen] = useState(false);
  const [pinPref, setPinPref] = useState(false);
  const [wide, setWide] = useState(false);
  const [ownDocs, setOwnDocs] = useState<DocSummary | null>(null);
  // Chat oder Notizen als Leiste am rechten Rand (immer nur eine), je Gerät gemerkt
  const [side, setSide] = useState<Side>(null);
  useEffect(() => {
    try {
      const v = localStorage.getItem(SIDE_KEY) ?? (localStorage.getItem('collegare-chat-offen') === '1' ? 'chat' : '');
      setSide(v === 'chat' || v === 'notes' ? v : null);
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
  const phases = phaseList(project.settings, project.mode === 'single').filter((p) => p.state !== 'off');
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
    <div className={`${sh.shell} ${pinned ? sh.pinned : ''} ${fill ? sh.fill : ''} ${showChat || showNotes ? sh.chatOpen : ''}`}>
      <header className={sh.head}>
        <button className={sh.who} onClick={() => (pinned ? pin(false) : setOpen((o) => !o))} aria-expanded={open || pinned} aria-controls="seitenmenue" title="Seitenmenü: Projekt, Phasen, Tag/Nacht">
          <Icon name="menu" size={18} />
          <span className={sh.whoText}>
            <span className={sh.whoName}>{me.name}</span>
            <span className={sh.whoClass}>{teacher ? `Lehrkraft · ${project.course.title}` : (myGroup ? `${project.course.title} · ${myGroup.title}` : project.course.title)}</span>
          </span>
        </button>
        <div className={sh.where}>
          <span className={sh.project}>{project.title}</span>
          <span className={sh.sep}>/</span>
          <strong>{where}</strong>
        </div>
        <div className={sh.actions}>
          {me.impersonated && (
            <button className="btn" onClick={back} title="Zurück zur Verwaltung">
              <span className="chip" style={{ background: 'var(--attr-soft)', color: 'var(--attr)' }}>Ansicht als {me.name}</span>
            </button>
          )}
          {actions}
          {where !== 'Notizen und Quellen' && (
            <button className={`btn icon ${showNotes ? 'on' : ''}`} onClick={() => toggleSide(showNotes ? null : 'notes')} title={showNotes ? 'Notizen ausblenden' : 'Notizen und Quellen am rechten Rand zeigen'} aria-pressed={showNotes} aria-label="Notizen und Quellen">
              <Icon name="notes" size={16} />
            </button>
          )}
          {chatOn && where !== 'Chat' && (
            <button className={`btn icon ${showChat ? 'on' : ''}`} onClick={() => toggleSide(showChat ? null : 'chat')} title={showChat ? 'Chat ausblenden' : 'Chat am rechten Rand zeigen'} aria-pressed={showChat} aria-label="Chat">
              <Icon name="chat" size={16} />
            </button>
          )}
        </div>
      </header>

      {open && !pinned && <div className={sh.scrim} onClick={() => setOpen(false)} />}
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
            const path = phasePath(p.key);
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
            return reachable ? (
              <a key={p.key} className={cls} href={href(path!.replace('{id}', String(project.id)))}>
                {body}
              </a>
            ) : (
              <div key={p.key} className={cls} aria-disabled="true">
                {body}
              </div>
            );
          })}
        </nav>

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
          <ChatPanel me={me} project={project} panel onClose={() => toggleSide(null)} />
        </aside>
      )}
      {showNotes && (
        <aside className={sh.chat} aria-label="Notizen und Quellen">
          <NotesPanel me={me} project={project} panel onClose={() => toggleSide(null)} />
        </aside>
      )}
    </div>
  );
}
