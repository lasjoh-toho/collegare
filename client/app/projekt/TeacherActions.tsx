'use client';
/** Knöpfe der Lehrkraft in der Kopfzeile des Projekts: Lernende bzw. Moodle-Abgleich, Zugangscodes, Einstellungen. */
import { useState } from 'react';
import { CodesDialog } from '@/components/CodesDialog';
import { Icon } from '@/components/Icon';
import { ApiError, href, post } from '@/lib/api';
import type { ProjectView } from '@/lib/types';
import p from './projekt.module.css';

export function TeacherActions({ project, onChanged }: { project: ProjectView; onChanged: () => void }) {
  const [dialog, setDialog] = useState<'codes' | 'students' | null>(null);
  const [toast, setToast] = useState('');
  const show = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 4000);
  };

  async function moodleImport() {
    try {
      const r = await post<{ added: number; total: number }>(`/api/projects/${project.id}/moodle-import`, {});
      show(r.added ? `${r.added} neu aus Moodle übernommen (${r.total} Lernende im Kurs)` : `Alle ${r.total} Lernenden sind schon im Projekt`);
      onChanged();
    } catch (e) {
      show(e instanceof ApiError ? e.message : String(e));
    }
  }

  return (
    <>
      <div className={p.actions}>
        {project.course.moodle ? (
          <button className="btn" onClick={moodleImport} title="Teilnehmende des Moodle-Kurses übernehmen">
            ↻ <span className={p.label}>Aus Moodle</span>
          </button>
        ) : (
          <button className="btn" onClick={() => setDialog('students')} title="Lernende eintragen">
            + <span className={p.label}>Lernende</span>
          </button>
        )}
        <button className="btn" onClick={() => setDialog('codes')} title="Zugangscodes">
          <Icon name="key" size={15} /> <span className={p.label}>Zugangscodes</span>
        </button>
        <a className="btn" href={href(`/projekt/korrektur/?id=${project.id}`)} title="Korrektur">
          <Icon name="pen" size={15} /> <span className={p.label}>Korrektur</span>
        </a>
        <a className="btn" href={href(`/einstellungen/?id=${project.id}`)} title="Einstellungen">
          <Icon name="gear" size={15} /> <span className={p.label}>Einstellungen</span>
        </a>
      </div>
      {toast && <div className={p.toast}>{toast}</div>}
      {dialog === 'codes' && (
        <CodesDialog projectId={project.id} title={project.title} members={project.board.members} validUntil={project.codesValidUntil} onClose={() => (setDialog(null), onChanged())} />
      )}
      {dialog === 'students' && <StudentsDialog projectId={project.id} onClose={() => (setDialog(null), onChanged())} />}
    </>
  );
}

function StudentsDialog({ projectId, onClose }: { projectId: number; onClose: () => void }) {
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const names = text.split('\n').map((l) => l.trim()).filter(Boolean);
  async function save() {
    try {
      await post(`/api/projects/${projectId}/students`, { names });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  return (
    <div className="modal-bg" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-label="Lernende eintragen">
        <h2>Lernende eintragen</h2>
        <p className="muted">Eine Zeile je Person, z. B. aus einer Klassenliste kopiert. Namen bleiben in Collegare und gehen nicht an die KI.</p>
        <div className="field">
          <textarea rows={12} value={text} onChange={(e) => setText(e.target.value)} placeholder={'Anna Beispiel\nBen Muster'} autoFocus />
        </div>
        {error && <div className="error">{error}</div>}
        <div className="row">
          <span className="grow" />
          <button className="btn" onClick={onClose}>
            Abbrechen
          </button>
          <button className="btn primary" disabled={!names.length} onClick={save}>
            {names.length} eintragen
          </button>
        </div>
      </div>
    </div>
  );
}
