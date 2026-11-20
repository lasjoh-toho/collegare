'use client';
/**
 * Materialien im Portal (Jo, 20. November 2026): eigene Sammlung einer Lehrkraft, unabhängig von Projekten. Sortieren
 * (eigene Reihenfolge, Titel, neueste, Art), Schlagworte vergeben und danach filtern, und in Projekte übernehmen: als
 * Kopie, für alle Lernenden, bestimmte Gruppen oder Einzelne, zum Beispiel als einführendes Material.
 * Gespeichert in der Werkstatt der Lehrkraft (siehe /werkzeuge).
 */
import { useEffect, useMemo, useState } from 'react';
import { Icon } from '@/components/Icon';
import { AddForm, CopyDialog, MaterialBody, OpenButtons, TagEditor, kindLabel, loadTargets, type Material, type Target } from '@/components/Materials';
import { PortalHead, PortalShell } from '@/components/PortalShell';
import { ApiError, del, get, href, patch } from '@/lib/api';
import { useMe, useQuery } from '@/lib/useMe';
import m from '../projekt/material/material.module.css';

type Sort = 'own' | 'title' | 'new' | 'kind';
const SORT_KEY = 'collegare-materialien-sortierung';

export default function Materialien() {
  const [me] = useMe();
  const neu = useQuery('neu');
  const [w, setW] = useState<number | null>(null);
  const [maxMb, setMaxMb] = useState(50);
  const [list, setList] = useState<Material[] | null>(null);
  const [targets, setTargets] = useState<Target[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState<{ text: string; projectId: number } | null>(null);
  const [open, setOpen] = useState<Set<number>>(new Set());
  const [adding, setAdding] = useState(false);
  const [sort, setSort] = useState<Sort>('own');
  const [tag, setTag] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [sharing, setSharing] = useState<Material | null>(null);

  const fail = (e: unknown) => setError(e instanceof ApiError ? e.message : String(e));
  const load = async (id = w) => {
    if (id !== null) await get<{ materials: Material[] }>(`/api/projects/${id}/materials`).then((r) => setList(r.materials), fail);
  };

  useEffect(() => {
    try {
      const s = localStorage.getItem(SORT_KEY) as Sort | null;
      if (s) setSort(s);
    } catch {}
  }, []);
  useEffect(() => setAdding(!!neu), [neu]);
  useEffect(() => {
    if (me === null) location.replace(href('/'));
    if (!me) return;
    get<{ projectId: number }>('/api/werkstatt').then((r) => {
      setW(r.projectId);
      void load(r.projectId);
      get<{ settings: { maxFileMb: number } }>(`/api/projects/${r.projectId}`).then((p) => setMaxMb(p.settings.maxFileMb), () => {});
    }, fail);
    loadTargets().then(setTargets, () => {});
  }, [me]);

  const allTags = useMemo(() => [...new Set((list ?? []).flatMap((x) => x.tags))].sort((a, b) => a.localeCompare(b, 'de')), [list]);
  const shown = useMemo(() => {
    let l = [...(list ?? [])];
    if (tag) l = l.filter((x) => x.tags.includes(tag));
    const needle = q.trim().toLowerCase();
    if (needle) l = l.filter((x) => (x.title + ' ' + x.note + ' ' + x.tags.join(' ')).toLowerCase().includes(needle));
    if (sort === 'title') l.sort((a, b) => a.title.localeCompare(b.title, 'de'));
    if (sort === 'new') l.sort((a, b) => b.createdAt - a.createdAt);
    if (sort === 'kind') l.sort((a, b) => kindLabel(a).localeCompare(kindLabel(b), 'de') || a.title.localeCompare(b.title, 'de'));
    return l;
  }, [list, tag, q, sort]);
  const canMove = sort === 'own' && !tag && !q.trim();

  function pickSort(s: Sort) {
    setSort(s);
    try {
      localStorage.setItem(SORT_KEY, s);
    } catch {}
  }

  async function move(i: number, d: -1 | 1) {
    if (!list || w === null) return;
    const next = [...list];
    const [x] = next.splice(i, 1);
    next.splice(i + d, 0, x);
    setList(next);
    await patch(`/api/projects/${w}/materials/${x.id}`, { order: next.map((y) => y.id) }).catch(fail);
  }

  async function setTags(x: Material, tags: string[]) {
    if (w === null) return;
    setList((l) => l?.map((y) => (y.id === x.id ? { ...y, tags } : y)) ?? l);
    await patch(`/api/projects/${w}/materials/${x.id}`, { tags }).catch(fail);
  }

  async function rename(x: Material) {
    const title = prompt('Titel', x.title);
    if (title === null || w === null) return;
    const note = prompt('Hinweis für die Lernenden (optional)', x.note);
    await patch(`/api/projects/${w}/materials/${x.id}`, { title, note: note ?? x.note }).then(() => load(), fail);
  }

  async function remove(x: Material) {
    if (w === null || !confirm(`„${x.title}“ aus deinen Materialien löschen? Kopien in Projekten bleiben erhalten.`)) return;
    await del(`/api/projects/${w}/materials/${x.id}`).then(() => load(), fail);
  }

  const toggle = (id: number) => setOpen((o) => (o.has(id) ? new Set([...o].filter((y) => y !== id)) : new Set([...o, id])));

  if (!me) return null;
  return (
    <PortalShell me={me} active="materials">
      <PortalHead icon="library" title="Materialien" sub="Deine Sammlung für den Unterricht: einmal anlegen, sortieren und verschlagworten, dann in beliebig viele Projekte übernehmen.">
        <button className={`btn ${adding ? 'on' : 'primary'}`} onClick={() => setAdding((a) => !a)}>
          <Icon name="pen" size={15} /> Neues Material
        </button>
      </PortalHead>
      <div className={m.wrap} style={{ maxWidth: 980, margin: 0, padding: 0 }}>
        {error && <div className="error">{error}</div>}
        {notice && (
          <div className="notice">
            {notice.text}{' '}
            <a href={href(`/projekt/material/?id=${notice.projectId}`)}>
              <strong>Im Projekt ansehen</strong>
            </a>
          </div>
        )}
        {adding && w !== null && <AddForm projectId={w} maxMb={maxMb} library onAdded={() => (setError(''), setAdding(false), void load())} onError={fail} />}

        {list && list.length > 0 && (
          <div className={m.toolbar}>
            <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Suchen in Titel, Hinweis, Schlagworten" aria-label="Suchen" />
            <div className="seg" role="group" aria-label="Sortierung">
              {(
                [
                  ['own', 'Eigene Reihenfolge'],
                  ['title', 'Titel'],
                  ['new', 'Neueste'],
                  ['kind', 'Art'],
                ] as const
              ).map(([k, l]) => (
                <button key={k} className={`btn ${sort === k ? 'on' : ''}`} onClick={() => pickSort(k)}>
                  {l}
                </button>
              ))}
            </div>
          </div>
        )}
        {allTags.length > 0 && (
          <div className={m.tags}>
            <Icon name="tag" size={14} />
            <button className={`${m.tag} ${tag === null ? m.on : ''}`} onClick={() => setTag(null)}>
              alle
            </button>
            {allTags.map((x) => (
              <button key={x} className={`${m.tag} ${tag === x ? m.on : ''}`} onClick={() => setTag(tag === x ? null : x)}>
                {x}
              </button>
            ))}
          </div>
        )}

        {list && list.length === 0 && !adding && (
          <p className="muted">
            Noch kein Material. Leg mit „Neues Material“ eine Lernseite an, verlinke eine Webseite oder ein Video oder lade eine Datei hoch. Die Werkzeuge zum Ausprobieren
            findest du unter <a href={href('/werkzeuge/')}>Werkzeuge</a>.
          </p>
        )}
        {list && list.length > 0 && shown.length === 0 && <p className="muted">Nichts gefunden.</p>}
        <ol className={m.list}>
          {w !== null &&
            shown.map((x) => {
              const i = list!.indexOf(x);
              return (
                <li key={x.id} className={`panel ${m.item}`}>
                  <div className={m.row}>
                    <span className={m.kind}>{kindLabel(x)}</span>
                    <strong className={m.title}>{x.title}</strong>
                    <span className="grow" />
                    <OpenButtons projectId={w} x={x} canEdit open={open.has(x.id)} onToggle={() => toggle(x.id)} />
                    <button className="btn primary" onClick={() => setSharing(x)} title="Als Kopie in ein Projekt übernehmen, für alle, bestimmte Gruppen oder Einzelne">
                      <Icon name="share" size={14} /> In Projekt übernehmen
                    </button>
                    <span className={m.tools}>
                      {canMove && (
                        <>
                          <button className="btn icon" disabled={i === 0} onClick={() => move(i, -1)} title="Nach oben" aria-label="Nach oben">
                            ↑
                          </button>
                          <button className="btn icon" disabled={i === list!.length - 1} onClick={() => move(i, 1)} title="Nach unten" aria-label="Nach unten">
                            ↓
                          </button>
                        </>
                      )}
                      <button className="btn icon" onClick={() => rename(x)} title="Titel und Hinweis ändern" aria-label="Bearbeiten">
                        <Icon name="pen" size={14} />
                      </button>
                      <button className="btn icon" onClick={() => remove(x)} title="Löschen" aria-label="Löschen">
                        <Icon name="close" size={14} />
                      </button>
                    </span>
                  </div>
                  <TagEditor tags={x.tags} all={allTags} onChange={(tags) => setTags(x, tags)} />
                  <MaterialBody projectId={w} x={x} open={open.has(x.id)} />
                </li>
              );
            })}
        </ol>
      </div>
      {sharing && w !== null && (
        <CopyDialog
          werkstatt={w}
          item={sharing}
          targets={targets}
          onClose={() => setSharing(null)}
          onDone={(text, projectId) => (setSharing(null), setNotice({ text, projectId }))}
          onError={fail}
        />
      )}
    </PortalShell>
  );
}
