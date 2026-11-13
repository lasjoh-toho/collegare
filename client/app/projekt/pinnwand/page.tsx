'use client';
/**
 * Pinnwand als Modul für die Präsentation (Konzept 8d.5): mod_pinnwand läuft unverändert im iframe
 * (public/pinnwand/index.html) und speichert über Collegare je Gruppe. Ändert jemand anderes etwas, zeigt die Seite
 * einen Hinweis zum Neuladen, statt mitten in der Arbeit neu zu laden.
 */
import { useEffect, useRef, useState } from 'react';
import { ProjectShell } from '@/components/ProjectShell';
import { Topbar } from '@/components/Topbar';
import { BASE_PATH, get, href, projectSocket } from '@/lib/api';
import type { ProjectView } from '@/lib/types';
import { useMe, useQuery } from '@/lib/useMe';
import s from './pinnwand.module.css';

interface Scopes {
  role: 'teacher' | 'student';
  scopes: { scope: string; title: string }[];
}

export default function PinnwandPage() {
  const [me] = useMe();
  const idParam = useQuery('id');
  const id = idParam ? Number(idParam) : NaN;
  const wanted = useQuery('bereich');
  const [project, setProject] = useState<ProjectView | null>(null);
  const [list, setList] = useState<Scopes | null>(null);
  const [scope, setScope] = useState<string | null>(null);
  const [stale, setStale] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const frame = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    if (me === null) location.replace(href('/'));
  }, [me]);
  useEffect(() => {
    if (!Number.isInteger(id)) return;
    get<ProjectView>(`/api/projects/${id}`).then(setProject, () => setProject(null));
    get<Scopes>(`/api/projects/${id}/pinnwand`).then((r) => {
      setList(r);
      setScope((cur) => cur ?? (wanted && r.scopes.some((x) => x.scope === wanted) ? wanted : (r.scopes[0]?.scope ?? null)));
    }, () => setList({ role: 'student', scopes: [] }));
  }, [id, wanted]);

  // Änderungen anderer an dieser Pinnwand
  useEffect(() => {
    if (!scope || !me || !Number.isInteger(id)) return;
    const so = projectSocket();
    const join = () => so.emit('pinnwand:join', { projectId: id, scope });
    so.on('connect', join);
    so.on('pinnwand', (e: { projectId: number; scope: string; by: number }) => {
      if (e.projectId === id && e.scope === scope && e.by !== me.id) setStale('Jemand aus der Gruppe hat die Pinnwand geändert.');
    });
    return () => {
      so.disconnect();
    };
  }, [id, scope, me]);

  if (!me || !project) return <Topbar me={me ?? null} />;
  const src = scope ? `${BASE_PATH}/pinnwand/?id=${id}&bereich=${encodeURIComponent(scope)}` : null;
  return (
    <ProjectShell
      me={me}
      project={project}
      where="Pinnwand"
      phase="presentation"
      fill
      actions={
        list && list.scopes.length > 1 ? (
          <select
            className={s.scope}
            value={scope ?? ''}
            onChange={(e) => {
              setScope(e.target.value);
              setStale(null);
            }}
            title="Pinnwand welcher Gruppe?"
          >
            {list.scopes.map((x) => (
              <option key={x.scope} value={x.scope}>
                {x.title}
              </option>
            ))}
          </select>
        ) : undefined
      }
    >
      <div className={s.area}>
        {list && !scope ? (
          <div className={`panel ${s.notice}`}>{list.role === 'teacher' ? 'Noch keine Gruppen.' : 'Du bist noch keiner Gruppe zugeordnet.'}</div>
        ) : (
          src && <iframe key={`${scope}-${reload}`} ref={frame} className={s.frame} src={src} title="Pinnwand" allow="camera; microphone; fullscreen; clipboard-read; clipboard-write" allowFullScreen />
        )}
        {stale && (
          <div className={`panel ${s.stale}`} role="status">
            <span>{stale}</span>
            <button
              className="btn primary"
              onClick={() => {
                setStale(null);
                setReload((n) => n + 1);
              }}
            >
              Neu laden
            </button>
            <button className="btn icon" onClick={() => setStale(null)} aria-label="Hinweis schließen" title="Später">
              ×
            </button>
          </div>
        )}
      </div>
    </ProjectShell>
  );
}
