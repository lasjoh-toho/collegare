'use client';
/**
 * Pinnwand als Modul für die Präsentation (Konzept 8d.5): mod_pinnwand läuft unverändert im iframe
 * (public/pinnwand/index.html) und speichert über Collegare je Gruppe. Gemeinsam bearbeiten: Ändert jemand anderes
 * etwas, meldet die Seite das an die Pinnwand im iframe, und diese lädt nach, sobald man gerade nichts in der Hand hat
 * (mod_pinnwand ab 0.170.0). Ältere Stände der Pinnwand bekommen stattdessen den Hinweis „Neu laden“. Oben steht, wer
 * die Pinnwand gerade noch offen hat.
 */
import { useEffect, useRef, useState } from 'react';
import { ProjectShell } from '@/components/ProjectShell';
import { Topbar } from '@/components/Topbar';
import { BASE_PATH, get, href, post, projectSocket } from '@/lib/api';
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
  const [info, setInfo] = useState('');
  useEffect(() => {
    if (!info) return;
    const t = setTimeout(() => setInfo(''), 6000);
    return () => clearTimeout(t);
  }, [info]);
  const frame = useRef<HTMLIFrameElement>(null);
  // Pinnwand im iframe lädt Änderungen selbst nach (meldet sich mit collegare:pinnwand-live)
  const live = useRef(false);
  const [people, setPeople] = useState<{ id: number; name: string }[]>([]);
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.origin === location.origin && e.source === frame.current?.contentWindow && e.data?.type === 'collegare:pinnwand-live') live.current = true;
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, []);
  useEffect(() => {
    live.current = false;
  }, [scope, reload]);

  useEffect(() => {
    if (me === null) location.replace(href('/'));
  }, [me]);
  useEffect(() => {
    if (!Number.isInteger(id)) return;
    get<ProjectView>(`/api/projects/${id}`).then(setProject, () => setProject(null));
    get<Scopes>(`/api/projects/${id}/pinnwand`).then(
      (r) => {
        setList(r);
        setScope((cur) => cur ?? (wanted && r.scopes.some((x) => x.scope === wanted) ? wanted : (r.scopes[0]?.scope ?? null)));
      },
      () => setList({ role: 'student', scopes: [] }),
    );
  }, [id, wanted]);

  // Änderungen anderer an dieser Pinnwand
  useEffect(() => {
    if (!scope || !me || !Number.isInteger(id)) return;
    const so = projectSocket();
    const join = () => so.emit('pinnwand:join', { projectId: id, scope });
    so.on('connect', join);
    so.on('pinnwand', (e: { projectId: number; scope: string; by: number }) => {
      if (e.projectId !== id || e.scope !== scope || e.by === me.id) return;
      if (live.current) frame.current?.contentWindow?.postMessage({ type: 'collegare:pinnwand-changed', by: e.by }, location.origin);
      else setStale('Jemand aus der Gruppe hat die Pinnwand geändert.');
    });
    so.on('pinnwand:presence', (e: { projectId: number; scope: string; people: { id: number; name: string }[] }) => {
      if (e.projectId === id && e.scope === scope) setPeople(e.people.filter((x) => x.id !== me.id));
    });
    return () => {
      so.disconnect();
      setPeople([]);
    };
  }, [id, scope, me]);

  async function fromMap() {
    if (!scope) return;
    try {
      const r = await post<{ frames: number; notes: number }>(`/api/projects/${id}/pinnwand/${encodeURIComponent(scope)}/aus-mindmap`);
      setStale(null);
      setReload((n) => n + 1);
      setInfo(r.frames + r.notes ? `Aus der Mindmap: ${r.frames} Rahmen im Roten Faden, ${r.notes} Zettel.` : 'Alles aus der Gliederung ist schon auf der Pinnwand.');
    } catch (e) {
      setInfo(e instanceof Error ? e.message : String(e));
    }
  }

  if (!me || !project) return <Topbar me={me ?? null} />;
  const src = scope ? `${BASE_PATH}/pinnwand/?id=${id}&bereich=${encodeURIComponent(scope)}` : null;
  return (
    <ProjectShell
      me={me}
      project={project}
      where="Pinnwand"
      info={{ key: 'pinnwand', title: 'Pinnwand', text: 'Die Pinnwand eurer Gruppe: Karten, Bilder, Links und Medien frei anordnen. Änderungen der anderen erscheinen von selbst.' }}
      phase="presentation"
      fill
      actions={
        <>
          {people.length > 0 && (
            <span className={s.people} title={'Gerade auch auf dieser Pinnwand: ' + people.map((x) => x.name).join(', ')}>
              {people.slice(0, 4).map((x) => (
                <span key={x.id} className={s.person}>
                  {x.name
                    .split(/\s+/)
                    .map((w) => w[0])
                    .join('')
                    .slice(0, 2)
                    .toUpperCase()}
                </span>
              ))}
              {people.length > 4 && <span className={s.person}>+{people.length - 4}</span>}
            </span>
          )}
          {scope && (
            <button
              className="btn"
              onClick={() => void fromMap()}
              title="Gliederung aus der Mindmap übernehmen"
            >
              Aus der Mindmap
            </button>
          )}
          {list && list.scopes.length > 1 && (
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
          )}
        </>
      }
    >
      <div className={s.area}>
        {list && !scope ? (
          <div className={`panel ${s.notice}`}>{list.role === 'teacher' ? 'Noch keine Gruppen.' : 'Du bist noch keiner Gruppe zugeordnet.'}</div>
        ) : (
          src && (
            <iframe key={`${scope}-${reload}`} ref={frame} className={s.frame} src={src} title="Pinnwand" allow="camera; microphone; fullscreen; clipboard-read; clipboard-write" allowFullScreen />
          )
        )}
        {info && (
          <div className={`panel ${s.stale}`} role="status">
            <span>{info}</span>
          </div>
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
