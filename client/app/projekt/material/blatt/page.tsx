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
import { colibre } from '@/lib/colibre';
import { ApiError, get, href, patch } from '@/lib/api';
import {
  BLOCK_LABEL,
  blockSummary,
  findBlock,
  fromEditMd,
  glossaryTerms,
  HEAD_KEYS,
  headFields,
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
  totalPoints,
  uid,
  updateBlock,
  walk,
  type BlattDoc,
  type Block,
  type BlockType,
  type Copy,
  type HeadField,
  type HeadKey,
  type HeadCtx,
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

const ADD: BlockType[] = ['material', 'image', 'task', 'text', 'quote', 'box', 'heading', 'table', 'chart', 'glossary', 'lines', 'pagebreak'];
/** Textbausteine und ihr Hauptfeld: ein Klick in den Baustein oder ein neuer Baustein öffnet es zum Schreiben */
const MAIN_FIELD: Partial<Record<BlockType, FieldName>> = { text: 'md', material: 'md', quote: 'md', box: 'md', task: 'md', heading: 'text', glossary: 'text' };
const MAX = 4_000_000;

const INFO = `Hier entsteht ein Arbeitsblatt oder eine Klassenarbeit zum Ausdrucken. Du schreibst direkt auf der Seite wie in Word: Klick in einen Text und tipp los. Ein Klick ins Leere unter dem letzten Baustein schreibt dort weiter; ein neuer Textbaustein öffnet sich gleich zum Schreiben. Esc beendet das Schreiben.

Das Menüband ist geordnet wie in Word. „Start“: Schrift, Absatz, Formatvorlagen und Rand für Notizen, im Text Fußnote, Randbemerkung und Glossar-Wort. Ohne Markierung gelten fett und kursiv für den ganzen Baustein. „Einfügen“: Textbausteine, Aufgaben und Teilaufgaben, Bild, Tabelle, Diagramm, Spalten, Seitenumbruch, Glossar sowie Rahmendaten, QR-Code und Seitenzahl. „Entwurf“: Schriftart und Grundschrift, Rahmendaten, QR-Code, Wasserzeichen und Korrekturrand. „Layout“: Format, Seitenzahlen, Broschüre, Spalten und die Zählweise der Teilaufgaben. Der Reiter mit dem Namen des gewählten Bausteins (z. B. „Aufgabe“, „Tabelle“ oder „Bild“) hat dessen Einstellungen.

Rahmendaten: Klick in den Kopf der ersten Seite oder auf „Rahmendaten“. Jedes Feld (Titel, Fach, Klasse, Lehrkraft, Datum, Name, Punkte, Note) lässt sich zeigen oder weglassen. „Automatisch“ füllt es aus dem Blatt bzw. beim Druck aus Autogra.fi (Titel = Name des Blatts, Punkte = Summe der Aufgaben, Datum = Tag des Drucks); sonst steht dein eigener Text da, oder eine Linie zum Ausfüllen.

Aufgaben werden von selbst nummeriert; Teilaufgaben heißen a), b) … oder 1.1, 1.2 … (unter „Layout“). Eine eigene Nummer wie „1 b)“ trägst du im Reiter „Aufgabe“ ein.

Spalten: unter „Einfügen“ oder „Layout“ anlegen und die Zahl der Spalten wählen. Die Mittelstege ziehst du auf der Seite mit der Maus; „Gleichmäßig“ macht alle Spalten wieder gleich breit. In eine leere Spalte klicken, dann einen Baustein einfügen. Oder einen Baustein wählen und „neben den nächsten“.

Tabelle: in die Zellen schreiben, Tab springt in die nächste Zelle (am Ende kommt eine Zeile dazu). Aus Excel oder Calc Kopiertes verteilt sich auf die Zellen. „Diagramm daraus“ zeichnet Säulen, Balken, Linie oder Kreis: erste Zeile = Namen der Reihen, erste Spalte = Kategorien.

Bilder: hineinziehen, einfügen, im Reiter „Bild“ auswählen, aus dem Material oder über ihre Adresse im Netz laden. Ein Bild lässt sich drehen und mit der Maus frei auf der Seite verschieben; sein Platz im Text bleibt frei, außer du wählst „vor dem Text“.

Links wählst du die Ansicht: Seiten (zum Schreiben), Doppelseiten (wie im aufgeschlagenen Heft, um den Mittelschnitt zu prüfen; auch hier schreibst du) und Druckbögen (so liegen die Seiten auf dem Papier). Darunter wechselst du zwischen Seitenminiaturen, Gliederung und allen Elementen (ziehen ändert die Reihenfolge).

Rechts lässt sich eine Seitenleiste zuschalten: Suchen (im Blatt, nach Bausteinen und im Material), Material (Bilder und Lernseiten einsetzen) und Glossar (Erklärungen schreiben).

Broschüre: Die Seiten werden auf ein Vielfaches von vier aufgefüllt und so auf die Bögen verteilt, dass die erste Seite neben der letzten steht. Beidseitig drucken und an der kurzen Kante wenden.

QR-Code: Beim Drucken wählst du eine Aufgabe in Autogra.fi; jede Person bekommt ein eigenes Exemplar mit ihrem Code, ihrem Namen und ihrer Klasse. Dafür musst du im selben Browser in Autogra.fi angemeldet sein.

Die Icons im Menüband sind Colibre aus LibreOffice (CC0).`;

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
  /** links: Seitenminiaturen, Gliederung oder alle Elemente */
  const [leftTab, setLeftTab] = useState<'thumbs' | 'outline' | 'blocks'>('blocks');
  const [headOpen, setHeadOpen] = useState(false);
  const thumbs = useRef<HTMLDivElement>(null);
  const pagesRef = useRef<HTMLElement[]>([]);
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
      } else if (!inField && sel && e.key === 'Delete') {
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
    const r = paginate(doc, h, undefined, { editing: canEdit, head: { title: title.trim(), course: project?.course.title ?? '', teacher: me?.name ?? '' } });
    setProblems(r.problems);
    setPageCount(r.pages.length);
    pagesRef.current = r.pages;
    // Seitenminiaturen links
    const th = thumbs.current;
    if (th) {
      th.replaceChildren(
        ...r.pages.map((p, k) => {
          const t = document.createElement('button');
          t.type = 'button';
          t.className = st.pThumb;
          t.dataset.page = String(k);
          const inner = document.createElement('div');
          inner.className = `${st.host} ${st.pThumbInner}`;
          const c = p.cloneNode(true) as HTMLElement;
          c.querySelectorAll('[data-bid]').forEach((e) => e.removeAttribute('data-bid'));
          inner.appendChild(c);
          t.appendChild(inner);
          const n = document.createElement('span');
          n.textContent = String(k + 1);
          t.appendChild(n);
          return t;
        }),
      );
    }
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
  }, [doc, view, canEdit, sel, selCol, edit, zoom, leftTab, title, project, me]);
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
    // neuer Textbaustein: gleich darin schreiben
    const f = MAIN_FIELD[type];
    setEdit(f && type !== 'glossary' ? { bid: b.id, field: f, idx: 0 } : type === 'table' ? { bid: b.id, field: 'cell:0:0', idx: 0 } : null);
    if (type === 'image' || type === 'cols' || type === 'lines' || type === 'glossary' || type === 'table' || type === 'chart') setTab('block');
  }
  /** Zahl der Spalten ändern; überzählige Spalten wandern in die letzte, „1“ löst die Spalten auf */
  function setColCount(cid: string, n: number) {
    if (n <= 1) return unColumns(cid);
    const b = doc ? findBlock(doc.blocks, cid) : null;
    if (!b) return;
    const cols = [...(b.cols ?? [])];
    while (cols.length < n) cols.push([]);
    while (cols.length > n) cols[n - 1] = [...cols[n - 1], ...cols.pop()!];
    setBlock(cid, { cols, ratio: cols.map(() => 1) });
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
    if (b && (b.type === 'image' || b.type === 'cols' || b.type === 'lines' || b.type === 'pagebreak' || b.type === 'glossary' || b.type === 'table' || b.type === 'chart')) setTab('block');
  }

  // Klick, Ziehen und Einsetzen auf den Seiten
  function onPagesClick(e: React.MouseEvent) {
    if (!canEdit || !doc) return;
    const t = e.target as HTMLElement;
    if (t.closest('[data-ov]') || t.closest('.bl-gutter')) return;
    // Kopf der Seite: Rahmendaten
    if (t.closest('[data-head]') && view !== 'sheets') {
      setEdit(null);
      setHeadOpen(true);
      return;
    }
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
    const at = { x: e.clientX, y: e.clientY };
    if (!blockEl?.dataset.bid) {
      setEdit(null);
      // Klick ins Leere unter dem letzten Baustein: dort weiterschreiben (wie in Word)
      const pageEl = t.closest<HTMLElement>('.bl-page');
      if (view === 'sheets' || !pageEl || pageEl.classList.contains('bl-blank-page')) return setSel(null);
      const isLast = pageEl === pagesRef.current.filter((p) => !p.classList.contains('bl-filler')).pop();
      const lastEl = [...pageEl.querySelectorAll<HTMLElement>('.bl-body > [data-bid]')].pop();
      if (!isLast || (lastEl && e.clientY < lastEl.getBoundingClientRect().bottom)) return setSel(null);
      const last = doc.blocks[doc.blocks.length - 1];
      if (last && (last.type === 'text' || last.type === 'material' || last.type === 'box') && !plainMd(last.md ?? '').trim()) {
        setSel(last.id);
        setEdit({ bid: last.id, field: 'md', idx: 99 });
      } else if (last && last.type === 'text') {
        setSel(last.id);
        setEdit({ bid: last.id, field: 'md', idx: 99 });
      } else {
        setSel(null);
        setSelCol(null);
        const nb = newBlock('text');
        change((d) => ({ ...d, blocks: [...d.blocks, nb] }));
        setSel(nb.id);
        setEdit({ bid: nb.id, field: 'md', idx: 0 });
      }
      return;
    }
    const bid = blockEl.dataset.bid;
    select(bid);
    if (view === 'sheets') return setEdit(null);
    // geschrieben wird in den Seiten und in den Doppelseiten; die Druckbögen sind nur zum Ansehen
    let f = t.closest<HTMLElement>('[data-field]');
    if (f && f.closest('[data-bid]') !== blockEl) f = null;
    // Klick neben den Text, aber in den Baustein: sein Haupttext
    if (!f) {
      const b = findBlock(doc.blocks, bid);
      const main = b ? MAIN_FIELD[b.type] : undefined;
      if (main) f = blockEl.querySelector<HTMLElement>(`[data-field="${main}"]`);
    }
    if (f) {
      const all = [...(host.current?.querySelectorAll<HTMLElement>(`[data-bid="${bid}"] [data-field="${f.dataset.field}"]`) ?? [])].filter((x) => x.closest('[data-bid]')?.getAttribute('data-bid') === bid);
      setEdit({ bid, field: f.dataset.field as FieldName, idx: Math.max(0, all.indexOf(f)), at });
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
    const gut = (e.target as HTMLElement).closest<HTMLElement>('.bl-gutter');
    if (gut?.dataset.gutter) return dragGutter(e, gut);
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
  // ---------- Tabelle: Zellen auf der Seite ----------
  const cellPos = (f: FieldName) => f.split(':').slice(1).map(Number) as [number, number];
  function setCell(bid: string, f: FieldName, v: string) {
    const [r, c] = cellPos(f);
    change((d) => {
      const b = findBlock(d.blocks, bid);
      if (!b?.rows?.[r]) return d;
      const rows = b.rows.map((x) => [...x]);
      rows[r][c] = v;
      return { ...d, blocks: updateBlock(d.blocks, bid, { rows }) };
    });
  }
  /** Tab: nächste Zelle, am Ende eine neue Zeile; Umschalt+Tab: vorige */
  function moveCell(t: EditTarget, dir: 1 | -1) {
    const b = doc ? findBlock(doc.blocks, t.bid) : null;
    if (!b?.rows?.length) return;
    const nc = b.rows[0].length;
    let [r, c] = cellPos(t.field);
    c += dir;
    if (c >= nc) (c = 0), r++;
    if (c < 0) (c = nc - 1), r--;
    if (r < 0) return;
    if (r >= b.rows.length) setBlock(t.bid, { rows: [...b.rows, Array(nc).fill('')] });
    setEdit({ bid: t.bid, field: `cell:${r}:${c}`, idx: 0 });
  }
  /** Aus einer Tabellenkalkulation eingefügt (Tabulatoren und Zeilen): ab der Zelle verteilen, Tabelle wächst mit */
  function pasteGrid(t: EditTarget, text: string) {
    const b = doc ? findBlock(doc.blocks, t.bid) : null;
    if (!b?.rows) return;
    const grid = text.replace(/\r/g, '').replace(/\n+$/, '').split('\n').map((l) => l.split('\t'));
    const [r0, c0] = cellPos(t.field);
    const rows = b.rows.map((x) => [...x]);
    const nc = Math.max(rows[0]?.length ?? 0, c0 + Math.max(...grid.map((g) => g.length)));
    while (rows.length < r0 + grid.length) rows.push([]);
    for (const row of rows) while (row.length < nc) row.push('');
    grid.forEach((g, i) => g.forEach((v, j) => (rows[r0 + i][c0 + j] = v.trim())));
    setBlock(t.bid, { rows });
    setEdit(null);
  }
  /** Mittelsteg zwischen zwei Spalten ziehen (Wunsch Jo, 23. November 2026) */
  function dragGutter(e: React.PointerEvent, gut: HTMLElement) {
    const [cid, ks] = gut.dataset.gutter!.split(':');
    const k = Number(ks);
    const box = gut.parentElement!;
    const b = doc ? findBlock(doc.blocks, cid) : null;
    if (!b) return;
    e.preventDefault();
    e.stopPropagation();
    select(cid);
    setEdit(null);
    const n = (b.cols ?? []).length;
    const r0 = (b.ratio ?? []).length === n ? b.ratio! : Array(n).fill(1);
    const sum = r0.reduce((x, y) => x + y, 0);
    const pxmm = 3.7795 * zoom;
    const W = box.getBoundingClientRect().width - 6 * (n - 1) * pxmm;
    const w0 = r0.map((r) => (r / sum) * W);
    const min = 15 * pxmm;
    const sx = e.clientX;
    let w = w0;
    const mv = (ev: PointerEvent) => {
      const d = Math.max(min - w0[k], Math.min(w0[k + 1] - min, ev.clientX - sx));
      w = w0.map((x, i) => (i === k ? x + d : i === k + 1 ? x - d : x));
      box.style.gridTemplateColumns = w.map((x) => `minmax(0, ${x}fr)`).join(' ');
      let acc = 0;
      box.querySelectorAll<HTMLElement>('.bl-gutter').forEach((g, i) => {
        acc += w[i];
        g.style.left = `calc((100% - ${6 * (n - 1)}mm) * ${acc / W} + ${6 * i + 3}mm)`;
      });
    };
    const up = () => {
      removeEventListener('pointermove', mv);
      removeEventListener('pointerup', up);
      if (w === w0) return;
      setBlock(cid, { ratio: w.map((x) => Math.round((x / W) * 1000) / 10) });
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
  const outlineItems = doc ? gliederung(doc) : [];
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
              cell={edit && selBlock?.type === 'table' && edit.bid === selBlock.id && edit.field.startsWith('cell:') ? { r: Number(edit.field.split(':')[1]), c: Number(edit.field.split(':')[2]) } : null}
              openHead={() => (setEdit(null), setHeadOpen(true))}
              setColCount={setColCount}
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
          {headOpen && editing && (
            <div className={st.headAnchor}>
              <HeadDialog doc={doc} title={title} course={project.course.title} teacher={me.name} setHeader={setHeader} onClose={() => setHeadOpen(false)} />
            </div>
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
              <div className={st.leftTabs} role="tablist" aria-label="Linke Leiste">
                {(
                  [
                    ['thumbs', 'Seiten', 'zoompage'],
                    ['outline', 'Gliederung', 'outlinemode'],
                    ['blocks', 'Elemente', 'navigator'],
                  ] as const
                ).map(([k, l, i]) => (
                  <button key={k} role="tab" aria-selected={leftTab === k} className={`${st.leftTab} ${leftTab === k ? st.leftTabOn : ''}`} onClick={() => setLeftTab(k)}>
                    <Ico n={i} size={16} />
                    {l}
                  </button>
                ))}
              </div>
              {leftTab === 'thumbs' && (
                <div
                  ref={thumbs}
                  className={st.pThumbs}
                  onClick={(e) => {
                    const k = Number((e.target as HTMLElement).closest<HTMLElement>('[data-page]')?.dataset.page);
                    const p = pagesRef.current[k];
                    if (p?.isConnected) p.scrollIntoView({ block: 'start', behavior: 'smooth' });
                  }}
                />
              )}
              {leftTab === 'outline' && (
                <div className={st.list}>
                  {!outlineItems.length && <div className={st.empty}>Noch keine Überschriften, Materialien oder Aufgaben.</div>}
                  {outlineItems.map(({ b, depth, label }) => (
                    <button key={b.id} className={`${st.oItem} ${sel === b.id ? st.sel : ''}`} style={{ paddingLeft: 6 + depth * 14 }} onClick={() => (select(b.id), setEdit(null), host.current?.querySelector(`[data-bid="${b.id}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }))}>
                      {label}
                    </button>
                  ))}
                </div>
              )}
              {leftTab === 'blocks' && (
                <section className={st.sec}>
                  {!doc.blocks.length && <div className={st.empty}>Noch leer. Klick auf die Seite und schreib los, oder füge unter „Einfügen“ Material, Bilder, Tabellen und Aufgaben ein.</div>}
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
                        <span className={st.itemIcon}>
                          <Ico n={BICON[b.type]} size={16} />
                        </span>
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
              )}
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
                      onChange={(v) => (edit.field.startsWith('cell:') ? setCell(edit.bid, edit.field, v) : setBlock(edit.bid, { [edit.field]: v }))}
                      onTab={edit.field.startsWith('cell:') ? (dir) => moveCell(edit, dir) : undefined}
                      onGrid={edit.field.startsWith('cell:') ? (text) => pasteGrid(edit, text) : undefined}
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
      {printing && doc && <PrintDialog doc={doc} title={title} head={{ title: title.trim(), course: project.course.title, teacher: me.name }} onClose={() => setPrinting(false)} />}
    </ProjectShell>
  );
}

// ---------- Bearbeiten direkt auf der Seite ----------
type Tab = 'start' | 'insert' | 'design' | 'layout' | 'block';
type Panel = 'search' | 'material' | 'glossary';
type FieldName = 'md' | 'title' | 'text' | 'source' | 'caption' | `cell:${number}:${number}`;
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
    tag: inlineEl || ['figcaption', 'td', 'th'].includes(f.tagName.toLowerCase()) ? 'div' : f.tagName.toLowerCase(),
    pageStyle: `font-family:${pg?.style.fontFamily ?? ''};font-size:${pg?.style.fontSize ?? ''};line-height:1.35;color:#111`,
    blockClass: block.className.replace(/\bbl-sel\b|\bbl-overflow\b/g, ''),
    blockStyle: block.style.cssText,
    fieldClass: f.className,
    // Tabellenzelle: Innenabstand, Schrift und Hintergrund der Zelle mitnehmen
    fieldStyle: /^t[dh]$/i.test(f.tagName) ? `${f.style.cssText};padding:${getComputedStyle(f).padding};font-weight:${getComputedStyle(f).fontWeight};background:${getComputedStyle(f).backgroundColor};min-height:${f.offsetHeight}px` : f.style.cssText,
  };
}

function fieldValue(b: Block | null, f: FieldName): string {
  if (!b) return '';
  if (f.startsWith('cell:')) {
    const [, r, c] = f.split(':').map(Number);
    return b.rows?.[r]?.[c] ?? '';
  }
  return String((b as unknown as Record<string, unknown>)[f] ?? '');
}
const RICH = (f: FieldName) => f === 'md' || f === 'title' || f === 'text' || f.startsWith('cell:');
const MULTI: FieldName[] = ['md'];

function InlineEditor({
  ov,
  field,
  at,
  value,
  api,
  doc,
  onChange,
  onTab,
  onGrid,
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
  onTab?: (dir: 1 | -1) => void;
  onGrid?: (text: string) => void;
  onClose: () => void;
  ensureGlossary: () => void;
}) {
  const box = useRef<HTMLElement | null>(null);
  const emitted = useRef<string | null>(null);
  const saved = useRef<Range | null>(null);
  const [atom, setAtom] = useState<{ el: HTMLElement; text: string; extra: string } | null>(null);
  const rich = RICH(field);
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
              if (e.key === 'Tab' && onTab) {
                e.preventDefault();
                emit();
                onTab(e.shiftKey ? -1 : 1);
                return;
              }
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
              if (t && onGrid && /[\t\n]/.test(t.trim())) return onGrid(t);
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

/** Gliederung: Überschriften, Materialien, Aufgaben, Tabellen, Diagramme und Bilder mit Unterschrift */
function gliederung(doc: BlattDoc): { b: Block; depth: number; label: string }[] {
  const labels = taskLabels(doc);
  let mat = 0;
  let base = 0;
  const out: { b: Block; depth: number; label: string }[] = [];
  for (const b of walk(doc.blocks)) {
    if (b.type === 'heading') {
      base = b.level === 1 ? 1 : 2;
      out.push({ b, depth: b.level === 1 ? 0 : 1, label: plainMd(b.text ?? '') || 'Überschrift' });
    } else if (b.type === 'material') {
      mat++;
      out.push({ b, depth: base, label: `${(b.label ?? '').trim() || `Material ${mat}`}: ${plainMd(b.title ?? '')}` });
    } else if (b.type === 'task') out.push({ b, depth: base + (b.subtask ? 1 : 0), label: `${labels.get(b.id) ?? ''} ${plainMd(b.md ?? '').slice(0, 60)}` });
    else if ((b.type === 'table' || b.type === 'chart' || b.type === 'image') && b.caption?.trim()) out.push({ b, depth: base, label: `${BLOCK_LABEL[b.type]}: ${b.caption.trim()}` });
  }
  return out;
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
const TEXT_TYPES: BlockType[] = ['heading', 'text', 'material', 'quote', 'task', 'box', 'glossary', 'table'];

/** QR-Code als Icon (Colibre hat keins) im selben Strich */
const QR_SVG =
  '<svg class="cb" viewBox="0 0 24 24"><g fill="#3a3a38"><path d="M3 3h7v7H3zm1 1v5h5V4zm10-1h7v7h-7zm1 1v5h5V4zM3 14h7v7H3zm1 1v5h5v-5z"/><path d="M5 5h3v3H5zm11 0h3v3h-3zM5 16h3v3H5zm9-2h2v2h-2zm2 2h2v2h-2zm2-2h3v2h-3zm-4 4h2v3h-2zm4 0h3v3h-3zm-2 2h2v1h-2z"/></g></svg>';

/** Colibre-Icon (LibreOffice) */
function Ico({ n, size = 24 }: { n: string; size?: number }) {
  return <span className={st.ico} style={{ width: size, height: size }} aria-hidden dangerouslySetInnerHTML={{ __html: n === 'qr' ? QR_SVG : colibre(n) }} />;
}
/** Knopf im Menüband: groß (Icon über der Beschriftung) oder klein (Icon, Beschriftung daneben) */
function RB({ icon, label, big, on, disabled, onClick, title, hideLabel }: { icon: string; label: string; big?: boolean; on?: boolean; disabled?: boolean; onClick: () => void; title?: string; hideLabel?: boolean }) {
  return (
    <button type="button" className={`${st.rb} ${big ? st.rbBig : ''} ${on ? st.rbOn : ''}`} disabled={disabled} onClick={onClick} title={title ?? label} aria-label={label} aria-pressed={on}>
      <Ico n={icon} size={big ? 24 : 16} />
      {!hideLabel && <span>{label}</span>}
    </button>
  );
}

const BICON: Record<BlockType, string> = {
  heading: 'heading1parastyle',
  text: 'textbodyparastyle',
  material: 'insertsection',
  quote: 'quoteparastyle',
  image: 'insertgraphic',
  task: 'edit',
  box: 'insertframe',
  glossary: 'insertmultiindex',
  table: 'inserttable',
  chart: 'insertobjectchart',
  cols: 'formatcolumns',
  lines: 'togglegridhorizontal',
  pagebreak: 'insertpagebreak',
};

type RibbonProps = {
  tab: Tab;
  setTab: (t: Tab) => void;
  doc: BlattDoc;
  b: Block | null;
  selCol: { id: string; k: number } | null;
  inline: React.MutableRefObject<InlineApi | null>;
  editingText: boolean;
  /** Zelle, in der gerade geschrieben wird (Tabelle) */
  cell: { r: number; c: number } | null;
  panel: Panel | null;
  setPanel: (p: Panel | null) => void;
  set: (p: Partial<Block>) => void;
  setPageOpt: (p: Partial<BlattDoc['page']>) => void;
  setHeader: (p: Partial<BlattDoc['page']['header']>) => void;
  openHead: () => void;
  add: (t: BlockType, extra?: Partial<Block>) => void;
  move: (id: string, dir: -1 | 1) => void;
  remove: (id: string) => void;
  duplicate: (id: string) => void;
  toColumns: (id: string) => void;
  unColumns: (id: string) => void;
  setColCount: (id: string, n: number) => void;
  onImage: (f: Blob) => void;
  ensureGlossary: () => void;
  onError: (m: string) => void;
};

function Ribbon(props: RibbonProps) {
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
  const rich = props.editingText && !!inline.current?.rich;
  const fs = s.fs ?? 100;
  return (
    <div className={st.ribbon} onMouseDown={keep}>
      <div className={st.tabs} role="tablist">
        {(
          [
            ['start', 'Start'],
            ['insert', 'Einfügen'],
            ['design', 'Entwurf'],
            ['layout', 'Layout'],
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
            ['search', 'Suchen', 'recsearch'],
            ['material', 'Material', 'gallery'],
            ['glossary', 'Glossar', 'insertmultiindex'],
          ] as const
        ).map(([k, l, i]) => (
          <button key={k} className={`${st.tab} ${st.tabSide} ${props.panel === k ? st.tabOn : ''}`} onClick={() => props.setPanel(props.panel === k ? null : k)} title="Seitenleiste rechts ein- und ausblenden">
            <Ico n={i} size={16} />
            {l}
          </button>
        ))}
      </div>
      <div className={st.groups}>
        {tab === 'start' && (
          <>
            <Group label="Schrift">
              <div className={st.rows}>
                <div className={st.row}>
                  <select value={fs} disabled={!textBlock} onChange={(e) => set({ fs: Number(e.target.value) })} title="Schriftgröße des Bausteins" aria-label="Schriftgröße">
                    {withValue([80, 85, 90, 100, 110, 120, 140, 160], s.fs).map((v) => (
                      <option key={v} value={v}>
                        {v} %
                      </option>
                    ))}
                  </select>
                  <RB icon="grow" label="Größer" hideLabel disabled={!textBlock} onClick={() => set({ fs: Math.min(200, fs + 10) })} title="Schrift größer" />
                  <RB icon="shrink" label="Kleiner" hideLabel disabled={!textBlock} onClick={() => set({ fs: Math.max(60, fs - 10) })} title="Schrift kleiner" />
                </div>
                <div className={st.row}>
                  <RB icon="bold" label="Fett" hideLabel on={!!s.bd} disabled={!textBlock} onClick={() => exec('bold') || set({ bd: !s.bd })} title="Fett (Strg+B); ohne Markierung der ganze Baustein" />
                  <RB icon="italic" label="Kursiv" hideLabel on={!!s.it} disabled={!textBlock} onClick={() => exec('italic') || set({ it: !s.it })} title="Kursiv (Strg+I); ohne Markierung der ganze Baustein" />
                  <RB icon="underline" label="Unterstrichen" hideLabel disabled={!props.editingText} onClick={() => exec('underline')} title="Unterstrichen (Strg+U)" />
                  <RB
                    icon="backcolor"
                    label="Textmarker"
                    hideLabel
                    disabled={!props.editingText}
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
                  />
                </div>
              </div>
            </Group>
            <Group label="Absatz">
              <div className={st.rows}>
                <div className={st.row}>
                  <RB icon="defaultbullet" label="Aufzählung" hideLabel disabled={!props.editingText} onClick={() => exec('insertUnorderedList')} />
                  <RB icon="defaultnumbering" label="Nummerierung" hideLabel disabled={!props.editingText} onClick={() => exec('insertOrderedList')} />
                  <RB icon="decrementindent" label="Einzug verkleinern" hideLabel disabled={!textBlock || !(s.ind ?? 0)} onClick={() => set({ ind: Math.max(0, (s.ind ?? 0) - 5) })} />
                  <RB icon="incrementindent" label="Einzug vergrößern" hideLabel disabled={!textBlock} onClick={() => set({ ind: Math.min(40, (s.ind ?? 0) + 5) })} title="Einzug vergrößern (5 mm)" />
                </div>
                <div className={st.row}>
                  {(
                    [
                      ['left', 'leftpara', 'Linksbündig'],
                      ['center', 'centerpara', 'Zentriert'],
                      ['right', 'rightpara', 'Rechtsbündig'],
                      ['justify', 'justifypara', 'Blocksatz'],
                    ] as const
                  ).map(([v, i, l]) => (
                    <RB key={v} icon={i} label={l} hideLabel on={textBlock && (s.ta ?? 'left') === v} disabled={!textBlock} onClick={() => set({ ta: v })} />
                  ))}
                  <span className={st.icoSel} title="Zeilenabstand">
                    <Ico n="spacepara15" size={16} />
                    <select value={s.lh ?? 1.35} disabled={!textBlock} onChange={(e) => set({ lh: Number(e.target.value) })} aria-label="Zeilenabstand">
                      {withValue([1.15, 1.25, 1.35, 1.45, 1.6, 1.8, 2, 2.4], s.lh ?? 1.35).map((v) => (
                        <option key={v} value={v}>
                          {String(v).replace('.', ',')}
                        </option>
                      ))}
                    </select>
                  </span>
                </div>
              </div>
            </Group>
            <Group label="Formatvorlagen">
              <div className={st.rows}>
                <div className={st.row}>
                  <Ico n="editstyle" size={16} />
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
                  <RB icon="resetattributes" label="Wie Vorlage" hideLabel disabled={!textBlock} onClick={() => set({ ...STYLE_RESET, ...(b?.type === 'material' ? { justify: undefined } : {}) })} title="Eigene Gestaltung entfernen (wie Vorlage)" />
                </div>
                <div className={st.row}>
                  <Ico n="pagemargin" size={16} />
                  <select value={s.nm ?? 0} disabled={!textBlock} onChange={(e) => set({ nm: Number(e.target.value) })} title="Freier Rand rechts für Notizen; Randbemerkungen stehen dort" aria-label="Rand für Notizen">
                    <option value={0}>kein Rand für Notizen</option>
                    {withValue([20, 30, 40, 50], s.nm || undefined).map((v) => (
                      <option key={v} value={v}>
                        Rand für Notizen {String(v / 10).replace('.', ',')} cm
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </Group>
            <Group label="Im Text">
              <RB icon="insertfootnote" label="Fußnote" big disabled={!rich} onClick={() => exec('insertHTML', noteHtml('note', 'Fußnote'))} title="Nummerierte Fußnote unten auf der Seite; antippen zum Ändern" />
              <RB icon="insertannotation" label="Randbemerkung" big disabled={!rich} onClick={() => exec('insertHTML', noteHtml('margin', 'Bemerkung'))} title="Bemerkung im Rand neben der Zeile" />
              <RB
                icon="insertmultiindex"
                label="Glossar"
                big
                disabled={!rich}
                title="Markiertes Wort ins Glossar"
                onClick={() => {
                  const w = selectedText().trim();
                  if (!w) return props.onError('Erst im Text ein Wort markieren, dann „Glossar“.');
                  props.onError('');
                  const known = glossaryTerms(doc).find((t) => t.word.toLowerCase() === w.toLowerCase());
                  exec('insertHTML', glossHtml(w, known?.explain ?? ''));
                  props.ensureGlossary();
                }}
              />
            </Group>
          </>
        )}
        {tab === 'insert' && (
          <>
            <Group label="Text">
              {(['text', 'material', 'quote', 'box', 'heading'] as const).map((t) => (
                <RB key={t} icon={BICON[t]} label={BLOCK_LABEL[t]} big onClick={() => props.add(t)} title={`${BLOCK_LABEL[t]} einfügen (${props.selCol ? 'in die gewählte Spalte' : b ? 'nach dem gewählten Baustein' : 'am Ende'})`} />
              ))}
            </Group>
            <Group label="Aufgaben">
              <RB icon={BICON.task} label="Aufgabe" big onClick={() => props.add('task')} />
              <RB icon="hangingindent" label="Teilaufgabe" big onClick={() => props.add('task', { subtask: true })} title="Teilaufgabe: a), b) … oder 1.1, 1.2 …" />
              <RB icon={BICON.lines} label="Linien" big onClick={() => props.add('lines')} title="Schreiblinien, Karos oder Freiraum" />
            </Group>
            <Group label="Illustrationen">
              <RB icon={BICON.image} label="Bild" big onClick={() => props.add('image')} />
              <RB icon={BICON.table} label="Tabelle" big onClick={() => props.add('table')} />
              <RB
                icon={BICON.chart}
                label="Diagramm"
                big
                onClick={() => {
                  const t = b?.type === 'table' ? b : walk(doc.blocks).filter((x) => x.type === 'table').pop();
                  props.add('chart', t ? { ref: t.id, caption: t.caption ? `Diagramm: ${t.caption}` : '' } : {});
                }}
                title="Diagramm aus einer Tabelle des Blatts"
              />
            </Group>
            <Group label="Seiten">
              <RB icon={BICON.cols} label="Spalten" big onClick={() => props.add('cols')} title="Zwei Spalten; die Zahl stellst du im Reiter „Spalten“ ein" />
              <RB icon={BICON.pagebreak} label="Seitenumbruch" big onClick={() => props.add('pagebreak')} />
            </Group>
            <Group label="Verzeichnisse">
              <RB icon={BICON.glossary} label="Glossar" big onClick={() => props.add('glossary')} />
            </Group>
            <Group label="Kopf und Fuß">
              <RB icon="insertheader" label="Rahmendaten" big onClick={props.openHead} title="Titel, Klasse, Datum, Name, Punkte …" />
              <RB icon="qr" label="QR-Code" big on={P.header.qr !== 'none'} onClick={() => props.setHeader({ qr: P.header.qr === 'none' ? 'first' : 'none', show: true })} title="Persönlicher QR-Code aus Autogra.fi auf Seite 1" />
              <RB icon="insertpagenumberfield" label="Seitenzahl" big on={P.pageNumbers} onClick={() => props.setPageOpt({ pageNumbers: !P.pageNumbers })} />
            </Group>
          </>
        )}
        {tab === 'design' && (
          <>
            <Group label="Dokumentformatierung">
              <div className={st.rows}>
                <div className={st.row}>
                  <Ico n="charfontname" size={16} />
                  <select value={P.font} onChange={(e) => props.setPageOpt({ font: e.target.value as 'sans' | 'serif' })} aria-label="Schriftart">
                    <option value="sans">Ohne Serifen (Carlito)</option>
                    <option value="serif">Mit Serifen (Libertine)</option>
                  </select>
                </div>
                <div className={st.row}>
                  <Ico n="grow" size={16} />
                  <select value={P.fontSize} onChange={(e) => props.setPageOpt({ fontSize: Number(e.target.value) })} aria-label="Grundschrift">
                    {[10, 10.5, 11, 12, 13].map((z) => (
                      <option key={z} value={z}>
                        {String(z).replace('.', ',')} pt
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </Group>
            <Group label="Kopf">
              <RB icon="insertheader" label="Rahmendaten" big onClick={props.openHead} title="Titel, Fach, Klasse, Lehrkraft, Datum, Name, Punkte, Note" />
              <RB icon="qr" label="QR-Code" big on={P.header.qr !== 'none'} onClick={() => props.setHeader({ qr: P.header.qr === 'none' ? 'first' : 'none', show: true })} />
              {P.header.qr !== 'none' && (
                <select value={P.header.qr} onChange={(e) => props.setHeader({ qr: e.target.value as 'first' | 'all' })} aria-label="QR-Code auf">
                  <option value="first">auf Seite 1</option>
                  <option value="all">auf jeder Seite</option>
                </select>
              )}
            </Group>
            <Group label="Seitenhintergrund">
              <div className={st.rows}>
                <div className={st.row}>
                  <Ico n="watermark" size={16} />
                  <select
                    value={['', 'ENTWURF', 'MUSTER', 'LÖSUNG'].includes(P.watermark ?? '') ? (P.watermark ?? '') : '*'}
                    onChange={(e) => props.setPageOpt({ watermark: e.target.value === '*' ? P.watermark || 'Eigener Text' : e.target.value })}
                    aria-label="Wasserzeichen"
                  >
                    <option value="">kein Wasserzeichen</option>
                    <option value="ENTWURF">ENTWURF</option>
                    <option value="MUSTER">MUSTER</option>
                    <option value="LÖSUNG">LÖSUNG</option>
                    <option value="*">eigener Text …</option>
                  </select>
                  {!!P.watermark && !['ENTWURF', 'MUSTER', 'LÖSUNG'].includes(P.watermark) && <input className={st.rIn} value={P.watermark} onChange={(e) => props.setPageOpt({ watermark: e.target.value })} aria-label="Text des Wasserzeichens" style={{ width: 110 }} />}
                </div>
                <div className={st.row}>
                  <Ico n="pagemargin" size={16} />
                  <select value={P.korr.side} onChange={(e) => props.setPageOpt({ korr: { ...P.korr, side: e.target.value as Korr['side'] } })} aria-label="Korrekturrand">
                    <option value="none">kein Korrekturrand</option>
                    <option value="right">Korrekturrand rechts</option>
                    <option value="left">Korrekturrand links</option>
                  </select>
                  {P.korr.side !== 'none' && (
                    <>
                      <select value={P.korr.width} onChange={(e) => props.setPageOpt({ korr: { ...P.korr, width: Number(e.target.value) } })} aria-label="Breite des Korrekturrands">
                        {[20, 25, 30, 40, 50].map((v) => (
                          <option key={v} value={v}>
                            {String(v / 10).replace('.', ',')} cm
                          </option>
                        ))}
                      </select>
                      <select value={P.korr.style} onChange={(e) => props.setPageOpt({ korr: { ...P.korr, style: e.target.value as Korr['style'] } })} aria-label="Linie des Korrekturrands">
                        <option value="thin">dünne Linie</option>
                        <option value="medium">mittlere Linie</option>
                        <option value="thick">dicke Linie</option>
                        <option value="end">Zeilen enden</option>
                      </select>
                    </>
                  )}
                </div>
              </div>
            </Group>
          </>
        )}
        {tab === 'layout' && (
          <>
            <Group label="Seite einrichten">
              <div className={st.rows}>
                <div className={st.row}>
                  <Ico n="attributepagesize" size={16} />
                  <select value={P.size} onChange={(e) => props.setPageOpt({ size: e.target.value as 'a4' | 'a5' })} aria-label="Format">
                    <option value="a4">A4</option>
                    <option value="a5">A5</option>
                  </select>
                </div>
                <div className={st.row}>
                  <RB icon="insertpagenumberfield" label="Seitenzahlen" on={P.pageNumbers} onClick={() => props.setPageOpt({ pageNumbers: !P.pageNumbers })} />
                </div>
              </div>
              <RB icon="insertpagebreak" label="Umbruch" big onClick={() => props.add('pagebreak')} title="Seitenumbruch nach dem gewählten Baustein" />
            </Group>
            <Group label="Broschüre">
              <RB icon="printpreview" label="Broschüre" big on={P.booklet} onClick={() => props.setPageOpt({ booklet: !P.booklet })} title={`Als Broschüre drucken (${P.size === 'a5' ? 'A4 quer' : 'A3 quer'}): Seite 1 steht neben der letzten`} />
              {P.booklet && (
                <div className={st.rows}>
                  <span className={st.hint}>leere Seiten füllen mit</span>
                  <select value={P.fill} onChange={(e) => props.setPageOpt({ fill: e.target.value as Ruling })} aria-label="Leere Seiten füllen mit">
                    <option value="lines">Schreiblinien</option>
                    <option value="grid">Karos</option>
                    <option value="empty">nichts</option>
                  </select>
                </div>
              )}
            </Group>
            <Group label="Spalten">
              {[1, 2, 3, 4].map((n) => (
                <button
                  key={n}
                  className={`${st.rb} ${st.rbBig} ${b?.type === 'cols' && (b.cols ?? []).length === n ? st.rbOn : ''}`}
                  onClick={() => (b?.type === 'cols' ? props.setColCount(b.id, n) : n > 1 ? props.add('cols', { cols: Array.from({ length: n }, () => []), ratio: Array(n).fill(1) }) : null)}
                  disabled={n === 1 && b?.type !== 'cols'}
                  title={b?.type === 'cols' ? `${n === 1 ? 'Spalten auflösen' : `${n} Spalten`}` : `${n} Spalten einfügen`}
                >
                  <ColsIcon n={n} />
                  <span>{n === 1 ? 'Eine' : n === 2 ? 'Zwei' : n === 3 ? 'Drei' : 'Vier'}</span>
                </button>
              ))}
              <RB icon="distributecolumns" label="Gleichmäßig" big disabled={b?.type !== 'cols'} onClick={() => set({ ratio: (b?.cols ?? []).map(() => 1) })} title="Mittelstege zurücksetzen: alle Spalten gleich breit" />
            </Group>
            <Group label="Nummerierung">
              <div className={st.rows}>
                <span className={st.hint}>Teilaufgaben</span>
                <select value={P.sub ?? 'letter'} onChange={(e) => props.setPageOpt({ sub: e.target.value as 'letter' | 'dot' })} aria-label="Nummern der Teilaufgaben">
                  <option value="letter">a), b), c) …</option>
                  <option value="dot">1.1, 1.2, 1.3 …</option>
                </select>
              </div>
            </Group>
            {b && <Arrange {...props} b={b} />}
          </>
        )}
        {tab === 'block' && b && <BlockTab {...props} b={b} />}
        {tab === 'block' && !b && <span className={st.hint}>Klick auf einen Baustein auf der Seite.</span>}
      </div>
    </div>
  );
}

/** Spalten-Icon mit n Spalten (für „Eine“ bis „Vier“) */
function ColsIcon({ n }: { n: number }) {
  const w = (20 - (n - 1) * 2) / n;
  return (
    <span className={st.ico} style={{ width: 24, height: 24 }} aria-hidden>
      <svg className="cb" viewBox="0 0 24 24">
        {Array.from({ length: n }, (_, k) => (
          <g key={k}>
            {[5, 8, 11, 14, 17, 20].map((y) => (
              <rect key={y} x={2 + k * (w + 2)} y={y - 1} width={w} height={1} fill="#3a3a38" />
            ))}
          </g>
        ))}
        <rect x={2} y={1} width={20} height={1.2} fill="#1e6fb8" />
      </svg>
    </span>
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

/** Anordnen: im Reiter des Bausteins und unter „Layout“ */
function Arrange(props: RibbonProps & { b: Block }) {
  const { b, doc } = props;
  const inCols = !!listOf(doc.blocks, b.id)?.parent;
  return (
    <Group label="Anordnen">
      <div className={st.rows}>
        <div className={st.row}>
          <RB icon="moveup" label="Nach oben" hideLabel onClick={() => props.move(b.id, -1)} />
          <RB icon="movedown" label="Nach unten" hideLabel onClick={() => props.move(b.id, 1)} />
          <RB icon="duplicatepage" label="Verdoppeln" hideLabel onClick={() => props.duplicate(b.id)} />
        </div>
        <div className={st.row}>
          {b.type !== 'cols' && !inCols && <RB icon="formatcolumns" label="Neben den nächsten" hideLabel onClick={() => props.toColumns(b.id)} title="Diesen und den nächsten Baustein nebeneinander setzen" />}
          <RB icon="delete" label="Entfernen" hideLabel onClick={() => props.remove(b.id)} title="Entfernen (Entf)" />
        </div>
      </div>
    </Group>
  );
}

function BlockTab(props: RibbonProps & { b: Block }) {
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
  const rows = b.rows ?? [];
  const cell = props.cell ?? { r: rows.length - 1, c: (rows[0]?.length ?? 1) - 1 };
  const setRows = (r: string[][]) => set({ rows: r.length ? r : [['']] });
  const tables = walk(doc.blocks).filter((x) => x.type === 'table');
  const size = (b2: Block) => (
    <>
      <input type="range" min={20} max={100} step={5} value={b2.width ?? 100} onChange={(e) => set({ width: Number(e.target.value) })} aria-label="Breite" title={`Breite ${b2.width ?? 100} %`} />
      <span className={st.hint}>{b2.width ?? 100} %</span>
    </>
  );
  const align = !b.free && (b.type === 'image' || b.type === 'chart') && (
    <span className={st.row}>
      {(
        [
          ['left', 'leftpara', 'links'],
          ['center', 'centerpara', 'Mitte'],
          ['right', 'rightpara', 'rechts'],
        ] as const
      ).map(([v, i, l]) => (
        <RB key={v} icon={i} label={l} hideLabel on={(b.align ?? 'center') === v} onClick={() => set({ align: v })} />
      ))}
    </span>
  );
  return (
    <>
      {b.type === 'heading' && (
        <Group label="Überschrift">
          <RB icon="heading1parastyle" label="Groß" big on={b.level === 1} onClick={() => set({ level: 1 })} />
          <RB icon="heading2parastyle" label="Unterstrichen" big on={(b.level ?? 2) === 2} onClick={() => set({ level: 2 })} />
        </Group>
      )}
      {b.type === 'material' && (
        <Group label="Material">
          <div className={st.rows}>
            <input className={st.rIn} value={b.label ?? ''} onChange={(e) => set({ label: e.target.value })} placeholder="Material 1 (automatisch)" aria-label="Bezeichnung" style={{ width: 170 }} />
            <input className={st.rIn} value={b.source ?? ''} onChange={(e) => set({ source: e.target.value })} placeholder="Quelle (Fußnote)" aria-label="Quelle" style={{ width: 170 }} />
          </div>
          <RB icon="linenumberingdialog" label="Zeilen zählen" big on={b.lineNumbers !== false} onClick={() => set({ lineNumbers: b.lineNumbers === false })} title="Zeilennummern alle fünf Zeilen" />
        </Group>
      )}
      {b.type === 'task' && (
        <>
          <Group label="Nummer">
            <RB icon="hangingindent" label="Teilaufgabe" big on={!!b.subtask} onClick={() => set({ subtask: !b.subtask })} title="Eingerückt, a), b) … oder 1.1, 1.2 …" />
            <div className={st.rows}>
              <span className={st.hint}>eigene Nummer</span>
              <input className={st.rIn} value={b.num ?? ''} onChange={(e) => set({ num: e.target.value })} placeholder={`automatisch: ${labels.get(b.id) ?? ''}`} aria-label="Eigene Nummer" title="Eigene Nummer, z. B. 1.2 oder 1 b); leer = automatisch" style={{ width: 130 }} />
            </div>
          </Group>
          <Group label="Bewertung">
            <div className={st.rows}>
              <span className={st.hint}>Punkte oder Anteil</span>
              <input className={st.rIn} value={b.points ?? ''} onChange={(e) => set({ points: e.target.value })} placeholder="z. B. 12 P. oder 50%" aria-label="Punkte oder Anteil" style={{ width: 130 }} />
            </div>
          </Group>
          <Group label="Antwortzeilen">
            <div className={st.rows}>
              <input className={st.rIn} type="number" min={0} max={40} value={b.lines ?? 0} onChange={(e) => set({ lines: Math.max(0, Math.min(40, Number(e.target.value) || 0)) })} aria-label="Antwortzeilen" style={{ width: 64 }} />
              {(b.lines ?? 0) > 0 && ruling(b.lineStyle, (r) => set({ lineStyle: r }), false)}
            </div>
          </Group>
        </>
      )}
      {b.type === 'image' && (
        <>
          <Group label="Bild">
            <label className={`${st.rb} ${st.rbBig}`} title="Bild vom Gerät">
              <Ico n="insertgraphic" />
              <span>{b.src ? 'Anderes Bild' : 'Auswählen'}</span>
              <input type="file" accept="image/*" hidden onChange={(e) => (e.target.files?.[0] && props.onImage(e.target.files[0]), (e.target.value = ''))} />
            </label>
            <RB icon="gallery" label="Aus dem Material" big onClick={() => props.setPanel('material')} />
            <form
              className={st.urlRow}
              onSubmit={(e) => {
                e.preventDefault();
                void fromUrl();
              }}
            >
              <Ico n="inserthyperlink" size={16} />
              <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Adresse: https://…" aria-label="Adresse des Bilds im Netz" />
              <button type="submit" className="btn" disabled={loading || !url.trim()}>
                {loading ? 'Lädt …' : 'Laden'}
              </button>
            </form>
          </Group>
          <Group label="Größe und Lage">
            <div className={st.rows}>
              <div className={st.row}>{size(b)}</div>
              <div className={st.row}>
                {align}
                <RB icon="rotateleft" label="Um 90° nach links drehen" hideLabel disabled={!b.src} onClick={() => void rotate(-1)} />
                <RB icon="rotateright" label="Um 90° nach rechts drehen" hideLabel disabled={!b.src} onClick={() => void rotate(1)} />
              </div>
            </div>
            {b.free ? (
              <div className={st.rows}>
                <label className={st.check} title="Das Bild liegt über dem Text; der Text rückt an seinen Platz nach">
                  <input type="checkbox" checked={!!b.over} onChange={(e) => set({ over: e.target.checked })} /> vor dem Text
                </label>
                <button className="btn" onClick={() => set({ free: false, over: false, dx: undefined, dy: undefined })} title="Bild wieder an seinen Platz im Text setzen">
                  An seinen Platz
                </button>
              </div>
            ) : (
              <span className={st.hint}>Ziehen verschiebt
                <br />
                das Bild.
              </span>
            )}
          </Group>
        </>
      )}
      {b.type === 'table' && (
        <>
          <Group label="Zeilen und Spalten">
            <div className={st.rows}>
              <div className={st.row}>
                <RB icon="insertrowsbefore" label="Zeile darüber" hideLabel onClick={() => setRows([...rows.slice(0, cell.r), rows[0].map(() => ''), ...rows.slice(cell.r)])} />
                <RB icon="insertrowsafter" label="Zeile darunter" hideLabel onClick={() => setRows([...rows.slice(0, cell.r + 1), rows[0].map(() => ''), ...rows.slice(cell.r + 1)])} />
                <RB icon="deleterows" label="Zeile löschen" hideLabel disabled={rows.length < 2} onClick={() => setRows(rows.filter((_, i) => i !== cell.r))} />
              </div>
              <div className={st.row}>
                <RB icon="insertcolumnsbefore" label="Spalte links" hideLabel onClick={() => setRows(rows.map((r) => [...r.slice(0, cell.c), '', ...r.slice(cell.c)]))} />
                <RB icon="insertcolumnsafter" label="Spalte rechts" hideLabel onClick={() => setRows(rows.map((r) => [...r.slice(0, cell.c + 1), '', ...r.slice(cell.c + 1)]))} />
                <RB icon="deletecolumns" label="Spalte löschen" hideLabel disabled={(rows[0]?.length ?? 0) < 2} onClick={() => setRows(rows.map((r) => r.filter((_, j) => j !== cell.c)))} />
              </div>
            </div>
          </Group>
          <Group label="Tabellenformat">
            <RB icon="tabledialog" label="Kopfzeile" big on={b.headRow !== false} onClick={() => set({ headRow: b.headRow === false })} title="Erste Zeile fett und hinterlegt" />
            <div className={st.rows}>
              <span className={st.hint}>Linien</span>
              <select value={b.grid ?? 'all'} onChange={(e) => set({ grid: e.target.value as Block['grid'] })} aria-label="Linien der Tabelle">
                <option value="all">alle Linien</option>
                <option value="rows">nur waagerecht</option>
                <option value="none">ohne Linien</option>
              </select>
            </div>
          </Group>
          <Group label="Daten">
            <RB icon="insertobjectchart" label="Diagramm daraus" big onClick={() => props.add('chart', { ref: b.id, caption: b.caption ? `Diagramm: ${b.caption}` : '' })} title="Diagramm aus dieser Tabelle: erste Zeile = Reihen, erste Spalte = Kategorien" />
          </Group>
        </>
      )}
      {b.type === 'chart' && (
        <>
          <Group label="Daten">
            <div className={st.rows}>
              <span className={st.hint}>aus der Tabelle</span>
              <select value={b.ref ?? ''} onChange={(e) => set({ ref: e.target.value || undefined })} aria-label="Tabelle">
                <option value="">– Tabelle wählen –</option>
                {tables.map((t, k) => (
                  <option key={t.id} value={t.id}>
                    {t.caption?.trim() || `Tabelle ${k + 1}`}: {blockSummary(t).slice(0, 40)}
                  </option>
                ))}
              </select>
            </div>
            {!tables.length && <RB icon="inserttable" label="Tabelle anlegen" big onClick={() => props.add('table')} />}
          </Group>
          <Group label="Diagrammtyp">
            {(
              [
                ['col', 'Säulen'],
                ['bar', 'Balken'],
                ['line', 'Linie'],
                ['pie', 'Kreis'],
              ] as const
            ).map(([k, l]) => (
              <button key={k} className={`${st.rb} ${st.rbBig} ${(b.kind ?? 'col') === k ? st.rbOn : ''}`} onClick={() => set({ kind: k })}>
                <ChartIcon kind={k} />
                <span>{l}</span>
              </button>
            ))}
            <label className={st.check}>
              <input type="checkbox" checked={!!b.gray} onChange={(e) => set({ gray: e.target.checked })} /> Graustufen
            </label>
          </Group>
          <Group label="Größe">
            <div className={st.rows}>
              <div className={st.row}>{size(b)}</div>
              <div className={st.row}>
                {align}
                <select value={b.hMm ?? 60} onChange={(e) => set({ hMm: Number(e.target.value) })} aria-label="Höhe">
                  {[40, 50, 60, 75, 90, 110].map((v) => (
                    <option key={v} value={v}>
                      Höhe {v / 10} cm
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </Group>
        </>
      )}
      {b.type === 'glossary' && (
        <Group label="Glossar">
          <div className={st.rows}>
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
          </div>
          <RB icon="insertmultiindex" label="Erklärungen" big onClick={() => props.setPanel('glossary')} />
        </Group>
      )}
      {b.type === 'cols' && (
        <Group label="Spalten">
          {[1, 2, 3, 4].map((n) => (
            <button key={n} className={`${st.rb} ${st.rbBig} ${(b.cols ?? []).length === n ? st.rbOn : ''}`} onClick={() => props.setColCount(b.id, n)} title={n === 1 ? 'Spalten auflösen' : `${n} Spalten`}>
              <ColsIcon n={n} />
              <span>{n === 1 ? 'Eine' : n === 2 ? 'Zwei' : n === 3 ? 'Drei' : 'Vier'}</span>
            </button>
          ))}
          <RB icon="distributecolumns" label="Gleichmäßig" big onClick={() => set({ ratio: (b.cols ?? []).map(() => 1) })} title="Mittelstege zurücksetzen: alle Spalten gleich breit" />
          <span className={st.hint}>
            Die Mittelstege
            <br />
            auf der Seite ziehen.
          </span>
        </Group>
      )}
      {b.type === 'lines' && (
        <Group label="Linien">
          <div className={st.rows}>
            <div className={st.row}>
              {ruling(b.style, (r) => set({ style: r }))}
              {b.style !== 'grid' && b.style !== 'empty' && (
                <select value={b.spacing ?? 8} onChange={(e) => set({ spacing: Number(e.target.value) })} aria-label="Zeilenabstand">
                  {[6, 7, 8, 9, 10, 12].map((v) => (
                    <option key={v} value={v}>
                      Abstand {v} mm
                    </option>
                  ))}
                </select>
              )}
            </div>
            <div className={st.row}>
              <label className={st.check}>
                <input type="checkbox" checked={!!b.fill} onChange={(e) => set({ fill: e.target.checked })} /> bis Seitenende
              </label>
              {!b.fill && <input className={st.rIn} type="number" min={1} max={60} value={b.count ?? 8} onChange={(e) => set({ count: Math.max(1, Math.min(60, Number(e.target.value) || 1)) })} aria-label="Anzahl Zeilen" style={{ width: 64 }} />}
              {b.style !== 'empty' && doc.page.korr.side !== 'none' && (
                <label className={st.check}>
                  <input type="checkbox" checked={!b.korrOff} onChange={(e) => set({ korrOff: !e.target.checked })} /> Korrekturrand
                </label>
              )}
            </div>
          </div>
        </Group>
      )}
      {b.type === 'pagebreak' && (
        <Group label="Seitenumbruch">
          <span className={st.hint}>Der nächste Baustein beginnt auf einer neuen Seite.</span>
        </Group>
      )}
      <Arrange {...props} />
    </>
  );
}

function ChartIcon({ kind }: { kind: 'col' | 'bar' | 'line' | 'pie' }) {
  const c = ['#1e6fb8', '#e07b39', '#3a3a38'];
  return (
    <span className={st.ico} style={{ width: 24, height: 24 }} aria-hidden>
      <svg className="cb" viewBox="0 0 24 24">
        {kind === 'col' && [4, 10, 16].map((x, k) => <rect key={x} x={x} y={[10, 4, 13][k]} width={4} height={[11, 17, 8][k]} fill={c[k % 2]} />)}
        {kind === 'bar' && [4, 10, 16].map((y, k) => <rect key={y} x={3} y={y} width={[11, 17, 8][k]} height={4} fill={c[k % 2]} />)}
        {kind === 'line' && <polyline points="3,18 8,11 13,14 20,5" fill="none" stroke={c[0]} strokeWidth={2} />}
        {kind === 'pie' && (
          <>
            <circle cx={12} cy={12} r={9} fill={c[0]} />
            <path d="M12 12 L12 3 A9 9 0 0 1 20.6 14.8 Z" fill={c[1]} />
          </>
        )}
        {kind !== 'pie' && <path d="M2 2v20h20" fill="none" stroke={c[2]} strokeWidth={1} />}
      </svg>
    </span>
  );
}

/** Rahmendaten: jedes Feld an oder aus, automatisch oder frei (eigener Text oder Linie zum Ausfüllen) */
function HeadDialog({ doc, title, course, teacher, setHeader, onClose }: { doc: BlattDoc; title: string; course: string; teacher: string; setHeader: (p: Partial<BlattDoc['page']['header']>) => void; onClose: () => void }) {
  const F = headFields(doc);
  const H = doc.page.header;
  const put = (k: HeadKey, p: Partial<HeadField>) => setHeader({ fields: { ...F, [k]: { ...F[k], ...p } }, show: true });
  const autoText: Partial<Record<HeadKey, string>> = {
    title: title || '(Name des Blatts)',
    klasse: course ? `${course}; beim Druck mit QR-Code die Klasse aus Autogra.fi` : 'beim Druck mit QR-Code die Klasse aus Autogra.fi',
    teacher: teacher,
    date: `Tag des Drucks (heute ${new Date().toLocaleDateString('de-DE')})`,
    name: 'beim Druck mit QR-Code aus der Klassenliste, sonst Linie',
    points: totalPoints(doc) !== null ? `___ / ${String(totalPoints(doc)).replace('.', ',')} (Summe der Aufgaben)` : 'Summe der Aufgaben (alle Aufgaben brauchen eine Punktzahl)',
  };
  return (
    <div className={st.headDlg} role="dialog" aria-label="Rahmendaten" onMouseDown={(e) => e.stopPropagation()}>
      <div className="row">
        <strong>Rahmendaten</strong>
        <span className="grow" />
        <label className={st.check}>
          <input type="checkbox" checked={H.show !== false} onChange={(e) => setHeader({ show: e.target.checked })} /> Kopf zeigen
        </label>
        <button className="btn" onClick={onClose} title="Schließen">
          ✕
        </button>
      </div>
      <table className={st.headTable}>
        <thead>
          <tr>
            <th>zeigen</th>
            <th />
            <th>automatisch</th>
            <th>sonst frei: eigener Text, leer = Linie zum Ausfüllen</th>
          </tr>
        </thead>
        <tbody>
          {HEAD_KEYS.map(({ key, label, auto }) => {
            const f = F[key];
            const isAuto = !!auto && f.auto === true;
            return (
              <tr key={key} className={f.on ? '' : st.off}>
                <td>
                  <input type="checkbox" checked={f.on} onChange={(e) => put(key, { on: e.target.checked })} aria-label={`${label} zeigen`} />
                </td>
                <td>{label}</td>
                <td>{auto ? <input type="checkbox" checked={isAuto} disabled={!f.on} onChange={(e) => put(key, { auto: e.target.checked })} aria-label={`${label} automatisch`} /> : <span className={st.hint}>–</span>}</td>
                <td>
                  {isAuto ? (
                    <span className={st.hint}>{autoText[key] ?? auto}</span>
                  ) : key === 'grade' ? (
                    <span className={st.hint}>Linie zum Eintragen</span>
                  ) : key === 'name' ? (
                    <span className={st.hint}>Linie zum Ausfüllen</span>
                  ) : (
                    <input className={st.rIn} value={f.value ?? ''} disabled={!f.on} onChange={(e) => put(key, { value: e.target.value })} placeholder="leer = Linie" aria-label={label} style={{ width: '100%' }} />
                  )}
                </td>
              </tr>
            );
          })}
          <tr>
            <td>
              <input type="checkbox" checked={H.qr !== 'none'} onChange={(e) => setHeader({ qr: e.target.checked ? 'first' : 'none', show: true })} aria-label="QR-Code zeigen" />
            </td>
            <td>QR-Code</td>
            <td>
              <input type="checkbox" checked disabled aria-label="QR-Code automatisch" />
            </td>
            <td>
              <select value={H.qr === 'all' ? 'all' : 'first'} disabled={H.qr === 'none'} onChange={(e) => setHeader({ qr: e.target.value as 'first' | 'all' })} aria-label="QR-Code auf">
                <option value="first">persönlich aus Autogra.fi, auf Seite 1</option>
                <option value="all">persönlich aus Autogra.fi, auf jeder Seite</option>
              </select>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
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
                  <b><Ico n={BICON[b.type]} size={14} /> {BLOCK_LABEL[b.type]}</b> {blockSummary(b).slice(0, 90)}
                </button>
              ))}
              {types.length > 0 && <div className={st.secHead}>Einfügen</div>}
              {types.map((t) => (
                <button key={t} className={st.hit} onClick={() => add(t)}>
                  + <Ico n={BICON[t]} size={14} /> {BLOCK_LABEL[t]}
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

function PrintDialog({ doc, title, head, onClose }: { doc: BlattDoc; title: string; head: HeadCtx; onClose: () => void }) {
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
        copies = r.items.sort((a, b) => (order.get(a.user_id) ?? 0) - (order.get(b.user_id) ?? 0)).map((it) => ({ name: it.name, printName, code: it.code, qr: it.qr, klasse: tasks.find((x) => x.id === task)?.class || undefined }));
        if (d.page.header.qr === 'none') d.page.header = { ...d.page.header, show: true, qr: 'first' };
      }
      printCopies(d, copies, title, head);
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
function printCopies(doc: BlattDoc, copies: Copy[], title: string, head: HeadCtx) {
  const printHost = document.createElement('div');
  printHost.className = `${st.host} ${st.printHost}`;
  document.body.appendChild(printHost);
  const tmp = document.createElement('div');
  tmp.className = st.host;
  printHost.appendChild(tmp);
  const sheets: Element[] = [];
  for (const c of copies) {
    const r = paginate(doc, tmp, c, { head });
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
