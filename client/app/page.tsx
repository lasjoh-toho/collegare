'use client';
import { useEffect, useState } from 'react';
import { Icon } from '@/components/Icon';
import { PortalHead, PortalShell, type PortalPage } from '@/components/PortalShell';
import { Welcome } from '@/components/Welcome';
import { get, href, post } from '@/lib/api';
import { currentPhase, phaseList } from '@/lib/phases';
import type { Course, Me, ProjectListItem, ProjectSettings, ProjectSummary } from '@/lib/types';
import { useMe, useQuery } from '@/lib/useMe';
import s from './portal-page.module.css';

/** Für die Phasen-Berechnung im Portal genügen die Phasen; der Rest sind Platzhalter. */
const DEFAULT_PHASE_SETTINGS = { groupFormation: 'teacher', groupMin: 2, groupMax: 4, choiceDeadline: null, finishLock: true } as unknown as ProjectSettings;

export default function Start() {
  const [me, reload] = useMe();

  // Lernende mit Zugangscode haben genau ein Projekt: direkt dorthin
  useEffect(() => {
    if (me?.projectId) location.replace(href(`/projekt/?id=${me.projectId}`));
  }, [me]);

  if (me === undefined || me?.projectId) return null;
  if (me === null) return <Welcome onLogin={reload} />;
  return <Portal me={me} />;
}

const SEEN_KEY = 'collegare-portal-gesehen';
const VIEW_KEY = 'collegare-portal-ansicht';

function greeting(): string {
  const h = new Date().getHours();
  return h < 11 ? 'Guten Morgen' : h < 18 ? 'Guten Tag' : 'Guten Abend';
}

/** Übersicht wie im Aufgaben-Portal von Autogra.fi, dazu „neu seit dem letzten Besuch“ (Konzept 8b). */
function Portal({ me }: { me: Me }) {
  const teacher = me.teacher || me.admin;
  const classParam = useQuery('klasse');
  const newParam = useQuery('neu');
  const [projects, setProjects] = useState<ProjectListItem[] | null>(null);
  const [courses, setCourses] = useState<Course[]>([]);
  const [creating, setCreating] = useState(false);
  const [filter, setFilter] = useState('');
  const [view, setView] = useState<'cards' | 'table'>('table');
  const [seenAt, setSeenAt] = useState<number | null>(null);
  const classId = classParam ? Number(classParam) : null;

  useEffect(() => {
    let since: number | null = null;
    try {
      since = Number(localStorage.getItem(SEEN_KEY)) || null;
      const v = localStorage.getItem(VIEW_KEY);
      if (v === 'cards' || v === 'table') setView(v);
    } catch {
      /* ohne Speicher: alles gilt als neu */
    }
    setSeenAt(since);
    get<{ projects: ProjectListItem[] }>(`/api/projects${since ? `?seit=${since}` : ''}`).then((r) => {
      setProjects(r.projects);
      try {
        localStorage.setItem(SEEN_KEY, String(Date.now()));
      } catch {
        /* egal */
      }
    });
    if (teacher) get<{ courses: Course[] }>('/api/courses').then((r) => setCourses(r.courses));
  }, [teacher]);
  useEffect(() => {
    if (newParam) setCreating(true);
  }, [newParam]);

  const chooseView = (v: 'cards' | 'table') => {
    setView(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* egal */
    }
  };

  const courseTitle = (id: number) => courses.find((c) => c.id === id)?.title ?? 'Kurs';
  const q = filter.trim().toLowerCase();
  const shown = (projects ?? []).filter(
    (p) => (classId === null || p.contextId === classId) && (!q || p.title.toLowerCase().includes(q) || courseTitle(p.contextId).toLowerCase().includes(q)),
  );
  const fresh = (projects ?? []).filter((p) => (p.summary?.newDone ?? 0) > 0);
  const freshCount = fresh.reduce((n, p) => n + (p.summary?.newDone ?? 0), 0);
  const active: PortalPage = creating ? 'new' : classId !== null ? `class-${classId}` : 'overview';

  return (
    <PortalShell me={me} active={active}>
      <PortalHead
        title={classId !== null ? courseTitle(classId) : `${greeting()}, ${me.name}`}
        sub={teacher ? 'Projekte anlegen, Zugangscodes ausgeben und den Stand aller Gruppen verfolgen.' : 'Deine Projekte.'}
      >
        {teacher && (
          <button className="btn primary" onClick={() => setCreating(true)}>
            + Neues Projekt
          </button>
        )}
      </PortalHead>

      {teacher && seenAt !== null && projects && (
        <div className={`notice ${s.fresh}`}>
          {freshCount
            ? `Neu seit ${new Date(seenAt).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })}: ${freshCount} ${freshCount === 1 ? 'Abschnitt' : 'Abschnitte'} fertig gemeldet in ${fresh.map((p) => `„${p.title}“`).join(', ')}.`
            : `Seit ${new Date(seenAt).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })} wurde nichts Neues fertig gemeldet.`}
        </div>
      )}

      <section className={`panel ${s.box}`}>
        <div className={s.boxHead}>
          <h2>
            <Icon name="grid" size={17} /> Bestehende Projekte
          </h2>
          <span className={s.badge}>{shown.length}</span>
          <span className="grow" />
          <div className="seg">
            <button className={`btn ${view === 'cards' ? 'on' : ''}`} onClick={() => chooseView('cards')}>
              Karten
            </button>
            <button className={`btn ${view === 'table' ? 'on' : ''}`} onClick={() => chooseView('table')}>
              Tabelle
            </button>
          </div>
        </div>
        <input className={`input ${s.filter}`} value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Klasse oder Projekt filtern …" aria-label="Filter" />

        {projects && shown.length === 0 && (
          <div className={s.empty}>
            {teacher ? (
              <>
                <p className="muted">{projects.length ? 'Kein Projekt passt zum Filter.' : 'Noch kein Projekt. Lege eines an, trage die Lernenden ein und bilde die Gruppen auf dem Board.'}</p>
                {!projects.length && (
                  <button className="btn primary" onClick={() => setCreating(true)}>
                    Erstes Projekt anlegen
                  </button>
                )}
              </>
            ) : (
              <p className="muted">Du bist noch in keinem Projekt. Deine Lehrkraft gibt dir einen Code.</p>
            )}
          </div>
        )}

        {view === 'table' && shown.length > 0 && (
          <div className={s.tableWrap}>
            <table className={s.table}>
              <thead>
                <tr>
                  <th>Fach</th>
                  <th>Projekt</th>
                  <th>Klasse</th>
                  <th>Phase</th>
                  <th>Lernende</th>
                  <th>Abschnitte</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {shown.map((p) => (
                  <tr key={p.id}>
                    <td className={s.subject}>{p.summary?.subject ?? '–'}</td>
                    <td>
                      <a className={s.ptitle} href={href(`/projekt/?id=${p.id}`)}>
                        {p.title}
                      </a>
                      <small className={s.mode}>{p.mode === 'single' ? 'Einzelarbeit' : 'Gruppenarbeit'}</small>
                    </td>
                    <td>{courseTitle(p.contextId)}</td>
                    <td>{p.summary ? <PhaseChip s={p.summary} /> : '–'}</td>
                    <td>{p.summary ? <People s={p.summary} /> : '–'}</td>
                    <td>{p.summary ? <Docs s={p.summary} /> : '–'}</td>
                    <td>
                      <Acts p={p} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {view === 'cards' && shown.length > 0 && (
          <div className={s.cards}>
            {shown.map((p) => (
              <div key={p.id} className={`panel ${s.card}`}>
                <div className={s.cardTop}>
                  <span className={s.subject}>{p.summary?.subject ?? 'ohne Fach'}</span>
                  <span className="grow" />
                  {p.summary && <PhaseChip s={p.summary} />}
                </div>
                <a className={s.ptitle} href={href(`/projekt/?id=${p.id}`)}>
                  <h3>{p.title}</h3>
                </a>
                <p className="muted">
                  {courseTitle(p.contextId)} · {p.mode === 'single' ? 'Einzelarbeit' : 'Gruppenarbeit'}
                </p>
                {p.summary && (
                  <div className={s.stats}>
                    <People s={p.summary} />
                    <Docs s={p.summary} />
                  </div>
                )}
                <Acts p={p} />
              </div>
            ))}
          </div>
        )}
      </section>

      {creating && (
        <NewProject
          courses={courses}
          initialCourse={classId}
          onClose={() => {
            setCreating(false);
            if (newParam) history.replaceState(null, '', href('/'));
          }}
        />
      )}
    </PortalShell>
  );
}

/** Phase, an der die Klasse gerade ist (wie die Schritte-Spalte in Autogra.fi). */
function PhaseChip({ s: sum }: { s: ProjectSummary }) {
  const list = phaseList({ ...DEFAULT_PHASE_SETTINGS, phases: sum.phases }, false);
  const now = currentPhase(list, {
    groups: sum.students > 0 && sum.unassigned === 0,
    orientation: sum.docs > 0,
    drafting: sum.docs > 0 && sum.done === sum.docs,
  });
  const ph = list.find((x) => x.key === now);
  return <span className={s.phase}>{ph ? ph.title : 'keine Phase offen'}</span>;
}

function People({ s: sum }: { s: ProjectSummary }) {
  return (
    <span className={s.stat}>
      {sum.students} {sum.groups ? `in ${sum.groups} ${sum.groups === 1 ? 'Gruppe' : 'Gruppen'}` : ''}
      {sum.unassigned > 0 && sum.groups > 0 && <small className={s.warn}>{sum.unassigned} ohne Gruppe</small>}
    </span>
  );
}

function Docs({ s: sum }: { s: ProjectSummary }) {
  if (!sum.docs) return <span className="muted">–</span>;
  return (
    <span className={s.stat}>
      {sum.done} / {sum.docs} fertig
      {sum.newDone > 0 && <span className={s.newBadge}>+{sum.newDone} neu</span>}
    </span>
  );
}

function Acts({ p }: { p: ProjectListItem }) {
  return (
    <div className={s.acts}>
      <a className="btn" href={href(`/projekt/?id=${p.id}`)} title="Projekt öffnen">
        <Icon name="grid" size={15} /> Öffnen
      </a>
      {p.role === 'teacher' && (
        <>
          <a className="btn icon" href={href(`/projekt/korrektur/?id=${p.id}`)} title="Korrektur">
            <Icon name="pen" size={15} />
          </a>
          <a className="btn icon" href={href(`/projekt/gruppen/?id=${p.id}`)} title="Gruppen-Board">
            <Icon name="users" size={15} />
          </a>
          <a className="btn icon" href={href(`/einstellungen/?id=${p.id}`)} title="Einstellungen">
            <Icon name="gear" size={15} />
          </a>
        </>
      )}
    </div>
  );
}

function NewProject({ courses, initialCourse, onClose }: { courses: Course[]; initialCourse: number | null; onClose: () => void }) {
  const [courseId, setCourseId] = useState<number | 'new'>(initialCourse ?? courses[0]?.id ?? 'new');
  const [courseTitle, setCourseTitle] = useState('');
  const [title, setTitle] = useState('');
  const [mode, setMode] = useState<'group' | 'single'>('group');
  const [error, setError] = useState('');

  async function create() {
    setError('');
    try {
      let cid = courseId;
      if (cid === 'new') cid = (await post<{ id: number }>('/api/courses', { title: courseTitle })).id;
      const { id } = await post<{ id: number }>('/api/projects', { courseId: cid, title, mode });
      location.href = href(`/projekt/?id=${id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="modal-bg" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-label="Neues Projekt">
        <h2>Neues Projekt</h2>
        <div className="field">
          <label>Klasse bzw. Kurs</label>
          <select value={courseId} onChange={(e) => setCourseId(e.target.value === 'new' ? 'new' : Number(e.target.value))}>
            {courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
                {c.moodle ? ' (Moodle)' : ''}
              </option>
            ))}
            <option value="new">Neuer Kurs …</option>
          </select>
        </div>
        {courseId === 'new' && (
          <div className="field">
            <label>Name des Kurses</label>
            <input value={courseTitle} onChange={(e) => setCourseTitle(e.target.value)} placeholder="z. B. S1 Geschichte" autoFocus />
          </div>
        )}
        <div className="field">
          <label>Titel des Projekts</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="z. B. Die Weimarer Republik" />
        </div>
        <div className="field">
          <label>Arbeitsform</label>
          <div className="seg">
            <button className={`btn ${mode === 'group' ? 'on' : ''}`} onClick={() => setMode('group')}>
              In Gruppen
            </button>
            <button className={`btn ${mode === 'single' ? 'on' : ''}`} onClick={() => setMode('single')}>
              Einzeln
            </button>
          </div>
        </div>
        {error && <div className="error">{error}</div>}
        <div className="row">
          <span className="grow" />
          <button className="btn" onClick={onClose}>
            Abbrechen
          </button>
          <button className="btn primary" disabled={!title.trim() || (courseId === 'new' && !courseTitle.trim())} onClick={create}>
            Anlegen
          </button>
        </div>
      </div>
    </div>
  );
}
