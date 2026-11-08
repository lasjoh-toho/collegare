'use client';
import { useEffect, useState } from 'react';
import { Topbar } from '@/components/Topbar';
import { Welcome } from '@/components/Welcome';
import { get, href, post } from '@/lib/api';
import type { Course, ProjectListItem } from '@/lib/types';
import { useMe } from '@/lib/useMe';
import s from './start.module.css';

export default function Start() {
  const [me, reload] = useMe();

  // Lernende mit Zugangscode haben genau ein Projekt: direkt dorthin
  useEffect(() => {
    if (me?.projectId) location.replace(href(`/projekt/?id=${me.projectId}`));
  }, [me]);

  if (me === undefined || me?.projectId) return null;
  if (me === null) return <Welcome onLogin={reload} />;
  return (
    <>
      <Topbar me={me} />
      <Projects teacher={me.teacher || me.admin} />
    </>
  );
}

function Projects({ teacher }: { teacher: boolean }) {
  const [projects, setProjects] = useState<ProjectListItem[] | null>(null);
  const [courses, setCourses] = useState<Course[]>([]);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    get<{ projects: ProjectListItem[] }>('/api/projects').then((r) => setProjects(r.projects));
    if (teacher) get<{ courses: Course[] }>('/api/courses').then((r) => setCourses(r.courses));
  }, [teacher]);

  const byCourse = new Map<number, ProjectListItem[]>();
  for (const p of projects ?? []) byCourse.set(p.contextId, [...(byCourse.get(p.contextId) ?? []), p]);
  const courseTitle = (id: number) => courses.find((c) => c.id === id)?.title ?? 'Kurs';

  return (
    <main className={s.start}>
      <header className={s.head}>
        <span className="dot" style={{ background: 'var(--accent)', width: 12, height: 12 }} />
        <h1>Projekte</h1>
        <span className="muted">{projects ? `${projects.length} ${projects.length === 1 ? 'Projekt' : 'Projekte'}` : ''}</span>
        <span className="grow" />
        {teacher && (
          <button className="btn primary" onClick={() => setCreating(true)}>
            + Neues Projekt
          </button>
        )}
      </header>

      {projects && projects.length === 0 && (
        <div className={`panel ${s.empty}`}>
          {teacher ? (
            <>
              <h2>Noch kein Projekt</h2>
              <p className="muted">Lege ein Projekt an, trage die Lernenden ein und bilde die Gruppen auf dem Board.</p>
              <button className="btn primary" onClick={() => setCreating(true)}>
                Erstes Projekt anlegen
              </button>
            </>
          ) : (
            <p className="muted">Du bist noch in keinem Projekt. Deine Lehrkraft gibt dir einen Code.</p>
          )}
        </div>
      )}

      {[...byCourse.entries()].map(([cid, list]) => (
        <section key={cid} className={s.course}>
          <h3>{courseTitle(cid)}</h3>
          <div className={s.cards}>
            {list.map((p) => (
              <a key={p.id} className={`panel ${s.card}`} href={href(`/projekt/?id=${p.id}`)}>
                <h2>{p.title}</h2>
                <p className="muted">
                  {p.mode === 'single' ? 'Einzelarbeit' : 'Gruppenarbeit'} · angelegt {new Date(p.createdAt).toLocaleDateString('de-DE')}
                </p>
                <div className={s.acts}>
                  <span className="btn">Öffnen</span>
                  {p.role === 'teacher' && (
                    <span
                      className="btn"
                      title="Einstellungen"
                      onClick={(e) => {
                        e.preventDefault();
                        location.href = href(`/einstellungen/?id=${p.id}`);
                      }}
                    >
                      ⚙ Einstellungen
                    </span>
                  )}
                </div>
              </a>
            ))}
          </div>
        </section>
      ))}

      {creating && <NewProject courses={courses} onClose={() => setCreating(false)} />}
    </main>
  );
}

function NewProject({ courses, onClose }: { courses: Course[]; onClose: () => void }) {
  const [courseId, setCourseId] = useState<number | 'new'>(courses[0]?.id ?? 'new');
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
