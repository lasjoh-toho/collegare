'use client';
/**
 * Arbeitsprozess, Abschnitt „Herkunft von Texten“ (Konzept 6.1, 8d.3; Seitentitel Wunsch Jo, 14. November 2026): Lernende sehen ihre eigenen Einträge und beantworten offene „Woher stammt der
 * Text?“-Fragen später; Lehrkräfte sehen alle Gruppen. Eine Grundlage für das Gespräch, keine Bewertung.
 *
 * Seit 20. November 2026 (Wunsch Jo): Einträge stehen nach Ziel (Karte, Notiz) zusammen; Lehrkräfte öffnen dort die
 * „Spur im Text“ (lib/trace.ts), die farbig zeigt, welche Stellen noch aus welcher Vorlage stammen. Texte aus der
 * Texterkennung erscheinen mit dem Vermerk Druckschrift bzw. Handschrift und dem Bild.
 */
import { useCallback, useEffect, useState } from 'react';
import { ProjectShell } from '@/components/ProjectShell';
import { Topbar } from '@/components/Topbar';
import { get, href, post } from '@/lib/api';
import { noteFileUrl } from '@/lib/imageDrop';
import { CITE_RULE, PASTE_ANSWERS } from '@/lib/pasteRules';
import { trace, TRACE_COLORS } from '@/lib/trace';
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
  target: string;
  origin: 'paste' | 'print' | 'hand';
  noteId: number | null;
}
interface Data {
  role: 'teacher' | 'student';
  scopes: { scope: string; title: string }[];
  pastes: Paste[];
}

const fmt = (ms: number) => new Date(ms).toLocaleString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const label = (a: Answer | null) => PASTE_ANSWERS.find((o) => o.key === a)?.label ?? 'noch offen';
const ORIGIN = { paste: 'Eingesetzt', print: 'Texterkennung · Druckschrift', hand: 'Texterkennung · Handschrift' } as const;
const pct = (x: number) => `${Math.round(x * 100)} %`;

/** Einträge nach Ziel; ältere Einträge ohne Ziel nach Ort */
function groupByTarget(list: Paste[]) {
  const groups = new Map<string, { key: string; target: string; place: string; scope: string; items: Paste[] }>();
  for (const p of list) {
    const key = p.scope + '|' + (p.target || 'ort:' + p.place);
    const g = groups.get(key) ?? { key, target: p.target, place: p.place, scope: p.scope, items: [] };
    g.items.push(p);
    groups.set(key, g);
  }
  return [...groups.values()];
}

export default function PastesPage() {
  const [me] = useMe();
  const idParam = useQuery('id');
  const id = idParam ? Number(idParam) : NaN;
  const [project, setProject] = useState<ProjectView | null>(null);
  const [data, setData] = useState<Data | null>(null);
  const [filter, setFilter] = useState('');
  const [traceOf, setTraceOf] = useState<string | null>(null);
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
  const st = project.settings;
  const rule = [
    st.pasteLogAll !== false ? 'Jedes Einsetzen von außen steht hier.' : `Einsetzen von außen steht hier, sobald es je Karte bzw. Notiz ${st.pasteThreshold} Zeichen erreicht.`,
    st.pasteOutside === 'ask' ? `Ab ${st.pasteThreshold} Zeichen je Karte bzw. Notiz fragt Collegare nach der Herkunft.` : st.pasteOutside === 'limit' ? `Mehr als ${st.pasteThreshold - 1} Zeichen je Karte bzw. Notiz lassen sich nicht einsetzen.` : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <ProjectShell
      me={me}
      project={project}
      where="Arbeitsprozess"
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
        <h1 className={s.title}>Arbeitsprozess</h1>
        <h2 className={s.section}>Herkunft von Texten</h2>
        <p className={s.rule}>{CITE_RULE}</p>
        <p className="muted">
          {rule} Kopieren innerhalb des Projekts gehört nicht hierher. {teacher ? 'Das Protokoll ist eine Grundlage für das Gespräch, keine Bewertung.' : 'Offene Fragen kannst du hier beantworten.'}
        </p>
        {error && <div className="panel">{error}</div>}
        {data && !shown.length && <div className="panel">Noch keine Einträge.</div>}
        {open > 0 && <p className={s.open}>{open === 1 ? 'Eine Herkunft ist noch offen.' : `${open} Herkünfte sind noch offen.`}</p>}
        <ul className={s.list}>
          {groupByTarget(shown).map((g) => (
            <li key={g.key} className={`panel ${s.group}`}>
              <div className={s.head}>
                <strong>{g.place || 'Karte'}</strong>
                <span className="muted">
                  {teacher ? `${scopeTitle(g.scope)} · ` : ''}
                  {g.items.length === 1 ? 'ein Eintrag' : `${g.items.length} Einträge`} · {g.items.filter((p) => p.origin === 'paste').reduce((n, p) => n + p.chars, 0)} Zeichen von außen
                </span>
                {teacher && g.target && (
                  <button className="btn" onClick={() => setTraceOf(traceOf === g.target ? null : g.target)} aria-expanded={traceOf === g.target}>
                    {traceOf === g.target ? 'Spur schließen' : 'Spur im Text'}
                  </button>
                )}
              </div>
              {teacher && traceOf === g.target && <TraceView projectId={id} target={g.target} />}
              <ul className={s.list}>
                {g.items.map((p) => (
                  <li key={p.id} className={`${s.item} ${p.answer ? '' : s.unanswered}`}>
                    <div className={s.head}>
                      <span className={s.origin}>{ORIGIN[p.origin] ?? ORIGIN.paste}</span>
                      <span className="muted">
                        {teacher ? `${p.name} · ` : ''}
                        {fmt(p.at)} · {p.chars} Zeichen
                      </span>
                    </div>
                    <div className={p.noteId && p.origin !== 'paste' ? s.withImage : undefined}>
                      {p.noteId && p.origin !== 'paste' && <img className={s.thumb} src={noteFileUrl(id, p.noteId, p.at)} alt="Bild zur Texterkennung" loading="lazy" />}
                      <blockquote className={s.sample}>
                        {p.sample}
                        {p.chars > p.sample.length ? ' …' : ''}
                      </blockquote>
                    </div>
                    <div className={s.answer}>
                      Herkunft: <strong>{label(p.answer)}</strong>
                      {p.note ? ` – ${p.note}` : ''}
                    </div>
                    {!p.answer && p.userId === me.id && <AnswerForm projectId={id} paste={p} onDone={load} />}
                  </li>
                ))}
              </ul>
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

interface Spur {
  target: string;
  title: string;
  text: string | null;
  pastes: { id: number; userId: number; name: string; origin: Paste['origin']; answer: Answer | null; note: string; at: number; text: string }[];
}

/** Spur im Text (Paste and Shake): heutiger Text, farbig nach Vorlage, darunter die Vorlagen mit Anteilen */
function TraceView({ projectId, target }: { projectId: number; target: string }) {
  const [d, setD] = useState<Spur | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    get<Spur>(`/api/projects/${projectId}/einfuegen/spur?ziel=${encodeURIComponent(target)}`).then(setD, (e) => setErr(e instanceof Error ? e.message : String(e)));
  }, [projectId, target]);
  if (err) return <div className="error">{err}</div>;
  if (!d) return <p className="muted">Lädt …</p>;
  if (d.text === null) return <p className="muted">Die Karte bzw. Notiz gibt es nicht mehr. Die Vorlagen stehen unten.</p>;
  const t = trace(d.text, d.pastes.map((p) => ({ id: p.id, text: p.text })));
  const color = (i: number) => TRACE_COLORS[i % TRACE_COLORS.length];
  return (
    <div className={s.trace}>
      <p className="muted">
        Farbig: Wortfolgen ab fünf Wörtern, die so auch in einer eingesetzten Vorlage stehen, {pct(t.outside)} des Texts. Umgestellte oder leicht umformulierte Stücke werden mitgefunden; gut Umformuliertes nicht. Ein Hinweis
        für das Gespräch, kein Beweis.
      </p>
      <div className={s.traceText}>
        {t.spans.map((sp, i) =>
          sp.src === null ? (
            <span key={i}>{d.text!.slice(sp.start, sp.end)}</span>
          ) : (
            <mark key={i} style={{ background: color(sp.src) + '55', boxShadow: `inset 0 -2px 0 ${color(sp.src)}` }} title={`aus Vorlage ${sp.src + 1} (${d.pastes[sp.src].name})`}>
              {d.text!.slice(sp.start, sp.end)}
            </mark>
          ),
        )}
      </div>
      <ol className={s.legend}>
        {d.pastes.map((p, i) => (
          <li key={p.id}>
            <span className={s.swatch} style={{ background: color(i) }} aria-hidden />
            <span>
              <strong>Vorlage {i + 1}</strong> · {p.name} · {fmt(p.at)} · {ORIGIN[p.origin] ?? ORIGIN.paste} · Herkunft: {label(p.answer)}
              {p.note ? ` – ${p.note}` : ''}
              <br />
              <span className="muted">
                {t.stats[i].runs ? `${pct(t.stats[i].share)} des Texts, ${pct(t.stats[i].kept)} der Vorlage noch enthalten${t.stats[i].reordered ? ', Reihenfolge umgestellt' : ''}` : 'im heutigen Text nicht mehr wiederzufinden'}
              </span>
              <details>
                <summary>Vorlage zeigen</summary>
                <blockquote className={s.sample}>{p.text}</blockquote>
              </details>
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
