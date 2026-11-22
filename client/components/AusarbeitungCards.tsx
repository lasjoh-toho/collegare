'use client';
/**
 * Karten der Ausarbeitung bzw. Präsentation (Wünsche Jo, 21. und 22. November 2026). Eigenständiger Baustein: steht auf
 * der Seite „Ausarbeitung“ und rechts neben der Linie auf der Seite „Gliederung“.
 *
 * - Abschnitte kommen von selbst aus der Gliederung (`kind` = Linie) und bleiben abgeglichen; vor jedem Abgleich merkt
 *   sich der Server den Stand der Texte, „Zurück“ unten holt ihn wieder.
 * - Ein Klick ins Panel schreibt sofort (WYSIWYG), die Werkzeuge stehen dann als mitlaufender Kopf über dem Eintrag.
 * - Ein zarter Farbverlauf zeigt, ob man am Text (blau) oder an der Präsentation (orange) arbeitet.
 * - Notizen lassen sich hineinziehen: zwischen zwei Panels entsteht ein neuer Punkt in der Gliederung mit der Notiz als
 *   Text, in ein Panel gezogen wird die Notiz an der Stelle als Text ausgepackt.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import { TufteView } from './TufteView';
import { WriteCard, type WriteDoc } from './WriteCard';
import { termsOf } from '@/lib/tufteEdit';
import { ApiError, BASE_PATH, get, post, put } from '@/lib/api';
import { isChatDrag, readChatDrop, type ChatDrop } from '@/lib/chatDrag';
import { addItem, findPoint, insertAfterRow, LINE_COLOR, linesOf, newPoint, type LineKind } from '@/lib/lines';
import type { MapOp, Me, MindMap, ProjectView } from '@/lib/types';
import s from './ausarbeitung.module.css';

export interface DocList {
  role: 'teacher' | 'student';
  scopes: { scope: string; title: string; test?: boolean }[];
  scope: string | null;
  test?: boolean;
  people: { id: number; name: string }[];
  docs: WriteDoc[];
  outlineAt: number | null;
  finishLock: boolean;
  reopenBy: 'teacher' | 'group';
  line: LineKind;
  hasPraes: boolean;
}

const OUTSIDE = '__ohne';
const mdEsc = (t: string) => t.replace(/[\\*_`[\]{}^]/g, (c) => '\\' + c);

/** Text einer Notiz zum Auspacken: der Inhalt, sonst der Titel */
export const dropText = (d: ChatDrop) => (d.note ? d.note.text.trim() || d.note.title.trim() : d.body.trim());

/** Druck in einem eigenen Fenster: nur die Seite, mit denselben Stilen (Kopfzeile und Seitenmenü bleiben weg) */
export function printArticle(root: ParentNode, title: string) {
  const art = root.querySelector(`.${s.read} article`);
  const win = open('', '_blank');
  if (!art || !win) return print();
  const styles = [...document.querySelectorAll('style, link[rel="stylesheet"]')].map((n) => n.outerHTML).join('');
  win.document.write(
    `<!doctype html><html lang="de" data-theme="light"><head><meta charset="utf-8"><title>${title.replace(/</g, '&lt;')}</title><base href="${location.origin}">${styles}<style>@page{margin:18mm 14mm}body{margin:0;background:#fff}</style></head><body>${art.outerHTML}</body></html>`,
  );
  win.document.close();
  win.addEventListener('load', () => setTimeout(() => win.print(), 200));
}

export function AusarbeitungCards({
  project,
  scope: wanted,
  me,
  sock,
  kind = 'ausarb',
  show,
  view = 'write',
  jump,
  onLoaded,
}: {
  project: ProjectView;
  /** Bereich (Gruppe); null = der eigene */
  scope: string | null;
  me: Me;
  sock: Socket | null;
  kind?: LineKind;
  show: (msg: string) => void;
  view?: 'write' | 'read';
  /** zu diesem Abschnitt springen (z. B. von der Marke an einer Notiz) */
  jump?: number | null;
  onLoaded?: (d: DocList) => void;
}) {
  const id = project.id;
  const [data, setData] = useState<DocList | null>(null);
  const [office, setOffice] = useState<WriteDoc | null>(null);
  const [remote, setRemote] = useState<Record<number, { rev: number; by: number }>>({});
  const [bodies, setBodies] = useState<Record<number, string>>({});
  const [dragging, setDragging] = useState(false);
  const [gapOver, setGapOver] = useState<number | null>(null);
  const [flash, setFlash] = useState<number | null>(null);
  const synced = useRef<string | undefined>(undefined);
  const syncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const map = useRef<MindMap | null>(null);
  const pending = useRef<Map<string, { text: string; noteId?: number }>>(new Map());
  const root = useRef<HTMLDivElement>(null);
  const showRef = useRef(show);
  showRef.current = show;
  const onLoadedRef = useRef(onLoaded);
  onLoadedRef.current = onLoaded;
  const fail = useCallback((e: unknown) => showRef.current(e instanceof ApiError ? e.message : String(e)), []);

  const writes = (d: DocList | null) => !!d?.scope && (d.role === 'student' || !!d.test);
  const scope = data?.scope ?? wanted;
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const dataRef = useRef(data);
  dataRef.current = data;

  /** neue Abschnitte, die aus einer hineingezogenen Notiz entstanden sind, mit deren Text füllen */
  const fillPending = useCallback(async (r: DocList) => {
    for (const d of r.docs) {
      const p = d.cardId ? pending.current.get(d.cardId) : undefined;
      if (!p || d.body) continue;
      pending.current.delete(d.cardId!);
      try {
        await put(`/api/documents/${d.id}/text`, { body: p.text + '\n', rev: d.rev });
        if (p.noteId) await post(`/api/documents/${d.id}/notiz`, { noteId: p.noteId, snippet: p.text.slice(0, 300) });
        dispatchEvent(new Event('collegare:notiz-verbaut'));
        d.body = p.text + '\n';
        d.rev += 1;
      } catch (e) {
        fail(e);
      }
    }
  }, [fail]);

  const load = useCallback(
    (sc: string | null) =>
      get<DocList>(`/api/projects/${id}/documents?linie=${kind}${sc ? `&bereich=${encodeURIComponent(sc)}` : ''}`).then(async (r) => {
        if (pending.current.size) await fillPending(r);
        setData(r);
        setBodies(Object.fromEntries(r.docs.map((d) => [d.id, d.body ?? ''])));
        onLoadedRef.current?.(r);
        return r;
      }, fail),
    [id, kind, fail, fillPending],
  );

  /** Abschnitte mit der Gliederung abgleichen; vorher den Stand der Texte merken (für „Zurück“) */
  const autoSync = useCallback(
    async (r: DocList | void, sig: string) => {
      if (!r || !r.scope || synced.current === sig) return;
      synced.current = sig;
      try {
        if (r.outlineAt !== null || sig !== 'start') {
          // Stand merken nur, wer schreibt; den Abgleich mit der Gliederung braucht auch die lesende Lehrkraft
          if (writes(r)) await post(`/api/projects/${id}/documents/merken`, { scope: r.scope, line: kind });
          await post(`/api/projects/${id}/documents/sync`, { scope: r.scope, line: kind }).catch(() => {});
        }
        await load(r.scope);
      } catch (e) {
        fail(e);
      }
    },
    [id, kind, load, fail],
  );
  /** Stand der Gliederung, der für diese Linie zählt (ändert sich bei jeder Änderung an Punkten) */
  const signature = useCallback((m: MindMap) => JSON.stringify(kind === 'praes' ? ((m.outline as { praes?: unknown } | null)?.praes ?? null) : (m.outline?.sections ?? null)), [kind]);

  useEffect(() => {
    synced.current = undefined;
    void load(wanted).then((r) => r && autoSync(r, 'start'));
    // beim Start, Wechsel der Gruppe oder der Linie
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, wanted, kind]);

  // Echtzeit: Abschnitte, Texte anderer und Änderungen an der Gliederung
  useEffect(() => {
    if (!sock) return;
    const join = () => {
      sock.emit('join', id, () => {});
      if (scopeRef.current)
        sock.emit('map:join', { projectId: id, scope: scopeRef.current }, (r: { ok: boolean; map?: MindMap }) => {
          if (r?.ok && r.map) map.current = r.map;
        });
    };
    const onDocs = (m: { projectId: number; scope: string }) => m.projectId === id && m.scope === scopeRef.current && void load(scopeRef.current);
    const onText = (m: { projectId: number; scope: string; docId: number; rev: number; by: number }) => {
      if (m.projectId === id && m.scope === scopeRef.current) setRemote((x) => ({ ...x, [m.docId]: { rev: m.rev, by: m.by } }));
    };
    const onMap = (m: { projectId: number; scope: string; map: MindMap }) => {
      if (m.projectId !== id || m.scope !== scopeRef.current) return;
      map.current = m.map;
      const sig = signature(m.map);
      if (sig === synced.current) return;
      if (syncTimer.current) clearTimeout(syncTimer.current);
      syncTimer.current = setTimeout(() => void autoSync(dataRef.current ?? undefined, sig), pending.current.size ? 200 : 1200);
    };
    if (sock.connected) join();
    sock.on('connect', join);
    sock.on('docs', onDocs);
    sock.on('doctext', onText);
    sock.on('map', onMap);
    return () => {
      sock.off('connect', join);
      sock.off('docs', onDocs);
      sock.off('doctext', onText);
      sock.off('map', onMap);
    };
  }, [sock, id, load, autoSync, signature, scope]);

  // Ziehen einer Notiz irgendwo auf der Seite: Ablagestellen zwischen den Panels zeigen
  useEffect(() => {
    let depth = 0;
    const enter = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes('application/x-collegare-chat')) return;
      depth++;
      setDragging(true);
    };
    const leave = () => {
      depth = Math.max(0, depth - 1);
      if (!depth) setDragging(false);
    };
    const end = () => {
      depth = 0;
      setDragging(false);
      setGapOver(null);
    };
    addEventListener('dragenter', enter);
    addEventListener('dragleave', leave);
    addEventListener('drop', end);
    addEventListener('dragend', end);
    return () => {
      removeEventListener('dragenter', enter);
      removeEventListener('dragleave', leave);
      removeEventListener('drop', end);
      removeEventListener('dragend', end);
    };
  }, []);

  // Sprung von der Marke an einer Notiz
  useEffect(() => {
    if (!jump || !data?.docs.some((d) => d.id === jump)) return;
    const el = root.current?.querySelector(`[data-doc="${jump}"]`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setFlash(jump);
    const t = setTimeout(() => setFlash(null), 2400);
    return () => clearTimeout(t);
  }, [jump, data]);

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
      const r = await post<{ restored: number }>(`/api/projects/${id}/documents/zurueck`, { scope, line: kind });
      await load(scope);
      show(r.restored ? `${r.restored} ${r.restored === 1 ? 'Abschnitt' : 'Abschnitte'} zurückgesetzt.` : 'Die Texte sind schon auf diesem Stand.');
    } catch (e) {
      fail(e);
    }
  }

  /** Notiz zwischen zwei Panels abgelegt: neuer Punkt in der Gliederung hinter dem Abschnitt davor, Text folgt */
  async function dropBetween(before: WriteDoc | null, d: ChatDrop) {
    const m = map.current;
    if (!sock?.connected || !m || !scope) return show('Keine Verbindung zum Server. Bitte kurz warten.');
    const lines = linesOf(m);
    // die Ausarbeitung folgt der Präsentationslinie, solange sie selbst leer ist
    const live = (k: LineKind) => lines[k].points.some((p) => !p.hidden && !p.removed);
    const k: LineKind = kind === 'ausarb' && !live('ausarb') && live('praes') ? 'praes' : kind;
    if (lines.locked) return show('Die Gliederung ist gesperrt.');
    const title = (d.note?.title || dropText(d).split('\n')[0]).slice(0, 120) || 'Neuer Punkt';
    const np = newPoint(title);
    let after: string | null = null;
    if (before) {
      const top = lines[k].points.find((p) => p.card === before.sectionId || p.id === before.sectionId) ?? findPoint(lines[k].points, before.cardId ?? '')?.p;
      if (top) after = '^' + top.id;
      else after = lines[k].points.length ? '^' + lines[k].points[lines[k].points.length - 1].id : null;
    }
    let l = insertAfterRow(lines, k, after, np);
    if (d.note) l = addItem(l, k, np.id, { note: d.note.id, card: null, label: title, kind: 'note', visible: true, by: me.id });
    pending.current.set(np.id, { text: dropText(d), noteId: d.note?.id });
    const op = { type: 'lines', lines: l } as unknown as MapOp;
    sock.emit('map:op', { projectId: id, scope, op }, (r: { ok: boolean; error?: string }) => {
      if (!r.ok) {
        pending.current.delete(np.id);
        show(r.error ?? 'Neuer Punkt ließ sich nicht anlegen');
      }
    });
  }

  const onBody = useCallback((docId: number, body: string) => setBodies((b) => (b[docId] === body ? b : { ...b, [docId]: body })), []);
  const noteUsed = useCallback(
    (docId: number, noteId: number, text: string) =>
      void post(`/api/documents/${docId}/notiz`, { noteId, snippet: text.slice(0, 300) }).then(
        () => setTimeout(() => dispatchEvent(new Event('collegare:notiz-verbaut')), 1600),
        () => {},
      ),
    [],
  );

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

  const teacher = project.role === 'teacher';
  const name = (uid: number | null) => (uid === null ? null : (data?.people.find((x) => x.id === uid)?.name ?? (uid === me.id ? me.name : null)));
  const inTest = !!data?.test;
  /** Post-it der Lehrkraft für die Gruppe */
  const comment = async (docId: number, body: string) => {
    try {
      await post(`/api/documents/${docId}/kommentar`, { body });
      void load(data?.scope ?? null);
      return true;
    } catch (e) {
      fail(e);
      return false;
    }
  };
  const commentState = (docId: number, cid: number, change: { done?: boolean; remove?: boolean }) =>
    void post(`/api/documents/${docId}/kommentar/${cid}`, change).then(() => load(data?.scope ?? null), fail);
  const canEdit = (d: WriteDoc) => (!teacher || inTest) && !d.doneAt;
  const mayFinish = (d: WriteDoc) => !!data?.finishLock && (!teacher || inTest) && !d.doneAt && (d.ownerId === null || d.ownerId === me.id);
  const mayReopen = (d: WriteDoc) => !!d.doneAt && (teacher || data?.reopenBy === 'group');
  const groupTitle = data?.scopes.find((x) => x.scope === data.scope)?.title ?? '';
  const officeUrl = (d: WriteDoc) => `${BASE_PATH}/office/editor/?${new URLSearchParams({ new: 'docx', collab: 'cg' + d.id, name: me.name, uid: String(me.id), title: d.title, editing: '0', lang: 'de' })}`;
  const canDrop = writes(data) && !!sock;

  /** Ablagestelle zwischen den Panels (neuer Punkt) */
  const gap = (before: WriteDoc | null, key: number) =>
    canDrop && (
      <div
        key={'gap' + key}
        className={`${s.gap} ${dragging ? s.gapOn : ''} ${gapOver === key ? s.gapOver : ''}`}
        onDragOver={(e) => {
          if (!isChatDrag(e)) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
          setGapOver(key);
        }}
        onDragLeave={() => setGapOver((g) => (g === key ? null : g))}
        onDrop={(e) => {
          const d = readChatDrop(e);
          if (!d) return;
          e.preventDefault();
          setGapOver(null);
          void dropBetween(before, d);
        }}
      >
        {dragging && <span>Hier ablegen: neuer Punkt</span>}
      </div>
    );

  let gapKey = 0;
  let lastDoc: WriteDoc | null = null;
  return (
    <div ref={root} className={`${s.col} ${kind === 'praes' ? s.praes : s.ausarb}`} style={{ '--line-color': LINE_COLOR[kind] } as React.CSSProperties}>
      {data && !data.scope && <p className="muted">{teacher ? 'Noch keine Gruppen.' : 'Du bist noch keiner Gruppe zugeordnet.'}</p>}
      {data?.scope && view === 'write' && (
        <div className={s.cards}>
          {sections.length === 0 && (
            <p className={`muted ${s.empty}`}>
              {kind === 'praes' && !data.hasPraes ? 'Sobald die Gliederung der Präsentation einmal gespeichert ist, erscheinen hier ihre Punkte.' : data.outlineAt ? 'Die Gliederung hat noch keine Punkte.' : 'Sobald eure Gliederung Punkte hat, erscheinen hier die Karten zum Schreiben.'}
            </p>
          )}
          {sections.length === 0 && gap(null, gapKey++)}
          {sections.map((sec, si) => (
            <section key={sec.id} className={`${s.section} ${sec.id === OUTSIDE ? s.outside : ''}`}>
              {si === 0 && gap(null, gapKey++)}
              {(sec.docs.length > 1 || sec.docs[0].title !== sec.title) && <h2 className={s.secTitle}>{sec.title}</h2>}
              {sec.docs.map((d) => {
                lastDoc = d;
                return (
                  <div key={d.id} className={flash === d.id ? s.flash : undefined}>
                    <WriteCard
                      doc={d}
                      meId={me.id}
                      kind={kind}
                      canEdit={canEdit(d)}
                      owner={name(d.ownerId)}
                      writer={name}
                      remote={remote[d.id]}
                      mayFinish={mayFinish(d)}
                      mayReopen={mayReopen(d)}
                      onFinish={() => act(d, 'done')}
                      onReopen={() => act(d, 'reopen')}
                      onBody={onBody}
                      onNote={noteUsed}
                      onOffice={() => setOffice(d)}
                      show={show}
                      commentFor={teacher && !inTest ? groupTitle || 'ohne Namen' : null}
                      onComment={comment}
                      onCommentState={commentState}
                    />
                  </div>
                );
              })}
              {sec.id !== OUTSIDE && gap(lastDoc, gapKey++)}
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
    </div>
  );
}
