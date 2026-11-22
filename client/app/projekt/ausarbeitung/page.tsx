'use client';
/**
 * Phase „Ausarbeitung“: eigener, leichter Schreibeditor statt der Office-Ansicht (Wünsche Jo, 21. und 22. November 2026).
 * Die Karten selbst stecken in components/AusarbeitungCards.tsx (stehen auch auf der Seite „Gliederung“); hier kommen
 * Kopfzeile, Gruppenwahl, Linie (Ausarbeitung oder Präsentation), Lesen/Drucken und die Gliederung links dazu.
 *
 * Alte Abschnitte aus dem Office-Editor bleiben lesbar (iframe unter /office/, AGPL-Teil, nur über die Adresse).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import { ProjectShell } from '@/components/ProjectShell';
import { Topbar } from '@/components/Topbar';
import { GliederungLive } from '@/components/GliederungLive';
import { AusarbeitungCards, printArticle, type DocList } from '@/components/AusarbeitungCards';
import type { InfoSpec } from '@/components/InfoButton';
import { ApiError, BASE_PATH, get, projectSocket } from '@/lib/api';
import type { LineKind } from '@/lib/lines';
import { announceSide, useSideBus } from '@/lib/sides';
import type { ProjectView } from '@/lib/types';
import { useMe, useQuery } from '@/lib/useMe';
import p from '../projekt.module.css';
import s from './ausarbeitung.module.css';

const INFO: InfoSpec = {
  key: 'ausarbeitung',
  title: 'Ausarbeitung',
  text:
    'Jeder Punkt eurer Gliederung wird hier ein Panel; ändert ihr die Gliederung, ziehen die Panels von selbst nach. Ein Klick ins Panel, und ihr schreibt: Oben am Eintrag stehen dann die Werkzeuge. ' +
    'Links steht der Text, rechts der Rand. „Auszeichnen“: Hervorheben und Begriff (das Wort kommt mit eurer Erklärung in die Begriffe am Ende). „Rand“: Randnotiz (nummeriert), Bemerkung (ohne Nummer) und Bild mit Unterschrift am Rand. ' +
    'Notizen zieht ihr aus „Notizen und Quellen“ (Symbol oben rechts) herein: in ein Panel gezogen wird die Notiz an der Stelle als Text eingesetzt, zwischen zwei Panels abgelegt entsteht ein neuer Punkt der Gliederung. ' +
    'Gespeichert wird von selbst. „⋯“ am Panel zeigt frühere Fassungen und „Fertig melden“. „Zurück“ unten holt den Stand, den eure Texte vor dem letzten Abgleich mit der Gliederung hatten. ' +
    'Blau getönt ist der Text der Ausarbeitung, orange die Präsentation. „Lesen“ zeigt alles so, wie es als Webseite und gedruckt aussieht.',
};

export default function Ausarbeitung() {
  const [me] = useMe();
  const idParam = useQuery('id');
  const lineParam = useQuery('linie');
  const jumpParam = useQuery('abschnitt');
  const scopeParam = useQuery('bereich');
  const id = idParam ? Number(idParam) : NaN;
  const [project, setProject] = useState<ProjectView | null>(null);
  const [scope, setScope] = useState<string | null>(null);
  const [data, setData] = useState<DocList | null>(null);
  const [kind, setKind] = useState<LineKind>('ausarb');
  const [view, setView] = useState<'write' | 'read'>('write');
  const [line, setLine] = useState(false);
  const [toast, setToast] = useState('');
  const [sock, setSock] = useState<Socket | null>(null);
  const area = useRef<HTMLDivElement>(null);

  // links wie rechts nur ein Seitenmenü: die Gliederung links schließt das Phasenmenü und umgekehrt
  useSideBus('left', 'ausarbeitung-gliederung', line, () => setLine(false));
  const toggleLine = () => {
    if (!line) announceSide('left', 'ausarbeitung-gliederung');
    setLine(!line);
  };

  const show = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 5000);
  }, []);
  const fail = useCallback((e: unknown) => show(e instanceof ApiError ? e.message : String(e)), [show]);

  useEffect(() => {
    if (me === null) location.replace(BASE_PATH + '/');
  }, [me]);
  useEffect(() => {
    if (Number.isInteger(id)) get<ProjectView>(`/api/projects/${id}`).then(setProject, fail);
  }, [id, fail]);
  useEffect(() => {
    if (lineParam === 'praes') setKind('praes');
  }, [lineParam]);
  useEffect(() => {
    if (scopeParam) setScope(scopeParam);
  }, [scopeParam]);
  // Gliederung links: auf breiten Bildschirmen von Anfang an offen
  useEffect(() => {
    setLine(matchMedia('(min-width: 1180px)').matches);
  }, []);
  useEffect(() => {
    if (!Number.isInteger(id) || !me) return;
    const so = projectSocket();
    setSock(so);
    return () => {
      so.disconnect();
      setSock(null);
    };
  }, [id, me]);

  if (!me || !project) return <Topbar me={me ?? null} />;

  return (
    <ProjectShell
      me={me}
      project={project}
      where={kind === 'praes' ? 'Präsentation' : 'Ausarbeitung'}
      phase="drafting"
      docs={data}
      fill
      info={INFO}
      crumbs={
        data && data.scopes.length > 1 ? (
          <select className={s.scope} value={data.scope ?? ''} onChange={(e) => setScope(e.target.value)} title="Ausarbeitung welcher Gruppe?">
            {data.scopes.map((x) => (
              <option key={x.scope} value={x.scope}>
                {x.title}
              </option>
            ))}
          </select>
        ) : undefined
      }
      actions={
        <>
          {view === 'write' && data?.scope && (
            <button className={`btn ${s.wide} ${line ? 'on' : ''}`} onClick={toggleLine} aria-pressed={line} title="Gliederung links ein- oder ausblenden">
              Gliederung
            </button>
          )}
          {data?.hasPraes && (
            <span className={`${s.seg} ${s.wide}`} role="group" aria-label="Linie">
              <button className={`btn ${kind === 'ausarb' ? 'on' : ''}`} onClick={() => setKind('ausarb')} aria-pressed={kind === 'ausarb'} title="Text der Ausarbeitung">
                Text
              </button>
              <button className={`btn ${kind === 'praes' ? 'on' : ''}`} onClick={() => setKind('praes')} aria-pressed={kind === 'praes'} title="Texte der Präsentation">
                Präsentation
              </button>
            </span>
          )}
          <span className={s.seg} role="group" aria-label="Ansicht">
            <button className={`btn ${view === 'write' ? 'on' : ''}`} onClick={() => setView('write')} aria-pressed={view === 'write'}>
              Schreiben
            </button>
            <button className={`btn ${view === 'read' ? 'on' : ''}`} onClick={() => setView('read')} aria-pressed={view === 'read'}>
              Lesen
            </button>
          </span>
          {view === 'read' && (
            <button className="btn" onClick={() => area.current && printArticle(area.current, project.title)} title="Drucken oder als PDF sichern">
              Drucken
            </button>
          )}
        </>
      }
    >
      <div ref={area} className={s.area}>
        {view === 'write' && line && data?.scope && (
          <aside className={s.line}>
            <GliederungLive sock={sock} project={project} scope={data.scope} meId={me.id} show={show} onClose={() => setLine(false)} side="left" prefer={kind} />
          </aside>
        )}
        <AusarbeitungCards project={project} scope={scope} me={me} sock={sock} kind={kind} show={show} view={view} jump={jumpParam ? Number(jumpParam) : null} onLoaded={setData} />
      </div>
      {toast && <div className={p.toast}>{toast}</div>}
    </ProjectShell>
  );
}
