'use client';
import { useCallback, useEffect, useState } from 'react';
import { CodesDialog } from '@/components/CodesDialog';
import { GroupBoard } from '@/components/GroupBoard';
import { Topbar } from '@/components/Topbar';
import { ApiError, get, href, post, projectSocket } from '@/lib/api';
import type { Board, ProjectView } from '@/lib/types';
import { useMe, useQuery } from '@/lib/useMe';
import p from './projekt.module.css';

export default function Projekt() {
  const [me] = useMe();
  const idParam = useQuery('id');
  const id = idParam ? Number(idParam) : NaN;
  const [project, setProject] = useState<ProjectView | null>(null);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [dialog, setDialog] = useState<'codes' | 'students' | null>(null);

  const load = useCallback(() => {
    if (!Number.isInteger(id)) return;
    get<ProjectView>(`/api/projects/${id}`)
      .then(setProject)
      .catch((e) => setError(e instanceof ApiError ? e.message : String(e)));
  }, [id]);

  useEffect(() => {
    if (me === null) location.replace(href('/'));
  }, [me]);

  useEffect(load, [load]);

  // Echtzeit: Änderungen am Board kommen sofort an
  useEffect(() => {
    if (!Number.isInteger(id) || !me) return;
    const sock = projectSocket();
    sock.on('connect', () => sock.emit('join', id, () => {}));
    sock.on('board', (b: Board) => setProject((cur) => (cur ? { ...cur, board: b, myGroupId: b.members.find((m) => m.userId === me.id)?.groupId ?? null } : cur)));
    // Einstellungen oder Codes können sich geändert haben: nach Wiederverbindung neu laden
    sock.io.on('reconnect', load);
    return () => {
      sock.disconnect();
    };
  }, [id, me, load]);

  const showError = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 4000);
  };

  async function moodleImport() {
    try {
      const r = await post<{ added: number; total: number }>(`/api/projects/${id}/moodle-import`, {});
      showError(r.added ? `${r.added} neu aus Moodle übernommen (${r.total} Lernende im Kurs)` : `Alle ${r.total} Lernenden sind schon im Projekt`);
    } catch (e) {
      showError(e instanceof ApiError ? e.message : String(e));
    }
  }

  if (error)
    return (
      <>
        <Topbar me={me ?? null} />
        <main className={p.main}>
          <div className="error">{error}</div>
        </main>
      </>
    );
  if (!project || !me) return null;
  const teacher = project.role === 'teacher';

  return (
    <>
      <Topbar me={me} title={project.title}>
        <span className="chip">{project.course.title}</span>
        {teacher && (
          <div className={p.actions}>
            {project.course.moodle ? (
              <button className="btn" onClick={moodleImport} title="Teilnehmende des Moodle-Kurses übernehmen">
                ↻ Aus Moodle
              </button>
            ) : (
              <button className="btn" onClick={() => setDialog('students')}>
                + Lernende
              </button>
            )}
            <button className="btn" onClick={() => setDialog('codes')}>
              Zugangscodes
            </button>
            <a className="btn" href={href(`/einstellungen/?id=${project.id}`)}>
              ⚙ Einstellungen
            </a>
          </div>
        )}
      </Topbar>
      <main className={p.main}>
        {project.settings.brief && <p className={p.brief}>{project.settings.brief}</p>}
        <nav className={p.phases}>
          <span className={`${p.phase} ${p.active}`}>Gruppen</span>
          <span className={p.phase} title="folgt">
            Orientierung
          </span>
          <span className={p.phase} title="folgt">
            Recherche
          </span>
          <span className={p.phase} title="folgt">
            Ausarbeitung
          </span>
          <span className={p.phase} title="folgt">
            Präsentation
          </span>
        </nav>
        {project.board.members.length === 0 && teacher ? (
          <div className={`panel ${p.empty}`}>
            <h2>Noch keine Lernenden</h2>
            <p className="muted">Trage die Namen ein (eine Zeile je Person) oder übernimm sie aus Moodle.</p>
            <div className="row">
              {project.course.moodle && (
                <button className="btn primary" onClick={moodleImport}>
                  Aus Moodle übernehmen
                </button>
              )}
              <button className={`btn ${project.course.moodle ? '' : 'primary'}`} onClick={() => setDialog('students')}>
                Lernende eintragen
              </button>
            </div>
          </div>
        ) : (
          <GroupBoard projectId={project.id} board={project.board} settings={project.settings} role={project.role} meId={me.id} onError={showError} />
        )}
      </main>
      {toast && <div className={p.toast}>{toast}</div>}
      {dialog === 'codes' && <CodesDialog projectId={project.id} title={project.title} members={project.board.members} validUntil={project.codesValidUntil} onClose={() => (setDialog(null), load())} />}
      {dialog === 'students' && <StudentsDialog projectId={project.id} onClose={() => setDialog(null)} />}
    </>
  );
}

function StudentsDialog({ projectId, onClose }: { projectId: number; onClose: () => void }) {
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const names = text.split('\n').map((l) => l.trim()).filter(Boolean);
  async function save() {
    try {
      await post(`/api/projects/${projectId}/students`, { names });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  return (
    <div className="modal-bg" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-label="Lernende eintragen">
        <h2>Lernende eintragen</h2>
        <p className="muted">Eine Zeile je Person, z. B. aus einer Klassenliste kopiert. Namen bleiben in Collegare und gehen nicht an die KI.</p>
        <div className="field">
          <textarea rows={12} value={text} onChange={(e) => setText(e.target.value)} placeholder={'Anna Beispiel\nBen Muster'} autoFocus />
        </div>
        {error && <div className="error">{error}</div>}
        <div className="row">
          <span className="grow" />
          <button className="btn" onClick={onClose}>
            Abbrechen
          </button>
          <button className="btn primary" disabled={!names.length} onClick={save}>
            {names.length} eintragen
          </button>
        </div>
      </div>
    </div>
  );
}
