'use client';
/**
 * Klassische Folienpräsentation (Wunsch Jo, 14. November 2026): neben der Pinnwand eine Präsentation wie in PowerPoint,
 * eine je Gruppe. Seit 0.7.0 in Bento (MIT, mit Menüband wie in PowerPoint) statt OnlyOffice: der Server liefert die
 * Bento-Oberfläche mit der Präsentation (/api/documents/:id/bento), Bento speichert selbst dorthin zurück. Diese Seite
 * erledigt die Datei-Aktionen aus Bentos Menü „Datei“ (PowerPoint, Bento-Datei, JSON). Die Lehrkraft sieht die
 * Präsentationen der Gruppen lesend und arbeitet im eigenen Testbereich selbst.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ProjectShell } from '@/components/ProjectShell';
import { Topbar } from '@/components/Topbar';
import { ApiError, BASE_PATH, get, href } from '@/lib/api';
import { download, fileBase, importBentoHtml, importJson, importPowerPoint, pickFile } from '@/lib/bentoFiles';
import { bentoToPptx } from '@/lib/pptxExport';
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

type Msg = { bento: string; action?: string; doc?: Record<string, unknown>; snapshots?: Record<string, string>; dirty?: boolean };

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

  const frame = useRef<HTMLIFrameElement>(null);
  const [busy, setBusy] = useState('');
  const toBento = useCallback((msg: Record<string, unknown>) => frame.current?.contentWindow?.postMessage(msg, location.origin), []);
  const toast = useCallback((message: string, kind: 'neutral' | 'success' | 'error' = 'neutral') => toBento({ bento: 'toast', message, kind }), [toBento]);

  // Datei-Aktionen aus Bentos Menü „Datei“
  useEffect(() => {
    const onMsg = async (ev: MessageEvent) => {
      if (ev.origin !== location.origin || ev.source !== frame.current?.contentWindow) return;
      const m = ev.data as Msg;
      if (!m || m.bento !== 'file' || !m.action) return;
      const replace = (d: Record<string, unknown>, note?: string) => {
        toBento({ bento: 'replace', doc: d });
        if (note) setTimeout(() => toast(note), 1200);
      };
      try {
        switch (m.action) {
          case 'exportPptx': {
            setBusy('PowerPoint-Datei wird erstellt …');
            const r = await bentoToPptx(m.doc ?? {}, m.snapshots ?? {});
            download(r.blob, `${fileBase(m.doc?.title)}.pptx`);
            toast(r.warnings.length ? `PowerPoint-Datei erstellt. Hinweis: ${r.warnings.join(' ')}` : 'PowerPoint-Datei erstellt.', 'success');
            break;
          }
          case 'exportJson':
            download(new Blob([JSON.stringify(m.doc, null, 1)], { type: 'application/json' }), `${fileBase(m.doc?.title)}.bento.json`);
            break;
          case 'importPptx': {
            const f = await pickFile('.pptx,.ppt,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/vnd.ms-powerpoint');
            if (!f) break;
            setBusy('PowerPoint-Datei wird umgewandelt …');
            const r = await importPowerPoint(f);
            replace(r.doc, r.warnings.length ? `Hinweise zum Import: ${r.warnings.slice(0, 4).join(' ')}` : undefined);
            break;
          }
          case 'importHtml': {
            const f = await pickFile('.html,.htm,text/html');
            if (f) replace(await importBentoHtml(f));
            break;
          }
          case 'importJson': {
            const f = await pickFile('.json,application/json');
            if (f) replace(await importJson(f));
            break;
          }
        }
      } catch (e) {
        toast(e instanceof Error ? e.message : String(e), 'error');
      } finally {
        setBusy('');
      }
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [toBento, toast]);

  if (!me || !project) return <Topbar me={me ?? null} />;
  const teacher = project.role === 'teacher';
  const doc = data?.doc ?? null;
  const editing = !!doc && !doc.doneAt && (!teacher || !!data?.test);
  const url = doc ? `${BASE_PATH}/api/documents/${doc.id}/bento` : null;

  return (
    <ProjectShell
      me={me}
      project={project}
      where="Folien"
      phase="presentation"
      fill
      actions={
        <>
          {busy && <span className="muted">{busy}</span>}
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
            <iframe ref={frame} key={url} className={s.frame} src={url} title="Folien" allow="clipboard-read; clipboard-write; fullscreen; display-capture" allowFullScreen />
          </div>
        )}
      </div>
    </ProjectShell>
  );
}
