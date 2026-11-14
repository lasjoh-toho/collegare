'use client';
/**
 * Einfüge-Protokoll (Konzept 6.1, 8d.3): Lernende sehen ihre eigenen Einträge und beantworten offene „Woher stammt der
 * Text?“-Fragen später; Lehrkräfte sehen alle Gruppen. Eine Grundlage für das Gespräch, keine Bewertung.
 */
import { useCallback, useEffect, useState } from 'react';
import { ProjectShell } from '@/components/ProjectShell';
import { Topbar } from '@/components/Topbar';
import { get, href, post } from '@/lib/api';
import { PASTE_ANSWERS } from '@/lib/pasteRules';
import type { ProjectView } from '@/lib/types';
import { useMe, useQuery } from '@/lib/useMe';
import s from './einfuegen.module.css';

type Answer = (typeof PASTE_ANSWERS)[number]['key'];
interface Paste {
  id: number;
  scope: string;
  userId: number;
  name: string;
  place: string;
  chars: number;
  sample: string;
  answer: Answer | null;
  note: string;
  at: number;
  answeredAt: number | null;
}
interface Data {
  role: 'teacher' | 'student';
  scopes: { scope: string; title: string }[];
  pastes: Paste[];
}

const fmt = (ms: number) => new Date(ms).toLocaleString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const label = (a: Answer | null) => PASTE_ANSWERS.find((o) => o.key === a)?.label ?? 'noch offen';

export default function PastesPage() {
  const [me] = useMe();
  const idParam = useQuery('id');
  const id = idParam ? Number(idParam) : NaN;
  const [project, setProject] = useState<ProjectView | null>(null);
  const [data, setData] = useState<Data | null>(null);
  const [filter, setFilter] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (me === null) location.replace(href('/'));
  }, [me]);
  const load = useCallback(() => {
    if (!Number.isInteger(id)) return;
    get<Data>(`/api/projects/${id}/einfuegen`).then(setData, (e) => setError(e instanceof Error ? e.message : String(e)));
  }, [id]);
  useEffect(() => {
    if (!Number.isInteger(id)) return;
    get<ProjectView>(`/api/projects/${id}`).then(setProject, () => setProject(null));
    load();
  }, [id, load]);

  if (!me || !project) return <Topbar me={me ?? null} />;
  const teacher = data?.role === 'teacher';
  const scopeTitle = (sc: string) => data?.scopes.find((x) => x.scope === sc)?.title ?? sc;
  const shown = (data?.pastes ?? []).filter((p) => !filter || p.scope === filter);
  const open = shown.filter((p) => !p.answer).length;
  const rule = { allow: 'Einsetzen von außen ist erlaubt und wird ab', ask: 'Beim Einsetzen von außen fragt Collegare ab', limit: 'Von außen lassen sich nur Stellen unter' }[project.settings.pasteOutside];

  return (
    <ProjectShell
      me={me}
      project={project}
      where="Herkunft von Texten"
      phase="research"
      actions={
        teacher && data && data.scopes.length > 1 ? (
          <select className={s.scope} value={filter} onChange={(e) => setFilter(e.target.value)} title="Welche Gruppe?">
            <option value="">Alle Gruppen</option>
            {data.scopes.map((x) => (
              <option key={x.scope} value={x.scope}>
                {x.title}
              </option>
            ))}
          </select>
        ) : undefined
      }
    >
      <div className={s.page}>
        <p className="muted">
          {rule} {project.settings.pasteThreshold} Zeichen {project.settings.pasteOutside === 'limit' ? 'einsetzen.' : 'nach der Herkunft gefragt bzw. protokolliert.'} Kopieren innerhalb des Projekts gehört nicht
          hierher. {teacher ? 'Das Protokoll ist eine Grundlage für das Gespräch, keine Bewertung.' : 'Offene Fragen kannst du hier beantworten.'}
        </p>
        {error && <div className="panel">{error}</div>}
        {data && !shown.length && <div className="panel">Noch keine Einträge.</div>}
        {open > 0 && <p className={s.open}>{open === 1 ? 'Eine Herkunft ist noch offen.' : `${open} Herkünfte sind noch offen.`}</p>}
        <ul className={s.list}>
          {shown.map((p) => (
            <li key={p.id} className={`panel ${s.item} ${p.answer ? '' : s.unanswered}`}>
              <div className={s.head}>
                <strong>{p.place || 'Karte'}</strong>
                <span className="muted">
                  {teacher ? `${p.name} · ${scopeTitle(p.scope)} · ` : ''}
                  {fmt(p.at)} · {p.chars} Zeichen
                </span>
              </div>
              <blockquote className={s.sample}>
                {p.sample}
                {p.chars > p.sample.length ? ' …' : ''}
              </blockquote>
              <div className={s.answer}>
                Herkunft: <strong>{label(p.answer)}</strong>
                {p.note ? ` – ${p.note}` : ''}
              </div>
              {!p.answer && p.userId === me.id && <AnswerForm projectId={id} paste={p} onDone={load} />}
            </li>
          ))}
        </ul>
      </div>
    </ProjectShell>
  );
}

function AnswerForm({ projectId, paste, onDone }: { projectId: number; paste: Paste; onDone: () => void }) {
  const [answer, setAnswer] = useState<Answer>('quote');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <div className={s.form}>
      <select value={answer} onChange={(e) => setAnswer(e.target.value as Answer)} aria-label="Herkunft">
        {PASTE_ANSWERS.map((o) => (
          <option key={o.key} value={o.key}>
            {o.label}
          </option>
        ))}
      </select>
      <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} placeholder={PASTE_ANSWERS.find((o) => o.key === answer)?.hint} aria-label="Angabe" />
      <button
        className="btn primary"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          await post(`/api/projects/${projectId}/einfuegen/${paste.id}`, { answer, note: note.trim() }).catch(() => {});
          setBusy(false);
          onDone();
        }}
      >
        Angeben
      </button>
    </div>
  );
}
