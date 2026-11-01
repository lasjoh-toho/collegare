'use client';
/**
 * Rahmen der Instanz (Konzept Abschnitt 4, „Rahmen der Administration“): was Lehrkräfte in ihren Projekten
 * einschalten dürfen. Abgeschaltetes erscheint in der Projekt-Einstellung grau.
 */
import { useEffect, useState } from 'react';
import { Topbar } from '@/components/Topbar';
import { ApiError, get, put } from '@/lib/api';
import { DOC_LABELS, EXPORT_LABELS, IMPORT_LABELS } from '@/lib/labels';
import type { Frame } from '@/lib/types';
import { useMe } from '@/lib/useMe';
import s from '../../start.module.css';
import v from '../verwaltung.module.css';

type FlagGroup = 'docTypes' | 'importTypes' | 'exportFormats';

function Flags({ frame, group, labels, onChange }: { frame: Frame; group: FlagGroup; labels: Record<string, string>; onChange: (f: Frame) => void }) {
  return (
    <div className={v.cols}>
      {Object.keys(frame[group]).map((k) => (
        <label key={k} className={v.check}>
          <input type="checkbox" checked={frame[group][k]} onChange={(e) => onChange({ ...frame, [group]: { ...frame[group], [k]: e.target.checked } })} />
          <span>{labels[k] ?? k}</span>
        </label>
      ))}
    </div>
  );
}

export default function Rahmen() {
  const [me] = useMe();
  const [frame, setFrame] = useState<Frame | null>(null);
  const [saved, setSaved] = useState<Frame | null>(null);
  const [error, setError] = useState('');
  const [ok, setOk] = useState(false);

  useEffect(() => {
    get<{ frame: Frame }>('/api/admin/frame')
      .then((r) => (setFrame(r.frame), setSaved(r.frame)))
      .catch((e) => setError(e instanceof ApiError ? e.message : String(e)));
  }, []);

  const change = (f: Frame) => (setFrame(f), setOk(false));
  async function save() {
    if (!frame) return;
    setError('');
    try {
      await put('/api/admin/frame', frame);
      setSaved(frame);
      setOk(true);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    }
  }
  const dirty = JSON.stringify(frame) !== JSON.stringify(saved);

  return (
    <>
      <Topbar me={me ?? null} title="Rahmen für Projekte" />
      <main className={s.start} style={{ maxWidth: 820, paddingBottom: 90 }}>
        {error && <div className="error">{error}</div>}
        {frame && (
          <>
            <p className="muted" style={{ margin: '0 0 12px' }}>
              Was hier abgeschaltet ist, können Lehrkräfte in ihren Projekten nicht einschalten. Es erscheint dort grau mit dem Hinweis „von der Administration abgeschaltet“. Der Rahmen gilt sofort für alle Projekte.
            </p>
            <section className={`panel ${v.box}`}>
              <h2>Dokumente, die Lernende anlegen dürfen</h2>
              <Flags frame={frame} group="docTypes" labels={DOC_LABELS} onChange={change} />
            </section>
            <section className={`panel ${v.box}`}>
              <h2>Dateien, die hochgeladen werden dürfen</h2>
              <Flags frame={frame} group="importTypes" labels={IMPORT_LABELS} onChange={change} />
              <div className="field" style={{ maxWidth: 260 }}>
                <label>Höchstgröße je Datei (MB)</label>
                <input type="number" min={1} max={500} value={frame.maxFileMb} onChange={(e) => change({ ...frame, maxFileMb: Math.max(1, Math.min(500, Number(e.target.value) || 1)) })} />
              </div>
            </section>
            <section className={`panel ${v.box}`}>
              <h2>Export</h2>
              <Flags frame={frame} group="exportFormats" labels={EXPORT_LABELS} onChange={change} />
            </section>
            <section className={`panel ${v.box}`}>
              <h2>KI und Hinweise</h2>
              <label className={v.check}>
                <input type="checkbox" checked={frame.ai} onChange={(e) => change({ ...frame, ai: e.target.checked })} />
                <span>
                  KI-Rückmeldungen erlauben
                  <small>Lehrkräfte schalten sie je Projekt ein. Namen gehen nie an die KI.</small>
                </span>
              </label>
              <div className="field" style={{ maxWidth: 420 }}>
                <label>Tippfluss-Hinweise (z. B. große Einfügungen)</label>
                <select value={frame.typingHints} onChange={(e) => change({ ...frame, typingHints: e.target.value as Frame['typingHints'] })}>
                  <option value="off">Aus</option>
                  <option value="students">Nur Hinweis an die Lernenden</option>
                  <option value="students_teachers">Lernende; Lehrkraft darf Hinweise und Antworten sehen</option>
                </select>
              </div>
              <p className="muted">Hinweise sind nie eine Bewertung. Ob die Lehrkraft sie sieht, entscheidet sie innerhalb dieses Rahmens je Projekt.</p>
            </section>
            <section className={`panel ${v.box}`}>
              <h2>Offenes Office</h2>
              <label className={v.check}>
                <input type="checkbox" checked={frame.openOffice} onChange={(e) => change({ ...frame, openOffice: e.target.checked })} />
                <span>
                  Office-Editoren ohne Anmeldung anbieten (unter <code>/office/</code>)
                  <small>Dateien bleiben dann im Browser der Person; in Projekten sind die Editoren immer verfügbar.</small>
                </span>
              </label>
            </section>
          </>
        )}
      </main>
      <div style={{ position: 'fixed', left: 0, right: 0, bottom: 0, display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px', background: 'color-mix(in srgb, var(--bg) 92%, transparent)', backdropFilter: 'blur(8px)', borderTop: '1px solid var(--line)' }}>
        <span className="grow" />
        {ok && !dirty && <span className={v.saved}>Gespeichert</span>}
        <button className="btn primary" disabled={!frame || !dirty} onClick={save}>
          Rahmen speichern
        </button>
      </div>
    </>
  );
}
