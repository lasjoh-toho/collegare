'use client';
/**
 * Gliederung als eigene Seite (Jo, 22. November 2026, Konzept 8h.10): in der Mitte des Kopfs „Präsentation ‖ Ausarbeitung“
 * genau über den beiden Linien. Ohne Wahl stehen beide Linien nebeneinander (synchrone Gliederung). Ein Klick auf
 * „Präsentation“ oder „Ausarbeitung“ lässt diese Linie nach links rutschen; daneben erscheint die Ausarbeitung als
 * Text bzw. als Präsentation. Erreichbar über die Kachel in der Übersicht und das Symbol oben rechts neben Notizen und Chat.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import { GliederungBoard } from '@/components/Gliederung';
import { Icon } from '@/components/Icon';
import { ProjectShell } from '@/components/ProjectShell';
import { Topbar } from '@/components/Topbar';
import { get, href, projectSocket } from '@/lib/api';
import { LINE_COLOR, visibleKinds, type LineKind } from '@/lib/lines';
import type { MapOp, MindMap, ProjectView } from '@/lib/types';
import { useMe, useQuery } from '@/lib/useMe';
import p from '../projekt.module.css';
import s from './page.module.css';

interface JoinAck {
  ok: boolean;
  error?: string;
  scopes?: { scope: string; title: string; readOnly?: boolean }[];
  scope?: string | null;
  readOnly?: boolean;
  people?: { id: number; name: string }[];
  map?: MindMap;
  version?: number;
}

export default function GliederungPage() {
  const [me] = useMe();
  const idParam = useQuery('id');
  const id = idParam ? Number(idParam) : NaN;
  const wanted = useQuery('bereich');
  const lineParam = useQuery('linie');
  const [project, setProject] = useState<ProjectView | null>(null);
  const [join, setJoin] = useState<JoinAck | null>(null);
  const [map, setMap] = useState<MindMap | null>(null);
  const [scope, setScope] = useState<string | null>(null);
  const [mode, setMode] = useState<'both' | LineKind>('both');
  const [toast, setToast] = useState('');
  const [sock, setSock] = useState<Socket | null>(null);
  const version = useRef(0);
  // „‖“ im Kopf genau zwischen die beiden Linien darunter schieben (Kopf und Fläche sind verschieden breit belegt)
  const midRef = useRef<HTMLButtonElement>(null);
  const [shift, setShift] = useState(0);
  const [, setTick] = useState(0);
  useEffect(() => {
    const on = () => setTick((t) => t + 1);
    addEventListener('resize', on);
    return () => removeEventListener('resize', on);
  }, []);
  useLayoutEffect(() => {
    const bridge = document.querySelector<HTMLElement>('[data-prow] > [data-bridge]');
    const mid = midRef.current;
    if (!bridge || !mid) return;
    const a = bridge.getBoundingClientRect();
    const b = mid.getBoundingClientRect();
    const next = Math.round(shift + (a.left + a.width / 2) - (b.left + b.width / 2));
    if (Math.abs(next - shift) > 1) setShift(next);
  });
  const scopeRef = useRef<string | null>(null);
  scopeRef.current = scope;

  useEffect(() => {
    if (me === null) location.replace(href('/'));
  }, [me]);
  useEffect(() => {
    if (Number.isInteger(id)) get<ProjectView>(`/api/projects/${id}`).then(setProject, (e) => setToast(String(e.message ?? e)));
  }, [id]);
  useEffect(() => {
    if (lineParam === 'praes' || lineParam === 'ausarb') setMode(lineParam);
  }, [lineParam]);

  const show = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 4000);
  }, []);

  const doJoin = useCallback(
    (so: Socket, sc: string | null) =>
      so.emit('map:join', { projectId: id, scope: sc ?? undefined }, (r: JoinAck) => {
        if (!r.ok) return show(r.error ?? 'Kein Zugriff');
        setJoin(r);
        setScope(r.scope ?? null);
        version.current = r.version ?? 0;
        setMap(r.map ?? null);
      }),
    [id, show],
  );

  useEffect(() => {
    if (!Number.isInteger(id) || !me) return;
    const so = projectSocket();
    setSock(so);
    so.on('connect', () => doJoin(so, scopeRef.current ?? wanted));
    so.on('map', (msg: { projectId: number; scope: string; map: MindMap; version: number }) => {
      if (msg.projectId !== id || msg.scope !== scopeRef.current || msg.version <= version.current) return;
      version.current = msg.version;
      setMap(msg.map);
    });
    return () => {
      so.disconnect();
      setSock(null);
    };
  }, [id, me, doJoin, wanted]);

  const send = useCallback(
    (op: MapOp) =>
      new Promise<boolean>((resolve) => {
        if (!sock?.connected) {
          show('Keine Verbindung zum Server. Bitte kurz warten.');
          return resolve(false);
        }
        sock.emit('map:op', { projectId: id, scope: scopeRef.current, op }, (r: { ok: boolean; error?: string }) => {
          if (!r.ok) show(r.error ?? 'Änderung fehlgeschlagen');
          resolve(r.ok);
        });
      }),
    [sock, id, show],
  );

  if (!me || !project) return <Topbar me={me ?? null} />;
  const kinds = visibleKinds(project.settings.outlineLines, project.role === 'teacher');
  const both = kinds.length > 1;
  const shown: 'both' | LineKind = both ? mode : kinds[0];
  const choose = (k: 'both' | LineKind) => {
    const next = k === mode ? 'both' : k;
    setMode(next);
    try {
      const u = new URL(location.href);
      if (next === 'both') u.searchParams.delete('linie');
      else u.searchParams.set('linie', next);
      history.replaceState(null, '', u);
    } catch {}
  };
  const lineBtn = (k: LineKind, label: string) => (
    <button className={`${s.lineBtn} ${shown === k ? s.on : ''}`} style={{ ['--t' as string]: LINE_COLOR[k] }} onClick={() => choose(k)} aria-pressed={shown === k} title={shown === k ? 'Zurück zu beiden Linien' : `${label}: Linie nach links, daneben schreiben`}>
      {label}
    </button>
  );
  const info = {
    key: 'gliederung',
    title: 'Gliederung',
    text: 'Links die Präsentation (rot), rechts die Ausarbeitung (blau). Gleiche Punkte stehen auf einer Höhe und sind hellgrau verbunden; stehen sie vertauscht, verbindet sie eine graue Linie mit zwei Bögen, ein Klick darauf stellt sie wieder einander gegenüber. Punkte zieht ihr mit der Maus an eine andere Stelle der Linie, auch von einer Linie in die andere (dort entsteht eine Kopie). Notizen und Karten legt ihr auf einen Punkt oder direkt auf die Linie. Das Plus am Ende legt einen neuen Punkt an. Oben in der Mitte rutscht mit „Präsentation“ oder „Ausarbeitung“ diese Linie nach links, daneben schreibt ihr.',
  };

  return (
    <ProjectShell
      me={me}
      project={project}
      where="Gliederung"
      phase="orientation"
      fill
      info={info}
      center={
        both ? (
          <div className={s.switch} role="group" aria-label="Welche Gliederung?" style={{ marginLeft: Math.max(0, 2 * shift), marginRight: Math.max(0, -2 * shift) }}>
            {lineBtn('praes', 'Präsentation')}
            <button ref={midRef} className={`${s.mid} ${shown === 'both' ? s.on : ''}`} onClick={() => choose('both')} title="Beide Linien nebeneinander" aria-label="Beide Linien nebeneinander" aria-pressed={shown === 'both'}>
              <Icon name="parallel" size={16} />
            </button>
            {lineBtn('ausarb', 'Ausarbeitung')}
          </div>
        ) : undefined
      }
      actions={
        join?.scopes && join.scopes.length > 1 ? (
          <select className={s.scope} value={scope ?? ''} onChange={(e) => sock && doJoin(sock, e.target.value)} title="Welche Gruppe?" aria-label="Welche Gruppe?">
            {join.scopes
              .filter((x) => x.scope !== 'p')
              .map((x) => (
                <option key={x.scope} value={x.scope}>
                  {x.title}
                </option>
              ))}
          </select>
        ) : undefined
      }
    >
      {join && !scope && <div className={`panel ${s.notice}`}>{project.role === 'teacher' ? 'Noch keine Gruppen. Bilde zuerst die Gruppen auf dem Board.' : 'Du bist noch keiner Gruppe zugeordnet. Sobald die Gruppen stehen, erscheint hier eure Gliederung.'}</div>}
      {map && scope && (
        <div className={shown === 'both' ? s.both : s.split} key={shown}>
          <div className={shown === 'both' ? s.bothCol : s.lineCol}>
            <GliederungBoard map={map} send={send} people={join?.people ?? []} canEdit={!join?.readOnly} meId={me.id} kinds={kinds} tab={shown === 'both' ? 'ausarb' : shown} onTab={() => {}} show={show} mode={shown} />
          </div>
          {shown !== 'both' && (
            <div className={`${s.work} ${shown === 'praes' ? s.workPraes : s.workAusarb}`}>
              <WorkSlot project={project} scope={scope} kind={shown} />
            </div>
          )}
        </div>
      )}
      {toast && <div className={p.toast}>{toast}</div>}
    </ProjectShell>
  );
}

/** neben der Linie: die Ausarbeitung als Text bzw. als Präsentation (Karten aus dem Schreibeditor) */
function WorkSlot({ project, scope, kind }: { project: ProjectView; scope: string; kind: LineKind }) {
  return (
    <div className={s.slot}>
      <a className="btn primary" href={href(`/projekt/ausarbeitung/?id=${project.id}&bereich=${scope}${kind === 'praes' ? '&linie=praes' : ''}`)}>
        <Icon name="doc" size={15} /> {kind === 'praes' ? 'Präsentation' : 'Ausarbeitung'} öffnen
      </a>
    </div>
  );
}
