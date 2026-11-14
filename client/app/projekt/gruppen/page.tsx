'use client';
/** Phase „Gruppen“: Kanban der Gruppenbildung, in Echtzeit (vorher die Projektseite selbst). */
import { useCallback, useEffect, useState } from 'react';
import { GroupBoard } from '@/components/GroupBoard';
import { ProjectShell } from '@/components/ProjectShell';
import { Topbar } from '@/components/Topbar';
import { ApiError, get, href, projectSocket } from '@/lib/api';
import { phaseList } from '@/lib/phases';
import type { Board, ProjectView } from '@/lib/types';
import { useMe, useQuery } from '@/lib/useMe';
import { TeacherActions } from '../TeacherActions';
import p from '../projekt.module.css';

export default function Gruppen() {
  const [me] = useMe();
  const idParam = useQuery('id');
  const id = idParam ? Number(idParam) : NaN;
  const [project, setProject] = useState<ProjectView | null>(null);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');

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
    sock.io.on('reconnect', load);
    return () => {
      sock.disconnect();
    };
  }, [id, me, load]);

  const show = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 4000);
  };

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
  const ph = phaseList(project.settings, project.mode === 'single').find((x) => x.key === 'groups')!;

  return (
    <ProjectShell me={me} project={project} info={{ key: 'gruppen', title: 'Gruppen', text: 'Jede Säule ist eine Gruppe. Je nach Einstellung teilt die Lehrkraft ein oder ihr wählt selbst eine Säule.' }} where="Gruppen" phase="groups" actions={teacher && <TeacherActions project={project} onChanged={load} />}>
      <div className={p.main}>
        {!teacher && <p className={p.brief}>{ph.help}</p>}
        {project.board.members.length === 0 && teacher && (
          <div className={`panel ${p.empty}`}>
            <h2>Noch keine Lernenden</h2>
            <p className="muted">
              Du kannst die Gruppen schon vorbereiten, auch aus den Themen der Themen-Mindmap. Lernende trägst du oben mit „+ Lernende“ ein (eine Zeile je Person), oder
              sie kommen beim Start aus Moodle dazu.
            </p>
          </div>
        )}
        <GroupBoard projectId={project.id} board={project.board} settings={project.settings} role={project.role} meId={me.id} onError={show} />
      </div>
      {toast && <div className={p.toast}>{toast}</div>}
    </ProjectShell>
  );
}
