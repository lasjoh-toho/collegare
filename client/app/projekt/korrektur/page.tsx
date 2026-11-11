'use client';
/**
 * Korrektur wie in Autogra.fi (gestaltung.md 4): links die Warteschlange, rechts Kopf mit Vorheriger/Nächster,
 * die Produkte der Person mit ihren Zuständen, „Note & Bewertung“ und „Rückmeldung an Lernende/n“.
 * Statt Blättern zeigt Collegare Phasen und Produkte; „Nach Gruppen“ ist nur eine Sortierung, Noten bleiben je Person.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '@/components/Icon';
import { ThemeSwitch } from '@/components/ThemeSwitch';
import { ApiError, get, href, put } from '@/lib/api';
import { useMe, useQuery } from '@/lib/useMe';
import k from './korrektur.module.css';

type State = 'missing' | 'present' | 'done';
interface Product {
  key: 'map' | 'outline' | 'section';
  title: string;
  state: State;
  owners: number[];
  docId?: number;
  detail?: string;
}
interface Scope {
  scope: string;
  title: string;
  people: { id: number; name: string }[];
  products: Product[];
}
interface Grading {
  points: number | null;
  feedback: string;
  notes: string;
  final: boolean;
  updatedAt: number;
}
interface Overview {
  project: { id: number; title: string };
  mode: 'group' | 'single';
  scopes: Scope[];
  unassigned: { id: number; name: string }[];
  gradings: Record<number, Grading>;
}
interface Row {
  id: number;
  name: string;
  scope: Scope | null;
}

/** Notenpunkte 0–15 als Note (15 = 1+, 0 = 6), wie in Autogra.fi. */
function gradeOf(points: number): string {
  if (points === 0) return '6';
  const g = 5 - Math.floor((points - 1) / 3);
  const r = (points - 1) % 3;
  return `${g}${r === 2 ? '+' : r === 0 ? '−' : ''}`;
}

const emptyGrading = (): Grading => ({ points: null, feedback: '', notes: '', final: false, updatedAt: 0 });

/** Produkte, für die diese Person zuständig ist (Mindmap und Gliederung gehören der ganzen Gruppe). */
const productsOf = (row: Row) => (row.scope?.products ?? []).filter((p) => p.key !== 'section' || p.owners.length === 0 || p.owners.includes(row.id));

export default function Korrektur() {
  const [me] = useMe();
  const idParam = useQuery('id');
  const id = idParam ? Number(idParam) : NaN;
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState('');
  const [byGroup, setByGroup] = useState(true);
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const [sel, setSel] = useState<number | null>(null);

  useEffect(() => {
    if (me === null) location.replace(href('/'));
  }, [me]);
  useEffect(() => {
    try {
      setByGroup(localStorage.getItem('collegare-korrektur-gruppen') !== '0');
    } catch {}
  }, []);

  const load = useCallback(() => {
    if (Number.isInteger(id)) get<Overview>(`/api/projects/${id}/korrektur`).then(setData, (e) => setError(e instanceof ApiError ? e.message : String(e)));
  }, [id]);
  useEffect(load, [load]);

  const rows: Row[] = useMemo(() => {
    if (!data) return [];
    const out: Row[] = data.scopes.flatMap((sc) => sc.people.map((p) => ({ ...p, scope: sc })));
    out.push(...data.unassigned.map((p) => ({ ...p, scope: null })));
    return byGroup ? out : [...out].sort((a, b) => a.name.localeCompare(b.name, 'de'));
  }, [data, byGroup]);

  const index = rows.findIndex((r) => r.id === sel);
  const row = index >= 0 ? rows[index] : null;

  function toggleGroups() {
    setByGroup(!byGroup);
    try {
      localStorage.setItem('collegare-korrektur-gruppen', byGroup ? '0' : '1');
    } catch {}
  }

  const setGrading = (userId: number, g: Grading) => setData((d) => (d ? { ...d, gradings: { ...d.gradings, [userId]: g } } : d));

  if (!me) return null;
  const grading = (uid: number) => data?.gradings[uid] ?? emptyGrading();

  const personRow = (r: Row, indent: boolean) => {
    const g = grading(r.id);
    const prods = productsOf(r);
    return (
      <button key={r.id} className={`${k.row} ${r.id === sel ? k.sel : ''} ${indent ? k.indent : ''}`} onClick={() => setSel(r.id)}>
        <span className={k.name}>{r.name}</span>
        <span className={k.prods}>
          {prods.length === 0 && <span className={`${k.sq} ${k.missing}`} title="Noch keine Produkte" />}
          {prods.map((p, i) => (
            <span key={i} className={`${k.sq} ${k[p.state]}`} title={`${p.title}: ${p.state === 'done' ? 'fertig' : p.state === 'present' ? 'in Arbeit' : 'fehlt noch'}`}>
              {p.state === 'done' && <Icon name="check" size={9} />}
            </span>
          ))}
        </span>
        <span className={k.gradeCell}>
          {g.points !== null ? <span className={`${k.miniBubble} ${g.final ? k.final : ''}`}>{gradeOf(g.points)}</span> : <span className={k.miniEmpty} />}
        </span>
      </button>
    );
  };

  return (
    <div className={k.page}>
      <aside className={k.queue}>
        <div className={k.qhead}>
          <a className={k.round} href={href('/')} title="Zum Portal">
            <Icon name="menu" size={18} />
          </a>
          <span className="grow">
            <strong>
              Lernende <span className="muted">({rows.length})</span>
            </strong>
            <small>{data?.project.title ?? ''}</small>
          </span>
          {data?.mode === 'group' && (
            <button className={`btn ${byGroup ? 'on' : ''}`} onClick={toggleGroups} title="Nach Gruppen ordnen oder alphabetisch">
              <Icon name="users" size={14} /> Gruppen
            </button>
          )}
        </div>
        <div className={k.thead}>
          <span>Name</span>
          <span>Produkte</span>
          <span>Note</span>
        </div>
        <div className={k.list}>
          {error && <div className="error">{error}</div>}
          {data && rows.length === 0 && <p className="muted" style={{ padding: 12 }}>Noch keine Lernenden im Projekt.</p>}
          {data &&
            (byGroup && data.mode === 'group'
              ? [...data.scopes.map((sc) => ({ key: sc.scope, title: sc.title, rows: rows.filter((r) => r.scope?.scope === sc.scope) })), ...(data.unassigned.length ? [{ key: 'none', title: 'Noch ohne Gruppe', rows: rows.filter((r) => !r.scope) }] : [])].map((grp) => (
                  <div key={grp.key}>
                    <button className={k.group} onClick={() => setClosed((c) => (c.has(grp.key) ? new Set([...c].filter((x) => x !== grp.key)) : new Set([...c, grp.key])))}>
                      <span className={k.caret}>{closed.has(grp.key) ? '▸' : '▾'}</span>
                      <span className="grow">{grp.title}</span>
                      <span className="muted">
                        {grp.rows.filter((r) => grading(r.id).final).length}/{grp.rows.length}
                      </span>
                    </button>
                    {!closed.has(grp.key) && grp.rows.map((r) => personRow(r, true))}
                  </div>
                ))
              : rows.map((r) => personRow(r, false)))}
        </div>
        <div className={k.qfoot}>
          <button className="btn icon" onClick={load} title="Neu laden">
            ↻
          </button>
          <a className="btn grow" href={href(`/projekt/?id=${id}`)}>
            <Icon name="grid" size={14} /> Projekt
          </a>
          <a className="btn grow" href={href('/')}>
            <Icon name="arrow" size={14} /> Portal
          </a>
          <ThemeSwitch compact />
        </div>
      </aside>
      <main className={k.work}>
        {!row || !data ? (
          <div className={k.pick}>
            <span className={k.pickIcon}>☝</span>
            Person links auswählen.
          </div>
        ) : (
          <Workspace
            key={row.id}
            projectId={id}
            row={row}
            pos={index + 1}
            total={rows.length}
            grading={grading(row.id)}
            onPrev={index > 0 ? () => setSel(rows[index - 1].id) : null}
            onNext={index < rows.length - 1 ? () => setSel(rows[index + 1].id) : null}
            onSaved={(g) => setGrading(row.id, g)}
            onCopy={async (g) => {
              for (const p of row.scope?.people ?? []) {
                if (p.id === row.id) continue;
                const r = await put<{ grading: Grading }>(`/api/projects/${id}/gradings/${p.id}`, { points: g.points, feedback: g.feedback });
                setGrading(p.id, r.grading);
              }
            }}
          />
        )}
      </main>
    </div>
  );
}

function Workspace(props: {
  projectId: number;
  row: Row;
  pos: number;
  total: number;
  grading: Grading;
  onPrev: (() => void) | null;
  onNext: (() => void) | null;
  onSaved: (g: Grading) => void;
  onCopy: (g: Grading) => Promise<void>;
}) {
  const { projectId, row } = props;
  const [g, setG] = useState<Grading>(props.grading);
  const [status, setStatus] = useState<'saved' | 'dirty' | 'saving' | 'error'>('saved');
  const [copied, setCopied] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(g);
  latest.current = g;

  async function save(patch: Partial<Grading>) {
    setStatus('saving');
    try {
      const r = await put<{ grading: Grading }>(`/api/projects/${projectId}/gradings/${row.id}`, patch);
      props.onSaved(r.grading);
      setG((x) => ({ ...x, updatedAt: r.grading.updatedAt, final: r.grading.final }));
      setStatus('saved');
    } catch {
      setStatus('error');
    }
  }
  const change = (patch: Partial<Grading>, now = false) => {
    setG((x) => ({ ...x, ...patch }));
    setStatus('dirty');
    if (timer.current) clearTimeout(timer.current);
    if (now) void save(patch);
    else timer.current = setTimeout(() => void save({ feedback: latest.current.feedback, notes: latest.current.notes }), 800);
  };
  useEffect(
    () => () => {
      if (timer.current) {
        clearTimeout(timer.current);
        void put(`/api/projects/${projectId}/gradings/${row.id}`, { feedback: latest.current.feedback, notes: latest.current.notes });
      }
    },
    [projectId, row.id],
  );

  const sc = row.scope;
  const prods = productsOf(row);
  const name = (uid: number) => sc?.people.find((p) => p.id === uid)?.name ?? '';
  const link = (p: Product) => {
    const bereich = sc ? `&bereich=${encodeURIComponent(sc.scope)}` : '';
    if (p.key === 'map') return `/projekt/mindmap/?id=${projectId}${bereich}`;
    if (p.key === 'outline') return `/projekt/mindmap/?id=${projectId}&gliederung=1${bereich}`;
    return `/projekt/ausarbeitung/?id=${projectId}${bereich}`;
  };
  const others = (sc?.people.length ?? 1) - 1;

  return (
    <div className={k.ws}>
      <div className={`${k.card} ${k.head}`}>
        <div className="grow">
          <h1>{row.name}</h1>
          <small>
            {props.pos} von {props.total} · {sc ? sc.title : 'noch ohne Gruppe'}
            {sc && sc.people.length > 1 && ` · mit ${sc.people.filter((p) => p.id !== row.id).map((p) => p.name).join(', ')}`}
          </small>
        </div>
        <button className="btn" disabled={!props.onPrev} onClick={() => props.onPrev?.()}>
          ← Vorheriger
        </button>
        <button className="btn" disabled={!props.onNext} onClick={() => props.onNext?.()}>
          Nächster →
        </button>
      </div>

      <section className={k.card}>
        <h2>
          <Icon name="grid" size={16} /> Produkte
        </h2>
        {prods.length === 0 ? (
          <p className="muted">{sc ? 'Noch keine Produkte.' : 'Erst einer Gruppe zuordnen.'}</p>
        ) : (
          <div className={k.products}>
            {prods.map((p, i) => (
              <a key={i} className={`${k.product} ${k['p_' + p.state]}`} href={href(link(p))} data-kind={p.key}>
                <span className={k.picon}>
                  <Icon name={p.key === 'map' ? 'map' : p.key === 'outline' ? 'outline' : 'doc'} size={16} />
                </span>
                <span className="grow">
                  <strong>{p.title}</strong>
                  <small>
                    {p.state === 'done' ? (p.key === 'outline' ? 'übernommen' : 'fertig gemeldet') : p.state === 'present' ? 'in Arbeit' : 'fehlt noch'}
                    {p.detail ? ` · ${p.detail}` : ''}
                    {p.key === 'section' && p.owners.length > 0 && ` · ${p.owners.map(name).join(', ')}`}
                  </small>
                </span>
                {p.state === 'done' && <Icon name="check" size={15} className={k.tick} />}
              </a>
            ))}
          </div>
        )}
      </section>

      <section className={k.card}>
        <h2>
          <Icon name="star" size={16} /> Note &amp; Bewertung
          <span className="grow" />
          <span className={`${k.badge} ${g.final ? k.badgeFinal : ''}`}>{g.final ? 'Abgeschlossen' : 'Entwurf'}</span>
        </h2>
        <div className={k.gradeRow}>
          <label className={k.pointsLabel}>
            Notenpunkte
            <select value={g.points ?? ''} disabled={g.final} onChange={(e) => change({ points: e.target.value === '' ? null : Number(e.target.value) }, true)}>
              <option value="">–</option>
              {Array.from({ length: 16 }, (_, i) => 15 - i).map((n) => (
                <option key={n} value={n}>
                  {n} ({gradeOf(n)})
                </option>
              ))}
            </select>
          </label>
          <span className={k.arrow}>→</span>
          <span className={`${k.bubble} ${g.points === null ? k.bubbleEmpty : ''}`}>{g.points !== null ? gradeOf(g.points) : '–'}</span>
          <span className="grow" />
          {others > 0 && (
            <button
              className="btn"
              disabled={g.points === null}
              title="Note und Rückmeldung als Vorschlag für die anderen der Gruppe übernehmen; danach je Person anpassen"
              onClick={async () => {
                await props.onCopy(g);
                setCopied(`Für ${others} weitere übernommen`);
                setTimeout(() => setCopied(''), 3000);
              }}
            >
              <Icon name="users" size={14} /> Für die Gruppe übernehmen
            </button>
          )}
          <button className={`btn ${g.final ? '' : 'primary'}`} disabled={g.points === null} onClick={() => change({ final: !g.final }, true)}>
            {g.final ? 'Wieder öffnen' : 'Abschließen'}
          </button>
        </div>
        {copied && <p className={k.saved}>{copied}</p>}
      </section>

      <section className={`${k.card} ${k.grow}`}>
        <h2>
          <Icon name="notes" size={16} /> Rückmeldung an Lernende/n
          <span className="grow" />
          <span className={status === 'error' ? k.err : k.saved}>{status === 'saved' ? (g.updatedAt ? 'Gespeichert.' : '') : status === 'error' ? 'Nicht gespeichert' : 'Speichert …'}</span>
        </h2>
        <textarea className={k.text} value={g.feedback} readOnly={g.final} onChange={(e) => change({ feedback: e.target.value })} placeholder="Was gelungen ist, was beim nächsten Mal besser geht …" />
        <h3>Notizen (nur für dich)</h3>
        <textarea className={`${k.text} ${k.notes}`} value={g.notes} onChange={(e) => change({ notes: e.target.value })} placeholder="Beobachtungen aus Gesprächen, Verteidigung, Logbuch …" />
      </section>
    </div>
  );
}
