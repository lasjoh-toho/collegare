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
import { Gliederung, useLineTab } from './Gliederung';

export function GliederungLive({ sock, project, scope, meId, noteInfo, show, onClose, side = 'right', prefer }: { sock: Socket | null; project: ProjectView; scope: string; meId: number; noteInfo?: (id: number) => { label: string; kind: string } | undefined; show: (m: string) => void; onClose?: () => void; side?: 'left' | 'right'; prefer?: LineKind }) {
  const [map, setMap] = useState<MindMap | null>(null);
  const [people, setPeople] = useState<{ id: number; name: string }[]>([]);
  const [readOnly, setReadOnly] = useState(false);
  const version = useRef(0);
  const kinds = visibleKinds(project.settings.outlineLines, project.role === 'teacher');
  const [tab, setTab] = useLineTab(kinds, prefer);
  const showRef = useRef(show);
  showRef.current = show;

  useEffect(() => {
    if (!sock) return;
    const join = () =>
      sock.emit('map:join', { projectId: project.id, scope }, (r: { ok: boolean; error?: string; map?: MindMap; version?: number; people?: { id: number; name: string }[]; readOnly?: boolean }) => {
        if (!r.ok || !r.map) return showRef.current(r.error ?? 'Gliederung nicht geladen');
        version.current = r.version ?? 0;
        setMap(r.map);
        setPeople(r.people ?? []);
        setReadOnly(!!r.readOnly);
      });
    const onMap = (msg: { projectId: number; scope: string; map: MindMap; version: number }) => {
      if (msg.projectId !== project.id || msg.scope !== scope || msg.version <= version.current) return;
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
  }, [sock, project.id, scope]);

  const send = useCallback(
    (op: MapOp) =>
      new Promise<boolean>((resolve) => {
        if (!sock?.connected) {
          showRef.current('Keine Verbindung zum Server. Bitte kurz warten.');
          return resolve(false);
        }
        sock.emit('map:op', { projectId: project.id, scope, op }, (r: { ok: boolean; error?: string }) => {
          if (!r.ok) showRef.current(r.error ?? 'Änderung fehlgeschlagen');
          resolve(r.ok);
        });
      }),
    [sock, project.id, scope],
  );

  if (!map) return <p className="muted" style={{ padding: 12 }}>Gliederung wird geladen …</p>;
  return <Gliederung map={map} send={send} people={people} canEdit={!readOnly} meId={meId} kinds={kinds} tab={tab} onTab={setTab} noteInfo={noteInfo} show={show} onClose={onClose} side={side} bothHref={href(`/projekt/gliederung/?id=${project.id}&bereich=${scope}`)} />;
}
