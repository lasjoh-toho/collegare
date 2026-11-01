'use client';
/** Phase „Orientierung“: Mindmap der Gruppe mit „Gliederung übernehmen“ (Issue #7). */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import { MindMap, type Person } from '@/components/MindMap';
import { Topbar } from '@/components/Topbar';
import { get, href, projectSocket } from '@/lib/api';
import type { MapOp, MindMap as MapData, ProjectView } from '@/lib/types';
import { useMe, useQuery } from '@/lib/useMe';
import p from '../projekt.module.css';
import s from './mindmap-page.module.css';

interface JoinAck {
  ok: boolean;
  error?: string;
  role?: 'teacher' | 'student';
  scopes?: { scope: string; title: string }[];
  scope?: string | null;
  people?: Person[];
  map?: MapData;
  version?: number;
}

export default function MindmapPage() {
  const [me] = useMe();
  const idParam = useQuery('id');
  // erst nach dem Lesen der Adresse gültig (statischer Export)
  const id = idParam ? Number(idParam) : NaN;
  const wanted = useQuery('bereich');
  const [project, setProject] = useState<ProjectView | null>(null);
  const [join, setJoin] = useState<JoinAck | null>(null);
  const [map, setMap] = useState<MapData | null>(null);
  const [scope, setScope] = useState<string | null>(null);
  const [toast, setToast] = useState('');
  const [outlineOpen, setOutlineOpen] = useState(false);
  const sock = useRef<Socket | null>(null);
  const version = useRef(0);
  const scopeRef = useRef<string | null>(null);
  scopeRef.current = scope;

  useEffect(() => {
    if (me === null) location.replace(href('/'));
  }, [me]);

  useEffect(() => {
    if (Number.isInteger(id)) get<ProjectView>(`/api/projects/${id}`).then(setProject, (e) => setToast(String(e.message ?? e)));
  }, [id]);

  const show = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 4000);
  };

  const doJoin = useCallback((sc: string | null) => {
    sock.current?.emit('map:join', { projectId: id, scope: sc ?? undefined }, (r: JoinAck) => {
      if (!r.ok) return show(r.error ?? 'Kein Zugriff');
      setJoin(r);
      setScope(r.scope ?? null);
      if (r.map) {
        version.current = r.version ?? 0;
        setMap(r.map);
      } else setMap(null);
    });
  }, [id]);

  useEffect(() => {
    if (!Number.isInteger(id) || !me) return;
    const so = projectSocket();
    sock.current = so;
    so.on('connect', () => doJoin(scopeRef.current ?? wanted));
    so.on('map', (msg: { projectId: number; scope: string; map: MapData; version: number }) => {
      if (msg.projectId !== id || msg.scope !== scopeRef.current || msg.version <= version.current) return;
      version.current = msg.version;
      setMap(msg.map);
    });
    so.on('connect_error', (e) => show('Verbindung: ' + e.message));
    return () => {
      so.disconnect();
      sock.current = null;
    };
  }, [id, me, doJoin, wanted]);

  const send = useCallback(
    (op: MapOp) =>
      new Promise<boolean>((resolve) => {
        if (!sock.current?.connected) {
          show('Keine Verbindung zum Server. Bitte kurz warten.');
          return resolve(false);
        }
        sock.current.emit('map:op', { projectId: id, scope: scopeRef.current, op }, (r: { ok: boolean; error?: string }) => {
          if (!r.ok) show(r.error ?? 'Änderung fehlgeschlagen');
          resolve(r.ok);
        });
      }),
    [id],
  );

  async function takeOutline() {
    if (map?.outline && !confirm('Die Gliederung wurde schon übernommen. Mit dem jetzigen Stand der Cluster neu übernehmen?')) return;
    if (await send({ type: 'outline' })) {
      setOutlineOpen(true);
      show('Gliederung übernommen');
    }
  }

  if (!me || !project) return <Topbar me={me ?? null} />;
  const teacher = project.role === 'teacher';
  const people = join?.people ?? [];
  const name = (uid: number) => people.find((x) => x.id === uid)?.name ?? 'unbekannt';

  return (
    <div className={s.page}>
      <Topbar me={me} title={project.title}>
        <a className="btn" href={href(`/projekt/?id=${id}`)}>
          ← Projekt
        </a>
      </Topbar>
      <nav className={`${p.phases} ${s.phases}`}>
        <a className={p.phase} href={href(`/projekt/?id=${id}`)}>
          Gruppen
        </a>
        <span className={`${p.phase} ${p.active}`}>Orientierung</span>
        <a className={p.phase} href={href(`/projekt/ausarbeitung/?id=${id}${scope ? '&bereich=' + scope : ''}`)}>
          Ausarbeitung
        </a>
        {join?.scopes && join.scopes.length > 1 && (
          <select className={s.scope} value={scope ?? ''} onChange={(e) => doJoin(e.target.value)} title="Mindmap welcher Gruppe?">
            {join.scopes.map((x) => (
              <option key={x.scope} value={x.scope}>
                {x.title}
              </option>
            ))}
          </select>
        )}
        <span className="grow" />
        {map && (
          <>
            <button className="btn" onClick={() => setOutlineOpen((o) => !o)}>
              Gliederung {map.outline ? `(${map.outline.sections.length})` : ''}
            </button>
            <button className="btn primary" onClick={takeOutline} title="Jeder Cluster wird ein Abschnitt, in Lesereihenfolge">
              Gliederung übernehmen
            </button>
          </>
        )}
      </nav>
      <div className={s.area}>
        {join && !scope && (
          <div className={`panel ${s.notice}`}>
            {teacher ? 'Noch keine Gruppen. Bilde zuerst die Gruppen auf dem Board.' : 'Du bist noch keiner Gruppe zugeordnet. Sobald die Gruppen stehen, erscheint hier eure Mindmap.'}
          </div>
        )}
        {map && <MindMap key={scope} map={map} people={people} canEdit={true} send={send} />}
        {map && outlineOpen && (
          <aside className={s.outline}>
            <div className="row">
              <h3>Gliederung</h3>
              <span className="grow" />
              <button className="btn icon" onClick={() => setOutlineOpen(false)} title="Schließen">
                ×
              </button>
            </div>
            {!map.outline ? (
              <p className="muted">Noch nicht übernommen. Legt Karten in Cluster und tippt auf „Gliederung übernehmen“: Jeder Cluster wird ein Abschnitt, von oben nach unten und links nach rechts.</p>
            ) : (
              <>
                <p className="muted">
                  Übernommen am {new Date(map.outline.at).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })}. Die Abschnitte werden in der Ausarbeitung zu Dokumenten.
                </p>
                <ol className={s.sections}>
                  {map.outline.sections.map((sec) => (
                    <li key={sec.id}>
                      <strong>{map.cards[sec.id]?.title || sec.title}</strong>
                      <ul>
                        {sec.cards.filter((c) => map.cards[c]).map((c) => (
                          <li key={c}>{map.cards[c].title || 'Ohne Titel'}</li>
                        ))}
                      </ul>
                      <span className={s.owners}>{sec.owners.length ? sec.owners.map(name).join(', ') : 'noch niemand zuständig'}</span>
                    </li>
                  ))}
                </ol>
              </>
            )}
          </aside>
        )}
      </div>
      {toast && <div className={p.toast}>{toast}</div>}
    </div>
  );
}
