'use client';
/**
 * Arbeitsblatt und Klassenarbeit (Material, Art „blatt“; Wunsch Jo, 22. November 2026).
 *
 * Links das Blatt (Format, Broschüre, Kopfzeile) und die Bausteine, in der Mitte die Seiten so, wie sie gedruckt
 * werden, rechts der gewählte Baustein. Gesetzt wird mit lib/blatt.ts. Drucken: ein Exemplar ohne Code oder je Person
 * einer Autogra.fi-Aufgabe ein Exemplar mit deren persönlichem QR-Code (Klassenliste und Codes holt der Browser dort,
 * mit der Anmeldung in Autogra.fi). Die Broschüre wird ausgeschossen: Seite 1 steht auf dem Bogen neben der letzten.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ProjectShell } from '@/components/ProjectShell';
import { Topbar } from '@/components/Topbar';
import { editToTufte, glossHtml, noteHtml, tufteToEdit } from '@/lib/tufteEdit';
import { fileUrl, type Material } from '@/components/Materials';
import { ApiError, get, href, patch } from '@/lib/api';
import {
  BLOCK_LABEL,
  blockSummary,
  findBlock,
  fromEditMd,
  glossaryTerms,
  insertAfter,
  insertIntoCol,
  listOf,
  mapLists,
  newBlock,
  paginate,
  parseDoc,
  plainMd,
  removeBlock,
  setTerm,
  sheetSize,
  styleOf,
  taskLabels,
  TEMPLATES,
  toCriteria,
  toEditMd,
  toMarkdown,
  toSheets,
  toSpreads,
  uid,
  updateBlock,
  walk,
  type BlattDoc,
  type Block,
  type BlockType,
  type Copy,
  type Korr,
  type Problem,
  type Ruling,
} from '@/lib/blatt';
import type { ProjectView } from '@/lib/types';
import { useMe, useQuery } from '@/lib/useMe';
import st from './blatt.module.css';

interface Page {
  id: number;
  kind: string;
  title: string;
  note: string;
  body: string;
}

const ICON: Record<BlockType, string> = { heading: 'H', text: '¶', material: '❝', quote: '“', image: '▣', task: '✎', box: '▢', glossary: 'Aa', cols: '▥', lines: '≡', pagebreak: '⤓' };
const ADD: BlockType[] = ['material', 'image', 'task', 'text', 'quote', 'box', 'heading', 'glossary', 'lines', 'pagebreak'];
const MAX = 4_000_000;

const INFO = `Hier entsteht ein Arbeitsblatt oder eine Klassenarbeit zum Ausdrucken. Du schreibst direkt auf der Seite: Klick in einen Text, eine Überschrift, eine Bildunterschrift oder eine Quelle, und tipp los. Esc beendet das Schreiben.

Das Menüband oben: „Start“ formatiert (fett, kursiv, unterstrichen, Textmarker, Listen, Ausrichtung, Einzug, Zeilenabstand, Schriftgröße, Rand für Notizen) und setzt Fußnote, Randbemerkung oder Glossar-Wort in den Text. Ohne Markierung gelten fett und kursiv für den ganzen Baustein. Jeder Textbaustein hat Vorlagen; „Wie Vorlage“ nimmt eigene Änderungen wieder weg. „Einfügen“ fügt Bausteine nach dem gewählten ein, auch Teilaufgaben und Spalten. „Blatt“ stellt Format, Broschüre, Korrekturrand, Kopfzeile, QR-Code und die Nummern der Teilaufgaben ein. Der Reiter mit dem Namen des gewählten Bausteins (z. B. „Aufgabe“ oder „Bild“) hat dessen Einstellungen.

Aufgaben werden von selbst nummeriert; Teilaufgaben heißen a), b) … oder 1.1, 1.2 … (unter „Blatt“). Eine eigene Nummer wie „1 b)“ trägst du im Reiter „Aufgabe“ ein.

Spalten: unter „Einfügen“ zwei oder drei Spalten anlegen, in eine leere Spalte klicken und dann einen Baustein einfügen. Oder einen Baustein wählen und „neben den nächsten“: Er steht dann neben dem folgenden, z. B. ein Erklärtext neben einer Grafik.

Bilder: hineinziehen, einfügen, im Reiter „Bild“ auswählen, aus dem Material oder über ihre Adresse im Netz laden. Ein Bild lässt sich drehen und mit der Maus frei auf der Seite verschieben; Sein Platz im Text bleibt frei, außer du wählst „vor dem Text“; „An seinen Platz“ setzt es zurück.

Links wählst du die Ansicht: Seiten (zum Schreiben), Doppelseiten (zwei Seiten nebeneinander wie im aufgeschlagenen Heft, um den Mittelschnitt zu prüfen; auch hier schreibst du) und Druckbögen (so liegen die Seiten auf dem Papier). Darunter stehen alle Bausteine; ziehen ändert die Reihenfolge.

Rechts lässt sich eine Seitenleiste zuschalten: Suchen (im Blatt, nach Bausteinen und im Material), Material (Bilder und Lernseiten einsetzen) und Glossar (Erklärungen schreiben).

Korrekturrand: dünne, mittlere oder dicke Randlinie, oder die Zeilen enden vor dem Rand; er gilt für alle Schreiblinien und Karos.

Broschüre: Die Seiten werden auf ein Vielfaches von vier aufgefüllt und so auf die Bögen verteilt, dass die erste Seite neben der letzten steht. Beidseitig drucken und an der kurzen Kante wenden.

QR-Code: Beim Drucken wählst du eine Aufgabe in Autogra.fi; jede Person bekommt ein eigenes Exemplar mit ihrem Code. Dafür musst du im selben Browser in Autogra.fi angemeldet sein.`;

/** Bild verkleinern (längste Seite 1600 px) und als data:-Adresse zurückgeben (wie bei Lernseiten). */
async function shrink(file: Blob): Promise<{ src: string; ar: number }> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = url;
    });
    const k = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * k);
    c.height = Math.round(img.naturalHeight * k);
    const g = c.getContext('2d')!;
    g.fillStyle = '#fff';
    g.fillRect(0, 0, c.width, c.height);
    g.drawImage(img, 0, 0, c.width, c.height);
    return { src: c.toDataURL('image/jpeg', 0.82), ar: c.height / Math.max(1, c.width) };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export default function BlattPage() {
  const [me] = useMe();
  const idParam = useQuery('id');
  const mParam = useQuery('m');
  const id = idParam ? Number(idParam) : NaN;
  const mid = mParam ? Number(mParam) : NaN;
  const [project, setProject] = useState<ProjectView | null>(null);
  const [page, setPage] = useState<Page | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [doc, setDoc] = useState<BlattDoc | null>(null);
  const [title, setTitle] = useState('');
  const [sel, setSel] = useState<string | null>(null);
  /** leere Spalte, in die „Einfügen“ setzt */
  const [selCol, setSelCol] = useState<{ id: string; k: number } | null>(null);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState<'ok' | 'dirty' | 'saving'>('ok');
  const [view, setView] = useState<'pages' | 'spreads' | 'sheets'>('pages');
  const [problems, setProblems] = useState<Problem[]>([]);
  const [pageCount, setPageCount] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [printing, setPrinting] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropAt, setDropAt] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('start');
  const [panel, setPanel] = useState<Panel | null>(null);
  /** Feld, das gerade auf der Seite bearbeitet wird */
  const [edit, setEdit] = useState<EditTarget | null>(null);
  const [ov, setOv] = useState<Overlay | null>(null);
  const host = useRef<HTMLDivElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const center = useRef<HTMLDivElement>(null);
  const inline = useRef<InlineApi | null>(null);
  const history = useRef<{ undo: BlattDoc[]; redo: BlattDoc[]; last: number }>({ undo: [], redo: [], last: 0 });

  useEffect(() => {
    if (!Number.isInteger(id) || !Number.isInteger(mid)) return;
    get<ProjectView>(`/api/projects/${id}`).then(setProject, (e) => setError(String(e.message ?? e)));
    get<{ page: Page; canEdit: boolean }>(`/api/projects/${id}/materials/${mid}`).then(
      (r) => {
        setPage(r.page);
        setTitle(r.page.title);
        setDoc(parseDoc(r.page.body, r.page.title));
        setCanEdit(r.canEdit);
      },
      (e) => setError(e instanceof ApiError ? e.message : String(e)),
    );
  }, [id, mid]);

  // ---------- Ändern, Rückgängig, Speichern ----------
  const change = useCallback((fn: (d: BlattDoc) => BlattDoc) => {
    setDoc((d) => {
      if (!d) return d;
      const h = history.current;
      // kurz hintereinander Getipptes ist ein Schritt
      if (Date.now() - h.last > 800) {
        h.undo.push(d);
        if (h.undo.length > 60) h.undo.shift();
      }
      h.last = Date.now();
      h.redo = [];
      return fn(d);
    });
    setSaved('dirty');
  }, []);
  const undo = () => {
    const h = history.current;
    const prev = h.undo.pop();
    if (!prev || !doc) return;
    h.redo.push(doc);
    h.last = 0;
    setDoc(prev);
    setSaved('dirty');
  };
  const redo = () => {
    const h = history.current;
    const nx = h.redo.pop();
    if (!nx || !doc) return;
    h.undo.push(doc);
    h.last = 0;
    setDoc(nx);
    setSaved('dirty');
  };
  const setBlock = useCallback((bid: string, p: Partial<Block>) => change((d) => ({ ...d, blocks: updateBlock(d.blocks, bid, p) })), [change]);
  const setPageOpt = (p: Partial<BlattDoc['page']>) => change((d) => ({ ...d, page: { ...d.page, ...p } }));
  const setHeader = (p: Partial<BlattDoc['page']['header']>) => change((d) => ({ ...d, page: { ...d.page, header: { ...d.page.header, ...p } } }));

  const body = useMemo(() => (doc ? JSON.stringify(doc) : ''), [doc]);
  const save = useCallback(async () => {
    if (!doc || !canEdit) return;
    if (body.length > MAX) {
      setError('Das Blatt ist zu groß (höchstens 4 MB samt Bildern). Bitte große Bilder entfernen oder kleiner einsetzen.');
      return;
    }
    setSaved('saving');
    try {
      await patch(`/api/projects/${id}/materials/${mid}`, { title: title.trim() || 'Ohne Titel', body });
      setSaved((s) => (s === 'saving' ? 'ok' : s));
      setError('');
    } catch (e) {
      setSaved('dirty');
      setError(e instanceof ApiError ? e.message : String(e));
    }
  }, [doc, canEdit, body, id, mid, title]);
  useEffect(() => {
    if (saved !== 'dirty') return;
    const t = setTimeout(() => void save(), 1500);
    return () => clearTimeout(t);
  }, [saved, body, title, save]);
  useEffect(() => {
    const warn = (ev: BeforeUnloadEvent) => {
      if (saved !== 'ok') ev.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [saved]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const inField = (e.target as HTMLElement)?.closest?.('input, textarea, select, [contenteditable="true"]');
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        void save();
      } else if (!inField && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (!inField && sel && (e.key === 'Delete' || e.key === 'Backspace')) {
        e.preventDefault();
        remove(sel);
      }
    };
    addEventListener('keydown', key);
    return () => removeEventListener('keydown', key);
  });

  // ---------- Setzen ----------
  useLayoutEffect(() => {
    const h = host.current;
    if (!h || !doc) return;
    const r = paginate(doc, h, undefined, { editing: canEdit });
    setProblems(r.problems);
    setPageCount(r.pages.length);
    if (view !== 'pages') {
      const tmp = document.createElement('div');
      if (view === 'sheets') toSheets(doc, r.pages, tmp);
      else toSpreads(doc, r.pages, tmp);
      h.replaceChildren(...tmp.children);
    }
    // Auswahl markieren und das bearbeitete Feld wiederfinden (es kann durch den Umbruch gewandert sein)
    h.querySelectorAll(`[data-bid="${sel}"]`).forEach((e) => e.classList.add('bl-sel'));
    if (selCol) h.querySelector(`[data-col="${selCol.id}:${selCol.k}"]`)?.classList.add('bl-col-sel');
    setOv(edit ? overlayFor(h, wrap.current, edit, zoom) : null);
  }, [doc, view, canEdit, sel, selCol, edit, zoom]);
  // auf die Breite der Mitte einpassen
  useEffect(() => {
    const c = center.current;
    if (!c || !doc) return;
    const fit = () => {
      const pw = doc.page.size === 'a5' ? 148 : 210;
      const sz = view === 'sheets' ? sheetSize(doc).w : view === 'spreads' ? 2 * pw : pw;
      const px = sz * 3.7795 + 40;
      setZoom(Math.min(1, Math.max(0.3, (c.clientWidth - 8) / px)));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(c);
    return () => ro.disconnect();
  }, [doc?.page.size, doc?.page.booklet, view, doc]);

  // ---------- Bausteine ----------
  const selBlock = doc && sel ? findBlock(doc.blocks, sel) : null;
  function add(type: BlockType, extra: Partial<Block> = {}) {
    const b = { ...newBlock(type), ...extra };
    change((d) => ({ ...d, blocks: selCol ? insertIntoCol(d.blocks, selCol.id, selCol.k, b) : insertAfter(d.blocks, sel, b) }));
    setSelCol(null);
    setSel(b.id);
    setEdit(null);
    if (type === 'image' || type === 'cols' || type === 'lines' || type === 'glossary') setTab('block');
  }
  function move(bid: string, dir: -1 | 1) {
    change((d) => ({
      ...d,
      blocks: mapLists(d.blocks, (l) => {
        const i = l.findIndex((b) => b.id === bid);
        const j = i + dir;
        if (i < 0 || j < 0 || j >= l.length) return l;
        const out = [...l];
        [out[i], out[j]] = [out[j], out[i]];
        return out;
      }),
    }));
  }
  function moveTo(bid: string, beforeId: string | null) {
    if (bid === beforeId) return;
    change((d) => {
      const b = findBlock(d.blocks, bid);
      if (!b) return d;
      const rest = removeBlock(d.blocks, bid);
      if (!beforeId) return { ...d, blocks: [...rest, b] };
      return {
        ...d,
        blocks: mapLists(rest, (l) => {
          const i = l.findIndex((x) => x.id === beforeId);
          return i < 0 ? l : [...l.slice(0, i), b, ...l.slice(i)];
        }),
      };
    });
  }
  function remove(bid: string) {
    change((d) => ({ ...d, blocks: removeBlock(d.blocks, bid) }));
    if (sel === bid) setSel(null);
    setEdit(null);
  }
  function duplicate(bid: string) {
    const nid = uid();
    change((d) => {
      const b = findBlock(d.blocks, bid);
      return b ? { ...d, blocks: insertAfter(d.blocks, bid, JSON.parse(JSON.stringify({ ...b, id: nid }), (k, v) => (k === 'id' && v !== nid ? uid() : v))) } : d;
    });
    setSel(nid);
  }
  /** gewählten Baustein und den folgenden nebeneinander setzen (z. B. Erklärtext neben eine Grafik) */
  function toColumns(bid: string) {
    change((d) => ({
      ...d,
      blocks: mapLists(d.blocks, (l) => {
        const i = l.findIndex((b) => b.id === bid);
        if (i < 0) return l;
        const next = l[i + 1];
        const c: Block = { ...newBlock('cols'), cols: next ? [[l[i]], [next]] : [[l[i]], []] };
        return [...l.slice(0, i), c, ...l.slice(i + (next ? 2 : 1))];
      }),
    }));
  }
  function unColumns(cid: string) {
    change((d) => ({ ...d, blocks: mapLists(d.blocks, (l) => l.flatMap((b) => (b.id === cid ? (b.cols ?? []).flat() : [b]))) }));
    setSel(null);
  }
  async function imageInto(file: Blob, bid: string | null) {
    try {
      const { src, ar } = await shrink(file);
      if (bid && findBlock(doc?.blocks ?? [], bid)?.type === 'image') setBlock(bid, { src, ar });
      else add('image', { src, ar });
    } catch {
      setError('Das Bild ließ sich nicht lesen.');
    }
  }
  function select(bid: string | null) {
    setSel(bid);
    setSelCol(null);
    const b = bid && doc ? findBlock(doc.blocks, bid) : null;
    if (b && (b.type === 'image' || b.type === 'cols' || b.type === 'lines' || b.type === 'pagebreak' || b.type === 'glossary')) setTab('block');
  }

  // Klick, Ziehen und Einsetzen auf den Seiten
  function onPagesClick(e: React.MouseEvent) {
    if (!canEdit) return;
    const t = e.target as HTMLElement;
    if (t.closest('[data-ov]')) return;
    const col = t.closest<HTMLElement>('.bl-col-empty')?.parentElement;
    if (col?.dataset.col) {
      const [cid, k] = col.dataset.col.split(':');
      setSel(cid);
      setSelCol({ id: cid, k: Number(k) });
      setEdit(null);
      setTab('insert');
      return;
    }
    const blockEl = t.closest<HTMLElement>('[data-bid]');
    if (!blockEl?.dataset.bid) {
      setEdit(null);
      return;
    }
    select(blockEl.dataset.bid);
    // geschrieben wird in den Seiten und in den Doppelseiten; die Druckbögen sind nur zum Ansehen
    const f = view !== 'sheets' ? t.closest<HTMLElement>('[data-field]') : null;
    if (f && f.closest('[data-bid]') === blockEl) {
      const all = [...(host.current?.querySelectorAll<HTMLElement>(`[data-bid="${blockEl.dataset.bid}"] [data-field="${f.dataset.field}"]`) ?? [])].filter((x) => x.closest('[data-bid]') === x.closest(`[data-bid="${blockEl.dataset.bid}"]`));
      setEdit({ bid: blockEl.dataset.bid, field: f.dataset.field as EditTarget['field'], idx: Math.max(0, all.indexOf(f)), at: { x: e.clientX, y: e.clientY } });
    } else setEdit(null);
  }
  function onPagesDrop(e: React.DragEvent) {
    if (!canEdit) return;
    const f = [...e.dataTransfer.files].find((x) => x.type.startsWith('image/'));
    if (!f) return;
    e.preventDefault();
    const t = (e.target as HTMLElement).closest<HTMLElement>('[data-bid]');
    void imageInto(f, t?.dataset.bid ?? null);
  }
  // Bilder auf der Seite verschieben: ziehen; ein Bild im Text wird dabei frei
  function onPointerDown(e: React.PointerEvent) {
    if (!canEdit || view === 'sheets' || e.button !== 0) return;
    const fig = (e.target as HTMLElement).closest<HTMLElement>('.bl-fig');
    const box = fig?.closest<HTMLElement>('.bl-image');
    const bid = box?.dataset.bid;
    if (!fig || !bid || (e.target as HTMLElement).closest('[data-field]')) return;
    const b = doc ? findBlock(doc.blocks, bid) : null;
    if (!b?.src) return;
    e.preventDefault();
    select(bid);
    setEdit(null);
    const pxmm = 3.7795 * zoom;
    const sx = e.clientX;
    const sy = e.clientY;
    const left0 = Number(b.dx) || 0;
    const top0 = Number(b.dy) || 0;
    let moved = false;
    const mv = (ev: PointerEvent) => {
      const dx = (ev.clientX - sx) / pxmm;
      const dy = (ev.clientY - sy) / pxmm;
      if (!moved && Math.hypot(dx, dy) < 1.5) return;
      moved = true;
      fig.style.transform = `translate(${dx}mm, ${dy}mm)`;
      fig.style.opacity = '0.85';
    };
    const up = (ev: PointerEvent) => {
      removeEventListener('pointermove', mv);
      removeEventListener('pointerup', up);
      if (!moved) return;
      const dx = Math.round((left0 + (ev.clientX - sx) / pxmm) * 2) / 2;
      const dy = Math.round((top0 + (ev.clientY - sy) / pxmm) * 2) / 2;
      setBlock(bid, { free: true, dx, dy });
    };
    addEventListener('pointermove', mv);
    addEventListener('pointerup', up);
  }
  useEffect(() => {
    if (!canEdit) return;
    const paste = (e: ClipboardEvent) => {
      if ((e.target as HTMLElement)?.closest?.('input, textarea, [contenteditable="true"]')) return;
      const f = [...(e.clipboardData?.files ?? [])].find((x) => x.type.startsWith('image/'));
      if (f) {
        e.preventDefault();
        void imageInto(f, sel);
      }
    };
    addEventListener('paste', paste);
    return () => removeEventListener('paste', paste);
  });

  if (!me || !project) return <Topbar me={me ?? null} />;
  const bad = new Set(problems.map((p) => p.bid));
  const editing = canEdit;
  const editValue = edit && doc ? fieldValue(findBlock(doc.blocks, edit.bid), edit.field) : '';
  const outline = doc ? flatOutline(doc.blocks) : [];
  return (
    <ProjectShell
      me={me}
      project={project}
      where="Material"
      fill
      info={{ key: 'blatt', title: 'Arbeitsblatt und Klassenarbeit', text: INFO }}
      crumbs={page ? <span className="muted">{title || page.title}</span> : null}
      actions={
        <>
          <a className="btn" href={href(project.werkstatt ? '/materialien/' : `/projekt/material/?id=${id}`)}>
            ← {project.werkstatt ? 'Materialien' : 'Material'}
          </a>
          {editing && (
            <>
              <button className="btn" onClick={undo} disabled={!history.current.undo.length} title="Rückgängig (Strg+Z)">
                ↶
              </button>
              <button className="btn" onClick={redo} disabled={!history.current.redo.length} title="Wiederholen (Strg+Umschalt+Z)">
                ↷
              </button>
              <span className="muted" style={{ fontSize: 12 }}>
                {saved === 'ok' ? 'Gespeichert' : saved === 'saving' ? 'Speichert …' : 'Nicht gespeichert'}
              </span>
            </>
          )}
          <button className="btn primary" onClick={() => setPrinting(true)} disabled={!doc}>
            Drucken …
          </button>
        </>
      }
    >
      {error && <div className="error">{error}</div>}
      {doc && (
        <div className={st.shell}>
          {editing && (
            <Ribbon
              tab={tab}
              setTab={setTab}
              doc={doc}
              b={selBlock}
              selCol={selCol}
              inline={inline}
              editingText={!!edit}
              panel={panel}
              setPanel={setPanel}
              set={(p) => selBlock && setBlock(selBlock.id, p)}
              setPageOpt={setPageOpt}
              setHeader={setHeader}
              add={add}
              move={move}
              remove={remove}
              duplicate={duplicate}
              toColumns={toColumns}
              unColumns={unColumns}
              onImage={(f) => void imageInto(f, selBlock?.type === 'image' ? selBlock.id : null)}
              ensureGlossary={() => change((d) => (walk(d.blocks).some((x) => x.type === 'glossary') ? d : { ...d, blocks: [...d.blocks, newBlock('glossary')] }))}
              onError={setError}
            />
          )}
          <div className={`${st.wrap} ${editing ? '' : st.read} ${panel ? '' : st.noPanel}`}>
            <aside className={st.side}>
              <div className="seg" role="group" aria-label="Ansicht">
                <button className={`btn ${view === 'pages' ? 'on' : ''}`} onClick={() => setView('pages')} title="Seiten untereinander; hier schreibst du">
                  Seiten
                </button>
                <button className={`btn ${view === 'spreads' ? 'on' : ''}`} onClick={() => (setView('spreads'), setEdit(null))} title="Zwei Seiten nebeneinander wie im aufgeschlagenen Heft; auch hier schreiben und Bilder verschieben">
                  Doppelseiten
                </button>
                <button className={`btn ${view === 'sheets' ? 'on' : ''}`} onClick={() => (setView('sheets'), setEdit(null))} title="So liegen die Seiten auf dem Papier">
                  Druckbögen
                </button>
              </div>
              <div className={st.hint}>
                {pageCount} {pageCount === 1 ? 'Seite' : 'Seiten'} {doc.page.size.toUpperCase()}
                {doc.page.booklet ? `, ${pageCount / 4} ${pageCount / 4 === 1 ? 'Bogen' : 'Bögen'} ${sheetSize(doc).name}` : ''}
              </div>
              {problems.length > 0 && <div className={st.warn}>{problems.length === 1 ? 'Ein Baustein passt' : `${problems.length} Bausteine passen`} nicht auf eine Seite</div>}
              {editing && <input className={st.titleIn} value={title} onChange={(e) => (setTitle(e.target.value), setSaved('dirty'))} placeholder="Name des Blatts" aria-label="Name des Blatts" />}
              <section className={st.sec}>
                <div className={st.secHead}>Bausteine</div>
                {!doc.blocks.length && <div className={st.empty}>Noch leer. Im Menüband unter „Einfügen“ kommen Material, Bilder und Aufgaben dazu.</div>}
                <div className={st.list} onDragOver={(e) => dragId && e.preventDefault()} onDrop={() => dragId && (moveTo(dragId, dropAt), setDragId(null), setDropAt(null))}>
                  {outline.map(({ b, depth }) => (
                    <div
                      key={b.id}
                      className={`${st.item} ${sel === b.id ? st.sel : ''} ${bad.has(b.id) ? st.bad : ''} ${dragId === b.id ? st.drag : ''} ${dropAt === b.id && dragId !== b.id ? st.dropAbove : ''}`}
                      style={{ marginLeft: depth * 14 }}
                      onClick={() => (select(b.id), setEdit(null), host.current?.querySelector(`[data-bid="${b.id}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }))}
                      draggable={editing}
                      onDragStart={(e) => (setDragId(b.id), e.dataTransfer.setData('text/plain', b.id))}
                      onDragOver={() => dragId && setDropAt(b.id)}
                      onDragEnd={() => (setDragId(null), setDropAt(null))}
                      title={bad.has(b.id) ? problems.find((p) => p.bid === b.id)?.msg : undefined}
                    >
                      <span className={st.itemIcon}>{ICON[b.type]}</span>
                      <span className={st.itemText}>
                        {BLOCK_LABEL[b.type]}
                        <small>{blockSummary(b)}</small>
                      </span>
                    </div>
                  ))}
                  {dragId && (
                    <div className={st.empty} onDragOver={() => setDropAt(null)}>
                      ans Ende
                    </div>
                  )}
                </div>
              </section>
            </aside>

            <div className={st.center} ref={center}>
              <div className={st.pagesOuter} onClick={onPagesClick} onPointerDown={onPointerDown} onDragOver={(e) => canEdit && e.preventDefault()} onDrop={onPagesDrop}>
                <div ref={wrap} className={st.zoomWrap} style={{ zoom } as React.CSSProperties}>
                  <div ref={host} className={`${st.host} ${editing ? st.editing : ''} ${view !== 'pages' ? st.sheets : ''}`} />
                  {edit && ov && (
                    <InlineEditor
                      key={`${edit.bid}:${edit.field}`}
                      ov={ov}
                      field={edit.field}
                      at={edit.at}
                      value={editValue}
                      api={inline}
                      doc={doc}
                      onChange={(v) => setBlock(edit.bid, { [edit.field]: v })}
                      onClose={() => setEdit(null)}
                      ensureGlossary={() => change((d) => (walk(d.blocks).some((x) => x.type === 'glossary') ? d : { ...d, blocks: [...d.blocks, newBlock('glossary')] }))}
                    />
                  )}
                </div>
              </div>
            </div>

            {panel && (
              <aside className={`${st.side} ${st.right}`}>
                <SidePanel
                  panel={panel}
                  setPanel={setPanel}
                  doc={doc}
                  projectId={id}
                  onPick={(bid) => (select(bid), setEdit(null), host.current?.querySelector(`[data-bid="${bid}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }))}
                  add={add}
                  onImage={(f, caption) => {
                    void imageInto(f, selBlock?.type === 'image' ? selBlock.id : null);
                    if (caption && selBlock?.type === 'image' && !selBlock.caption) setBlock(selBlock.id, { caption });
                  }}
                  onTerm={(w, e) => change((d) => setTerm(d, w, e))}
                />
              </aside>
            )}
          </div>
        </div>
      )}
      {printing && doc && <PrintDialog doc={doc} title={title} onClose={() => setPrinting(false)} />}
    </ProjectShell>
  );
}

// ---------- Bearbeiten direkt auf der Seite ----------
type Tab = 'start' | 'insert' | 'sheet' | 'block';
type Panel = 'search' | 'material' | 'glossary';
type FieldName = 'md' | 'title' | 'text' | 'source' | 'caption';
interface EditTarget {
  bid: string;
  field: FieldName;
  /** welches Stück, wenn der Baustein über mehrere Seiten läuft */
  idx: number;
  at?: { x: number; y: number };
}
/** Lage und Aussehen des Felds auf der Seite, damit der Editor genau darüber liegt */
interface Overlay {
  left: number;
  top: number;
  width: number;
  minHeight: number;
  tag: string;
  pageStyle: string;
  blockClass: string;
  blockStyle: string;
  fieldClass: string;
  fieldStyle: string;
}
interface InlineApi {
  el: HTMLElement;
  emit: () => void;
  restore: () => void;
  rich: boolean;
}

function overlayFor(host: HTMLElement, wrapEl: HTMLElement | null, t: EditTarget, zoom: number): Overlay | null {
  if (!wrapEl) return null;
  const all = [...host.querySelectorAll<HTMLElement>(`[data-bid="${t.bid}"] [data-field="${t.field}"]`)].filter((x) => x.closest('[data-bid]')?.getAttribute('data-bid') === t.bid);
  const f = all[Math.min(t.idx, all.length - 1)];
  if (!f) return null;
  const block = f.closest<HTMLElement>('.bl-block')!;
  const pg = f.closest<HTMLElement>('.bl-page');
  const w = wrapEl.getBoundingClientRect();
  const inlineEl = getComputedStyle(f).display === 'inline';
  const r = inlineEl ? (f.getClientRects()[0] ?? f.getBoundingClientRect()) : f.getBoundingClientRect();
  const parent = (inlineEl ? f.parentElement : f)!.getBoundingClientRect();
  const left = (r.left - w.left) / zoom;
  const top = (r.top - w.top) / zoom;
  const width = inlineEl ? (parent.right - r.left) / zoom : f.offsetWidth;
  return {
    left,
    top,
    width: Math.max(40, width),
    minHeight: inlineEl ? r.height / zoom : f.offsetHeight,
    tag: inlineEl ? 'div' : f.tagName.toLowerCase() === 'figcaption' ? 'div' : f.tagName.toLowerCase(),
    pageStyle: `font-family:${pg?.style.fontFamily ?? ''};font-size:${pg?.style.fontSize ?? ''};line-height:1.35;color:#111`,
    blockClass: block.className.replace(/\bbl-sel\b|\bbl-overflow\b/g, ''),
    blockStyle: block.style.cssText,
    fieldClass: f.className,
    fieldStyle: f.style.cssText,
  };
}

function fieldValue(b: Block | null, f: FieldName): string {
  if (!b) return '';
  return String((b as unknown as Record<string, unknown>)[f] ?? '');
}
const RICH: FieldName[] = ['md', 'title', 'text'];
const MULTI: FieldName[] = ['md'];

function InlineEditor({
  ov,
  field,
  at,
  value,
  api,
  doc,
  onChange,
  onClose,
  ensureGlossary,
}: {
  ov: Overlay;
  field: FieldName;
  at?: { x: number; y: number };
  value: string;
  api: React.MutableRefObject<InlineApi | null>;
  doc: BlattDoc;
  onChange: (v: string) => void;
  onClose: () => void;
  ensureGlossary: () => void;
}) {
  const box = useRef<HTMLElement | null>(null);
  const emitted = useRef<string | null>(null);
  const saved = useRef<Range | null>(null);
  const [atom, setAtom] = useState<{ el: HTMLElement; text: string; extra: string } | null>(null);
  const rich = RICH.includes(field);
  const multi = MULTI.includes(field);

  function emit() {
    const el = box.current;
    if (!el) return;
    let v = rich ? fromEditMd(editToTufte(el)) : (el.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (!multi) v = v.replace(/\n+/g, ' ');
    emitted.current = v;
    onChange(v);
  }
  function restore() {
    const el = box.current;
    if (!el) return;
    if (document.activeElement !== el) el.focus();
    const s = getSelection();
    if (saved.current && el.contains(saved.current.startContainer)) {
      s?.removeAllRanges();
      s?.addRange(saved.current);
    }
  }
  // Inhalt nur setzen, wenn er von außen kommt (Rückgängig, Glossar …), sonst springt die Schreibmarke
  useLayoutEffect(() => {
    const el = box.current;
    if (!el || value === emitted.current) return;
    const first = emitted.current === null;
    if (rich) el.innerHTML = tufteToEdit(toEditMd(value));
    else el.textContent = value;
    emitted.current = value;
    if (first) {
      el.focus();
      // Schreibmarke dorthin, wo geklickt wurde
      const pos = at && (document as Document & { caretRangeFromPoint?: (x: number, y: number) => Range | null }).caretRangeFromPoint?.(at.x, at.y);
      const s = getSelection();
      if (pos && el.contains(pos.startContainer)) {
        s?.removeAllRanges();
        s?.addRange(pos);
      } else {
        const r = document.createRange();
        r.selectNodeContents(el);
        r.collapse(false);
        s?.removeAllRanges();
        s?.addRange(r);
      }
    }
  }, [value, rich, at]);
  useEffect(() => {
    api.current = box.current ? { el: box.current, emit, restore, rich } : null;
    return () => {
      api.current = null;
    };
  });
  useEffect(() => {
    const onSel = () => {
      const s = getSelection();
      if (box.current && s?.rangeCount && box.current.contains(s.anchorNode)) saved.current = s.getRangeAt(0).cloneRange();
    };
    document.addEventListener('selectionchange', onSel);
    return () => document.removeEventListener('selectionchange', onSel);
  }, []);
  function saveAtom(removeIt = false) {
    if (!atom) return;
    const { el, text, extra } = atom;
    if (removeIt) {
      if (el.classList.contains('ed-gloss')) el.replaceWith(document.createTextNode(el.textContent ?? ''));
      else el.remove();
    } else {
      const tpl = document.createElement('template');
      tpl.innerHTML = el.classList.contains('ed-gloss') ? glossHtml(text.trim(), extra.trim()) : noteHtml(el.dataset.kind === 'margin' ? 'margin' : 'note', text.trim());
      if (tpl.content.firstChild) el.replaceWith(tpl.content.firstChild);
    }
    emit();
    setAtom(null);
  }
  void doc;
  void ensureGlossary;
  const Tag = ov.tag as 'div';
  return (
    <div className={`${st.host} ${st.ov}`} data-ov style={{ left: ov.left, top: ov.top, width: ov.width }} onClick={(e) => e.stopPropagation()}>
      <div style={cssObj(ov.pageStyle)}>
        <div className={ov.blockClass} style={{ ...cssObj(ov.blockStyle), padding: 0, margin: 0, border: 0, background: 'none', boxShadow: 'none', outline: 0, minHeight: 0, height: 'auto' }}>
          <Tag
            ref={(e: HTMLElement | null) => {
              box.current = e;
            }}
            className={`${ov.fieldClass} ${st.ovField}`}
            style={{ ...cssObj(ov.fieldStyle), margin: 0, minHeight: ov.minHeight, width: '100%' }}
            contentEditable
            suppressContentEditableWarning
            role="textbox"
            aria-multiline={multi}
            aria-label="Text auf der Seite"
            onInput={emit}
            onKeyDown={(e) => {
              if (e.key === 'Escape') onClose();
              if (e.key === 'Enter' && !multi) e.preventDefault();
              if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'u' && rich) {
                e.preventDefault();
                document.execCommand('underline');
                emit();
              }
            }}
            onPaste={(e) => {
              e.preventDefault();
              const t = e.clipboardData.getData('text/plain');
              if (t) document.execCommand('insertText', false, multi ? t : t.replace(/\s*\n\s*/g, ' '));
              emit();
            }}
            onFocus={() => document.execCommand('defaultParagraphSeparator', false, 'p')}
            onClick={(e) => {
              const a = (e.target as HTMLElement).closest('.ed-note, .ed-gloss') as HTMLElement | null;
              if (a) setAtom(a.classList.contains('ed-gloss') ? { el: a, text: a.textContent ?? '', extra: a.dataset.explain ?? '' } : { el: a, text: a.dataset.text ?? '', extra: '' });
            }}
          />
        </div>
      </div>
      {atom && atom.el.isConnected && (
        <form
          className={st.atom}
          onSubmit={(e) => {
            e.preventDefault();
            saveAtom();
          }}
        >
          <strong>{atom.el.classList.contains('ed-gloss') ? 'Glossar' : atom.el.dataset.kind === 'margin' ? 'Randbemerkung' : 'Fußnote'}</strong>
          {atom.el.classList.contains('ed-gloss') && <input value={atom.text} onChange={(e) => setAtom({ ...atom, text: e.target.value })} aria-label="Wort" placeholder="Wort" />}
          <textarea
            autoFocus
            rows={3}
            value={atom.el.classList.contains('ed-gloss') ? atom.extra : atom.text}
            onChange={(e) => setAtom(atom.el.classList.contains('ed-gloss') ? { ...atom, extra: e.target.value } : { ...atom, text: e.target.value })}
            placeholder={atom.el.classList.contains('ed-gloss') ? 'Erklärung fürs Glossar' : atom.el.dataset.kind === 'margin' ? 'Text im Rand' : 'Text der Fußnote'}
            aria-label="Inhalt"
          />
          <div className="row">
            <button type="button" className="btn danger" onClick={() => saveAtom(true)}>
              Entfernen
            </button>
            <span className="grow" />
            <button type="button" className="btn" onClick={() => setAtom(null)}>
              Abbrechen
            </button>
            <button type="submit" className="btn primary">
              Übernehmen
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

/** style.cssText → Objekt für React */
function cssObj(css: string): React.CSSProperties {
  const o: Record<string, string> = {};
  for (const part of css.split(';')) {
    const i = part.indexOf(':');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (!k || !v) continue;
    o[k.startsWith('--') ? k : k.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())] = v;
  }
  return o as React.CSSProperties;
}

/** Bausteine für die Liste links, mit Einrückung für Spalten */
function flatOutline(blocks: Block[], depth = 0): { b: Block; depth: number }[] {
  const out: { b: Block; depth: number }[] = [];
  for (const b of blocks) {
    out.push({ b, depth });
    if (b.type === 'cols') for (const c of b.cols ?? []) out.push(...flatOutline(c, depth + 1));
  }
  return out;
}

// ---------- Menüband ----------
const withValue = (list: number[], v?: number) => (v === undefined || list.includes(v) ? list : [...list, v].sort((a, b) => a - b));
const STYLE_RESET: Partial<Block> = { fs: undefined, lh: undefined, ta: undefined, it: undefined, bd: undefined, nm: undefined, ind: undefined };
const TEXT_TYPES: BlockType[] = ['heading', 'text', 'material', 'quote', 'task', 'box', 'glossary'];

function Ribbon(props: {
  tab: Tab;
  setTab: (t: Tab) => void;
  doc: BlattDoc;
  b: Block | null;
  selCol: { id: string; k: number } | null;
  inline: React.MutableRefObject<InlineApi | null>;
  editingText: boolean;
  panel: Panel | null;
  setPanel: (p: Panel | null) => void;
  set: (p: Partial<Block>) => void;
  setPageOpt: (p: Partial<BlattDoc['page']>) => void;
  setHeader: (p: Partial<BlattDoc['page']['header']>) => void;
  add: (t: BlockType, extra?: Partial<Block>) => void;
  move: (id: string, dir: -1 | 1) => void;
  remove: (id: string) => void;
  duplicate: (id: string) => void;
  toColumns: (id: string) => void;
  unColumns: (id: string) => void;
  onImage: (f: Blob) => void;
  ensureGlossary: () => void;
  onError: (m: string) => void;
}) {
  const { tab, setTab, doc, b, inline, set } = props;
  const textBlock = !!b && TEXT_TYPES.includes(b.type);
  const s = b ? styleOf(b) : {};
  // Befehl im Text auf der Seite (Markierung bleibt, weil die Knöpfe den Fokus nicht nehmen)
  const cmd = (fn: (api: InlineApi) => void) => {
    const api = inline.current;
    if (!api) return false;
    api.restore();
    fn(api);
    api.emit();
    return true;
  };
  const exec = (c: string, v?: string) => cmd(() => document.execCommand(c, false, v));
  const selectedText = () => {
    const sel = getSelection();
    return inline.current && sel?.rangeCount && inline.current.el.contains(sel.anchorNode) ? sel.toString() : '';
  };
  const keep = (e: React.MouseEvent) => (e.target as Element).closest('button') && e.preventDefault();
  const blockTab = b ? (b.type === 'cols' ? 'Spalten' : BLOCK_LABEL[b.type]) : null;
  const P = doc.page;
  return (
    <div className={st.ribbon} onMouseDown={keep}>
      <div className={st.tabs} role="tablist">
        {(
          [
            ['start', 'Start'],
            ['insert', 'Einfügen'],
            ['sheet', 'Blatt'],
          ] as const
        ).map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={`${st.tab} ${tab === k ? st.tabOn : ''}`} onClick={() => setTab(k)}>
            {l}
          </button>
        ))}
        {blockTab && (
          <button role="tab" aria-selected={tab === 'block'} className={`${st.tab} ${st.tabCtx} ${tab === 'block' ? st.tabOn : ''}`} onClick={() => setTab('block')}>
            {blockTab}
          </button>
        )}
        <span className="grow" />
        {(
          [
            ['search', '🔍 Suchen'],
            ['material', 'Material'],
            ['glossary', 'Glossar'],
          ] as const
        ).map(([k, l]) => (
          <button key={k} className={`${st.tab} ${props.panel === k ? st.tabOn : ''}`} onClick={() => props.setPanel(props.panel === k ? null : k)} title="Seitenleiste rechts ein- und ausblenden">
            {l}
          </button>
        ))}
      </div>
      <div className={st.groups}>
        {tab === 'start' && (
          <>
            <Group label="Schrift">
              <button className={`btn ${s.bd ? 'on' : ''}`} disabled={!textBlock} onClick={() => exec('bold') || set({ bd: !s.bd })} title="Fett (Strg+B); ohne Markierung der ganze Baustein">
                <b>F</b>
              </button>
              <button className={`btn ${s.it ? 'on' : ''}`} disabled={!textBlock} onClick={() => exec('italic') || set({ it: !s.it })} title="Kursiv (Strg+I); ohne Markierung der ganze Baustein">
                <i>K</i>
              </button>
              <button className="btn" disabled={!props.editingText} onClick={() => exec('underline')} title="Unterstrichen (Strg+U)">
                <u>U</u>
              </button>
              <button
                className="btn"
                disabled={!props.editingText}
                title="Textmarker"
                onClick={() =>
                  cmd(() => {
                    const sel = getSelection();
                    const r = sel?.rangeCount ? sel.getRangeAt(0) : null;
                    if (!r || r.collapsed) return;
                    const m = r.startContainer.parentElement?.closest('mark');
                    if (m) m.replaceWith(...m.childNodes);
                    else {
                      const mk = document.createElement('mark');
                      mk.appendChild(r.extractContents());
                      r.insertNode(mk);
                    }
                  })
                }
              >
                <mark style={{ background: '#fff176', padding: '0 3px' }}>M</mark>
              </button>
              <select value={s.fs ?? 100} disabled={!textBlock} onChange={(e) => set({ fs: Number(e.target.value) })} title="Schriftgröße des Bausteins" aria-label="Schriftgröße">
                {withValue([80, 85, 90, 100, 110, 120, 140], s.fs).map((v) => (
                  <option key={v} value={v}>
                    {v} %
                  </option>
                ))}
              </select>
            </Group>
            <Group label="Absatz">
              <button className="btn" disabled={!props.editingText} onClick={() => exec('insertUnorderedList')} title="Liste mit Punkten">
                • Liste
              </button>
              <button className="btn" disabled={!props.editingText} onClick={() => exec('insertOrderedList')} title="Nummerierte Liste">
                1. Liste
              </button>
              <span className="seg">
                {(
                  [
                    ['left', '⯇', 'linksbündig'],
                    ['justify', '☰', 'Blocksatz'],
                    ['center', '≡', 'zentriert'],
                    ['right', '⯈', 'rechtsbündig'],
                  ] as const
                ).map(([v, l, t]) => (
                  <button key={v} className={`btn ${(s.ta ?? 'left') === v && textBlock ? 'on' : ''}`} disabled={!textBlock} onClick={() => set({ ta: v })} title={t}>
                    {l}
                  </button>
                ))}
              </span>
              <button className="btn" disabled={!textBlock || !(s.ind ?? 0)} onClick={() => set({ ind: Math.max(0, (s.ind ?? 0) - 5) })} title="Einzug verkleinern">
                ⇤
              </button>
              <button className="btn" disabled={!textBlock} onClick={() => set({ ind: Math.min(40, (s.ind ?? 0) + 5) })} title="Einzug vergrößern (5 mm)">
                ⇥
              </button>
              <select value={s.lh ?? 1.35} disabled={!textBlock} onChange={(e) => set({ lh: Number(e.target.value) })} title="Zeilenabstand" aria-label="Zeilenabstand">
                {withValue([1.15, 1.25, 1.35, 1.45, 1.6, 1.8, 2, 2.4], s.lh ?? 1.35).map((v) => (
                  <option key={v} value={v}>
                    Zeilen {String(v).replace('.', ',')}
                  </option>
                ))}
              </select>
            </Group>
            <Group label="Rand">
              <select value={s.nm ?? 0} disabled={!textBlock} onChange={(e) => set({ nm: Number(e.target.value) })} title="Freier Rand rechts für Notizen; Randbemerkungen stehen dort" aria-label="Rand für Notizen">
                <option value={0}>kein Rand für Notizen</option>
                {withValue([20, 30, 40, 50], s.nm || undefined).map((v) => (
                  <option key={v} value={v}>
                    Rand für Notizen {String(v / 10).replace('.', ',')} cm
                  </option>
                ))}
              </select>
            </Group>
            <Group label="Im Text">
              <button className="btn" disabled={!props.editingText || !inline.current?.rich} onClick={() => exec('insertHTML', noteHtml('note', 'Fußnote'))} title="Nummerierte Fußnote unten auf der Seite; antippen zum Ändern">
                Fußnote
              </button>
              <button className="btn" disabled={!props.editingText || !inline.current?.rich} onClick={() => exec('insertHTML', noteHtml('margin', 'Bemerkung'))} title="Bemerkung im Rand neben der Zeile">
                Randbemerkung
              </button>
              <button
                className="btn"
                disabled={!props.editingText || !inline.current?.rich}
                title="Markiertes Wort ins Glossar"
                onClick={() => {
                  const w = selectedText().trim();
                  if (!w) return props.onError('Erst im Text ein Wort markieren, dann „Glossar“.');
                  props.onError('');
                  const known = glossaryTerms(doc).find((t) => t.word.toLowerCase() === w.toLowerCase());
                  exec('insertHTML', glossHtml(w, known?.explain ?? ''));
                  props.ensureGlossary();
                }}
              >
                Glossar
              </button>
            </Group>
            <Group label="Vorlage">
              {b && TEMPLATES[b.type] ? (
                <select value={b.tpl ?? TEMPLATES[b.type]![0].id} onChange={(e) => set({ tpl: e.target.value, ...STYLE_RESET, ...(b.type === 'material' ? { justify: undefined } : {}) })} aria-label="Vorlage">
                  {TEMPLATES[b.type]!.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.label}
                    </option>
                  ))}
                </select>
              ) : (
                <span className={st.hint}>{b ? 'keine Vorlagen' : 'Baustein anklicken'}</span>
              )}
              <button className="btn" disabled={!textBlock} onClick={() => set({ ...STYLE_RESET, ...(b?.type === 'material' ? { justify: undefined } : {}) })} title="Eigene Gestaltung entfernen">
                Wie Vorlage
              </button>
            </Group>
          </>
        )}
        {tab === 'insert' && (
          <>
            <Group label={props.selCol ? 'In die gewählte Spalte' : b ? 'Nach dem gewählten Baustein' : 'Am Ende'}>
              {ADD.map((t) => (
                <button key={t} className={`btn ${st.big}`} onClick={() => props.add(t)} title={BLOCK_LABEL[t]}>
                  <span>{ICON[t]}</span>
                  {BLOCK_LABEL[t]}
                </button>
              ))}
              <button className={`btn ${st.big}`} onClick={() => props.add('task', { subtask: true })} title="Teilaufgabe: a), b) … oder 1.1, 1.2 …">
                <span>✎ₐ</span>
                Teilaufgabe
              </button>
            </Group>
            <Group label="Spalten">
              {(
                [
                  [[1, 1], '▥ zwei gleich'],
                  [[2, 1], '▥ breit | schmal'],
                  [[1, 2], '▥ schmal | breit'],
                  [[1, 1, 1], '▦ drei'],
                ] as const
              ).map(([r, l]) => (
                <button key={l} className="btn" onClick={() => props.add('cols', { ratio: [...r], cols: r.map(() => []) })} title="Spalten einfügen; in eine leere Spalte klicken, dann Baustein einfügen">
                  {l}
                </button>
              ))}
            </Group>
          </>
        )}
        {tab === 'sheet' && (
          <>
            <Group label="Format">
              <select value={P.size} onChange={(e) => props.setPageOpt({ size: e.target.value as 'a4' | 'a5' })} aria-label="Seitengröße">
                <option value="a4">A4</option>
                <option value="a5">A5</option>
              </select>
              <select
                value={`${P.font}-${P.fontSize}`}
                onChange={(e) => {
                  const [font, size] = e.target.value.split('-');
                  props.setPageOpt({ font: font as 'sans' | 'serif', fontSize: Number(size) });
                }}
                aria-label="Schrift"
              >
                {(['sans', 'serif'] as const).flatMap((f) =>
                  [10, 11, 12].map((z) => (
                    <option key={f + z} value={`${f}-${z}`}>
                      {f === 'sans' ? 'Ohne Serifen' : 'Mit Serifen'} {z} pt
                    </option>
                  )),
                )}
              </select>
              <label className={st.check}>
                <input type="checkbox" checked={P.pageNumbers} onChange={(e) => props.setPageOpt({ pageNumbers: e.target.checked })} /> Seitenzahlen
              </label>
            </Group>
            <Group label="Broschüre">
              <label className={st.check}>
                <input type="checkbox" checked={P.booklet} onChange={(e) => props.setPageOpt({ booklet: e.target.checked })} /> als Broschüre ({P.size === 'a5' ? 'A4 quer' : 'A3 quer'})
              </label>
              {P.booklet && (
                <select value={P.fill} onChange={(e) => props.setPageOpt({ fill: e.target.value as Ruling })} aria-label="Leere Seiten füllen mit">
                  <option value="lines">leere Seiten: Schreiblinien</option>
                  <option value="grid">leere Seiten: Karos</option>
                  <option value="empty">leere Seiten: nichts</option>
                </select>
              )}
            </Group>
            <Group label="Korrekturrand">
              <select value={P.korr.side} onChange={(e) => props.setPageOpt({ korr: { ...P.korr, side: e.target.value as Korr['side'] } })} aria-label="Korrekturrand">
                <option value="none">kein Korrekturrand</option>
                <option value="right">rechts</option>
                <option value="left">links</option>
              </select>
              {P.korr.side !== 'none' && (
                <>
                  <select value={P.korr.width} onChange={(e) => props.setPageOpt({ korr: { ...P.korr, width: Number(e.target.value) } })} aria-label="Breite">
                    {[20, 25, 30, 40, 50].map((v) => (
                      <option key={v} value={v}>
                        {String(v / 10).replace('.', ',')} cm
                      </option>
                    ))}
                  </select>
                  <span className="seg">
                    {(
                      [
                        ['thin', 'dünn'],
                        ['medium', 'mittel'],
                        ['thick', 'dick'],
                        ['end', 'Zeilen enden'],
                      ] as const
                    ).map(([v, l]) => (
                      <button key={v} className={`btn ${P.korr.style === v ? 'on' : ''}`} onClick={() => props.setPageOpt({ korr: { ...P.korr, style: v } })}>
                        {l}
                      </button>
                    ))}
                  </span>
                </>
              )}
            </Group>
            <Group label="Kopfzeile">
              <label className={st.check}>
                <input type="checkbox" checked={P.header.show} onChange={(e) => props.setHeader({ show: e.target.checked })} /> Kopfzeile
              </label>
              {P.header.show && (
                <>
                  <input className={st.rIn} value={P.header.text} onChange={(e) => props.setHeader({ text: e.target.value })} placeholder="z. B. Klausur S 4" aria-label="Text der Kopfzeile" />
                  <label className={st.check}>
                    <input type="checkbox" checked={P.header.nameLine} onChange={(e) => props.setHeader({ nameLine: e.target.checked })} /> Name
                  </label>
                  <label className={st.check}>
                    <input type="checkbox" checked={P.header.date} onChange={(e) => props.setHeader({ date: e.target.checked })} /> Datum
                  </label>
                </>
              )}
              <select value={P.header.qr} onChange={(e) => props.setHeader({ qr: e.target.value as 'first' | 'all' | 'none', show: e.target.value !== 'none' || P.header.show })} aria-label="QR-Code für Autogra.fi">
                <option value="none">kein QR-Code</option>
                <option value="first">QR-Code auf Seite 1</option>
                <option value="all">QR-Code auf jeder Seite</option>
              </select>
            </Group>
            <Group label="Teilaufgaben">
              <select value={P.sub ?? 'letter'} onChange={(e) => props.setPageOpt({ sub: e.target.value as 'letter' | 'dot' })} aria-label="Nummern der Teilaufgaben">
                <option value="letter">a), b), c) …</option>
                <option value="dot">1.1, 1.2, 1.3 …</option>
              </select>
            </Group>
          </>
        )}
        {tab === 'block' && b && <BlockTab {...props} b={b} />}
        {tab === 'block' && !b && <span className={st.hint}>Klick auf einen Baustein auf der Seite.</span>}
      </div>
    </div>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className={st.group}>
      <div className={st.groupBody}>{children}</div>
      <div className={st.groupLabel}>{label}</div>
    </div>
  );
}

function BlockTab(props: Parameters<typeof Ribbon>[0] & { b: Block }) {
  const { b, set, doc } = props;
  const labels = taskLabels(doc);
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  async function rotate(dir: 1 | -1) {
    let ar = b.ar;
    if (!ar && b.src) ar = await new Promise<number>((res) => {
      const i = new Image();
      i.onload = () => res(i.naturalHeight / Math.max(1, i.naturalWidth));
      i.onerror = () => res(1);
      i.src = b.src!;
    });
    set({ rot: ((((Number(b.rot) || 0) + dir * 90) % 360) + 360) % 360, ar });
  }
  /** Bild von einer Adresse im Netz: der Server holt es (fremde Seiten geben Bilder dem Browser oft nicht heraus) */
  async function fromUrl() {
    const u = url.trim();
    if (!/^https?:\/\/\S+$/.test(u)) return props.onError('Bitte die vollständige Adresse des Bilds eingeben (beginnt mit https://).');
    props.onError('');
    setLoading(true);
    try {
      const res = await fetch(href(`/api/bild-holen?url=${encodeURIComponent(u)}`), { credentials: 'include' });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string; page?: boolean };
        throw new Error(j.page ? 'Unter dieser Adresse liegt eine Webseite, kein Bild. Rechtsklick auf das Bild, „Bildadresse kopieren“, und hier einsetzen.' : (j.error ?? `Fehler ${res.status}`));
      }
      props.onImage(await res.blob());
      if (!b.caption) {
        const info = await fetch(href(`/api/bild-info?url=${encodeURIComponent(u)}`), { credentials: 'include' })
          .then((r) => (r.ok ? (r.json() as Promise<{ title?: string; credit?: string; license?: string }>) : null))
          .catch(() => null);
        const credit = [info?.credit, info?.license].filter(Boolean).join(', ');
        set({ caption: [info?.title, credit && `(${credit})`].filter(Boolean).join(' ') || `Quelle: ${new URL(u).hostname}` });
      }
      setUrl('');
    } catch (e) {
      props.onError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }
  const ruling = (value: Ruling | undefined, onChange: (r: Ruling) => void, withEmpty = true) => (
    <select value={value ?? 'lines'} onChange={(e) => onChange(e.target.value as Ruling)} aria-label="Art der Linien">
      <option value="lines">Schreiblinien</option>
      <option value="grid">Karos (Mathe)</option>
      {withEmpty && <option value="empty">Freiraum</option>}
    </select>
  );
  const inCols = !!listOf(doc.blocks, b.id)?.parent;
  return (
    <>
      {b.type === 'heading' && (
        <Group label="Überschrift">
          <select value={b.level ?? 2} onChange={(e) => set({ level: Number(e.target.value) as 1 | 2 })} aria-label="Art">
            <option value={1}>groß</option>
            <option value={2}>unterstrichen</option>
          </select>
        </Group>
      )}
      {b.type === 'material' && (
        <Group label="Material">
          <input className={st.rIn} value={b.label ?? ''} onChange={(e) => set({ label: e.target.value })} placeholder="Material 1 (automatisch)" aria-label="Bezeichnung" style={{ width: 150 }} />
          <label className={st.check}>
            <input type="checkbox" checked={b.lineNumbers !== false} onChange={(e) => set({ lineNumbers: e.target.checked })} /> Zeilen zählen
          </label>
          <input className={st.rIn} value={b.source ?? ''} onChange={(e) => set({ source: e.target.value })} placeholder="Quelle (Fußnote)" aria-label="Quelle" style={{ width: 220 }} />
        </Group>
      )}
      {b.type === 'task' && (
        <>
          <Group label="Nummer">
            <label className={st.check}>
              <input type="checkbox" checked={!!b.subtask} onChange={(e) => set({ subtask: e.target.checked })} /> Teilaufgabe
            </label>
            <input className={st.rIn} value={b.num ?? ''} onChange={(e) => set({ num: e.target.value })} placeholder={`automatisch: ${labels.get(b.id) ?? ''}`} aria-label="Eigene Nummer" title="Eigene Nummer, z. B. 1.2 oder 1 b); leer = automatisch" style={{ width: 130 }} />
          </Group>
          <Group label="Bewertung">
            <input className={st.rIn} value={b.points ?? ''} onChange={(e) => set({ points: e.target.value })} placeholder="z. B. 12 P. oder 50%" aria-label="Punkte oder Anteil" style={{ width: 130 }} />
          </Group>
          <Group label="Antwortzeilen">
            <input className={st.rIn} type="number" min={0} max={40} value={b.lines ?? 0} onChange={(e) => set({ lines: Math.max(0, Math.min(40, Number(e.target.value) || 0)) })} aria-label="Antwortzeilen" style={{ width: 64 }} />
            {(b.lines ?? 0) > 0 && ruling(b.lineStyle, (r) => set({ lineStyle: r }), false)}
          </Group>
        </>
      )}
      {b.type === 'image' && (
        <>
          <Group label="Bild">
            <label className="btn">
              {b.src ? 'Anderes Bild …' : 'Bild auswählen …'}
              <input type="file" accept="image/*" hidden onChange={(e) => (e.target.files?.[0] && props.onImage(e.target.files[0]), (e.target.value = ''))} />
            </label>
            <button className="btn" onClick={() => props.setPanel('material')}>
              Aus dem Material
            </button>
            <form
              className={st.urlRow}
              onSubmit={(e) => {
                e.preventDefault();
                void fromUrl();
              }}
            >
              <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Adresse: https://…" aria-label="Adresse des Bilds im Netz" />
              <button type="submit" className="btn" disabled={loading || !url.trim()}>
                {loading ? 'Lädt …' : 'Laden'}
              </button>
            </form>
          </Group>
          <Group label="Größe und Lage">
            <input type="range" min={20} max={100} step={5} value={b.width ?? 100} onChange={(e) => set({ width: Number(e.target.value) })} aria-label="Breite" title={`Breite ${b.width ?? 100} %`} />
            <span className={st.hint}>{b.width ?? 100} %</span>
            {!b.free && (
              <span className="seg">
                {(
                  [
                    ['left', 'links'],
                    ['center', 'Mitte'],
                    ['right', 'rechts'],
                  ] as const
                ).map(([v, l]) => (
                  <button key={v} className={`btn ${(b.align ?? 'center') === v ? 'on' : ''}`} onClick={() => set({ align: v })}>
                    {l}
                  </button>
                ))}
              </span>
            )}
            <button className="btn" disabled={!b.src} onClick={() => void rotate(-1)} title="Um 90° nach links drehen">
              ⟲
            </button>
            <button className="btn" disabled={!b.src} onClick={() => void rotate(1)} title="Um 90° nach rechts drehen">
              ⟳
            </button>
            {b.free ? (
              <>
                <label className={st.check} title="Das Bild liegt über dem Text; der Text rückt an seinen Platz nach">
                  <input type="checkbox" checked={!!b.over} onChange={(e) => set({ over: e.target.checked })} /> vor dem Text
                </label>
                <button className="btn" onClick={() => set({ free: false, over: false, dx: undefined, dy: undefined })} title="Bild wieder an seinen Platz im Text setzen">
                  An seinen Platz
                </button>
              </>
            ) : (
              <span className={st.hint}>Ziehen verschiebt das Bild.</span>
            )}
          </Group>
        </>
      )}
      {b.type === 'glossary' && (
        <Group label="Glossar">
          <select value={b.sort ?? 'alpha'} onChange={(e) => set({ sort: e.target.value as Block['sort'] })} aria-label="Reihenfolge">
            <option value="alpha">nach dem Alphabet</option>
            <option value="order">wie im Text</option>
          </select>
          <select value={b.mark ?? 'star'} onChange={(e) => set({ mark: e.target.value as Block['mark'] })} aria-label="Markierung im Text">
            <option value="star">im Text: Sternchen*</option>
            <option value="arrow">im Text: → Pfeil</option>
            <option value="bold">im Text: fett</option>
            <option value="none">im Text: nichts</option>
          </select>
          <button className="btn" onClick={() => props.setPanel('glossary')}>
            Erklärungen bearbeiten
          </button>
        </Group>
      )}
      {b.type === 'cols' && (
        <Group label="Spalten">
          <select
            value={(b.ratio ?? [1, 1]).join(':')}
            onChange={(e) => {
              const r = e.target.value.split(':').map(Number);
              const cols = [...(b.cols ?? [])];
              while (cols.length < r.length) cols.push([]);
              // überzählige Spalten: Inhalt in die letzte übrige
              while (cols.length > r.length) cols[r.length - 1] = [...cols[r.length - 1], ...cols.pop()!];
              set({ ratio: r, cols });
            }}
            aria-label="Aufteilung"
          >
            <option value="1:1">zwei gleich breit</option>
            <option value="2:1">breit | schmal</option>
            <option value="1:2">schmal | breit</option>
            <option value="3:2">3 : 2</option>
            <option value="1:1:1">drei gleich breit</option>
          </select>
          <button className="btn" onClick={() => props.unColumns(b.id)} title="Bausteine wieder untereinander setzen">
            Spalten auflösen
          </button>
        </Group>
      )}
      {b.type === 'lines' && (
        <Group label="Linien">
          {ruling(b.style, (r) => set({ style: r }))}
          <label className={st.check}>
            <input type="checkbox" checked={!!b.fill} onChange={(e) => set({ fill: e.target.checked })} /> bis Seitenende
          </label>
          {!b.fill && <input className={st.rIn} type="number" min={1} max={60} value={b.count ?? 8} onChange={(e) => set({ count: Math.max(1, Math.min(60, Number(e.target.value) || 1)) })} aria-label="Anzahl Zeilen" style={{ width: 64 }} />}
          {b.style !== 'grid' && b.style !== 'empty' && (
            <select value={b.spacing ?? 8} onChange={(e) => set({ spacing: Number(e.target.value) })} aria-label="Zeilenabstand">
              {[6, 7, 8, 9, 10, 12].map((v) => (
                <option key={v} value={v}>
                  Abstand {v} mm
                </option>
              ))}
            </select>
          )}
          {b.style !== 'empty' && doc.page.korr.side !== 'none' && (
            <label className={st.check}>
              <input type="checkbox" checked={!b.korrOff} onChange={(e) => set({ korrOff: !e.target.checked })} /> Korrekturrand
            </label>
          )}
        </Group>
      )}
      {b.type === 'pagebreak' && (
        <Group label="Seitenumbruch">
          <span className={st.hint}>Der nächste Baustein beginnt auf einer neuen Seite.</span>
        </Group>
      )}
      <Group label="Anordnen">
        <button className="btn" onClick={() => props.move(b.id, -1)} title="nach oben">
          ↑
        </button>
        <button className="btn" onClick={() => props.move(b.id, 1)} title="nach unten">
          ↓
        </button>
        <button className="btn" onClick={() => props.duplicate(b.id)} title="verdoppeln">
          ⧉
        </button>
        {b.type !== 'cols' && !inCols && (
          <button className="btn" onClick={() => props.toColumns(b.id)} title="Diesen und den nächsten Baustein nebeneinander setzen">
            ▥ neben den nächsten
          </button>
        )}
        <button className="btn danger" onClick={() => props.remove(b.id)} title="entfernen (Entf)">
          ✕ Entfernen
        </button>
      </Group>
    </>
  );
}

// ---------- Seitenleiste rechts: suchen, Material, Glossar ----------
function SidePanel({
  panel,
  setPanel,
  doc,
  projectId,
  onPick,
  add,
  onImage,
  onTerm,
}: {
  panel: Panel;
  setPanel: (p: Panel | null) => void;
  doc: BlattDoc;
  projectId: number;
  onPick: (bid: string) => void;
  add: (t: BlockType, extra?: Partial<Block>) => void;
  onImage: (f: Blob, caption?: string) => void;
  onTerm: (word: string, explain: string | null) => void;
}) {
  const [q, setQ] = useState('');
  const [mats, setMats] = useState<Material[] | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    if ((panel === 'material' || panel === 'search') && mats === null)
      get<{ materials: Material[] }>(`/api/projects/${projectId}/materials`).then(
        (r) => setMats(r.materials),
        (e) => setErr(e instanceof ApiError ? e.message : String(e)),
      );
  }, [panel, mats, projectId]);
  const needle = q.trim().toLowerCase();
  const hits = needle ? walk(doc.blocks).filter((b) => [BLOCK_LABEL[b.type], blockSummary(b), plainMd(b.md ?? ''), b.caption ?? '', b.source ?? '', b.text ?? ''].join(' ').toLowerCase().includes(needle)) : [];
  const types = needle ? ADD.filter((t) => BLOCK_LABEL[t].toLowerCase().includes(needle)) : [];
  const matHits = (mats ?? []).filter((m) => (m.kind === 'page' || (m.mime ?? '').startsWith('image/')) && (!needle || m.title.toLowerCase().includes(needle)));
  async function takeImage(m: Material) {
    const res = await fetch(fileUrl(projectId, m.id), { credentials: 'include' });
    if (!res.ok) return setErr('Bild nicht erreichbar');
    onImage(await res.blob(), m.title);
  }
  async function takePage(m: Material) {
    try {
      const r = await get<{ page: { body: string; title: string } }>(`/api/projects/${projectId}/materials/${m.id}`);
      // Lernseite: Absätze (Leerzeile) werden Zeilen, Bilder und Videos bleiben draußen
      const md = r.page.body
        .split(/\n{2,}/)
        .map((p) => p.replace(/\s*\n\s*/g, ' ').trim())
        .filter((p) => p && !/^!\[|^https?:\/\/\S+$/.test(p))
        .join('\n');
      add('material', { title: r.page.title, md, source: '' });
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : String(e));
    }
  }
  const terms = glossaryTerms(doc);
  const matList = (list: Material[]) => (
    <div className={st.matList}>
      {list.map((m) =>
        (m.mime ?? '').startsWith('image/') ? (
          <button key={m.id} className={st.matImg} onClick={() => void takeImage(m)} title={`Bild einsetzen: ${m.title}`}>
            <img src={fileUrl(projectId, m.id)} alt={m.title} />
            <span>{m.title}</span>
          </button>
        ) : (
          <button key={m.id} className={st.matPage} onClick={() => void takePage(m)} title="Als Material-Baustein übernehmen">
            ❝ {m.title}
          </button>
        ),
      )}
    </div>
  );
  return (
    <section className={st.sec}>
      <div className="row">
        <div className="seg" role="group" aria-label="Seitenleiste">
          {(
            [
              ['search', 'Suchen'],
              ['material', 'Material'],
              ['glossary', 'Glossar'],
            ] as const
          ).map(([k, l]) => (
            <button key={k} className={`btn ${panel === k ? 'on' : ''}`} onClick={() => setPanel(k)}>
              {l}
            </button>
          ))}
        </div>
        <span className="grow" />
        <button className="btn" onClick={() => setPanel(null)} title="Seitenleiste schließen">
          ✕
        </button>
      </div>
      {err && <div className="error">{err}</div>}
      {panel !== 'glossary' && <input className={st.titleIn} style={{ fontSize: 14, fontWeight: 400 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder={panel === 'search' ? 'Suchen: Text, Baustein, Material …' : 'Material filtern …'} autoFocus />}
      {panel === 'search' && (
        <>
          {!needle && <p className={st.hint}>Sucht im Blatt, unter den Bausteinen und im Material dieses Projekts.</p>}
          {needle && (
            <>
              <div className={st.secHead}>Auf diesem Blatt ({hits.length})</div>
              {hits.map((b) => (
                <button key={b.id} className={st.hit} onClick={() => onPick(b.id)}>
                  <b>{ICON[b.type]} {BLOCK_LABEL[b.type]}</b> {blockSummary(b).slice(0, 90)}
                </button>
              ))}
              {types.length > 0 && <div className={st.secHead}>Einfügen</div>}
              {types.map((t) => (
                <button key={t} className={st.hit} onClick={() => add(t)}>
                  + {ICON[t]} {BLOCK_LABEL[t]}
                </button>
              ))}
              <div className={st.secHead}>Material ({matHits.length})</div>
              {matList(matHits)}
            </>
          )}
        </>
      )}
      {panel === 'material' && (
        <>
          <p className={st.hint}>Bilder und Lernseiten aus dem Material dieses Projekts. Ein Klick setzt sie ein (ein Bild in den gewählten Bild-Baustein).</p>
          {mats === null ? <p className={st.hint}>Lädt …</p> : matHits.length ? matList(matHits) : <p className={st.hint}>Kein passendes Material. Bilder lädst du unter „Materialien“ hoch oder ziehst sie direkt auf die Seite.</p>}
        </>
      )}
      {panel === 'glossary' && (
        <>
          {!terms.length && <p className={st.hint}>Noch keine Wörter. Markiere auf der Seite ein Wort und wähle im Menüband „Glossar“.</p>}
          {terms.map((t) => (
            <div className="field" key={t.word}>
              <label className="row">
                <strong>{t.word}</strong>
                <span className="grow" />
                <button type="button" className="btn" style={{ height: 22, fontSize: 11.5 }} onClick={() => onTerm(t.word, null)} title="Aus dem Glossar nehmen (das Wort bleibt im Text)">
                  ✕
                </button>
              </label>
              <textarea className={st.term} rows={2} value={t.explain} onChange={(e) => onTerm(t.word, e.target.value.replace(/[{}\n]/g, ' '))} placeholder="Erklärung" />
            </div>
          ))}
        </>
      )}
    </section>
  );
}

// ---------- Drucken ----------
interface AgAssessment {
  id: number;
  context_id: number;
  title: string;
  class: string;
  status: string;
}
interface AgClass {
  id: number;
  title: string;
}
interface AgStudent {
  id: number;
  name: string;
}

/**
 * Autogra.fi im selben Browser ansprechen: gleiche Adresse (gleicher Server), Anmeldung per Cookie von Autogra.fi,
 * Schutz gegen fremde Seiten über den Kopf X-Autografi-Request.
 */
async function ag<T>(base: string, method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(base + path, {
    method,
    credentials: 'include',
    headers: { 'X-Autografi-Request': '1', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const j = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
  if (!res.ok) throw new ApiError(j.error?.message ?? `Autogra.fi antwortet mit Fehler ${res.status}`, res.status);
  return j as T;
}

function PrintDialog({ doc, title, onClose }: { doc: BlattDoc; title: string; onClose: () => void }) {
  const [mode, setMode] = useState<'one' | 'ag'>(doc.page.header.qr !== 'none' ? 'ag' : 'one');
  const [agUrl, setAgUrl] = useState('');
  const [agState, setAgState] = useState<'idle' | 'loading' | 'login' | 'ready' | 'error'>('idle');
  const [agMsg, setAgMsg] = useState('');
  const [tasks, setTasks] = useState<AgAssessment[]>([]);
  const [classes, setClasses] = useState<AgClass[]>([]);
  const [parents, setParents] = useState<AgClass[]>([]);
  const [task, setTask] = useState<number | null>(null);
  // neue Aufgabe in Autogra.fi direkt von hier (Wunsch Jo, 22. November 2026)
  const [creating, setCreating] = useState(false);
  const [newClass, setNewClass] = useState<number | 'neu'>('neu');
  const [newClassName, setNewClassName] = useState('');
  const [newTitle, setNewTitle] = useState(title);
  const [newDue, setNewDue] = useState('');
  const [newMode, setNewMode] = useState<'summative' | 'formative'>('summative');
  // Personen ergänzen: Namen oder eine Zahl nummerierter Plätze („Abgabe 1“ …)
  const [addTab, setAddTab] = useState<'names' | 'count'>('names');
  const [addNames, setAddNames] = useState('');
  const [addCount, setAddCount] = useState(0);
  // Aufgabentext nach Autogra.fi (Grundlage für Erwartungshorizont und KI-Bewertung)
  const [sendText, setSendText] = useState(true);
  const [taskText, setTaskText] = useState<string | null>(null);
  const [sent, setSent] = useState('');
  const [students, setStudents] = useState<AgStudent[]>([]);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [printName, setPrintName] = useState(true);
  const [valid, setValid] = useState('freigabe');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const sheet = sheetSize(doc);

  useEffect(() => {
    let stored = '';
    try {
      stored = localStorage.getItem('collegare-autografi-url') ?? '';
    } catch {}
    get<{ url: string | null }>('/api/autografi').then(
      (r) => setAgUrl(stored || r.url || `${location.origin}/autografi`),
      () => setAgUrl(stored || `${location.origin}/autografi`),
    );
  }, []);

  const loadTasks = useCallback(async () => {
    const base = agUrl.replace(/\/+$/, '');
    if (!base) return;
    setAgState('loading');
    setAgMsg('');
    try {
      const r = await ag<{ teacher: boolean; assessments: AgAssessment[]; classes: AgClass[]; parents: AgClass[] }>(base, 'GET', '/api/v1/portal');
      if (!r.teacher) {
        setAgState('login');
        setAgMsg('In Autogra.fi bist du nicht als Lehrkraft angemeldet.');
        return;
      }
      setTasks(r.assessments);
      setClasses(r.classes ?? []);
      setParents(r.parents ?? []);
      setNewClass((r.classes ?? [])[0]?.id ?? 'neu');
      if (!r.assessments.length) setCreating(true);
      setAgState('ready');
      try {
        localStorage.setItem('collegare-autografi-url', base);
      } catch {}
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        setAgState('login');
        setAgMsg('Bitte melde dich in Autogra.fi an (neuer Tab) und versuch es dann noch einmal.');
      } else {
        setAgState('error');
        setAgMsg(e instanceof ApiError && e.status !== 404 ? e.message : 'Unter dieser Adresse ist kein Autogra.fi zu erreichen. Bitte die Adresse prüfen (gleicher Server wie Collegare).');
      }
    }
  }, [agUrl]);
  useEffect(() => {
    if (mode === 'ag' && agUrl && agState === 'idle') void loadTasks();
  }, [mode, agUrl, agState, loadTasks]);

  const base = agUrl.replace(/\/+$/, '');
  async function pickTask(aid: number, keep?: Set<number>) {
    setTask(aid);
    setCreating(false);
    setErr('');
    try {
      const r = await ag<{ assessment: { pseudonymized: boolean }; students: AgStudent[] }>(base, 'GET', `/api/v1/assessments/${aid}/access-codes`);
      setStudents(r.students);
      setPicked(keep ?? new Set(r.students.map((s) => s.id)));
      setPrintName(!r.assessment.pseudonymized);
      if (!keep) {
        setSent('');
        // vorhandener Aufgabentext: nur überschreiben, wenn er leer ist oder schon von diesem Blatt stammt
        const st = await ag<{ assessment: { status: string; items: { body_md: string }[] } }>(base, 'GET', `/api/v1/assessments/${aid}/settings`).catch(() => null);
        const body = st?.assessment.items[0]?.body_md ?? '';
        setTaskText(body);
        setSendText(st?.assessment.status !== 'released' && (!body.trim() || body.trim() === toMarkdown(doc).trim()));
      }
      return r.students;
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : String(e));
      return [];
    }
  }

  /** Neue Aufgabe in Autogra.fi anlegen (bei Bedarf mit neuer Klasse), wie „Neue Aufgabe + QR-Codes“ im Portal. */
  async function createTask() {
    setErr('');
    setBusy(true);
    try {
      let ctx = newClass;
      if (ctx === 'neu') {
        if (!newClassName.trim()) throw new Error('Bitte einen Namen für die Klasse eingeben.');
        if (!parents.length) throw new Error('Du darfst in Autogra.fi keine Klassen anlegen. Bitte eine vorhandene Klasse wählen.');
        const c = await ag<{ id: number }>(base, 'POST', '/api/v1/portal/classes', { parent_id: parents[0].id, title: newClassName.trim() });
        ctx = c.id;
      }
      const t = await ag<{ id: number }>(base, 'POST', '/api/v1/portal/tasks', {
        context_id: ctx,
        title: newTitle.trim() || title || 'Klassenarbeit',
        mode: newMode,
        due: newDue ? new Date(newDue).toISOString() : '',
      });
      await loadTasks();
      await pickTask(t.id);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  /**
   * Text des Blatts als Aufgabenstellung in die Aufgabe von Autogra.fi schreiben (erste Teilaufgabe). Erwartungshorizont
   * bleibt; Teilaufgaben mit Punkten kommen nur dazu, wenn dort noch keine stehen.
   */
  async function sendToAutografi(aid: number) {
    const st = await ag<{ assessment: { revision: number; items: { task_id: number; title: string; body_md: string; horizon_md: string; criteria: { key: string; label: string; max_points: number }[]; scored: boolean }[] } }>(
      base,
      'GET',
      `/api/v1/assessments/${aid}/settings`,
    );
    const items = st.assessment.items.map((it) => ({ task_id: it.task_id, title: it.title, body_md: it.body_md, horizon_md: it.horizon_md, criteria: it.criteria, scored: it.scored }));
    if (!items.length) throw new Error('Die Aufgabe in Autogra.fi hat keine Teilaufgabe.');
    const crit = items[0].criteria.length ? items[0].criteria : toCriteria(doc);
    items[0] = { ...items[0], title: title.trim() || items[0].title, body_md: toMarkdown(doc), criteria: crit };
    await ag(base, 'PATCH', `/api/v1/assessments/${aid}`, { revision: st.assessment.revision, items });
    setTaskText(items[0].body_md);
    setSent('Der Text des Blatts steht jetzt als Aufgabenstellung in Autogra.fi.');
  }

  /** Namen oder nummerierte Plätze in die Klasse der Aufgabe eintragen; die neuen werden gleich angehakt. */
  async function addPeople() {
    const a = tasks.find((x) => x.id === task);
    if (!a) return;
    let names: string[];
    if (addTab === 'names') names = addNames.split(/\n|;/).map((n) => n.trim()).filter(Boolean);
    else {
      let max = 0;
      for (const s of students) {
        const m = /^Abgabe (\d+)$/.exec(s.name);
        if (m) max = Math.max(max, Number(m[1]));
      }
      names = Array.from({ length: Math.max(0, Math.min(200, addCount)) }, (_, i) => `Abgabe ${max + i + 1}`);
    }
    if (!names.length) return setErr(addTab === 'names' ? 'Bitte mindestens einen Namen eingeben (einer je Zeile).' : 'Bitte eine Anzahl größer als 0 eingeben.');
    setErr('');
    setBusy(true);
    try {
      const r = await ag<{ added: AgStudent[]; skipped: number }>(base, 'POST', `/api/v1/contexts/${a.context_id}/students`, { names });
      const fresh = new Set(r.added.map((x) => x.id));
      const lower = new Set(names.map((n) => n.toLowerCase()));
      const list = await pickTask(a.id, picked);
      // schon vorhandene Namen aus der Eingabe ebenfalls anhaken
      setPicked(new Set([...picked, ...list.filter((s) => fresh.has(s.id) || lower.has(s.name.toLowerCase())).map((s) => s.id)]));
      setAddNames('');
      setAddCount(0);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function run() {
    setErr('');
    setBusy(true);
    try {
      let copies: Copy[] = [{}];
      const d: BlattDoc = structuredClone(doc);
      if (mode === 'ag') {
        if (!task || !picked.size) throw new Error('Bitte eine Aufgabe und mindestens eine Person wählen.');
        if (sendText) await sendToAutografi(task);
        const body: Record<string, unknown> = { user_ids: [...picked] };
        if (valid === 'freigabe') body.until = 'freigabe';
        else body.hours = Number(valid);
        const r = await ag<{ items: { user_id: number; name: string; code: string; qr: string }[] }>(base, 'POST', `/api/v1/assessments/${task}/access-codes`, body);
        const order = new Map(students.map((s, i) => [s.id, i]));
        copies = r.items.sort((a, b) => (order.get(a.user_id) ?? 0) - (order.get(b.user_id) ?? 0)).map((it) => ({ name: it.name, printName, code: it.code, qr: it.qr }));
        if (d.page.header.qr === 'none') d.page.header = { ...d.page.header, show: true, qr: 'first' };
      }
      printCopies(d, copies, title);
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-bg" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${st.dialog}`} role="dialog" aria-label="Drucken">
        <h2>Drucken</h2>
        <div className={st.radio}>
          <label>
            <input type="radio" checked={mode === 'one'} onChange={() => setMode('one')} />
            <span>
              Ein Exemplar zum Kopieren
              <small>ohne QR-Code{doc.page.header.qr !== 'none' ? ' (das Feld für den Code bleibt frei)' : ''}</small>
            </span>
          </label>
          <label>
            <input type="radio" checked={mode === 'ag'} onChange={() => setMode('ag')} />
            <span>
              Für jede Person ein eigenes Exemplar mit QR-Code aus Autogra.fi
              <small>Mit dem Code scannen die Lernenden ihre Seiten mit dem Handy ein, ohne Anmeldung.</small>
            </span>
          </label>
        </div>

        {mode === 'ag' && (
          <>
            {(agState === 'login' || agState === 'error') && (
              <>
                <div className="error">{agMsg}</div>
                <div className="row">
                  <div className="field" style={{ flex: 1 }}>
                    <label>Adresse von Autogra.fi</label>
                    <input value={agUrl} onChange={(e) => setAgUrl(e.target.value)} />
                  </div>
                </div>
                <div className="row">
                  <a className="btn" href={agUrl.replace(/\/+$/, '') + '/portal'} target="_blank" rel="noopener">
                    Autogra.fi öffnen ↗
                  </a>
                  <button className="btn primary" onClick={() => void loadTasks()}>
                    Noch einmal versuchen
                  </button>
                </div>
              </>
            )}
            {agState === 'loading' && <p className="muted">Aufgaben aus Autogra.fi werden geladen …</p>}
            {agState === 'ready' && (
              <>
                <div className="field">
                  <label>Aufgabe in Autogra.fi</label>
                  <select value={creating ? 'neu' : (task ?? '')} onChange={(e) => (e.target.value === 'neu' ? (setCreating(true), setTask(null)) : void pickTask(Number(e.target.value)))}>
                    <option value="" disabled>
                      bitte wählen
                    </option>
                    {tasks.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.class} · {a.title}
                      </option>
                    ))}
                    <option value="neu">+ Neue Aufgabe anlegen …</option>
                  </select>
                </div>
                {creating && (
                  <div className={st.newTask}>
                    <div className={st.grid2}>
                      <div className="field">
                        <label>Klasse</label>
                        <select value={newClass} onChange={(e) => setNewClass(e.target.value === 'neu' ? 'neu' : Number(e.target.value))}>
                          {classes.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.title}
                            </option>
                          ))}
                          {parents.length > 0 && <option value="neu">+ Neue Klasse</option>}
                        </select>
                      </div>
                      {newClass === 'neu' ? (
                        <div className="field">
                          <label>Name der Klasse</label>
                          <input value={newClassName} onChange={(e) => setNewClassName(e.target.value)} placeholder="z. B. S4 Geschichte" />
                        </div>
                      ) : (
                        <span />
                      )}
                      <div className="field">
                        <label>Titel der Aufgabe</label>
                        <input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} />
                      </div>
                      <div className="field">
                        <label>Art</label>
                        <select value={newMode} onChange={(e) => setNewMode(e.target.value as 'summative' | 'formative')}>
                          <option value="summative">Klausur</option>
                          <option value="formative">Übung</option>
                        </select>
                      </div>
                      <div className="field">
                        <label>Abgabe bis (optional)</label>
                        <input type="datetime-local" value={newDue} onChange={(e) => setNewDue(e.target.value)} />
                      </div>
                    </div>
                    <div className="row">
                      <span className={st.hint}>Die Aufgabe ist gleich offen; weitere Einstellungen machst du in Autogra.fi.</span>
                      <span className="grow" />
                      <button className="btn primary" disabled={busy} onClick={() => void createTask()}>
                        Aufgabe anlegen
                      </button>
                    </div>
                  </div>
                )}
                {task && !creating && (
                  <>
                    <div className="row">
                      <button className="btn" onClick={() => setPicked(new Set(students.map((s) => s.id)))}>
                        Alle
                      </button>
                      <button className="btn" onClick={() => setPicked(new Set())}>
                        Keine
                      </button>
                      <span className="muted">
                        {picked.size} von {students.length} ausgewählt
                      </span>
                    </div>
                    <div className={st.people}>
                      {students.map((s) => (
                        <label key={s.id} className={st.person}>
                          <input type="checkbox" checked={picked.has(s.id)} onChange={(e) => setPicked((p) => (e.target.checked ? new Set(p).add(s.id) : new Set([...p].filter((x) => x !== s.id))))} />
                          {s.name}
                        </label>
                      ))}
                      {!students.length && <div className={st.person}>In der Klasse sind noch keine Lernenden eingetragen. Trag unten Namen ein oder bestell Nummern.</div>}
                    </div>
                    <div className={st.addPeople}>
                      <div className="seg" role="group" aria-label="Personen ergänzen">
                        <button className={`btn ${addTab === 'names' ? 'on' : ''}`} onClick={() => setAddTab('names')}>
                          Namen eintragen
                        </button>
                        <button className={`btn ${addTab === 'count' ? 'on' : ''}`} onClick={() => setAddTab('count')} title="Codes ohne Namen, z. B. zum Verteilen in der Stunde">
                          Nummern bestellen
                        </button>
                      </div>
                      {addTab === 'names' ? (
                        <textarea rows={3} value={addNames} onChange={(e) => setAddNames(e.target.value)} placeholder={'Ein Name je Zeile, z. B.\nLea Brandt\nTom Kühn'} />
                      ) : (
                        <div className="row">
                          <input type="number" min={1} max={200} value={addCount || ''} onChange={(e) => setAddCount(Number(e.target.value) || 0)} placeholder="Anzahl" style={{ width: 90 }} />
                          <span className={st.hint}>Plätze „Abgabe 1“, „Abgabe 2“ … ohne Namen; wer welchen Zettel bekommt, entscheidest du beim Verteilen.</span>
                        </div>
                      )}
                      <div className="row">
                        <span className="grow" />
                        <button className="btn" disabled={busy} onClick={() => void addPeople()}>
                          In die Klasse übernehmen
                        </button>
                      </div>
                    </div>
                    <div className={st.grid2}>
                      <div className="field">
                        <label>Codes gültig</label>
                        <select value={valid} onChange={(e) => setValid(e.target.value)}>
                          <option value="freigabe">solange die Aufgabe freigegeben ist</option>
                          <option value="24">1 Tag</option>
                          <option value="168">7 Tage</option>
                          <option value="336">14 Tage</option>
                        </select>
                      </div>
                      <label className={st.check}>
                        <input type="checkbox" checked={printName} onChange={(e) => setPrintName(e.target.checked)} /> Namen eindrucken
                      </label>
                    </div>
                    <p className={st.hint}>Neue Codes ersetzen ältere nicht; schon verteilte Codes gelten weiter.</p>
                    <div className={st.newTask}>
                      <label className={st.check}>
                        <input type="checkbox" checked={sendText} onChange={(e) => setSendText(e.target.checked)} /> Text des Blatts als Aufgabenstellung nach Autogra.fi übernehmen
                      </label>
                      <span className={st.hint}>
                        Grundlage für den Erwartungshorizont und die KI-Bewertung in Autogra.fi: Material, Bildunterschriften und Aufgaben mit Punkten.
                        {taskText?.trim() && taskText.trim() !== toMarkdown(doc).trim() ? ' Dort steht schon ein anderer Text; er würde ersetzt.' : ''}
                      </span>
                      <div className="row">
                        {sent && <span className={st.hint}>✓ {sent}</span>}
                        <span className="grow" />
                        <a className="btn" href={`${base}/korrektur?assessment=${task}&view=einstellungen`} target="_blank" rel="noopener">
                          Einstellungen in Autogra.fi ↗
                        </a>
                        <button
                          className="btn"
                          disabled={busy}
                          onClick={async () => {
                            setBusy(true);
                            setErr('');
                            try {
                              await sendToAutografi(task);
                            } catch (e) {
                              setErr(e instanceof Error ? e.message : String(e));
                            } finally {
                              setBusy(false);
                            }
                          }}
                        >
                          Jetzt übernehmen
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </>
            )}
          </>
        )}

        <p className={st.hint}>
          {doc.page.booklet
            ? `Broschüre auf ${sheet.name}: beidseitig drucken, an der kurzen Kante wenden, Größe 100 % (nicht „an Seite anpassen“). Danach in der Mitte falten.`
            : `Auf ${sheet.name} drucken, Größe 100 % (nicht „an Seite anpassen“).`}{' '}
          Im Druckfenster des Browsers kannst du auch „Als PDF speichern“ wählen.
        </p>
        {err && <div className="error">{err}</div>}
        <div className="row">
          <span className="grow" />
          <button className="btn" onClick={onClose}>
            Abbrechen
          </button>
          <button className="btn primary" disabled={busy || (mode === 'ag' && (!task || !picked.size))} onClick={() => void run()}>
            {busy ? 'Bereitet vor …' : mode === 'ag' ? `${picked.size} ${picked.size === 1 ? 'Exemplar' : 'Exemplare'} drucken` : 'Drucken'}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Alle Exemplare setzen, in Bögen legen und das Druckfenster öffnen. */
function printCopies(doc: BlattDoc, copies: Copy[], title: string) {
  const printHost = document.createElement('div');
  printHost.className = `${st.host} ${st.printHost}`;
  document.body.appendChild(printHost);
  const tmp = document.createElement('div');
  tmp.className = st.host;
  printHost.appendChild(tmp);
  const sheets: Element[] = [];
  for (const c of copies) {
    const r = paginate(doc, tmp, c);
    const out = document.createElement('div');
    toSheets(doc, r.pages, out);
    sheets.push(...out.children);
  }
  tmp.remove();
  printHost.append(...sheets);
  const s = sheetSize(doc);
  const style = document.createElement('style');
  style.textContent = `@page { size: ${s.w}mm ${s.h}mm; margin: 0; }`;
  document.head.appendChild(style);
  document.body.classList.add('bl-printing');
  const oldTitle = document.title;
  document.title = title || 'Arbeitsblatt';
  const done = () => {
    document.body.classList.remove('bl-printing');
    printHost.remove();
    style.remove();
    document.title = oldTitle;
    removeEventListener('afterprint', done);
  };
  addEventListener('afterprint', done);
  // Bilder (QR-Codes) erst laden lassen
  const imgs = [...printHost.querySelectorAll('img')];
  Promise.all(imgs.map((i) => (i.complete ? null : new Promise((r) => ((i.onload = r), (i.onerror = r)))))).then(() => setTimeout(() => print(), 50));
}
