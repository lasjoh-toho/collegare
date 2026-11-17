'use client';
/**
 * Klassische Folienpräsentation (Wunsch Jo, 14. November 2026): neben der Pinnwand eine Präsentation wie in PowerPoint,
 * eine je Gruppe. Seit 0.7.0 in Bento (MIT, mit Menüband wie in PowerPoint) statt OnlyOffice: der Server liefert die
 * Bento-Oberfläche mit der Präsentation (/api/documents/:id/bento), Bento speichert selbst dorthin zurück. Diese Seite
 * erledigt die Datei-Aktionen aus Bentos Menü „Datei“ (PowerPoint, Bento-Datei, JSON). Die Lehrkraft sieht die
 * Präsentationen der Gruppen lesend und arbeitet im eigenen Testbereich selbst.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ProjectShell, type UndoEntry } from '@/components/ProjectShell';
import { Topbar } from '@/components/Topbar';
import { ApiError, BASE_PATH, get, href, post } from '@/lib/api';
import { download, fileBase, importBentoHtml, importJson, importPowerPoint, pickFile } from '@/lib/bentoFiles';
import { bentoToPptx } from '@/lib/pptxExport';
import type { ProjectView } from '@/lib/types';
import { useMe, useQuery } from '@/lib/useMe';
import { DeckPicker, type DeckInfo } from './DeckPicker';
import s from './folien.module.css';

interface Deck {
  role: 'teacher' | 'student';
  decks: DeckInfo[];
  scope: string | null;
  doc: { id: number; title: string; doneAt: number | null } | null;
  write?: boolean;
  canShare?: boolean;
  canLock?: boolean;
  canUnlock?: boolean;
}

type Msg = {
  bento: string;
  action?: string;
  doc?: Record<string, unknown>;
  snapshots?: Record<string, string>;
  dirty?: boolean;
  title?: string;
  kind?: 'wordart' | 'shape' | 'formula';
  edit?: { id: string; data: string };
  /** WordArt/Form auf ein Textfeld oder eine Auswahl anwenden: der Text dazu */
  text?: string;
  canUndo?: boolean;
  canRedo?: boolean;
  entries?: { undo: UndoEntry[]; redo: UndoEntry[] };
};
/** offener Einzel-Editor aus der Pinnwand (WordArt, Formen-Editor, Formel) */
type Insert = { kind: 'wordart' | 'shape' | 'formula'; edit?: { id: string; data: string }; text?: string };
const INSERT_TITLE = { wordart: 'WordArt', shape: 'Formen-Editor', formula: 'Formel' } as const;

export default function Folien() {
  const [me] = useMe();
  const idParam = useQuery('id');
  const id = idParam ? Number(idParam) : NaN;
  const wanted = useQuery('bereich');
  const [project, setProject] = useState<ProjectView | null>(null);
  const [data, setData] = useState<Deck | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (me === null) location.replace(href('/'));
  }, [me]);
  const load = useCallback(
    (sc: string | null) =>
      get<Deck>(`/api/projects/${id}/folien${sc ? `?bereich=${encodeURIComponent(sc)}` : ''}`).then(
        (d) => {
          setData(d);
          setError('');
        },
        (e) => setError(e instanceof ApiError ? e.message : String(e)),
      ),
    [id],
  );
  // Freigabe und Sperre ändern auch andere: regelmäßig nachsehen (sperrt jemand, wird die Präsentation hier lesend)
  const scopeNow = data?.scope ?? null;
  useEffect(() => {
    if (!Number.isInteger(id) || !me) return;
    const t = setInterval(() => document.visibilityState === 'visible' && void load(scopeNow), 20000);
    return () => clearInterval(t);
  }, [id, me, scopeNow, load]);
  useEffect(() => {
    if (!Number.isInteger(id) || !me) return;
    get<ProjectView>(`/api/projects/${id}`).then(setProject, () => setProject(null));
    void load(wanted);
  }, [id, me, wanted, load]);

  const frame = useRef<HTMLIFrameElement>(null);
  const [busy, setBusy] = useState('');
  const toBento = useCallback((msg: Record<string, unknown>) => frame.current?.contentWindow?.postMessage(msg, location.origin), []);
  const toast = useCallback((message: string, kind: 'neutral' | 'success' | 'error' = 'neutral') => toBento({ bento: 'toast', message, kind }), [toBento]);
  // Einfügen › WordArt / Formen-Editor / Formel: die Editoren der Pinnwand in einem eigenen iframe, erst bei Bedarf geladen
  const [insert, setInsert] = useState<Insert | null>(null);
  const editorFrame = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    if (!insert) return;
    const onMsg = (ev: MessageEvent) => {
      if (ev.origin !== location.origin || ev.source !== editorFrame.current?.contentWindow) return;
      const m = ev.data as { pinnwandEditor?: string; svg?: string; data?: string; tex?: string };
      if (m?.pinnwandEditor === 'ready') {
        editorFrame.current?.contentWindow?.postMessage({ pinnwandEditor: 'init', kind: insert.kind, data: insert.edit?.data ?? '', text: insert.text ?? '', teacher: project?.role === 'teacher' }, location.origin);
      } else if (m?.pinnwandEditor === 'done') {
        toBento({ bento: 'inserted', app: 'pinnwand', kind: insert.kind, svg: m.svg, data: m.data, tex: m.tex, editId: insert.edit?.id });
        setInsert(null);
      } else if (m?.pinnwandEditor === 'cancel') setInsert(null);
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [insert, project, toBento]);
  // Titel und Speicherstand stehen in der Kopfzeile (Wunsch Jo), Bento meldet beides
  const [title, setTitle] = useState('');
  const [dirty, setDirty] = useState(false);
  // Rückgängig/Wiederholen in der Kopfzeile (Wunsch Jo, 0.7.5), Bento meldet den Stand
  const [history, setHistory] = useState<{ canUndo: boolean; canRedo: boolean; entries: { undo: UndoEntry[]; redo: UndoEntry[] } | null }>({ canUndo: false, canRedo: false, entries: null });
  const historyWanted = useRef(false);
  useEffect(() => {
    const onMsg = (ev: MessageEvent) => {
      if (ev.origin !== location.origin || ev.source !== frame.current?.contentWindow) return;
      const m = ev.data as Msg;
      if (!m || typeof m.bento !== 'string') return;
      if ((m.bento === 'ready' || m.bento === 'title') && typeof m.title === 'string') setTitle(m.title);
      if (m.bento === 'ready' || m.bento === 'dirty') setDirty(!!m.dirty);
      if (m.bento === 'saved') setDirty(false);
      if (m.bento === 'insert' && m.kind && m.kind in INSERT_TITLE) setInsert({ kind: m.kind, edit: m.edit, text: typeof m.text === 'string' ? m.text : undefined });
      if (m.bento === 'ready' && historyWanted.current) toBento({ bento: 'history-get' });
      if (m.bento === 'history') setHistory((h) => ({ canUndo: !!m.canUndo, canRedo: !!m.canRedo, entries: m.entries ?? h.entries }));
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [toBento]);

  // Datei-Aktionen aus Bentos Menü „Datei“
  useEffect(() => {
    const onMsg = async (ev: MessageEvent) => {
      if (ev.origin !== location.origin || ev.source !== frame.current?.contentWindow) return;
      const m = ev.data as Msg;
      if (!m || m.bento !== 'file' || !m.action) return;
      const replace = (d: Record<string, unknown>, note?: string) => {
        toBento({ bento: 'replace', doc: d });
        if (note) setTimeout(() => toast(note), 1200);
      };
      try {
        switch (m.action) {
          case 'exportPptx': {
            setBusy('PowerPoint-Datei wird erstellt …');
            const r = await bentoToPptx(m.doc ?? {}, m.snapshots ?? {});
            download(r.blob, `${fileBase(m.doc?.title)}.pptx`);
            toast(r.warnings.length ? `PowerPoint-Datei erstellt. Hinweis: ${r.warnings.join(' ')}` : 'PowerPoint-Datei erstellt.', 'success');
            break;
          }
          case 'exportJson':
            download(new Blob([JSON.stringify(m.doc, null, 1)], { type: 'application/json' }), `${fileBase(m.doc?.title)}.bento.json`);
            break;
          case 'importPptx': {
            const f = await pickFile('.pptx,.ppt,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/vnd.ms-powerpoint');
            if (!f) break;
            setBusy('PowerPoint-Datei wird umgewandelt …');
            const r = await importPowerPoint(f);
            replace(r.doc, r.warnings.length ? `Hinweise zum Import: ${r.warnings.slice(0, 4).join(' ')}` : undefined);
            break;
          }
          case 'importHtml': {
            const f = await pickFile('.html,.htm,text/html');
            if (f) replace(await importBentoHtml(f));
            break;
          }
          case 'importJson': {
            const f = await pickFile('.json,application/json');
            if (f) replace(await importJson(f));
            break;
          }
        }
      } catch (e) {
        toast(e instanceof Error ? e.message : String(e), 'error');
      } finally {
        setBusy('');
      }
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [toBento, toast]);

  if (!me || !project) return <Topbar me={me ?? null} />;
  const teacher = project.role === 'teacher';
  const doc = data?.doc ?? null;
  const editing = !!doc && !!data?.write;
  const url = doc ? `${BASE_PATH}/api/documents/${doc.id}/bento` : null;
  const current = data?.decks.find((x) => x.scope === data.scope) ?? null;
  const renameDeck = (t: string) => toBento({ bento: 'title', title: t });
  async function share(shared: boolean) {
    if (!doc) return;
    await post(`/api/documents/${doc.id}/freigabe`, { shared }).catch((e) => setError(e instanceof Error ? e.message : String(e)));
    void load(data?.scope ?? null);
  }
  async function lock(locked: boolean) {
    if (!doc) return;
    // vor dem Sperren speichern, damit nichts verloren geht
    if (locked && dirty) toBento({ bento: 'save' });
    await post(`/api/documents/${doc.id}/sperre`, { locked }).catch((e) => setError(e instanceof Error ? e.message : String(e)));
    void load(data?.scope ?? null);
  }

  return (
    <ProjectShell
      me={me}
      project={project}
      where="Folien"
      center={
        data && current ? (
          <DeckPicker
            decks={data.decks}
            current={current}
            teacher={teacher}
            meId={me.id}
            title={title}
            editing={editing}
            dirty={dirty}
            canShare={!!data.canShare}
            canLock={!!data.canLock}
            canUnlock={!!data.canUnlock}
            onChoose={(sc) => void load(sc)}
            onRename={renameDeck}
            onSave={() => toBento({ bento: 'save' })}
            onShare={(on) => void share(on)}
            onLock={(on) => void lock(on)}
          />
        ) : undefined
      }
      info={{ key: 'folien', title: 'Folien', text: 'Eure Präsentation, bedient wie PowerPoint: Oben stehen Datei, Start, Einfügen und die anderen Registerkarten, rechts der Formatbereich zur gewählten Registerkarte. Gespeichert wird von selbst. Unter „Datei“ lässt sich die Präsentation als PowerPoint, Bento-Datei oder JSON herunterladen. In der Mitte der Kopfzeile wählst und benennst du die Präsentation; das Auge dahinter schaltet sie für alle frei, das Schloss sperrt die Bearbeitung für alle anderen, auch für deine Gruppe.' }}
      phase="presentation"
      fill
      undo={
        editing
          ? {
              ...history,
              onUndo: () => toBento({ bento: 'undo' }),
              onRedo: () => toBento({ bento: 'redo' }),
              onGo: (steps) => toBento({ bento: 'history-go', steps }),
              onHistory: () => {
                historyWanted.current = true;
                toBento({ bento: 'history-get' });
              },
            }
          : undefined
      }
      actions={
        <>
          {busy && <span className="muted">{busy}</span>}
          {doc && !editing && <span className={`muted ${s.readNote}`}>{teacher ? 'Ansicht für die Lehrkraft' : 'Nur lesen'}</span>}
        </>
      }
    >
      <div className={s.area}>
        {error && <div className={`panel ${s.notice}`}>{error}</div>}
        {data && !data.scope && <div className={`panel ${s.notice}`}>{teacher ? 'Noch keine Gruppen.' : 'Du bist noch keiner Gruppe zugeordnet.'}</div>}
        {url && (
          <div className={s.editor}>
            <div className={s.stripe} />
            <iframe ref={frame} key={`${url}:${editing}`} className={s.frame} src={url} title="Folien" allow="clipboard-read; clipboard-write; fullscreen; display-capture" allowFullScreen />
          </div>
        )}
        {insert && (
          <div className={s.insertBack} onClick={(e) => e.target === e.currentTarget && setInsert(null)}>
            <div className={`panel ${s.insertBox} ${insert.kind === 'formula' ? s.insertFormula : ''}`} role="dialog" aria-label={INSERT_TITLE[insert.kind]}>
              <iframe ref={editorFrame} className={s.insertFrame} src={`${BASE_PATH}/pinnwand/editor.html`} title={INSERT_TITLE[insert.kind]} />
            </div>
          </div>
        )}
      </div>
    </ProjectShell>
  );
}
