'use client';
/**
 * Phase „Ausarbeitung“: eigener, leichter Schreibeditor statt der Office-Ansicht (Wunsch Jo, 21. November 2026).
 *
 * Die Abschnitte kommen von selbst aus der Gliederung (Linie „Ausarbeitung“, sonst „Präsentation“) und bleiben mit ihr
 * abgeglichen; vor jedem Abgleich merkt sich der Server den Stand der Texte, „Zurück“ unten holt ihn wieder. Geschrieben
 * wird auf Karten, die nur die Überschrift tragen: Text links, rechts der Rand für Randnotizen, Bemerkungen,
 * Bildunterschriften. „Lesen“ zeigt die ganze Ausarbeitung so, wie sie als Webseite und gedruckt aussieht (auf dem
 * Handy einspaltig, Notizen im Text). Begriffe aus allen Abschnitten sammeln sich im Glossar am Ende.
 *
 * Alte Abschnitte aus dem Office-Editor bleiben lesbar (iframe unter /office/, AGPL-Teil, nur über die Adresse).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import { ProjectShell } from '@/components/ProjectShell';
import { Topbar } from '@/components/Topbar';
import { GliederungLive } from '@/components/GliederungLive';
import { TufteView } from '@/components/TufteView';
import { WriteCard, type WriteDoc } from '@/components/WriteCard';
import type { InfoSpec } from '@/components/InfoButton';
import { termsOf } from '@/lib/tufteEdit';
import { ApiError, BASE_PATH, get, post, projectSocket } from '@/lib/api';
import type { MindMap, ProjectView } from '@/lib/types';
import { useMe, useQuery } from '@/lib/useMe';
import p from '../projekt.module.css';
import s from './ausarbeitung.module.css';

interface DocList {
  role: 'teacher' | 'student';
  scopes: { scope: string; title: string; test?: boolean }[];
  scope: string | null;
  test?: boolean;
  people: { id: number; name: string }[];
  docs: WriteDoc[];
  outlineAt: number | null;
  finishLock: boolean;
  reopenBy: 'teacher' | 'group';
}

const OUTSIDE = '__ohne';

const INFO: InfoSpec = {
  key: 'ausarbeitung',
  title: 'Ausarbeitung',
  text:
    'Jeder Punkt eurer Gliederung wird hier eine Karte; ändert ihr die Gliederung, ziehen die Karten von selbst nach. Links schreibt ihr den Text, rechts ist der Rand. ' +
    'Markiert Text, dann erscheinen die Werkzeuge: Hervorheben, Randnotiz, Begriff (das Wort kommt mit eurer Erklärung in die Begriffe am Ende). ' +
    'Während ihr schreibt, stehen unten im Rand der Karte „+ Randnotiz“, „+ Bemerkung“ (ohne Nummer) und „+ Bild“. Antippen eines Bausteins ändert ihn. ' +
    'Gespeichert wird von selbst. „⋯“ an der Karte zeigt frühere Fassungen und „Fertig melden“. „Zurück“ unten holt den Stand, den eure Texte vor dem letzten Abgleich mit der Gliederung hatten. ' +
    '„Lesen“ zeigt alles so, wie es als Webseite und gedruckt aussieht.',
};

const mdEsc = (t: string) => t.replace(/[\\*_`[\]{}^]/g, (c) => '\\' + c);

export default function Ausarbeitung() {
  const [me] = useMe();
  const idParam = useQuery('id');
  const id = idParam ? Number(idParam) : NaN;
  const [project, setProject] = useState<ProjectView | null>(null);
  const [scope, setScope] = useState<string | null>(null);
  const [data, setData] = useState<DocList | null>(null);
  const [view, setView] = useState<'write' | 'read'>('write');
  const [line, setLine] = useState(false);
  const [office, setOffice] = useState<WriteDoc | null>(null);
  const [remote, setRemote] = useState<Record<number, { rev: number; by: number }>>({});
  const [bodies, setBodies] = useState<Record<number, string>>({});
  const [toast, setToast] = useState('');
  const [sock, setSock] = useState<Socket | null>(null);
  const synced = useRef<number | null | undefined>(undefined);
  const syncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 5000);
  }, []);
  const fail = useCallback((e: unknown) => show(e instanceof ApiError ? e.message : String(e)), [show]);

  useEffect(() => {
    if (me === null) location.replace(BASE_PATH + '/');
  }, [me]);
  useEffect(() => {
    if (Number.isInteger(id)) get<ProjectView>(`/api/projects/${id}`).then(setProject, fail);
  }, [id, fail]);
  // Gliederung links: auf breiten Bildschirmen von Anfang an offen
  useEffect(() => {
    setLine(matchMedia('(min-width: 1180px)').matches);
  }, []);

  const writes = (d: DocList | null) => !!d?.scope && (d.role === 'student' || !!d.test);

  const load = useCallback(
    (sc: string | null) =>
      get<DocList>(`/api/projects/${id}/documents${sc ? `?bereich=${encodeURIComponent(sc)}` : ''}`).then((r) => {
        setData(r);
        setScope(r.scope);
        setBodies(Object.fromEntries(r.docs.map((d) => [d.id, d.body ?? ''])));
        return r;
      }, fail),
    [id, fail],
  );

  /** Abschnitte mit der Gliederung abgleichen; vorher den Stand der Texte merken (für „Zurück“) */
  const autoSync = useCallback(
    async (r: DocList | void, outlineAt: number | null) => {
      if (!r || !r.scope || outlineAt === null || synced.current === outlineAt) return;
      synced.current = outlineAt;
      try {
        if (writes(r)) {
          await post(`/api/projects/${id}/documents/merken`, { scope: r.scope });
          await post(`/api/projects/${id}/documents/sync`, { scope: r.scope });
        }
        await load(r.scope);
      } catch (e) {
        fail(e);
      }
    },
    [id, load, fail],
  );

  useEffect(() => {
    if (!Number.isInteger(id) || !me) return;
    synced.current = undefined;
    void load(scope).then((r) => r && autoSync(r, r.outlineAt));
    // nur beim Start und Wechsel der Gruppe
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, me]);

  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const dataRef = useRef(data);
  dataRef.current = data;

  // Echtzeit: Abschnitte, Texte anderer und Änderungen an der Gliederung
  useEffect(() => {
    if (!Number.isInteger(id) || !me) return;
    const so = projectSocket();
    setSock(so);
    const joinMap = () => scopeRef.current && so.emit('map:join', { projectId: id, scope: scopeRef.current }, () => {});
    so.on('connect', () => {
      so.emit('join', id, () => {});
      joinMap();
    });
    so.on('docs', (m: { projectId: number; scope: string }) => {
      if (m.projectId === id && m.scope === scopeRef.current) void load(scopeRef.current);
    });
    so.on('doctext', (m: { projectId: number; scope: string; docId: number; rev: number; by: number }) => {
      if (m.projectId === id && m.scope === scopeRef.current) setRemote((x) => ({ ...x, [m.docId]: { rev: m.rev, by: m.by } }));
    });
    so.on('map', (m: { projectId: number; scope: string; map: MindMap }) => {
      if (m.projectId !== id || m.scope !== scopeRef.current) return;
      const at = m.map.outline?.at ?? null;
      if (at === synced.current) return;
      if (syncTimer.current) clearTimeout(syncTimer.current);
      syncTimer.current = setTimeout(() => void autoSync(dataRef.current ?? undefined, at), 1500);
    });
    return () => {
      so.disconnect();
      setSock(null);
    };
  }, [id, me, load, autoSync]);
  useEffect(() => {
    if (sock?.connected && scope) sock.emit('map:join', { projectId: id, scope }, () => {});
  }, [sock, scope, id]);

  async function act(doc: WriteDoc, what: 'done' | 'reopen') {
    if (what === 'done' && !confirm(`„${doc.title}“ fertig melden? Danach kann niemand mehr darin schreiben, bis die ${data?.reopenBy === 'group' ? 'Gruppe' : 'Lehrkraft'} es wieder öffnet.`)) return;
    try {
      await post(`/api/documents/${doc.id}/${what}`, {});
      await load(scope);
    } catch (e) {
      fail(e);
    }
  }

  async function back() {
    if (!scope) return;
    if (!confirm('Alle Texte auf den Stand vor dem letzten Abgleich mit der Gliederung zurücksetzen? Der jetzige Stand bleibt unter „Frühere Fassungen“.')) return;
    try {
      const r = await post<{ restored: number }>(`/api/projects/${id}/documents/zurueck`, { scope });
      await load(scope);
      show(r.restored ? `${r.restored} ${r.restored === 1 ? 'Abschnitt' : 'Abschnitte'} zurückgesetzt.` : 'Die Texte sind schon auf diesem Stand.');
    } catch (e) {
      fail(e);
    }
  }

  /** Druck in einem eigenen Fenster: nur die Seite, mit denselben Stilen (Kopfzeile und Seitenmenü bleiben weg) */
  function printRead() {
    const art = document.querySelector(`.${s.read} article`);
    const win = open('', '_blank');
    if (!art || !win) return print();
    const styles = [...document.querySelectorAll('style, link[rel="stylesheet"]')].map((n) => n.outerHTML).join('');
    win.document.write(`<!doctype html><html lang="de" data-theme="light"><head><meta charset="utf-8"><title>${(project?.title ?? 'Ausarbeitung').replace(/</g, '&lt;')}</title><base href="${location.origin}">${styles}<style>@page{margin:18mm 14mm}body{margin:0;background:#fff}</style></head><body>${art.outerHTML}</body></html>`);
    win.document.close();
    win.addEventListener('load', () => setTimeout(() => win.print(), 200));
  }

  const onBody = useCallback((docId: number, body: string) => setBodies((b) => (b[docId] === body ? b : { ...b, [docId]: body })), []);

  const sections = useMemo(() => {
    const out: { id: string; title: string; docs: WriteDoc[] }[] = [];
    for (const d of data?.docs ?? []) {
      const last = out[out.length - 1];
      if (last && last.id === d.sectionId) last.docs.push(d);
      else out.push({ id: d.sectionId, title: d.sectionTitle, docs: [d] });
    }
    return out;
  }, [data]);

  const terms = useMemo(() => {
    const all = new Map<string, { word: string; explain: string }>();
    for (const d of data?.docs ?? [])
      for (const t of termsOf(bodies[d.id] ?? '')) {
        const k = t.word.toLocaleLowerCase('de');
        if (!t.word) continue;
        const old = all.get(k);
        if (!old || (!old.explain && t.explain)) all.set(k, t);
      }
    return [...all.values()].sort((a, b) => a.word.localeCompare(b.word, 'de'));
  }, [data, bodies]);

  const readBody = useMemo(() => {
    const parts: string[] = [];
    for (const sec of sections) {
      if (sec.id === OUTSIDE) continue;
      parts.push(`## ${mdEsc(sec.title)}`);
      for (const d of sec.docs) {
        if (sec.docs.length > 1 || d.title !== sec.title) parts.push(`### ${mdEsc(d.title)}`);
        const b = (bodies[d.id] ?? '').trim();
        if (b) parts.push(b);
      }
    }
    if (terms.length) parts.push('## Begriffe', terms.map((t) => `- **${mdEsc(t.word)}**${t.explain ? ': ' + mdEsc(t.explain) : ''}`).join('\n'));
    return parts.join('\n\n');
  }, [sections, bodies, terms]);

  if (!me || !project) return <Topbar me={me ?? null} />;
  const teacher = project.role === 'teacher';
  const name = (uid: number | null) => (uid === null ? null : (data?.people.find((x) => x.id === uid)?.name ?? (uid === me.id ? me.name : null)));
  const inTest = !!data?.test;
  const canEdit = (d: WriteDoc) => (!teacher || inTest) && !d.doneAt;
  const mayFinish = (d: WriteDoc) => !!data?.finishLock && (!teacher || inTest) && !d.doneAt && (d.ownerId === null || d.ownerId === me.id);
  const mayReopen = (d: WriteDoc) => !!d.doneAt && (teacher || data?.reopenBy === 'group');
  const groupTitle = data?.scopes.find((x) => x.scope === data.scope)?.title ?? '';
  const officeUrl = (d: WriteDoc) => `${BASE_PATH}/office/editor/?${new URLSearchParams({ new: 'docx', collab: 'cg' + d.id, name: me.name, uid: String(me.id), title: d.title, editing: '0', lang: 'de' })}`;

  return (
    <ProjectShell
      me={me}
      project={project}
      where="Ausarbeitung"
      phase="drafting"
      docs={data}
      fill
      info={INFO}
      crumbs={
        data && data.scopes.length > 1 ? (
          <select className={s.scope} value={scope ?? ''} onChange={(e) => ((synced.current = undefined), void load(e.target.value).then((r) => r && autoSync(r, r.outlineAt)))} title="Ausarbeitung welcher Gruppe?">
            {data.scopes.map((x) => (
              <option key={x.scope} value={x.scope}>
                {x.title}
              </option>
            ))}
          </select>
        ) : undefined
      }
      actions={
        <>
          {view === 'write' && data?.scope && (
            <button className={`btn ${s.wide} ${line ? 'on' : ''}`} onClick={() => setLine(!line)} aria-pressed={line} title="Gliederung links ein- oder ausblenden">
              Gliederung
            </button>
          )}
          <span className={s.seg} role="group" aria-label="Ansicht">
            <button className={`btn ${view === 'write' ? 'on' : ''}`} onClick={() => setView('write')} aria-pressed={view === 'write'}>
              Schreiben
            </button>
            <button className={`btn ${view === 'read' ? 'on' : ''}`} onClick={() => setView('read')} aria-pressed={view === 'read'}>
              Lesen
            </button>
          </span>
          {view === 'read' && (
            <button className="btn" onClick={printRead} title="Drucken oder als PDF sichern">
              Drucken
            </button>
          )}
        </>
      }
    >
      <div className={`${s.area} ${view === 'read' ? s.reading : ''}`}>
        {view === 'write' && line && data?.scope && (
          <aside className={s.line}>
            <GliederungLive sock={sock} project={project} scope={data.scope} meId={me.id} show={show} onClose={() => setLine(false)} />
          </aside>
        )}
        <div className={s.col}>
          {data && !data.scope && <p className="muted">{teacher ? 'Noch keine Gruppen.' : 'Du bist noch keiner Gruppe zugeordnet.'}</p>}
          {data?.scope && view === 'write' && (
            <div className={s.cards}>
              {sections.length === 0 && <p className={`muted ${s.empty}`}>{data.outlineAt ? 'Die Gliederung hat noch keine Punkte.' : 'Sobald eure Gliederung Punkte hat, erscheinen hier die Karten zum Schreiben.'}</p>}
              {sections.map((sec) => (
                <section key={sec.id} className={`${s.section} ${sec.id === OUTSIDE ? s.outside : ''}`}>
                  {(sec.docs.length > 1 || sec.docs[0].title !== sec.title) && <h2 className={s.secTitle}>{sec.title}</h2>}
                  {sec.docs.map((d) => (
                    <WriteCard
                      key={d.id}
                      doc={d}
                      meId={me.id}
                      canEdit={canEdit(d)}
                      owner={name(d.ownerId)}
                      writer={name}
                      remote={remote[d.id]}
                      mayFinish={mayFinish(d)}
                      mayReopen={mayReopen(d)}
                      onFinish={() => act(d, 'done')}
                      onReopen={() => act(d, 'reopen')}
                      onBody={onBody}
                      onOffice={() => setOffice(d)}
                      show={show}
                    />
                  ))}
                </section>
              ))}
              {terms.length > 0 && (
                <section className={`${s.section} ${s.terms}`}>
                  <h2 className={s.secTitle}>Begriffe</h2>
                  <dl>
                    {terms.map((t) => (
                      <div key={t.word}>
                        <dt>{t.word}</dt>
                        <dd className={t.explain ? '' : s.missing}>{t.explain || 'Erklärung fehlt'}</dd>
                      </div>
                    ))}
                  </dl>
                </section>
              )}
              {writes(data) && sections.length > 0 && (
                <div className={s.backBar}>
                  <button className="btn" onClick={back} title="Zurück zu meinem letzten Zustand im Editor">
                    ↶ Zurück
                  </button>
                </div>
              )}
            </div>
          )}
          {data?.scope && view === 'read' && (
            <div className={s.read}>
              <TufteView title={project.title} subtitle={groupTitle || undefined} body={readBody} />
            </div>
          )}
        </div>
      </div>
      {office && (
        <div className="modal-bg" onPointerDown={(e) => e.target === e.currentTarget && setOffice(null)}>
          <div className={`modal ${s.officeModal}`} role="dialog" aria-label="Text aus dem früheren Editor">
            <div className="row">
              <h2>Früherer Editor: {office.title}</h2>
              <span className="grow" />
              <button className="btn" onClick={() => setOffice(null)}>
                Schließen
              </button>
            </div>
            <p className="muted">Text markieren, kopieren und in die Karte einsetzen.</p>
            <div className={s.stripe} aria-hidden="true" />
            <iframe className={s.frame} src={officeUrl(office)} title={`Früherer Editor: ${office.title}`} allow="clipboard-read; clipboard-write" />
          </div>
        </div>
      )}
      {toast && <div className={p.toast}>{toast}</div>}
    </ProjectShell>
  );
}
