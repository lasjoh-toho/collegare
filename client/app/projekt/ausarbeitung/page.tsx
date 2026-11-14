'use client';
/**
 * Phase „Ausarbeitung“ (Issue #9): Abschnitte aus der Gliederung, je Karte ein Dokument im Office-Editor.
 * Die Editoren laufen im iframe unter /office/ (AGPL-Teil); die Oberfläche spricht sie nur über die Adresse an
 * (Lizenztrennung, LIZENZEN.md).
 */
import { useCallback, useEffect, useState } from 'react';
import { ProjectShell } from '@/components/ProjectShell';
import { Topbar } from '@/components/Topbar';
import { ApiError, BASE_PATH, get, href, post, projectSocket } from '@/lib/api';
import type { ProjectView } from '@/lib/types';
import { useMe, useQuery } from '@/lib/useMe';
import p from '../projekt.module.css';
import s from './ausarbeitung.module.css';

interface Doc {
  id: number;
  sectionId: string;
  sectionTitle: string;
  title: string;
  ownerId: number | null;
  doneAt: number | null;
  doneBy: number | null;
}
interface DocList {
  role: 'teacher' | 'student';
  scopes: { scope: string; title: string; test?: boolean }[];
  scope: string | null;
  people: { id: number; name: string }[];
  docs: Doc[];
  outlineAt: number | null;
  finishLock: boolean;
  reopenBy: 'teacher' | 'group';
}

export default function Ausarbeitung() {
  const [me] = useMe();
  const idParam = useQuery('id');
  const id = idParam ? Number(idParam) : NaN;
  const [project, setProject] = useState<ProjectView | null>(null);
  const [scope, setScope] = useState<string | null>(null);
  const [data, setData] = useState<DocList | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [frameKey, setFrameKey] = useState(0);
  const [toast, setToast] = useState('');

  const show = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 4000);
  };
  const fail = (e: unknown) => show(e instanceof ApiError ? e.message : String(e));

  useEffect(() => {
    if (me === null) location.replace(href('/'));
  }, [me]);
  useEffect(() => {
    if (Number.isInteger(id)) get<ProjectView>(`/api/projects/${id}`).then(setProject, fail);
  }, [id]);

  const load = useCallback(
    (sc: string | null) =>
      get<DocList>(`/api/projects/${id}/documents${sc ? `?bereich=${encodeURIComponent(sc)}` : ''}`).then((r) => {
        setData((old) => {
          // Fertig oder wieder geöffnet: Editor neu laden, damit er lesend bzw. schreibend startet
          const was = old?.docs.find((d) => d.id === open);
          const now = r.docs.find((d) => d.id === open);
          if (was && now && !!was.doneAt !== !!now.doneAt) setFrameKey((k) => k + 1);
          return r;
        });
        setScope(r.scope);
      }, fail),
    [id, open],
  );

  useEffect(() => {
    if (Number.isInteger(id) && me) void load(scope);
    // nur beim Start und Wechsel der Gruppe
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, me]);

  // Echtzeit: Liste neu laden, wenn jemand Abschnitte anlegt oder fertig meldet
  useEffect(() => {
    if (!Number.isInteger(id) || !me) return;
    const so = projectSocket();
    so.on('connect', () => so.emit('join', id, () => {}));
    so.on('docs', (m: { projectId: number; scope: string }) => {
      if (m.projectId === id && m.scope === scope) void load(scope);
    });
    return () => {
      so.disconnect();
    };
  }, [id, me, scope, load]);

  async function sync() {
    if (!scope) return;
    try {
      const r = await post<{ created: number; total: number }>(`/api/projects/${id}/documents/sync`, { scope });
      show(r.created ? `${r.created} neue Abschnitte angelegt` : 'Abschnitte sind auf dem Stand der Gliederung');
      await load(scope);
    } catch (e) {
      fail(e);
    }
  }

  async function act(doc: Doc, what: 'done' | 'reopen') {
    if (what === 'done' && !confirm(`„${doc.title}“ fertig melden? Danach kann niemand mehr darin schreiben, bis die ${data?.reopenBy === 'group' ? 'Gruppe' : 'Lehrkraft'} es wieder öffnet.`)) return;
    try {
      await post(`/api/documents/${doc.id}/${what}`, {});
      await load(scope);
    } catch (e) {
      fail(e);
    }
  }

  if (!me || !project) return <Topbar me={me ?? null} />;
  const teacher = project.role === 'teacher';
  const name = (uid: number | null) => (uid === null ? null : (data?.people.find((x) => x.id === uid)?.name ?? 'unbekannt'));
  const current = data?.docs.find((d) => d.id === open) ?? null;
  const sections: { id: string; title: string; docs: Doc[] }[] = [];
  for (const d of data?.docs ?? []) {
    const last = sections[sections.length - 1];
    if (last && last.id === d.sectionId) last.docs.push(d);
    else sections.push({ id: d.sectionId, title: d.sectionTitle, docs: [d] });
  }
  // im eigenen Testbereich schreibt die Lehrkraft selbst
  const inTest = !!data?.scopes.find((x) => x.scope === data.scope)?.test;
  const canEdit = (d: Doc) => (!teacher || inTest) && !d.doneAt;
  const editorUrl = (d: Doc) =>
    `${BASE_PATH}/office/editor/?${new URLSearchParams({ new: 'docx', collab: 'cg' + d.id, name: me.name, uid: String(me.id), title: d.title, editing: canEdit(d) ? '1' : '0', lang: 'de' })}`;
  const mayFinish = (d: Doc) => !!data?.finishLock && (!teacher || inTest) && !d.doneAt && (d.ownerId === null || d.ownerId === me.id);
  const mayReopen = (d: Doc) => !!d.doneAt && (teacher || data?.reopenBy === 'group');

  const status = current
    ? current.doneAt
      ? `fertig seit ${new Date(current.doneAt).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })}`
      : teacher
        ? 'Ansicht für die Lehrkraft'
        : name(current.ownerId)
          ? `zuständig: ${name(current.ownerId)}`
          : ''
    : '';

  // Keine eigene Leiste über OnlyOffice (docs/gestaltung.md, Abschnitt 5): Titel, Zustand und „Fertig“ stehen in der Kopfzeile.
  return (
    <ProjectShell
      me={me}
      project={project}
      where={current ? current.title : 'Textabschnitte'}
      phase="drafting"
      docs={data}
      fill
      actions={
        <>
          {current && (
            <button className={`btn ${s.back}`} onClick={() => setOpen(null)}>
              ← Abschnitte
            </button>
          )}
          {current && status && (
            <span className={`chip ${current.doneAt ? s.doneChip : ''}`} title={status}>
              {current.doneAt ? '✓ fertig' : <span className={s.status}>{status}</span>}
            </span>
          )}
          {data && data.scopes.length > 1 && (
            <select className={s.scope} value={scope ?? ''} onChange={(e) => (setOpen(null), void load(e.target.value))} title="Abschnitte welcher Gruppe?">
              {data.scopes.map((x) => (
                <option key={x.scope} value={x.scope}>
                  {x.title}
                </option>
              ))}
            </select>
          )}
          {current && mayFinish(current) && (
            <button className="btn primary" onClick={() => act(current, 'done')}>
              Fertig melden
            </button>
          )}
          {current && mayReopen(current) && (
            <button className="btn" onClick={() => act(current, 'reopen')}>
              Wieder öffnen
            </button>
          )}
        </>
      }
    >
      <div className={s.area}>
        <aside className={`${s.side} ${current ? s.hideOnPhone : ''}`}>
          {data && !data.scope && <p className="muted">{teacher ? 'Noch keine Gruppen.' : 'Du bist noch keiner Gruppe zugeordnet.'}</p>}
          {data?.scope && (
            <>
              {sections.length === 0 && (
                <p className="muted">
                  {data.outlineAt ? 'Die Gliederung steht. Legt jetzt die Abschnitte an: Jede Karte wird ein eigenes Dokument.' : 'Zuerst in der Orientierung die Mindmap ordnen und „Gliederung übernehmen“.'}
                </p>
              )}
              {data.outlineAt && (
                <button className={`btn ${sections.length ? '' : 'primary'}`} onClick={sync} title="Gliederung übernehmen">
                  {sections.length ? 'Mit der Gliederung abgleichen' : 'Abschnitte anlegen'}
                </button>
              )}
              <ol className={s.sections}>
                {sections.map((sec) => (
                  <li key={sec.id}>
                    <div className={s.secTitle}>{sec.title}</div>
                    {sec.docs.map((d) => (
                      <button key={d.id} className={`${s.doc} ${open === d.id ? s.on : ''}`} onClick={() => (setOpen(d.id), setFrameKey((k) => k + 1))}>
                        <span className={s.docTitle}>{d.title}</span>
                        <span className={s.meta}>
                          {name(d.ownerId) ?? 'niemand zuständig'}
                          {d.doneAt && <span className={s.done}>✓ fertig</span>}
                        </span>
                      </button>
                    ))}
                  </li>
                ))}
              </ol>
            </>
          )}
        </aside>
        <section className={s.editor}>
          {current ? (
            <>
              <div className={s.stripe} aria-hidden="true" />
              <iframe key={`${current.id}-${frameKey}`} className={s.frame} src={editorUrl(current)} title={`Editor: ${current.title}`} allow="clipboard-read; clipboard-write" />
            </>
          ) : (
            <div className={s.placeholder}>{sections.length ? 'Abschnitt links auswählen.' : ''}</div>
          )}
        </section>
      </div>
      {toast && <div className={p.toast}>{toast}</div>}
    </ProjectShell>
  );
}
