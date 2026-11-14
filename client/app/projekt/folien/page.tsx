'use client';
/**
 * Klassische Folienpräsentation (Wunsch Jo, 14. November 2026): neben der Pinnwand eine Präsentation wie in PowerPoint,
 * eine je Gruppe, im Office-Editor (iframe unter /office/, AGPL-Teil, nur über die Adresse angesprochen). Die Lehrkraft
 * sieht die Präsentationen der Gruppen lesend und arbeitet im eigenen Testbereich selbst.
 */
import { useCallback, useEffect, useState } from 'react';
import { ProjectShell } from '@/components/ProjectShell';
import { Topbar } from '@/components/Topbar';
import { ApiError, BASE_PATH, get, href } from '@/lib/api';
import type { ProjectView } from '@/lib/types';
import { useMe, useQuery } from '@/lib/useMe';
import s from './folien.module.css';

interface Deck {
  role: 'teacher' | 'student';
  scopes: { scope: string; title: string; test: boolean }[];
  scope: string | null;
  test?: boolean;
  doc: { id: number; title: string; doneAt: number | null } | null;
}

export default function Folien() {
  const [me] = useMe();
  const idParam = useQuery('id');
  const id = idParam ? Number(idParam) : NaN;
  const wanted = useQuery('bereich');
  const [project, setProject] = useState<ProjectView | null>(null);
  const [data, setData] = useState<Deck | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (me === null) location.replace(href('/'));
  }, [me]);
  const load = useCallback(
    (sc: string | null) =>
      get<Deck>(`/api/projects/${id}/folien${sc ? `?bereich=${encodeURIComponent(sc)}` : ''}`).then(setData, (e) => setError(e instanceof ApiError ? e.message : String(e))),
    [id],
  );
  useEffect(() => {
    if (!Number.isInteger(id) || !me) return;
    get<ProjectView>(`/api/projects/${id}`).then(setProject, () => setProject(null));
    void load(wanted);
  }, [id, me, wanted, load]);

  if (!me || !project) return <Topbar me={me ?? null} />;
  const teacher = project.role === 'teacher';
  const doc = data?.doc ?? null;
  const editing = !!doc && !doc.doneAt && (!teacher || !!data?.test);
  const url = doc
    ? `${BASE_PATH}/office/editor/?${new URLSearchParams({ new: 'pptx', collab: 'cg' + doc.id, name: me.name, uid: String(me.id), title: doc.title, editing: editing ? '1' : '0', lang: 'de' })}`
    : null;

  return (
    <ProjectShell
      me={me}
      project={project}
      where="Folien"
      phase="presentation"
      fill
      actions={
        <>
          {teacher && !editing && doc && <span className="muted">Ansicht für die Lehrkraft</span>}
          {data && data.scopes.length > 1 && (
            <select className={s.scope} value={data.scope ?? ''} onChange={(e) => void load(e.target.value)} title="Präsentation welcher Gruppe?">
              {data.scopes.map((x) => (
                <option key={x.scope} value={x.scope}>
                  {x.title}
                </option>
              ))}
            </select>
          )}
        </>
      }
    >
      <div className={s.area}>
        {error && <div className={`panel ${s.notice}`}>{error}</div>}
        {data && !data.scope && <div className={`panel ${s.notice}`}>{teacher ? 'Noch keine Gruppen.' : 'Du bist noch keiner Gruppe zugeordnet.'}</div>}
        {url && (
          <div className={s.editor}>
            <div className={s.stripe} />
            <iframe key={url} className={s.frame} src={url} title="Folien" allow="clipboard-read; clipboard-write; fullscreen" allowFullScreen />
          </div>
        )}
      </div>
    </ProjectShell>
  );
}
