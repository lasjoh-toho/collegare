'use client';
/**
 * i-Knopf neben dem Seitentitel (Wunsch Jo, 14. November 2026): ersetzt die Erklärblasen. Ein Klick zeigt die
 * Erklärung; Lehrkräfte passen Text und „beim ersten Öffnen zeigen“ in einem Fenster an (Einstellung infos),
 * nicht auf der Einstellungsseite. Lernende sehen eine Erklärung mit „start“ einmal von selbst, je Text gemerkt.
 */
import { useEffect, useRef, useState } from 'react';
import { patch } from '@/lib/api';
import type { ProjectView } from '@/lib/types';
import { Icon } from './Icon';
import st from './info.module.css';

export interface InfoSpec {
  /** Schlüssel in settings.infos, z. B. „mindmap“ */
  key: string;
  /** Standardtext, wenn die Lehrkraft keinen eigenen geschrieben hat */
  text: string;
  /** geht beim ersten Öffnen von selbst auf, solange die Lehrkraft nichts anderes eingestellt hat */
  start?: boolean;
  /** Name im Anpassen-Fenster, z. B. „Mindmap der Gruppe“ */
  title: string;
}

const seenKey = (projectId: number, key: string) => `collegare-info-${projectId}-${key}`;
function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return String(h);
}

export function InfoButton({ project, spec }: { project: ProjectView; spec: InfoSpec }) {
  const [own, setOwn] = useState(project.settings.infos?.[spec.key]);
  useEffect(() => setOwn(project.settings.infos?.[spec.key]), [project.settings.infos, spec.key]);
  const text = own?.text.trim() || spec.text;
  // gemerkt wird nur der eigene Text der Lehrkraft: ein Standardtext, der je nach Ansicht wechselt, geht nicht erneut auf
  const mark = hash(own?.text.trim() || '');
  const start = own ? own.start : !!spec.start;
  const teacher = project.role === 'teacher';
  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState(false);
  const box = useRef<HTMLSpanElement>(null);

  // einmal von selbst zeigen, wieder erst, wenn die Lehrkraft den Text ändert
  useEffect(() => {
    if (!start) return;
    try {
      if (localStorage.getItem(seenKey(project.id, spec.key)) !== mark) setOpen(true);
    } catch {}
  }, [start, mark, project.id, spec.key]);
  const close = () => {
    setOpen(false);
    try {
      localStorage.setItem(seenKey(project.id, spec.key), mark);
    } catch {}
  };
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => !box.current?.contains(e.target as Node) && close();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    addEventListener('pointerdown', onDown);
    addEventListener('keydown', onKey);
    return () => {
      removeEventListener('pointerdown', onDown);
      removeEventListener('keydown', onKey);
    };
  });

  return (
    <span className={st.wrap} ref={box}>
      <button className={`btn icon ${st.btn} ${open ? 'on' : ''}`} onClick={() => (open ? close() : setOpen(true))} title="Erklärung" aria-label="Erklärung" aria-expanded={open}>
        <Icon name="info" size={15} />
      </button>
      {open && (
        <div className={`panel ${st.pop}`} role="note">
          <p className={st.text}>{text}</p>
          <div className={st.foot}>
            {teacher && (
              <button className="btn" onClick={() => setEdit(true)}>
                <Icon name="pen" size={13} /> Anpassen
              </button>
            )}
            <span className="grow" />
            <button className="btn" onClick={close}>
              Verstanden
            </button>
          </div>
        </div>
      )}
      {edit && (
        <InfoDialog
          project={project}
          spec={spec}
          own={own}
          onClose={() => setEdit(false)}
          onSaved={(v) => {
            setOwn(v);
            setEdit(false);
          }}
        />
      )}
    </span>
  );
}

function InfoDialog({ project, spec, own, onClose, onSaved }: { project: ProjectView; spec: InfoSpec; own?: { text: string; start: boolean }; onClose: () => void; onSaved: (v: { text: string; start: boolean }) => void }) {
  const [text, setText] = useState(own?.text ?? '');
  const [start, setStart] = useState(own ? own.start : !!spec.start);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  async function save() {
    setBusy(true);
    setErr('');
    const v = { text: text.trim(), start };
    try {
      await patch(`/api/projects/${project.id}`, { settings: { infos: { ...(project.settings.infos ?? {}), [spec.key]: v } } });
      project.settings.infos = { ...(project.settings.infos ?? {}), [spec.key]: v };
      onSaved(v);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Speichern fehlgeschlagen');
      setBusy(false);
    }
  }
  return (
    <div className="modal-bg" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${st.modal}`} role="dialog" aria-label="Erklärung anpassen">
        <h2>Erklärung: {spec.title}</h2>
        <label className={st.label} htmlFor="info-text">
          Text für die Lernenden (leer = Standardtext)
        </label>
        <textarea id="info-text" className={st.area} rows={6} maxLength={2000} value={text} placeholder={spec.text} onChange={(e) => setText(e.target.value)} />
        <label className={st.check}>
          <input type="checkbox" checked={start} onChange={(e) => setStart(e.target.checked)} /> Beim ersten Öffnen der Seite von selbst zeigen
        </label>
        {err && <p className={st.err}>{err}</p>}
        <div className={st.foot}>
          {text && (
            <button className="btn" onClick={() => setText('')}>
              Standardtext
            </button>
          )}
          <span className="grow" />
          <button className="btn" onClick={onClose}>
            Abbrechen
          </button>
          <button className="btn primary" onClick={save} disabled={busy}>
            Speichern
          </button>
        </div>
      </div>
    </div>
  );
}
