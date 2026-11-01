'use client';
/** Erster Start aus einer Moodle-Aktivität: Lehrkraft verbindet sie mit einem Projekt, Lernende warten. */
import { useEffect, useState } from 'react';
import { Topbar } from '@/components/Topbar';
import { ApiError, get, href, post } from '@/lib/api';
import { useMe, useQuery } from '@/lib/useMe';
import s from '../start.module.css';

interface LinkInfo {
  id: number;
  title: string | null;
  course: string;
  projectId: number | null;
  teacher: boolean;
  projects: { id: number; title: string; mode: string }[];
}

export default function LtiSetup() {
  const [me] = useMe();
  const linkId = useQuery('link');
  const waiting = useQuery('warten');
  const [info, setInfo] = useState<LinkInfo | null>(null);
  const [error, setError] = useState('');
  const [title, setTitle] = useState('');
  const [mode, setMode] = useState<'group' | 'single'>('group');
  const [importRoster, setImportRoster] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!linkId) return;
    get<LinkInfo>(`/api/lti/links/${linkId}`)
      .then((i) => {
        if (i.projectId) location.replace(href(`/projekt/?id=${i.projectId}`));
        setInfo(i);
        setTitle(i.title ?? '');
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : String(e)));
  }, [linkId]);

  async function connect(body: unknown) {
    setBusy(true);
    setError('');
    try {
      const r = await post<{ projectId: number; warning: string | null }>(`/api/lti/links/${linkId}/project`, body);
      if (r.warning) alert(r.warning);
      location.replace(href(`/projekt/?id=${r.projectId}`));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <>
      <Topbar me={me ?? null} title={info?.course} />
      <main className={s.start} style={{ maxWidth: 640 }}>
        {error && <div className="error">{error}</div>}
        {info && (!info.teacher || waiting) && (
          <div className={`panel ${s.empty}`}>
            <h2>Noch nicht eingerichtet</h2>
            <p className="muted">Deine Lehrkraft richtet diese Aktivität gerade ein. Öffne sie später noch einmal aus Moodle.</p>
          </div>
        )}
        {info?.teacher && !waiting && (
          <div className={`panel ${s.empty}`} style={{ alignItems: 'stretch', gap: 12 }}>
            <h2>Moodle-Aktivität einrichten</h2>
            <p className="muted">
              „{info.title ?? 'Aktivität'}“ im Kurs {info.course} ist noch mit keinem Projekt verbunden. Danach landen alle, die die Aktivität öffnen, direkt im Projekt.
            </p>
            <div className="field">
              <label>Titel des Projekts</label>
              <input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
            </div>
            <div className="field">
              <label>Arbeitsform</label>
              <div className="seg">
                <button className={`btn ${mode === 'group' ? 'on' : ''}`} onClick={() => setMode('group')}>
                  In Gruppen
                </button>
                <button className={`btn ${mode === 'single' ? 'on' : ''}`} onClick={() => setMode('single')}>
                  Einzeln
                </button>
              </div>
            </div>
            <label className="row">
              <input type="checkbox" checked={importRoster} onChange={(e) => setImportRoster(e.target.checked)} />
              Lernende aus dem Moodle-Kurs übernehmen
            </label>
            <div className="row">
              <span className="grow" />
              <button className="btn primary" disabled={busy || !title.trim()} onClick={() => connect({ title: title.trim(), mode, importRoster })}>
                Projekt anlegen
              </button>
            </div>
            {info.projects.length > 0 && (
              <>
                <div className={s.sep}>oder mit einem vorhandenen Projekt verbinden</div>
                {info.projects.map((p) => (
                  <button key={p.id} className="btn" disabled={busy} onClick={() => connect({ projectId: p.id })}>
                    {p.title}
                  </button>
                ))}
              </>
            )}
          </div>
        )}
      </main>
    </>
  );
}
