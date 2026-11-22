'use client';
/**
 * Gliederung neben „Notizen und Quellen“ (Konzept 8h, ersetzt „Meine Linie“ aus 8e.7): holt die Mindmap der Gruppe
 * über den Socket der Seite (map:join) und zeigt dieselbe Linie wie neben der Mindmap. Notizen zieht man aus dem
 * Thread auf die Punkte. side="left" beim Schreiben (Ausarbeitung, Präsentation), sonst rechts.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import { href } from '@/lib/api';
import { visibleKinds, type LineKind } from '@/lib/lines';
import type { MapOp, MindMap, ProjectView } from '@/lib/types';
import { teacherGroup } from './TeacherAsk';
import { Gliederung, useLineTab } from './Gliederung';

export function GliederungLive({ sock, project, scope: wanted, meId, noteInfo, show, onClose, side = 'right', prefer }: { sock: Socket | null; project: ProjectView; scope?: string | null; meId: number; noteInfo?: (id: number) => { label: string; kind: string } | undefined; show: (m: string) => void; onClose?: () => void; side?: 'left' | 'right'; prefer?: LineKind }) {
  const [map, setMap] = useState<MindMap | null>(null);
  const [people, setPeople] = useState<{ id: number; name: string }[]>([]);
  const [readOnly, setReadOnly] = useState(false);
  const [scopes, setScopes] = useState<{ scope: string; title: string }[]>([]);
  // ohne vorgegebenen Bereich wählt der Server (Gruppe der Person); er nennt ihn in der Antwort
  const [scope, setScope] = useState<string | null>(wanted ?? null);
  const scopeRef = useRef<string | null>(wanted ?? null);
  const version = useRef(0);
  const kinds = visibleKinds(project.settings.outlineLines, project.role === 'teacher');
  const [tab, setTab] = useLineTab(kinds, prefer);
  const showRef = useRef(show);
  showRef.current = show;

  useEffect(() => {
    if (!sock) return;
    const join = () =>
      sock.emit('map:join', { projectId: project.id, scope: wanted ?? undefined }, (r: { ok: boolean; error?: string; map?: MindMap; version?: number; people?: { id: number; name: string }[]; readOnly?: boolean; scope?: string | null; scopes?: { scope: string; title: string }[] }) => {
        if (!r.ok || !r.map) return showRef.current(r.error ?? 'Gliederung nicht geladen');
        scopeRef.current = r.scope ?? wanted ?? null;
        setScope(scopeRef.current);
        version.current = r.version ?? 0;
        setMap(r.map);
        setPeople(r.people ?? []);
        setReadOnly(!!r.readOnly);
        setScopes(r.scopes ?? []);
      });
    const onMap = (msg: { projectId: number; scope: string; map: MindMap; version: number }) => {
      if (msg.projectId !== project.id || msg.scope !== scopeRef.current || msg.version <= version.current) return;
      version.current = msg.version;
      setMap(msg.map);
    };
    if (sock.connected) join();
    sock.on('connect', join);
    sock.on('map', onMap);
    return () => {
      sock.off('connect', join);
      sock.off('map', onMap);
    };
  }, [sock, project.id, wanted]);

  const send = useCallback(
    (op: MapOp) =>
      new Promise<boolean>((resolve) => {
        if (!sock?.connected) {
          showRef.current('Keine Verbindung zum Server. Bitte kurz warten.');
          return resolve(false);
        }
        sock.emit('map:op', { projectId: project.id, scope: scopeRef.current, op }, (r: { ok: boolean; error?: string }) => {
          if (!r.ok) showRef.current(r.error ?? 'Änderung fehlgeschlagen');
          resolve(r.ok);
        });
      }),
    [sock, project.id],
  );

  if (!map) return <p className="muted" style={{ padding: 12 }}>Gliederung wird geladen …</p>;
  return <Gliederung map={map} send={send} people={people} canEdit={!readOnly} meId={meId} kinds={kinds} tab={tab} onTab={setTab} noteInfo={noteInfo} show={show} onClose={onClose} side={side} bothHref={href(`/projekt/gliederung/?id=${project.id}&bereich=${scope}`)} teacher={teacherGroup({ role: project.role, scope, scopes, sock, projectId: project.id })} />;
}
