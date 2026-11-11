'use client';
/**
 * Phase „Orientierung“: Mindmap der Gruppe mit „Gliederung übernehmen“ (Issue #7).
 * Dazu die gemeinsame Themen-Mindmap (Bereich p) vor der Gruppenbildung; eine Gruppe kann sie als Start übernehmen.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import { BranchMap } from '@/components/BranchMap';
import { MindMap, type Person } from '@/components/MindMap';
import { ProjectShell } from '@/components/ProjectShell';
import { Topbar } from '@/components/Topbar';
import { Icon } from '@/components/Icon';
import { get, href, projectSocket } from '@/lib/api';
import type { MapOp, MindMap as MapData, ProjectView } from '@/lib/types';
import { useMe, useQuery } from '@/lib/useMe';
import p from '../projekt.module.css';
import s from './mindmap-page.module.css';

interface JoinAck {
  ok: boolean;
  error?: string;
  role?: 'teacher' | 'student';
  scopes?: { scope: string; title: string; readOnly?: boolean }[];
  scope?: string | null;
  readOnly?: boolean;
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
  const outlineParam = useQuery('gliederung');
  const [project, setProject] = useState<ProjectView | null>(null);
  const [join, setJoin] = useState<JoinAck | null>(null);
  const [map, setMap] = useState<MapData | null>(null);
  const [scope, setScope] = useState<string | null>(null);
  const [toast, setToast] = useState('');
  const [outlineOpen, setOutlineOpen] = useState(false);
  // Ansicht: Äste (wie eine klassische Mindmap) oder Karten-Fläche (brausa); gleiche Daten, Wahl je Gerät
  const [view, setView] = useState<'aeste' | 'karten'>('aeste');
  useEffect(() => {
    try {
      if (localStorage.getItem('collegare-mindmap-ansicht') === 'karten') setView('karten');
    } catch {}
  }, []);
  const switchView = (v: 'aeste' | 'karten') => {
    setView(v);
    try {
      localStorage.setItem('collegare-mindmap-ansicht', v);
    } catch {}
  };
  const sock = useRef<Socket | null>(null);
  const version = useRef(0);
  const scopeRef = useRef<string | null>(null);
  scopeRef.current = scope;

  useEffect(() => {
    if (me === null) location.replace(href('/'));
  }, [me]);
  // Kachel „Gliederung“ öffnet die Mindmap mit aufgeklappter Gliederung
  useEffect(() => {
    if (outlineParam) setOutlineOpen(true);
  }, [outlineParam]);

  useEffect(() => {
    if (Number.isInteger(id)) get<ProjectView>(`/api/projects/${id}`).then(setProject, (e) => setToast(String(e.message ?? e)));
  }, [id]);

  const show = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 4000);
  };

  const doJoin = useCallback(
    (sc: string | null) => {
      sock.current?.emit('map:join', { projectId: id, scope: sc ?? undefined }, (r: JoinAck) => {
        if (!r.ok) return show(r.error ?? 'Kein Zugriff');
        setJoin(r);
        setScope(r.scope ?? null);
        if (r.map) {
          version.current = r.version ?? 0;
          setMap(r.map);
        } else setMap(null);
      });
    },
    [id],
  );

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

  function seedFromTopic() {
    if (!confirm('Die Themen-Mindmap als Start für diese Mindmap übernehmen? Danach arbeitet ihr an eurer eigenen Kopie weiter.')) return;
    sock.current?.emit('map:seed', { projectId: id, scope: scopeRef.current }, (r: { ok: boolean; error?: string }) =>
      show(r.ok ? 'Themen-Mindmap übernommen' : (r.error ?? 'Übernehmen fehlgeschlagen')),
    );
  }

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
  const isTopic = scope === 'p';
  const canEdit = !join?.readOnly;
  const hasTopic = !!join?.scopes?.some((x) => x.scope === 'p');
  const empty = !!map && Object.keys(map.cards).length === 0;
  const center = isTopic ? project.title : join?.scopes?.find((x) => x.scope === scope)?.title || project.title;

  return (
    <ProjectShell
      me={me}
      project={project}
      where={outlineOpen ? 'Mindmap und Gliederung' : 'Mindmap'}
      phase={isTopic ? 'topic' : 'orientation'}
      fill
      actions={
        <>
          {join?.scopes && join.scopes.length > 1 && (
            <select className={s.scope} value={scope ?? ''} onChange={(e) => doJoin(e.target.value)} title="Themen-Mindmap oder Mindmap welcher Gruppe?">
              {join.scopes.map((x) => (
                <option key={x.scope} value={x.scope}>
                  {x.title}
                </option>
              ))}
            </select>
          )}
          {map && (
            <>
              <span className="seg" role="group" aria-label="Ansicht">
                <button className={`btn ${view === 'aeste' ? 'on' : ''}`} onClick={() => switchView('aeste')} aria-pressed={view === 'aeste'} title="Äste: Thema in der Mitte">
                  <Icon name="map" size={14} /> <span className={s.long}>Äste</span>
                </button>
                <button className={`btn ${view === 'karten' ? 'on' : ''}`} onClick={() => switchView('karten')} aria-pressed={view === 'karten'} title="Karten frei auf der Fläche">
                  <Icon name="grid" size={14} /> <span className={s.long}>Karten</span>
                </button>
              </span>
              {!isTopic && (
                <>
                  <button className={`btn ${outlineOpen ? 'on' : ''}`} onClick={() => setOutlineOpen((o) => !o)}>
                    Gliederung {map.outline ? `(${map.outline.sections.length})` : ''}
                  </button>
                  <button className="btn primary" onClick={takeOutline} title="Jeder Cluster wird ein Abschnitt, in Lesereihenfolge">
                    <span className={s.long}>Gliederung </span>übernehmen
                  </button>
                </>
              )}
            </>
          )}
        </>
      }
    >
      <div className={s.area}>
        {join && !scope && (
          <div className={`panel ${s.notice}`}>
            {teacher ? 'Noch keine Gruppen. Bilde zuerst die Gruppen auf dem Board.' : 'Du bist noch keiner Gruppe zugeordnet. Sobald die Gruppen stehen, erscheint hier eure Mindmap.'}
          </div>
        )}
        {isTopic && (
          <div className={`panel ${s.banner}`}>
            {canEdit
              ? 'Themen-Mindmap für alle: Hier umreißt ihr gemeinsam das Thema, noch vor den Gruppen. Jede Gruppe kann sie später als Start für ihre eigene Mindmap übernehmen.'
              : 'Themen-Mindmap: Hier umreißt deine Lehrkraft das Thema. Du kannst sie ansehen.'}
          </div>
        )}
        {!isTopic && empty && hasTopic && canEdit && (
          <div className={`panel ${s.banner}`}>
            Eure Mindmap ist noch leer.
            <button className="btn primary" onClick={seedFromTopic}>
              Mit der Themen-Mindmap beginnen
            </button>
          </div>
        )}
        {map && view === 'karten' && <MindMap key={scope} map={map} people={people} canEdit={canEdit} send={send} />}
        {map && view === 'aeste' && <BranchMap key={scope} map={map} topic={center} people={people} canEdit={canEdit} send={send} />}
        {map && outlineOpen && !isTopic && (
          <aside className={s.outline}>
            <div className="row">
              <h3>Gliederung</h3>
              <span className="grow" />
              <button className="btn icon" onClick={() => setOutlineOpen(false)} title="Schließen">
                ×
              </button>
            </div>
            {!map.outline ? (
              <p className="muted">Noch nicht übernommen. Jeder Hauptast (in der Karten-Ansicht: jeder Cluster) wird ein Abschnitt. Tippt dann auf „Gliederung übernehmen“.</p>
            ) : (
              <>
                <p className="muted">
                  Übernommen am{' '}
                  {new Date(map.outline.at).toLocaleString('de-DE', {
                    dateStyle: 'short',
                    timeStyle: 'short',
                  })}
                  . Die Abschnitte werden in der Ausarbeitung zu Dokumenten.
                </p>
                <ol className={s.sections}>
                  {map.outline.sections.map((sec) => (
                    <li key={sec.id}>
                      <strong>{map.cards[sec.id]?.title || sec.title}</strong>
                      <ul>
                        {sec.cards
                          .filter((c) => map.cards[c])
                          .map((c) => (
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
    </ProjectShell>
  );
}
