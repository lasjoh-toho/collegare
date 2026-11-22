'use client';
/**
 * Gliederung als Seitenleiste rechts (Symbol oben rechts neben Notizen und Chat, Jo 22. November 2026): eigene
 * Verbindung, Bereich aus der Adresse (z. B. Testbereich) oder die Gruppe der Person. „‖“ führt zur Parallelansicht.
 */
import { useEffect, useState } from 'react';
import type { Socket } from 'socket.io-client';
import { projectSocket } from '@/lib/api';
import type { Me, ProjectView } from '@/lib/types';
import { GliederungLive } from './GliederungLive';

export function OutlineSide({ me, project, onClose }: { me: Me; project: ProjectView; onClose: () => void }) {
  const [sock, setSock] = useState<Socket | null>(null);
  const [msg, setMsg] = useState('');
  const [wanted, setWanted] = useState<string | null>(null);
  useEffect(() => {
    const b = new URLSearchParams(location.search).get('bereich');
    setWanted(b && b !== 'p' ? b : null);
    const so = projectSocket();
    setSock(so);
    return () => {
      so.disconnect();
    };
  }, []);
  return (
    <>
      {msg && <p className="muted" style={{ padding: '8px 12px', margin: 0 }}>{msg}</p>}
      <GliederungLive sock={sock} project={project} scope={wanted} meId={me.id} show={setMsg} onClose={onClose} />
    </>
  );
}
