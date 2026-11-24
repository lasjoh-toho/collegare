'use client';
/**
 * Arbeitsblatt und Klassenarbeit (Material, Art „blatt“; Wunsch Jo, 22. November 2026).
 *
 * Links das Blatt (Format, Broschüre, Kopfzeile) und die Bausteine, in der Mitte die Seiten so, wie sie gedruckt
 * werden, rechts der gewählte Baustein. Gesetzt wird mit lib/blatt.ts. Drucken: ein Exemplar ohne Code oder je Person
 * einer Autogra.fi-Aufgabe ein Exemplar mit deren persönlichem QR-Code (Klassenliste und Codes holt der Browser dort,
 * mit der Anmeldung in Autogra.fi). Die Broschüre wird ausgeschossen: Seite 1 steht auf dem Bogen neben der letzten.
 */
import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ProjectShell } from '@/components/ProjectShell';
import { Topbar } from '@/components/Topbar';
import { editToTufte, glossHtml, noteHtml, tufteToEdit } from '@/lib/tufteEdit';
import { fileUrl, type Material } from '@/components/Materials';
import { colibre } from '@/lib/colibre';
import { fromTypst, toTypst } from '@/lib/blattTypst';
import { ApiError, get, href, patch, post } from '@/lib/api';
import { toDocx, docxName } from '@/lib/blattDocx';
import { download, pickFile } from '@/lib/bentoFiles';
import {
  BLOCK_LABEL,
  blockSummary,
  findBlock,
  fromEditMd,
  glossaryTerms,
  paraSpans,
  CORNERS,
  DEFAULT_CORNERS,
  HEAD_TOKENS,
  headCorners,
  type CornerKey,
  insertAfter,
  insertIntoCol,
  listOf,
  mapLists,
  CONVERTIBLE,
  convertBlock,
  SPLITTABLE,
  splitBlock,
  splitBlockAt,
  splitCount,
  newBlock,
  pageGeom,
  paginate,
  parseDoc,
  plainMd,
  removeBlock,
  setTerm,
  sheetSize,
  styleOf,
  STYLE_KEYS,
  taskLabels,
  TEMPLATES,
  LINE_MM,
  LINE_LABEL,
  hasFrame,
  type LineWeight,
  type CaptionStyle,
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
  type HeadCtx,
  type Korr,
  type Problem,
  type Ruling,
} from '@/lib/blatt';
import type { ProjectView } from '@/lib/types';
import { useMe, useQuery } from '@/lib/useMe';
import { type Crop, cropImage, kb, loadImage, removeBackground, shrinkImage, srcBytes } from '@/lib/blattImage';
import { ScanDialog } from '@/components/ScanDialog';
import st from './blatt.module.css';

interface Page {
  id: number;
  kind: string;
  title: string;
  note: string;
  body: string;
}

const ADD: BlockType[] = ['material', 'image', 'task', 'text', 'quote', 'box', 'heading', 'table', 'chart', 'glossary', 'lines', 'pagebreak', 'grade'];
/** Textbausteine und ihr Hauptfeld: ein Klick in den Baustein oder ein neuer Baustein öffnet es zum Schreiben */
const MAIN_FIELD: Partial<Record<BlockType, FieldName>> = { text: 'md', material: 'md', quote: 'md', box: 'md', task: 'md', heading: 'text', glossary: 'text' };
const MAX = 4_000_000;

const INFO = `Hier entsteht ein Arbeitsblatt oder eine Klassenarbeit zum Ausdrucken. Du schreibst direkt auf der Seite wie in Word: Klick in einen Text und tipp los. Ein Klick ins Leere unter dem letzten Baustein schreibt dort weiter; ein neuer Textbaustein öffnet sich gleich zum Schreiben. Esc beendet das Schreiben.

Den Namen des Blatts änderst du oben in der Kopfleiste. „Datei“: speichern, Kopie anlegen (z. B. für Gruppe B), drucken oder als PDF speichern, als Word-Datei, Webseite oder Text exportieren und das Blatt als Blatt-Datei weitergeben oder öffnen. Das Menüband beginnt mit „Einfügen“ (Textbausteine, Aufgaben, Bild, Tabelle, Diagramm, Spalten, Seitenumbruch, Glossar). „Start“: Format übertragen, Schrift (Größe, Stärke, Laufweite, fett, kursiv, Textmarker), Absatz (Listen, Einzug, Ausrichtung, Zeilen- und Absatzabstand), Formatvorlagen und Rand für Notizen, im Text Fußnote, Randbemerkung und Glossar-Wort. Ohne Markierung gelten fett und kursiv für den ganzen Baustein. „Aufgabe“: neue Aufgaben, Nummern der Teilaufgaben, Nummer, Punkte und Antwortzeilen der gewählten Aufgabe, Rahmendaten, QR-Code, Korrekturrand und Wasserzeichen. „Entwurf“: Schrift des Blatts, Kopfzeile, Textfluss und Typst-Code. „Layout“: Ränder, Hoch- oder Querformat, Format, Umbrüche, Spalten, Seitenfolge (einzeln, zwei Seiten je Blatt, Broschüre) und Anordnen (Umfluss, Ausrichten, Reihenfolge). Die Klappmenüs zeigen unter dem Knopf, was gerade gewählt ist.

Format übertragen: Baustein wählen, „Format übertragen“, dann auf einen anderen Baustein klicken. Doppelklick auf den Knopf überträgt auf mehrere nacheinander; Esc beendet.

Textfluss (Entwurf → „Textfluss zeigen“): Gestrichelte Rahmen zeigen jeden Baustein. Läuft ein Text über mehrere Seiten, tragen seine Stücke Nummern und sagen, wo es weitergeht. Der Kettenknopf zwischen zwei Bausteinen verbindet sie: verbundene Bausteine bleiben auf derselben Seite. Unter Layout → Umbrüche: „beginnt auf neuer Seite“ und „nicht über Seiten teilen“. Layout → Spalten lässt einen Text durch zwei oder drei verbundene Spalten fließen; die Stegbreite stellst du dort ein.

Typst-Code (Entwurf → „Typst-Code“, für Fortgeschrittene): rechts steht das ganze Blatt als Typst-Code. Ändern und „Übernehmen“ (Strg+Enter); ein Fehler nennt die Zeile, das Blatt bleibt dann wie es war. Bilder stehen als Verweis #bild("…") im Code; neue Bilder fügst du über „Einfügen“ hinzu.

Kopf: vier Felder in den Ecken, die du direkt auf der Seite ausfüllst (oben links steht in der ersten Zeile der Titel). Klick in eine Ecke und schreib; Enter beginnt eine neue Zeile. Im Reiter „Kopf“ setzt du Platzhalter ein, die das Blatt selbst füllt (Titel = Name des Blatts, Name aus der Klassenliste beim Druck, Klasse, Lehrkraft, Datum = Tag des Drucks, Punkte = Linie und Summe der Aufgaben), dazu „Linie“ zum Ausfüllen: drei oder mehr Unterstriche ___ werden zur Linie, so lang wie getippt. „Muster“ füllt alle vier Ecken auf einmal (Standard, Klassenarbeit, Arbeitsblatt, nur Titel, leer). Dort auch Abgrenzung (Linie, Kasten, schlicht), Größe des Titels, QR-Code und Löschen.

Aufteilen (unter „Start“ → Im Text, bei Aufgaben unter „Aufgabe“, oder Rechtsklick links): Ein Baustein mit eingefügtem Text wird an der Schreibmarke geteilt, nach Nummern (1., 2), Aufgabe 3:, a); bei Aufgaben fällt die Nummer weg, a) wird Teilaufgabe, Punkte am Zeilenende kommen ins Punktefeld), in einzelne Absätze oder an Überschriften (#). Die Zahl hinter dem Knopf zeigt, wie viele Nummern erkannt wurden. Definitionen (Einfügen → Definitionen, z. B. Operatoren): jede Zeile „Begriff: Erklärung“ steht als Begriff links und Erklärung rechts; Zeilen ohne Doppelpunkt sind Zwischenüberschriften. Die Vorlage „Definitionen“ gibt es auch für Erklärtext und Kasten. „Vorlagen“: Die Blattvorlage „Buchsatz mit Randspalte“ setzt das ganze Blatt in Serifenschrift mit breiter Randspalte; Fußnoten stehen nummeriert neben der Zeile (auch einzeln einschaltbar), Überschriften sind kursiv, ein Zitat wird zum Motto mit Quelle („Motto“ fügt eines ein). „Standard“ stellt alles zurück. Absatzvorlagen (z. B. Einleitung, Kleingedruckt, Mit Randspalte, Zwei Spalten) gelten für jeden Textbaustein; „Format merken“ speichert das Format des gewählten Bausteins als eigene Vorlage (Rechtsklick auf sie löscht sie). Zeichenvorlagen wirken auf den markierten Text: betont, stark, markiert, unterstrichen, in den Rand, als Fußnote, als Begriff. Löschen: das × am Baustein (beim Darüberfahren), „Löschen“ ganz rechts im Reiter des Bausteins oder Rechtsklick auf den Eintrag links. Links unter „Elemente“ zeigen gestrichelte Linien, wo eine neue Seite beginnt; ganz oben steht der Kopf mit den Rahmendaten (× blendet ihn aus, „+ Kopf“ holt ihn zurück). Unterschriften unter Bildern, Diagrammen und Tabellen gestaltest du unter „Entwurf“ → Bildunterschrift (Größe, Schnitt, Ausrichtung, grau, nummerieren). Eine leere Zeile im Text bleibt stehen.

Bilder (Reiter „Bild“, erscheint beim Anklicken eines Bilds): Helligkeit, Kontrast, Graustufen und Rahmen (Linie, runde Ecken, Schatten). „Zuschneiden“ zeigt Griffe am Bild auf der Seite: Ränder wegziehen, Enter oder „Zuschneiden“ übernimmt, Esc bricht ab. „Freistellen“ macht den Hintergrund durchsichtig, der vom Rand her zusammenhängt. „Verkleinern“ macht die Datei kleiner. „Original“ nimmt Zuschneiden, Freistellen und Verkleinern zurück. Ein Bild verschiebst du, indem du es auf der Seite ziehst.

Bewertung (Reiter „Aufgabe“): „Punktefelder“ setzt hinter jede Aufgabe ein Kästchen oder eine Linie für die erreichten Punkte. Mit „Sollpunktzahl zeigen“ steht die mögliche Punktzahl gleich im Feld (z. B. [    / 6 P.]), sonst bleibt sie im Text der Aufgabe. „Notenkasten“ fügt einen Kasten ein mit den Punkten je Aufgabe, der Summe und einem Feld für die Note; auf Wunsch mit Bemerkung und Unterschrift. Hat das Blatt einen QR-Code aus Autogra.fi, steht unten im Notenkasten „Scannen Sie für ein genaues Feedback erneut den QR-Code.“ (abschaltbar). Die Stärke der Rahmenlinien wählst du bei Kästen unter „Start“ → Formatvorlagen → „Linie“ (Haarlinie bis kräftig), beim Notenkasten auch in seinem Reiter.

Aufgaben werden von selbst nummeriert; Teilaufgaben heißen a), b) … oder 1.1, 1.2 … (Reiter „Aufgabe“ → Nummern). Eine eigene Nummer wie „1 b)“ trägst du dort ein, wenn die Aufgabe gewählt ist.

Bausteine nebeneinander: unter „Einfügen“ oder Layout → Spalten anlegen und die Zahl der Spalten wählen. Die Mittelstege ziehst du auf der Seite mit der Maus; „Gleichmäßig“ macht alle Spalten wieder gleich breit. In eine leere Spalte klicken, dann einen Baustein einfügen. Oder einen Baustein wählen und „neben den nächsten“.

Tabelle: in die Zellen schreiben, Tab springt in die nächste Zelle (am Ende kommt eine Zeile dazu). Aus Excel oder Calc Kopiertes verteilt sich auf die Zellen. „Diagramm daraus“ zeichnet Säulen, Balken, Linie oder Kreis: erste Zeile = Namen der Reihen, erste Spalte = Kategorien.

Bilder: hineinziehen, einfügen, im Reiter „Bild“ auswählen, aus dem Material oder über ihre Adresse im Netz laden. Ein Bild lässt sich drehen und mit der Maus frei auf der Seite verschieben; sein Platz im Text bleibt frei, außer du wählst „vor dem Text“.

Links wählst du die Ansicht: Seiten (zum Schreiben), Doppelseiten (wie im aufgeschlagenen Heft, um den Mittelschnitt zu prüfen; auch hier schreibst du) und Druckbögen (so liegen die Seiten auf dem Papier). Darunter wechselst du zwischen Seitenminiaturen, Gliederung und allen Elementen (ziehen ändert die Reihenfolge). Ein Rechtsklick auf einen Eintrag der Gliederung oder der Elemente wandelt ihn um: Überschrift, Erklärtext, Material, Zitat, Kasten oder Aufgabe; der Text bleibt erhalten. In den Elementen geht das auch mit dem kleinen Knopf am gewählten Eintrag.

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
  /** „Bild aufnehmen“ mit dem Scanner aus Autogra.fi (Wunsch Jo, 24. November 2026) */
  const [scan, setScan] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  /** Kontextmenü „Umwandeln in“ für einen Baustein der linken Leiste */
  const [conv, setConv] = useState<{ bid: string; x: number; y: number } | null>(null);
  /** Bild, das gerade auf der Seite zugeschnitten wird */
  const [cropBid, setCropBid] = useState<string | null>(null);
  /** wo die Seiten beginnen: vor welchem Baustein (oder mitten in ihm, wenn er weiterläuft) */
  const [pageMarks, setPageMarks] = useState<Map<string, { page: number; cont: boolean }[]>>(new Map());
  const [dropAt, setDropAt] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('insert');
  /** Format übertragen: Gestaltung, die beim nächsten Klick auf einen Baustein übernommen wird */
  const [painter, setPainter] = useState<{ type: BlockType; style: Partial<Block>; sticky: boolean } | null>(null);
  const [flowView, setFlowView] = useState(false);
  const [busy, setBusy] = useState('');
  const [pro, setPro] = useState(false);
  useEffect(() => {
    try {
      setPro(localStorage.getItem('collegare.blatt.code') === '1');
    } catch {}
  }, []);
  const [panel, setPanel] = useState<Panel | null>(null);
  /** links: Seitenminiaturen, Gliederung oder alle Elemente */
  const [leftTab, setLeftTab] = useState<'thumbs' | 'outline' | 'blocks'>('blocks');
  /** Kopf gewählt: Reiter „Kopf“ */
  const [headSel, setHeadSel] = useState(false);
  const thumbs = useRef<HTMLDivElement>(null);
  const pagesRef = useRef<HTMLElement[]>([]);
  /** Feld, das gerade auf der Seite bearbeitet wird */
  const [edit, setEdit] = useState<EditTarget | null>(null);
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
      } else if (e.key === 'Escape' && painter) {
        setPainter(null);
      } else if (!inField && sel && e.key === 'Delete') {
        e.preventDefault();
        remove(sel);
      }
    };
    addEventListener('keydown', key);
    return () => removeEventListener('keydown', key);
  });

  // ---------- Schreiben direkt im Text der Seite (Wunsch Jo, 24. November 2026: echtes WYSIWYG) ----------
  /**
   * Das gesetzte Feld selbst wird bearbeitbar: gleiche Schrift, gleicher Umbruch, gleiche Stelle. Beim Tippen wird
   * nicht neu gesetzt (sonst springt die Schreibmarke); erst nach einer kurzen Pause oder am Ende. Läuft ein Baustein
   * über Seiten, wird nur das Stück auf dieser Seite bearbeitet.
   */
  const live = useRef<{ el: HTMLElement; t: EditTarget; rich: boolean; range: [number, number] | null; spans: [number, number][]; value: string } | null>(null);
  /** Zeitpunkt der letzten Eingabe: das Setzen gleich danach fällt aus */
  const skipRender = useRef(0);
  /** Schreibmarke über das Neusetzen hinweg: Absatz im ganzen Feld und Zeichen darin */
  const caret = useRef<{ key: string; para: number; off: number } | null>(null);
  const savedRange = useRef<Range | null>(null);
  const idle = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [tick, setTick] = useState(0);
  const [atom, setAtom] = useState<AtomState | null>(null);
  const editKey = (t: EditTarget) => `${t.bid}|${t.field}`;

  function rememberCaret() {
    const L = live.current;
    const s = getSelection();
    if (!L || !s?.rangeCount || !L.el.contains(s.anchorNode)) return;
    savedRange.current = s.getRangeAt(0).cloneRange();
    const c = caretIn(L.el, s.focusNode!, s.focusOffset);
    if (c) caret.current = { key: editKey(L.t), para: (L.range?.[0] ?? 0) + c.k, off: c.off };
  }
  useEffect(() => {
    document.addEventListener('selectionchange', rememberCaret);
    return () => document.removeEventListener('selectionchange', rememberCaret);
  });

  function emitLive() {
    const L = live.current;
    if (!L) return;
    if (L.t.bid === '__head') {
      // Eckfeld im Kopf: Text mit Platzhaltern zurücklesen
      const k = L.t.field.slice(5) as CornerKey;
      const v = headFromEdit(L.el);
      L.value = v;
      rememberCaret();
      skipRender.current = performance.now();
      change((d) => ({ ...d, page: { ...d.page, header: { ...d.page.header, corners: { ...headCorners(d), [k]: v } } } }));
      if (idle.current) clearTimeout(idle.current);
      idle.current = setTimeout(() => setTick((x) => x + 1), 1100);
      return;
    }
    let v = L.rich ? (MULTI.includes(L.t.field) ? keepBlank(fromEditMd(editToTufte(markBlank(L.el)))) : fromEditMd(editToTufte(L.el))) : (L.el.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (!MULTI.includes(L.t.field)) v = v.replace(/\n+/g, ' ');
    let full = v;
    if (L.range) {
      // nur die Absätze dieses Stücks ersetzen
      const lines = L.value.replace(/\r\n?/g, '\n').split('\n');
      const [a, z] = L.range;
      const s0 = L.spans[a]?.[0] ?? lines.length;
      const s1 = L.spans[z - 1]?.[1] ?? lines.length;
      const mine = v ? v.split('\n') : [];
      full = [...lines.slice(0, s0), ...mine, ...lines.slice(s1)].join('\n');
      L.range = [a, a + paraSpans(v).length];
    }
    L.value = full;
    L.spans = paraSpans(full);
    rememberCaret();
    skipRender.current = performance.now();
    if (L.t.field.startsWith('cell:')) setCell(L.t.bid, L.t.field, full);
    else setBlock(L.t.bid, { [L.t.field]: full });
    // nach einer kurzen Pause neu setzen (Seitenumbruch, Zeilennummern, Fußnoten)
    if (idle.current) clearTimeout(idle.current);
    idle.current = setTimeout(() => setTick((x) => x + 1), 1100);
  }

  function activate(h: HTMLElement, t: EditTarget, d: BlattDoc) {
    const isHead = t.bid === '__head';
    const b = isHead ? null : findBlock(d.blocks, t.bid);
    if (!b && !isHead) return;
    const all = [...h.querySelectorAll<HTMLElement>(`[data-bid="${t.bid}"] [data-field="${t.field}"]`)].filter((x) => x.closest('[data-bid]')?.getAttribute('data-bid') === t.bid);
    if (!all.length) return;
    const rangeOf = (x: HTMLElement) => (x.dataset.r ? (x.dataset.r.split(':').map(Number) as [number, number]) : null);
    const want = caret.current?.key === editKey(t) ? caret.current : null;
    let f = all[Math.min(t.idx, all.length - 1)];
    if (want) {
      const k = all.findIndex((x) => {
        const r = rangeOf(x);
        return !r || (want.para >= r[0] && want.para < r[1]);
      });
      if (k >= 0) f = all[k];
    }
    const value = isHead ? headCorners(d)[t.field.slice(5) as CornerKey] : fieldValue(b, t.field);
    const rich = RICH(t.field);
    const spans = paraSpans(value);
    const range = t.field === 'md' ? rangeOf(f) : null;
    let slice = value;
    if (range) {
      const lines = value.replace(/\r\n?/g, '\n').split('\n');
      slice = lines.slice(spans[range[0]]?.[0] ?? lines.length, spans[range[1] - 1]?.[1] ?? lines.length).join('\n');
    }
    // Stelle des Klicks vor dem Austausch merken
    let click: { k: number; off: number } | null = null;
    if (!want && t.at) {
      const pos = (document as Document & { caretRangeFromPoint?: (x: number, y: number) => Range | null }).caretRangeFromPoint?.(t.at.x, t.at.y);
      if (pos && f.contains(pos.startContainer) && !(pos.startContainer.parentElement?.closest('.bl-ph'))) click = caretIn(f, pos.startContainer, pos.startOffset);
    }
    f.innerHTML = isHead ? headToEdit(slice) : rich ? tufteToEdit(toEditMd(slice)) : escHtml(slice);
    if (getComputedStyle(f).display === 'inline') f.style.display = 'inline-block';
    f.contentEditable = 'true';
    f.spellcheck = true;
    f.classList.add('bl-live');
    f.setAttribute('role', 'textbox');
    f.setAttribute('aria-label', 'Text auf der Seite');
    live.current = { el: f, t, rich, range, spans, value };
    inline.current = {
      el: f,
      emit: emitLive,
      rich,
      restore: () => {
        if (document.activeElement !== f) f.focus();
        const s = getSelection();
        if (savedRange.current && f.contains(savedRange.current.startContainer)) {
          s?.removeAllRanges();
          s?.addRange(savedRange.current);
        }
      },
    };
    const multi = MULTI.includes(t.field) || isHead;
    f.oninput = () => emitLive();
    f.onkeydown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setEdit(null);
      } else if (e.key === 'Tab' && t.field.startsWith('cell:')) {
        e.preventDefault();
        emitLive();
        moveCell(t, e.shiftKey ? -1 : 1);
      } else if (e.key === 'Enter' && !multi) e.preventDefault();
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'u' && rich) {
        e.preventDefault();
        document.execCommand('underline');
        emitLive();
      }
    };
    f.onpaste = (e) => {
      e.preventDefault();
      const txt = e.clipboardData?.getData('text/plain') ?? '';
      if (txt && t.field.startsWith('cell:') && /[\t\n]/.test(txt.trim())) return pasteGrid(t, txt);
      if (txt) document.execCommand('insertText', false, multi ? txt : txt.replace(/\s*\n\s*/g, ' '));
      emitLive();
    };
    f.onclick = (e) => {
      const a = (e.target as HTMLElement).closest('.ed-note, .ed-gloss') as HTMLElement | null;
      if (!a || !wrap.current) return;
      const w = wrap.current.getBoundingClientRect();
      const r = a.getBoundingClientRect();
      setAtom({ el: a, left: (r.left - w.left) / zoom, top: (r.bottom - w.top) / zoom + 6, ...(a.classList.contains('ed-gloss') ? { text: a.textContent ?? '', extra: a.dataset.explain ?? '' } : { text: a.dataset.text ?? '', extra: '' }) });
    };
    // tippt man gerade in ein Feld im Menüband (z. B. Punkte), bleibt dort der Fokus (Fehler, Jo 24. November 2026)
    const ae = document.activeElement as HTMLElement | null;
    if (ae && !h.contains(ae) && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.tagName === 'SELECT' || ae.isContentEditable)) return;
    f.focus({ preventScroll: true });
    document.execCommand('defaultParagraphSeparator', false, 'p');
    if (want) placeCaret(f, want.para - (range?.[0] ?? 0), want.off);
    else if (click) placeCaret(f, click.k, click.off);
    else placeCaret(f, null, 0);
    rememberCaret();
  }
  function saveAtom(removeIt: boolean) {
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
    emitLive();
    setAtom(null);
  }

  // ---------- Setzen ----------
  useLayoutEffect(() => {
    const h = host.current;
    if (!h || !doc) return;
    // beim Tippen nicht neu setzen: das Feld auf der Seite ist schon richtig
    if (skipRender.current && performance.now() - skipRender.current < 250) {
      skipRender.current = 0;
      return;
    }
    skipRender.current = 0;
    live.current = null;
    inline.current = null;
    const r = paginate(doc, h, undefined, { editing: canEdit, head: { title: title.trim(), course: project?.course.title ?? '', teacher: me?.name ?? '' } });
    setProblems(r.problems);
    setPageCount(r.pages.length);
    pagesRef.current = r.pages;
    {
      const firstPage = new Map<string, number>();
      const marks = new Map<string, { page: number; cont: boolean }[]>();
      r.pages.forEach((p, k) => {
        const ids = [...p.querySelectorAll<HTMLElement>('[data-bid]')].map((e) => e.dataset.bid!).filter((x) => x !== '__head');
        if (k > 0 && ids[0]) {
          const cont = firstPage.has(ids[0]);
          marks.set(ids[0], [...(marks.get(ids[0]) ?? []), { page: k + 1, cont }]);
        }
        for (const id of ids) if (!firstPage.has(id)) firstPage.set(id, k);
      });
      const key = (m: typeof marks) => [...m].map(([a, l]) => a + l.map((x) => x.page + (x.cont ? 'c' : '')).join()).join('|');
      setPageMarks((o) => (key(o) === key(marks) ? o : marks));
    }
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
    if (flowView && view !== 'sheets') decorateFlow(h, doc);
    if (edit && canEdit && view !== 'sheets') activate(h, edit, doc);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, view, canEdit, sel, selCol, edit, zoom, leftTab, title, project, me, tick, flowView]);
  useEffect(() => {
    setAtom(null);
    if (!edit && idle.current) clearTimeout(idle.current);
  }, [edit]);
  // auf die Breite der Mitte einpassen
  useEffect(() => {
    const c = center.current;
    if (!c || !doc) return;
    const fit = () => {
      const pw = pageGeom(doc).w;
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
    if (type === 'image' || type === 'cols' || type === 'lines' || type === 'glossary' || type === 'table' || type === 'chart' || type === 'grade') setTab('block');
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
  // Zuschneiden endet, wenn ein anderer Baustein gewählt wird
  useEffect(() => setCropBid((c) => (c && c !== sel ? null : c)), [sel]);
  /** Baustein in eine andere Art umwandeln (Überschrift, Erklärtext, Material, Zitat, Kasten, Aufgabe) */
  function transform(bid: string, to: BlockType) {
    change((d) => ({
      ...d,
      blocks: mapLists(d.blocks, (l) => {
        const i = l.findIndex((b) => b.id === bid);
        return i < 0 ? l : [...l.slice(0, i), ...convertBlock(l[i], to), ...l.slice(i + 1)];
      }),
    }));
    setSel(bid);
    setEdit(null);
  }
  /** Baustein aufteilen (Wunsch Jo, 24. November 2026): an der Schreibmarke, nach Nummern, Absätzen oder Überschriften */
  function split(bid: string, mode: SplitMode) {
    if (!doc) return;
    const b = findBlock(doc.blocks, bid);
    if (!b) return;
    let parts: Block[];
    if (mode === 'caret') {
      const c = caret.current;
      if (!c || c.key !== `${bid}|md`) return setError('Erst in den Text klicken, wo geteilt werden soll, dann „Aufteilen“.');
      const sp = paraSpans(b.md);
      const at = sp[c.para];
      parts = at ? splitBlockAt(b, c.off === 0 ? at[0] : at[1]) : [b];
    } else parts = splitBlock(b, mode);
    if (parts.length < 2) return setError('Hier gibt es nichts zu teilen.');
    setError('');
    change((d) => ({
      ...d,
      blocks: mapLists(d.blocks, (l) => {
        const i = l.findIndex((x) => x.id === bid);
        return i < 0 ? l : [...l.slice(0, i), ...parts, ...l.slice(i + 1)];
      }),
    }));
    setEdit(null);
    setSel(parts[0].id);
  }
  const openConv = (e: React.MouseEvent, b: Block) => {
    if (!editing) return;
    e.preventDefault();
    select(b.id);
    setConv({ bid: b.id, x: e.clientX, y: e.clientY });
  };
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
    if (bid) setHeadSel(false);
    setSelCol(null);
    const b = bid && doc ? findBlock(doc.blocks, bid) : null;
    if (b && (b.type === 'image' || b.type === 'cols' || b.type === 'lines' || b.type === 'pagebreak' || b.type === 'glossary' || b.type === 'table' || b.type === 'chart' || b.type === 'grade')) setTab('block');
    else if (b?.type === 'task' && tab === 'block') setTab('task');
    else if (b && tab === 'block' && !CTX_TYPES.includes(b.type)) setTab('start');
  }
  /** Reiter „Datei“: speichern, Kopie, Druck und Export */
  async function fileAction(a: FileAction) {
    if (!doc) return;
    const name = (title.trim() || 'Arbeitsblatt').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim();
    const headCtx = { title: title.trim(), course: project?.course.title ?? '', teacher: me?.name ?? '' };
    setError('');
    try {
      if (a === 'save') return void (await save());
      if (a === 'print') return setPrinting(true);
      if (a === 'md') return download(new Blob([toMarkdown(doc)], { type: 'text/markdown' }), name + '.md');
      if (a === 'typst') return download(new Blob([toTypst(doc)], { type: 'text/plain' }), name + '.typ');
      if (a === 'json') return download(new Blob([JSON.stringify({ ...doc, title: title.trim() })], { type: 'application/json' }), name + '.blatt.json');
      if (a === 'html') return download(new Blob([exportHtml(doc, title.trim(), headCtx)], { type: 'text/html' }), name + '.html');
      if (a === 'docx') {
        setBusy('Word-Datei entsteht …');
        download(await toDocx(doc, headCtx), docxName(name));
        return;
      }
      if (a === 'open') {
        const f = await pickFile('.json,application/json');
        if (!f) return;
        const j = JSON.parse(await f.text()) as { format?: string; title?: string };
        if (j.format !== 'ag-blatt/1') throw new Error('Das ist keine Blatt-Datei.');
        setEdit(null);
        setSel(null);
        change(() => parseDoc(JSON.stringify(j)));
        if (j.title && !title.trim()) setTitle(j.title);
        return;
      }
      if (a === 'copy') {
        await save();
        setBusy('Kopie wird angelegt …');
        const r = await post<{ material?: { id: number }; id?: number }>(`/api/projects/${id}/materials/page`, { kind: 'blatt', title: `${title.trim() || 'Arbeitsblatt'} (Kopie)` });
        const nid = r.material?.id ?? r.id;
        if (!nid) throw new Error('Die Kopie ließ sich nicht anlegen.');
        await patch(`/api/projects/${id}/materials/${nid}`, { title: `${title.trim() || 'Arbeitsblatt'} (Kopie)`, body: JSON.stringify(doc) });
        location.href = href(`/projekt/material/blatt/?id=${id}&m=${nid}`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy('');
    }
  }
  /** Format übertragen (wie in Bento): Vorlage und eigene Gestaltung des gewählten Bausteins */
  function startPainter(sticky: boolean) {
    if (painter && !sticky) return setPainter(null);
    const b = selBlock;
    if (!b) return;
    const style: Partial<Block> = { tpl: b.tpl };
    for (const k of [...STYLE_KEYS, 'gap', 'wrap', 'align', 'width', 'keep', 'keepNext'] as const) (style as Record<string, unknown>)[k] = b[k];
    setPainter({ type: b.type, style, sticky });
    setEdit(null);
  }
  function applyPainter(bid: string) {
    if (!painter || !doc) return;
    const t = findBlock(doc.blocks, bid);
    if (!t) return;
    const p: Partial<Block> = {};
    for (const [k, v] of Object.entries(painter.style)) {
      if (k === 'tpl' && t.type !== painter.type) continue;
      if ((k === 'wrap' || k === 'align' || k === 'width') && !(t.type === 'image' || t.type === 'chart')) continue;
      if (k === 'gap' && !(t.type === 'cols' || TEXT_TYPES.includes(t.type))) continue;
      (p as Record<string, unknown>)[k] = v;
    }
    setBlock(bid, p);
    setSel(bid);
    if (!painter.sticky) setPainter(null);
  }

  // Klick, Ziehen und Einsetzen auf den Seiten
  function onPagesClick(e: React.MouseEvent) {
    if (!canEdit || !doc) return;
    const t = e.target as HTMLElement;
    const del = t.closest<HTMLElement>('[data-del]');
    if (del?.dataset.del) {
      e.stopPropagation();
      if (del.dataset.del === '__head') return setHeader({ show: false });
      return remove(del.dataset.del);
    }
    // Ansicht Textfluss: Bausteine verbinden (zusammenhalten) oder trennen
    const link = t.closest<HTMLElement>('[data-link]');
    if (link?.dataset.link) {
      const lb = findBlock(doc.blocks, link.dataset.link);
      if (lb) setBlock(lb.id, { keepNext: !lb.keepNext || undefined });
      return;
    }
    if (painter) {
      const pb = t.closest<HTMLElement>('[data-bid]')?.dataset.bid;
      if (pb) applyPainter(pb);
      else setPainter(null);
      return;
    }
    // im Text, der gerade bearbeitet wird, setzt der Browser die Schreibmarke selbst
    if (t.closest('.bl-live') || t.closest('[data-atom]') || t.closest('.bl-gutter')) return;
    // Kopf der Seite: Rahmendaten
    if (t.closest('[data-head]') && view !== 'sheets') {
      // Kopf: in die angeklickte Ecke schreiben (sonst die nächste Ecke)
      setSel(null);
      setHeadSel(true);
      setTab('block');
      const f = t.closest<HTMLElement>('[data-field^="head:"]');
      setEdit({ bid: '__head', field: (f?.dataset.field ?? 'head:tl') as FieldName, idx: 0, at: f ? { x: e.clientX, y: e.clientY } : undefined });
      return;
    }
    setHeadSel(false);
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
    if ((e.target as HTMLElement).closest('[data-del]')) return;
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
      crumbs={
        page ? (
          canEdit ? (
            <input className={st.crumbTitle} value={title} onChange={(e) => (setTitle(e.target.value), setSaved('dirty'))} placeholder="Name des Blatts" aria-label="Name des Blatts" size={Math.max(12, Math.min(48, title.length + 2))} />
          ) : (
            <span className="muted">{title || page.title}</span>
          )
        ) : null
      }
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
              head={headSel}
              split={(m) => selBlock && split(selBlock.id, m)}
              openHead={(k = 'tl') => (setSel(null), setHeadSel(true), setTab('block'), setHeader({ show: true }), setEdit({ bid: '__head', field: `head:${k}`, idx: 0 }))}
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
              onScan={() => setScan(true)}
              ensureGlossary={() => change((d) => (walk(d.blocks).some((x) => x.type === 'glossary') ? d : { ...d, blocks: [...d.blocks, newBlock('glossary')] }))}
              onError={setError}
              painter={painter}
              startPainter={startPainter}
              flowView={flowView}
              setFlowView={setFlowView}
              pro={pro || panel === 'typst'}
              file={(a) => void fileAction(a)}
              select={(bid) => (select(bid), setEdit(null), setTab('block'), host.current?.querySelector(`[data-bid="${bid}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }))}
              busy={busy}
              crop={cropBid}
              setCrop={setCropBid}
            />
          )}
          {cropBid && selBlock?.id === cropBid && selBlock.src && (
            <CropOverlay
              host={host}
              bid={cropBid}
              onCancel={() => setCropBid(null)}
              onApply={async (c) => {
                const b = selBlock;
                setCropBid(null);
                if (!b.src || c.every((x) => x < 0.002)) return;
                try {
                  const r = await cropImage(b.src, Number(b.rot) || 0, c);
                  setBlock(b.id, { src: r.src, ar: r.ar, rot: 0, orig: b.orig ?? b.src, origRot: b.orig ? b.origRot : b.rot });
                } catch (e) {
                  setError(e instanceof Error ? e.message : String(e));
                }
              }}
            />
          )}
          <div className={`${st.wrap} ${editing ? '' : st.read} ${panel ? '' : st.noPanel} ${panel === 'typst' ? st.codePanel : ''}`}>
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
                    <button key={b.id} className={`${st.oItem} ${sel === b.id ? st.sel : ''}`} style={{ paddingLeft: 6 + depth * 14 }} onContextMenu={(e) => openConv(e, b)} onClick={() => (select(b.id), setEdit(null), host.current?.querySelector(`[data-bid="${b.id}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }))}>
                      {label}
                    </button>
                  ))}
                </div>
              )}
              {conv?.bid === '__head' && (
                <ConvMenu
                  conv={conv}
                  b={{ id: '__head', type: 'heading' } as Block}
                  head
                  onPick={() => setConv(null)}
                  onDelete={() => (setHeader({ show: false }), setConv(null))}
                  onClose={() => setConv(null)}
                />
              )}
              {conv && conv.bid !== '__head' && (
                <ConvMenu
                  conv={conv}
                  b={doc ? findBlock(doc.blocks, conv.bid) : null}
                  onPick={(to) => (transform(conv.bid, to), setConv(null))}
                  onSplit={(m) => (split(conv.bid, m), setConv(null))}
                  onDelete={() => (remove(conv.bid), setConv(null))}
                  onClose={() => setConv(null)}
                />
              )}
              {leftTab === 'blocks' && (
                <section className={st.sec}>
                  {!doc.blocks.length && <div className={st.empty}>Noch leer. Klick auf die Seite und schreib los, oder füge unter „Einfügen“ Material, Bilder, Tabellen und Aufgaben ein.</div>}
                  <div className={st.list} onDragOver={(e) => dragId && e.preventDefault()} onDrop={() => dragId && (moveTo(dragId, dropAt), setDragId(null), setDropAt(null))}>
                    {doc.page.header.show !== false ? (
                      <div
                        className={`${st.item} ${headSel ? st.sel : ''}`}
                        onClick={() => (setSel(null), setHeadSel(true), setTab('block'), editing && setEdit({ bid: '__head', field: 'head:tl', idx: 0 }), host.current?.querySelector('[data-head]')?.scrollIntoView({ block: 'center', behavior: 'smooth' }))}
                        onContextMenu={(e) => editing && (e.preventDefault(), setConv({ bid: '__head', x: e.clientX, y: e.clientY }))}
                        title="Kopf der Klausur: Titel, Name, Datum, QR-Code … Klick zum Bearbeiten, Rechtsklick zum Löschen"
                      >
                        <span className={st.itemIcon}>
                          <Ico n="insertheader" size={16} />
                        </span>
                        <span className={st.itemText}>
                          Kopf
                          <small>vier Ecken{doc.page.header.qr !== 'none' ? ', QR-Code' : ''}</small>
                        </span>
                        {editing && (
                          <button type="button" className={st.convBtn} title="Kopf entfernen" aria-label="Kopf entfernen" onClick={(e) => (e.stopPropagation(), setHeader({ show: false }))}>
                            <span aria-hidden>×</span>
                          </button>
                        )}
                      </div>
                    ) : (
                      editing && (
                        <button type="button" className={st.oItem} style={{ opacity: 0.7 }} onClick={() => setHeader({ show: true })} title="Kopf mit Titel, Name, Datum und QR-Code wieder zeigen">
                          + Kopf mit Rahmendaten
                        </button>
                      )
                    )}
                    {outline.map(({ b, depth }) => (
                      <Fragment key={b.id}>
                      {(pageMarks.get(b.id) ?? []).filter((m) => !m.cont).map((m) => (
                        <div key={'p' + m.page} className={st.pageMark} style={{ marginLeft: depth * 14 }}>
                          <span>Seite {m.page}</span>
                        </div>
                      ))}
                      <div
                        key={b.id}
                        className={`${st.item} ${sel === b.id ? st.sel : ''} ${bad.has(b.id) ? st.bad : ''} ${dragId === b.id ? st.drag : ''} ${dropAt === b.id && dragId !== b.id ? st.dropAbove : ''}`}
                        style={{ marginLeft: depth * 14 }}
                        onClick={() => (select(b.id), setEdit(null), host.current?.querySelector(`[data-bid="${b.id}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }))}
                        draggable={editing}
                        onDragStart={(e) => (setDragId(b.id), e.dataTransfer.setData('text/plain', b.id))}
                        onDragOver={() => dragId && setDropAt(b.id)}
                        onDragEnd={() => (setDragId(null), setDropAt(null))}
                        onContextMenu={(e) => openConv(e, b)}
                        title={bad.has(b.id) ? problems.find((p) => p.bid === b.id)?.msg : undefined}
                      >
                        <span className={st.itemIcon}>
                          <Ico n={BICON[b.type]} size={16} />
                        </span>
                        <span className={st.itemText}>
                          {BLOCK_LABEL[b.type]}
                          <small>{blockSummary(b)}</small>
                        </span>
                        {editing && sel === b.id && (
                          <button
                            type="button"
                            className={st.convBtn}
                            title={CONVERTIBLE.includes(b.type) ? 'Umwandeln oder löschen (auch mit Rechtsklick)' : 'Löschen (auch mit Rechtsklick)'}
                            aria-label="Umwandeln oder löschen"
                            onClick={(e) => {
                              e.stopPropagation();
                              const r = e.currentTarget.getBoundingClientRect();
                              setConv({ bid: b.id, x: r.left, y: r.bottom + 2 });
                            }}
                          >
                            <span aria-hidden>⋯</span>
                          </button>
                        )}
                      </div>
                      {(pageMarks.get(b.id) ?? []).filter((m) => m.cont).map((m) => (
                        <div key={'c' + m.page} className={`${st.pageMark} ${st.pageMarkIn}`} style={{ marginLeft: depth * 14 + 10 }} title="Der Baustein läuft auf der nächsten Seite weiter">
                          <span>Seite {m.page} · läuft weiter</span>
                        </div>
                      ))}
                      </Fragment>
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
                  <div ref={host} className={`${st.host} ${editing ? st.editing : ''} ${view !== 'pages' ? st.sheets : ''} ${painter ? st.painting : ''} ${flowView ? st.flowView : ''}`} />
                  {atom && atom.el.isConnected && (
                    <div data-atom>
                      <AtomForm atom={atom} setAtom={setAtom} onSave={saveAtom} />
                    </div>
                  )}
                </div>
              </div>
            </div>

            {panel && (
              <aside className={`${st.side} ${st.right}`}>
                {panel === 'typst' ? (
                  <TypstPanel
                    doc={doc}
                    onClose={() => setPanel(null)}
                    onApply={(d) => {
                      setEdit(null);
                      change(() => d);
                    }}
                  />
                ) : (
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
                )}
              </aside>
            )}
          </div>
        </div>
      )}
      {scan && <ScanDialog onClose={() => setScan(false)} onImage={(f) => void imageInto(f, selBlock?.type === 'image' ? selBlock.id : null)} />}
      {printing && doc && <PrintDialog doc={doc} title={title} head={{ title: title.trim(), course: project.course.title, teacher: me.name }} onClose={() => setPrinting(false)} />}
    </ProjectShell>
  );
}

// ---------- Bearbeiten direkt auf der Seite ----------
type Tab = 'file' | 'start' | 'insert' | 'styles' | 'task' | 'design' | 'layout' | 'block';
type FileAction = 'save' | 'copy' | 'print' | 'docx' | 'html' | 'md' | 'typst' | 'json' | 'open';
/** Bausteine mit eigenem Reiter (Aufgaben stehen unter „Aufgabe“, Text unter „Start“) */
const CTX_TYPES: BlockType[] = ['heading', 'material', 'image', 'table', 'chart', 'glossary', 'cols', 'lines', 'pagebreak', 'grade'];
type Panel = 'search' | 'material' | 'glossary' | 'typst';
type FieldName = 'md' | 'title' | 'text' | 'source' | 'caption' | `cell:${number}:${number}` | `head:${CornerKey}`;
interface EditTarget {
  bid: string;
  field: FieldName;
  /** welches Stück, wenn der Baustein über mehrere Seiten läuft */
  idx: number;
  at?: { x: number; y: number };
}
/** Lage und Aussehen des Felds auf der Seite, damit der Editor genau darüber liegt */
interface InlineApi {
  el: HTMLElement;
  emit: () => void;
  restore: () => void;
  rich: boolean;
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

// ---------- Eckfelder im Kopf ----------
const TOKEN_KEYS = new Set(HEAD_TOKENS.map((t) => t.key).concat('Kurs'));
/** Platzhalter als Marke im Text, die man als Ganzes löscht */
const tokHtml = (k: string) => `<span class="bl-tok" contenteditable="false" data-tok="${k}">${k}</span>`;
/** Eckfeld zum Bearbeiten: eine Zeile je Absatz, Platzhalter als Marken, Unterstriche bleiben sichtbar */
function headToEdit(v: string): string {
  const lines = v ? v.split('\n') : [''];
  return lines.map((ln) => `<p>${ln.split(/(\{[A-Za-zÄÖÜäöüß]+\})/).map((x) => { const m = /^\{(.+)\}$/.exec(x); return m && TOKEN_KEYS.has(m[1]) ? tokHtml(m[1]) : escHtml(x); }).join('') || '<br>'}</p>`).join('');
}
/** Eckfeld zurücklesen: Absätze und Zeilenumbrüche werden zu Zeilen, Marken zu {Platzhaltern} */
function headFromEdit(el: HTMLElement): string {
  const lines: string[] = [''];
  const walkN = (n: Node) => {
    if (n.nodeType === 3) return void (lines[lines.length - 1] += (n.textContent ?? '').replace(/\u200b/g, '').replace(/\u00a0/g, ' '));
    if (!(n instanceof HTMLElement)) return;
    if (n.dataset.tok) return void (lines[lines.length - 1] += `{${n.dataset.tok}}`);
    if (n.tagName === 'BR') return void (n.nextSibling || n.parentElement === el ? lines.push('') : undefined);
    const block = /^(P|DIV|LI)$/.test(n.tagName);
    if (block && lines[lines.length - 1] !== '') lines.push('');
    n.childNodes.forEach(walkN);
    if (block) lines.push('');
  };
  el.childNodes.forEach(walkN);
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  return lines.map((l) => l.replace(/\s+$/, '')).join('\n');
}

// ---------- Schreibmarke im Text auf der Seite ----------
/** Absätze des bearbeiteten Felds (Zeilennummern und Platzhalter zählen nicht) */
const topChildren = (el: HTMLElement) => [...el.children].filter((c) => !c.classList.contains('bl-lno')) as HTMLElement[];
/** Stelle (Absatz, Zeichen) einer Schreibmarke im Feld */
function caretIn(el: HTMLElement, node: Node, offset: number): { k: number; off: number } | null {
  if (!el.contains(node)) return null;
  const kids = topChildren(el);
  const k = kids.findIndex((c) => c.contains(node) || c === node);
  const top = k >= 0 ? kids[k] : el;
  const r = document.createRange();
  r.selectNodeContents(top);
  try {
    r.setEnd(node, offset);
  } catch {
    return { k: Math.max(0, k), off: 0 };
  }
  return { k: Math.max(0, k), off: r.toString().length };
}
/**
 * Leere Zeilen behalten (Fehler, Jo 24. November 2026: einfache Zeilenumbrüche verschwanden). Ein leerer Absatz und ein
 * Zeilenumbruch (Umschalt+Enter) bekommen ein unsichtbares Zeichen (U+200B), damit sie die Umwandlung überstehen; im Blatt
 * steht ein leerer Absatz als Zeile mit nur diesem Zeichen.
 */
const ZW = '\u200b';
function markBlank(el: HTMLElement): HTMLElement {
  const c = el.cloneNode(true) as HTMLElement;
  c.querySelectorAll('br').forEach((br) => br.after(document.createTextNode(ZW)));
  c.querySelectorAll('p, div').forEach((p) => {
    if (!(p.textContent ?? '').replace(/[\s\u200b]/g, '') && !p.querySelector('img, .ed-note')) p.append(ZW);
  });
  return c;
}
function keepBlank(v: string): string {
  const lines = v.split('\n').map((l) => (l.includes(ZW) ? l.replace(/\u200b/g, '').trim() || ZW : l));
  // ein Umbruch am Ende eines Absatzes, auf den noch nichts folgt, zählt als leere Zeile; doppelte Leerzeichen entfallen
  return lines.join('\n');
}

/** Schreibmarke an (Absatz, Zeichen) setzen; fehlt der Absatz, ans Ende */
function placeCaret(el: HTMLElement, k: number | null, off: number) {
  const kids = topChildren(el);
  const top = k === null ? null : (kids[Math.min(k, kids.length - 1)] ?? null);
  const s = getSelection();
  const r = document.createRange();
  if (!top) {
    r.selectNodeContents(el);
    r.collapse(false);
  } else {
    const w = document.createTreeWalker(top, NodeFilter.SHOW_TEXT);
    let left = off;
    let n: Node | null;
    let done = false;
    while ((n = w.nextNode())) {
      const len = n.textContent?.length ?? 0;
      if (left <= len) {
        r.setStart(n, left);
        done = true;
        break;
      }
      left -= len;
    }
    if (!done) {
      r.selectNodeContents(top);
      r.collapse(false);
    } else r.collapse(true);
  }
  s?.removeAllRanges();
  s?.addRange(r);
}

/** Fußnote, Randbemerkung oder Glossar-Wort im Text ändern */
interface AtomState {
  el: HTMLElement;
  text: string;
  extra: string;
  left: number;
  top: number;
}
function AtomForm({ atom, setAtom, onSave }: { atom: AtomState; setAtom: (a: AtomState | null) => void; onSave: (removeIt: boolean) => void }) {
  const gloss = atom.el.classList.contains('ed-gloss');
  return (
    <form
      className={st.atom}
      style={{ left: atom.left, top: atom.top }}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onSubmit={(e) => {
        e.preventDefault();
        onSave(false);
      }}
    >
      <strong>{gloss ? 'Glossar' : atom.el.dataset.kind === 'margin' ? 'Randbemerkung' : 'Fußnote'}</strong>
      {gloss && <input value={atom.text} onChange={(e) => setAtom({ ...atom, text: e.target.value })} aria-label="Wort" placeholder="Wort" />}
      <textarea
        autoFocus
        rows={3}
        value={gloss ? atom.extra : atom.text}
        onChange={(e) => setAtom(gloss ? { ...atom, extra: e.target.value } : { ...atom, text: e.target.value })}
        placeholder={gloss ? 'Erklärung fürs Glossar' : atom.el.dataset.kind === 'margin' ? 'Text im Rand' : 'Text der Fußnote'}
        aria-label="Inhalt"
      />
      <div className="row">
        <button type="button" className="btn danger" onClick={() => onSave(true)}>
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
  );
}

const escHtml = (x: string) => x.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

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

/** Reiter „Bild“: Anpassen (Helligkeit, Kontrast, Graustufen), Bearbeiten (Zuschneiden, Freistellen, Verkleinern), Rahmen */
function ImageTools({ b, set, crop, setCrop, onError }: { b: Block; set: (p: Partial<Block>) => void; crop: string | null; setCrop: (bid: string | null) => void; onError: (m: string) => void }) {
  const [work, setWork] = useState('');
  const rot = Number(b.rot) || 0;
  const keepOrig = () => ({ orig: b.orig ?? b.src, origRot: b.orig ? b.origRot : b.rot });
  async function run(label: string, fn: () => Promise<{ src: string; ar: number }>) {
    if (!b.src) return;
    setWork(label);
    onError('');
    try {
      const r = await fn();
      if (label === 'klein' && srcBytes(r.src) >= srcBytes(b.src)) return onError('Kleiner geht es so nicht: das Bild ist schon so klein (freigestellte Bilder bleiben PNG).');
      set({ src: r.src, ar: r.ar, rot: 0, ...keepOrig() });
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setWork('');
    }
  }
  async function restore() {
    if (!b.orig) return;
    const img = await loadImage(b.orig).catch(() => null);
    set({ src: b.orig, rot: b.origRot, ar: img ? img.naturalHeight / Math.max(1, img.naturalWidth) : b.ar, orig: undefined, origRot: undefined });
  }
  const pct = (v?: number) => (v ? `${v > 0 ? '+' : '−'}${Math.abs(v)} %` : 'normal');
  const steps = [-40, -20, -10, 0, 10, 20, 40];
  const bytes = srcBytes(b.src);
  return (
    <>
      <Group label="Anpassen">
        <div className={st.rows}>
          <div className={st.row}>
            <Drop icon="grow" label="Helligkeit" value={pct(b.bright)} disabled={!b.src} title="Bild heller oder dunkler">
              <MH>Helligkeit</MH>
              {steps.map((v) => (
                <MI key={v} label={v === 0 ? 'normal' : pct(v)} on={(b.bright ?? 0) === v} onClick={() => set({ bright: v || undefined })} />
              ))}
            </Drop>
          </div>
          <div className={st.row}>
            <Drop icon="spacing" label="Kontrast" value={pct(b.contrast)} disabled={!b.src} title="Kontrast verringern oder verstärken (z. B. für blasse Kopien)">
              <MH>Kontrast</MH>
              {steps.map((v) => (
                <MI key={v} label={v === 0 ? 'normal' : pct(v)} on={(b.contrast ?? 0) === v} onClick={() => set({ contrast: v || undefined })} />
              ))}
            </Drop>
          </div>
        </div>
        <div className={st.rows}>
          <div className={st.row}>
            <Drop icon="formatline" label="Rahmen" value={b.frame ? LINE_LABEL[b.frame] : 'kein'} disabled={!b.src} title="Rahmen, runde Ecken und Schatten">
              <MH>Rahmenlinie</MH>
              <MI label="keine" on={!b.frame} onClick={() => set({ frame: undefined })} />
              {(Object.keys(LINE_MM) as LineWeight[]).map((k) => (
                <MI key={k} label={LINE_LABEL[k]} hint={`${de(LINE_MM[k])} mm`} on={b.frame === k} onClick={() => set({ frame: k })} />
              ))}
              <MH>Form</MH>
              <MI label="Runde Ecken" stay on={!!b.round} onClick={() => set({ round: !b.round || undefined })} />
              <MI label="Schatten" stay on={!!b.shadow} onClick={() => set({ shadow: !b.shadow || undefined })} />
            </Drop>
          </div>
          <div className={st.row}>
            <RB icon="backcolor" label="Graustufen" disabled={!b.src} on={!!b.gray} onClick={() => set({ gray: !b.gray || undefined })} title="Bild schwarz-weiß (spart Farbe beim Kopieren)" />
          </div>
        </div>
      </Group>
      <Group label="Bearbeiten">
        <RB icon="insertframe" label="Zuschneiden" big disabled={!b.src || !!work} on={crop === b.id} onClick={() => setCrop(crop === b.id ? null : b.id)} title="Ränder auf der Seite wegziehen; Enter übernimmt, Esc bricht ab" />
        <Drop icon="rect" label="Freistellen" value={work === 'frei' ? 'läuft …' : undefined} big disabled={!b.src || !!work} title="Hintergrund entfernen: was vom Rand her zusammenhängt und ihm ähnelt, wird durchsichtig">
          <MH>Hintergrund entfernen</MH>
          <MI label="genau" hint="nur fast gleiche Farbe wie am Rand" onClick={() => void run('frei', () => removeBackground(b.src!, rot, 18))} />
          <MI label="mittel" hint="für Fotos vor hellem Hintergrund" onClick={() => void run('frei', () => removeBackground(b.src!, rot, 36))} />
          <MI label="großzügig" hint="auch Schatten und Verläufe" onClick={() => void run('frei', () => removeBackground(b.src!, rot, 64))} />
        </Drop>
        <Drop icon="shrink" label="Verkleinern" value={work === 'klein' ? 'läuft …' : bytes ? kb(bytes) : undefined} big disabled={!b.src || !!work} title="Datei verkleinern: das Blatt lädt und speichert schneller">
          <MH>Datei verkleinern (jetzt {bytes ? kb(bytes) : '–'})</MH>
          <MI label="für den Druck" hint="längste Seite 1600 Bildpunkte" onClick={() => void run('klein', () => shrinkImage(b.src!, rot, 1600, 0.82))} />
          <MI label="kleiner" hint="1000 Bildpunkte, für kleine Bilder" onClick={() => void run('klein', () => shrinkImage(b.src!, rot, 1000, 0.78))} />
          <MI label="sehr klein" hint="600 Bildpunkte, Symbole und Skizzen" onClick={() => void run('klein', () => shrinkImage(b.src!, rot, 600, 0.75))} />
        </Drop>
        <RB icon="resetattributes" label="Original" big disabled={!b.orig || !!work} onClick={() => void restore()} title="Zuschneiden, Freistellen und Verkleinern zurücknehmen" />
      </Group>
    </>
  );
}

/** Zuschneiden auf der Seite: Rahmen über dem Bild mit Griffen an Ecken und Kanten; Enter übernimmt, Esc bricht ab */
function CropOverlay({ host, bid, onApply, onCancel }: { host: React.RefObject<HTMLDivElement | null>; bid: string; onApply: (c: Crop) => void; onCancel: () => void }) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [c, setC] = useState<Crop>([0, 0, 0, 0]);
  const cRef = useRef(c);
  cRef.current = c;
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const img = host.current?.querySelector<HTMLElement>(`[data-bid="${bid}"] img`);
      const r = img?.getBoundingClientRect() ?? null;
      setRect((o) => (r && o && r.x === o.x && r.y === o.y && r.width === o.width && r.height === o.height ? o : r));
      raf = requestAnimationFrame(tick);
    };
    tick();
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') (e.preventDefault(), e.stopPropagation(), onCancel());
      if (e.key === 'Enter') (e.preventDefault(), e.stopPropagation(), onApply(cRef.current));
    };
    addEventListener('keydown', key, true);
    return () => {
      cancelAnimationFrame(raf);
      removeEventListener('keydown', key, true);
    };
  }, [host, bid, onApply, onCancel]);
  if (!rect) return null;
  const drag = (e: React.PointerEvent, edges: string) => {
    e.preventDefault();
    e.stopPropagation();
    const x0 = e.clientX;
    const y0 = e.clientY;
    const s = [...cRef.current] as Crop;
    const min = 0.05;
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - x0) / rect.width;
      const dy = (ev.clientY - y0) / rect.height;
      const n = [...s] as Crop;
      const cl = (v: number, other: number) => Math.max(0, Math.min(1 - other - min, v));
      if (edges === 'move') {
        const w = 1 - s[0] - s[2];
        const h = 1 - s[1] - s[3];
        n[0] = Math.max(0, Math.min(1 - w, s[0] + dx));
        n[2] = 1 - w - n[0];
        n[1] = Math.max(0, Math.min(1 - h, s[1] + dy));
        n[3] = 1 - h - n[1];
      } else {
        if (edges.includes('l')) n[0] = cl(s[0] + dx, s[2]);
        if (edges.includes('r')) n[2] = cl(s[2] - dx, s[0]);
        if (edges.includes('t')) n[1] = cl(s[1] + dy, s[3]);
        if (edges.includes('b')) n[3] = cl(s[3] - dy, s[1]);
      }
      setC(n);
    };
    const up = () => {
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', up);
    };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
  };
  const [l, t, r, b] = c;
  const box = { left: rect.left + l * rect.width, top: rect.top + t * rect.height, width: (1 - l - r) * rect.width, height: (1 - t - b) * rect.height };
  return (
    <>
      <div className={st.cropClip} style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }} onPointerDown={(e) => e.stopPropagation()}>
        <div className={st.cropBox} style={{ left: box.left - rect.left, top: box.top - rect.top, width: box.width, height: box.height }} onPointerDown={(e) => drag(e, 'move')}>
          {['tl', 't', 'tr', 'r', 'br', 'b', 'bl', 'l'].map((k) => (
            <span key={k} className={`${st.cropH} ${st['cropH_' + k]}`} onPointerDown={(e) => drag(e, k)} />
          ))}
        </div>
      </div>
      <div className={st.cropBar} style={{ left: Math.max(8, box.left), top: Math.min(innerHeight - 48, box.top + box.height + 8) }} onPointerDown={(e) => e.stopPropagation()}>
        <button type="button" className="btn" onClick={onCancel}>
          Abbrechen
        </button>
        <button type="button" className="btn" onClick={() => setC([0, 0, 0, 0])} disabled={c.every((x) => x === 0)}>
          Ganzes Bild
        </button>
        <button type="button" className="btn primary" onClick={() => onApply(c)}>
          Zuschneiden
        </button>
      </div>
    </>
  );
}

/** Kontextmenü der linken Leiste: Baustein umwandeln */
function ConvMenu({ conv, b, head, onPick, onSplit, onDelete, onClose }: { conv: { x: number; y: number }; b: Block | null | undefined; head?: boolean; onPick: (to: BlockType) => void; onSplit?: (m: SplitMode) => void; onDelete: () => void; onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const down = (e: PointerEvent) => !box.current?.contains(e.target as Node) && onClose();
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    addEventListener('pointerdown', down);
    addEventListener('keydown', key);
    return () => {
      removeEventListener('pointerdown', down);
      removeEventListener('keydown', key);
    };
  }, [onClose]);
  if (!b) return null;
  const left = Math.min(conv.x, innerWidth - 240);
  const top = Math.min(conv.y, innerHeight - 300);
  return (
    <div ref={box} className={`${st.menu} ${st.convMenu}`} style={{ left, top }} role="menu">
      {!head && CONVERTIBLE.includes(b.type) && (
        <>
          <div className={st.mh}>Umwandeln in</div>
          {CONVERTIBLE.map((t) => (
            <MI key={t} icon={BICON[t]} label={BLOCK_LABEL[t]} on={b.type === t} disabled={b.type === t} onClick={() => onPick(t)} />
          ))}
        </>
      )}
      {!head && onSplit && SPLITTABLE.includes(b.type) && <SplitItems b={b} split={onSplit} caret={false} />}
      <div className={st.mh}>{head ? 'Kopf' : BLOCK_LABEL[b.type]}</div>
      <MI icon="delete" label="Löschen" onClick={onDelete} />
    </div>
  );
}

/** Beispiel für Operatoren; jede Zeile „Operator: Erklärung“, Zeilen ohne Doppelpunkt sind Zwischenüberschriften */
const OPERATOREN = [
  '**Anforderungsbereich I**',
  'nennen: Informationen ohne Erläuterung aufzählen',
  'beschreiben: Sachverhalte strukturiert und fachsprachlich angemessen wiedergeben',
  'zusammenfassen: wesentliche Aussagen knapp und geordnet wiedergeben',
  '**Anforderungsbereich II**',
  'erklären: Sachverhalte in einen Zusammenhang einordnen und begründen',
  'analysieren: Material gezielt untersuchen und auswerten',
  'vergleichen: Gemeinsamkeiten und Unterschiede nach Kriterien darstellen',
  '**Anforderungsbereich III**',
  'beurteilen: Aussagen prüfen und ein begründetes Sachurteil fällen',
  'bewerten: wie beurteilen, dazu ein begründetes Werturteil mit offengelegten Maßstäben',
  'erörtern: Pro und Contra abwägen und zu einem begründeten Urteil kommen',
].join('\n');
type SplitMode = 'caret' | 'numbers' | 'paras' | 'headings';
/** Einträge „Aufteilen“: wie viele Bausteine entstünden, steht dahinter */
function SplitItems({ b, split, caret }: { b: Block; split: (m: SplitMode) => void; caret: boolean }) {
  const unit = b.type === 'task' ? 'Aufgaben' : 'Bausteine';
  const n = splitCount(b, 'numbers');
  const p = splitCount(b, 'paras');
  const h = splitCount(b, 'headings');
  return (
    <>
      <div className={st.mh}>Aufteilen</div>
      {caret && <MI label="an der Schreibmarke" onClick={() => split('caret')} hint="vor dem Absatz mit der Schreibmarke (am Absatzende: danach)" />}
      <MI label={`nach Nummern${n ? ` (${n} ${unit})` : ''}`} disabled={!n} onClick={() => split('numbers')} hint={b.type === 'task' ? '1., 2), Aufgabe 3: … neue Aufgabe; a) Teilaufgabe; Punkte am Zeilenende ins Punktefeld' : 'jede Zeile mit 1., 2), a) … beginnt einen neuen Baustein'} />
      <MI label={`jeden Absatz einzeln${p ? ` (${p})` : ''}`} disabled={!p} onClick={() => split('paras')} />
      <MI label={`an Überschriften${h ? ` (${h})` : ''}`} disabled={!h} onClick={() => split('headings')} hint="Zeilen mit # werden Überschriften" />
    </>
  );
}
function SplitDrop({ b, split }: { b: Block | null; split: (m: SplitMode) => void }) {
  const ok = !!b && SPLITTABLE.includes(b.type);
  const n = ok ? splitCount(b!, 'numbers') : 0;
  return (
    <Drop icon="distributecolumns" label="Aufteilen" value={n ? `${n} erkannt` : undefined} big disabled={!ok} title="Eingefügten Text in mehrere Bausteine teilen">
      {ok && <SplitItems b={b!} split={split} caret />}
    </Drop>
  );
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

/** Kamera für „Bild aufnehmen“ (Colibre hat keine) im selben Strich */
const CAM_SVG =
  '<svg class="cb" viewBox="0 0 24 24"><g fill="none" stroke="#3a3a38" stroke-width="1.2" stroke-linejoin="round"><path d="M3.5 7.5h4l1.5-2.5h6l1.5 2.5h4v12h-17z"/><circle cx="12" cy="13" r="3.8"/></g><circle cx="18" cy="10" r=".9" fill="#3a3a38"/></svg>';

/** Colibre-Icon (LibreOffice) */
function Ico({ n, size = 24 }: { n: string; size?: number }) {
  return <span className={st.ico} style={{ width: size, height: size }} aria-hidden dangerouslySetInnerHTML={{ __html: n === 'qr' ? QR_SVG : n === 'camera' ? CAM_SVG : colibre(n) }} />;
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
  grade: 'checkbox',
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
  /** Kopf gewählt: Reiter „Kopf“ statt Baustein */
  head: boolean;
  openHead: (corner?: CornerKey) => void;
  split: (m: SplitMode) => void;
  add: (t: BlockType, extra?: Partial<Block>) => void;
  move: (id: string, dir: -1 | 1) => void;
  remove: (id: string) => void;
  duplicate: (id: string) => void;
  toColumns: (id: string) => void;
  unColumns: (id: string) => void;
  setColCount: (id: string, n: number) => void;
  onImage: (f: Blob) => void;
  /** Scanner öffnen; das Bild kommt über onImage */
  onScan: () => void;
  ensureGlossary: () => void;
  onError: (m: string) => void;
  /** Format übertragen läuft (sticky: auf mehrere Bausteine) */
  painter: { sticky: boolean } | null;
  startPainter: (sticky: boolean) => void;
  flowView: boolean;
  setFlowView: (v: boolean) => void;
  /** Typst-Code anbieten (für Fortgeschrittene) */
  pro: boolean;
  select: (bid: string) => void;
  file: (a: FileAction) => void;
  busy: string;
  crop: string | null;
  setCrop: (bid: string | null) => void;
};

/** Klappmenü im Menüband: Knopf mit der aktuellen Wahl, darunter die Möglichkeiten mit Häkchen (wie in OnlyOffice) */
function Drop({ icon, iconEl, label, value, big, disabled, title, children, wide }: { icon?: string; iconEl?: React.ReactNode; label: string; value?: string; big?: boolean; disabled?: boolean; title?: string; children: React.ReactNode; wide?: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);
  return (
    <div className={st.drop} ref={ref}>
      <button type="button" className={`${st.rb} ${big ? st.rbBig : ''} ${open ? st.rbOn : ''}`} disabled={disabled} onClick={() => setOpen(!open)} aria-haspopup="menu" aria-expanded={open} aria-label={label} title={title ?? (value ? `${label}: ${value}` : label)}>
        {iconEl ?? <Ico n={icon ?? ''} size={big ? 24 : 16} />}
        {big ? (
          <>
            <span className={st.dropLabel}>{label}</span>
            <em className={st.dropVal}>
              {value ?? ''}
              <span className={st.caret}> ▾</span>
            </em>
          </>
        ) : (
          <span className={st.dropLabel}>
            {label}
            {value !== undefined && <em className={st.dropVal}>{value}</em>}
            <span className={st.caret}>▾</span>
          </span>
        )}
      </button>
      {open && (
        <div className={`${st.menu} ${wide ? st.menuWide : ''}`} role="menu" onClick={(e) => (e.target as Element).closest('[data-close]') && setOpen(false)}>
          {children}
        </div>
      )}
    </div>
  );
}
/** Eintrag im Klappmenü; mit `on` als Auswahl (Häkchen) */
function MI({ label, on, onClick, icon, hint, disabled, stay }: { label: string; on?: boolean; onClick: () => void; icon?: string; hint?: string; disabled?: boolean; stay?: boolean }) {
  return (
    <button type="button" role={on === undefined ? 'menuitem' : 'menuitemradio'} aria-checked={on} className={`${st.mi} ${on ? st.miOn : ''}`} disabled={disabled} onClick={onClick} data-close={stay ? undefined : ''}>
      <span className={st.miCheck}>{on ? '✓' : ''}</span>
      {icon && <Ico n={icon} size={16} />}
      <span className={st.miLabel}>{label}</span>
      {hint && <small>{hint}</small>}
    </button>
  );
}
/** Absatzvorlagen für jeden Textbaustein (Wunsch Jo, 24. November 2026: Formate der Vorlagen übertragen) */
const PARA_PRESETS: { id: string; label: string; style: NonNullable<BlattDoc['page']['styles']>[number]['style'] }[] = [
  { id: 'standard', label: 'Standard', style: {} },
  { id: 'einleitung', label: 'Einleitung', style: { it: true, lh: 1.5 } },
  { id: 'klein', label: 'Kleingedruckt', style: { fs: 85 } },
  { id: 'betont', label: 'Betont', style: { bd: true } },
  { id: 'block', label: 'Blocksatz', style: { ta: 'justify', lh: 1.45 } },
  { id: 'rand', label: 'Mit Randspalte', style: { ta: 'justify', lh: 1.6, nm: 35 } },
  { id: 'kompakt', label: 'Kompakt', style: { fs: 92, lh: 1.3 } },
  { id: 'luftig', label: 'Luftig', style: { lh: 1.8, ps: 0.8 } },
  { id: 'eingerueckt', label: 'Eingerückt', style: { ind: 10 } },
  { id: 'mitte', label: 'Groß, Mitte', style: { fs: 120, ta: 'center', it: true } },
  { id: 'spalten', label: 'Zwei Spalten', style: { flow: 2, ta: 'justify' } },
];
const STYLE_CLEAR = Object.fromEntries(STYLE_KEYS.map((k) => [k, undefined])) as Partial<Block>;

/** Vorschau einer Absatzvorlage als Knopf */
function presetCss(st0: Partial<Block>): React.CSSProperties {
  return {
    fontSize: st0.fs ? `${Math.min(st0.fs, 115)}%` : undefined,
    fontStyle: st0.it ? 'italic' : undefined,
    fontWeight: st0.bd ? 700 : st0.fw,
    textAlign: st0.ta,
    paddingLeft: st0.ind ? 8 : undefined,
    letterSpacing: st0.ls ? `${st0.ls}em` : undefined,
  };
}

/**
 * Reiter „Vorlagen“: Absatzvorlagen auf den gewählten Baustein übertragen (jede Art), Zeichenvorlagen auf den markierten
 * Text, eigene Vorlagen aus dem Format eines Bausteins speichern (im Blatt gemerkt).
 */
function StylesTab(props: {
  doc: BlattDoc;
  b: Block | null;
  textBlock: boolean;
  rich: boolean;
  set: (p: Partial<Block>) => void;
  setPageOpt: (p: Partial<BlattDoc['page']>) => void;
  exec: (c: string, v?: string) => boolean;
  selectedText: () => string;
  onError: (m: string) => void;
  ensureGlossary: () => void;
  add: (t: BlockType, extra?: Partial<Block>) => void;
}) {
  const { doc, b, textBlock, rich, set, exec } = props;
  const P = doc.page;
  const book = P.look === 'book';
  const [name, setName] = useState('');
  const own = doc.page.styles ?? [];
  const cur = b ? styleOf(b) : {};
  const same = (x: Partial<Block>) => STYLE_KEYS.every((k) => (x[k] ?? undefined) === ((cur as Partial<Block>)[k] ?? undefined));
  const apply = (x: Partial<Block>) => set({ ...STYLE_CLEAR, ...x, ...(b?.type === 'material' ? { justify: undefined } : {}) });
  const sel = () => {
    const w = props.selectedText();
    if (!w.trim()) props.onError('Erst im Text etwas markieren.');
    else props.onError('');
    return w;
  };
  const wrapNote = (kind: 'margin' | 'note') => {
    const w = sel().trim();
    if (w) exec('insertHTML', noteHtml(kind, w));
  };
  return (
    <>
      <Group label="Blatt">
        <Drop icon="editstyle" label="Blattvorlage" value={book ? 'Buchsatz' : 'Standard'} big title="Gestaltung des ganzen Blatts">
          <MI label="Standard" on={!book} onClick={() => props.setPageOpt({ look: undefined, sidenotes: undefined, font: 'sans' })} hint="serifenlose Schrift, Fußnoten unten auf der Seite" />
          <MI label="Buchsatz mit Randspalte" on={book} onClick={() => props.setPageOpt({ look: 'book', sidenotes: true, font: 'serif' })} hint="Serifenschrift, breite Randspalte für Notizen, Fußnoten neben der Zeile, Überschriften kursiv" />
          <MH>Einzeln</MH>
          <MI label="Fußnoten in den Rand" on={!!P.sidenotes} onClick={() => props.setPageOpt({ sidenotes: !P.sidenotes || undefined })} hint="nummeriert neben der Zeile statt unten auf der Seite" stay />
        </Drop>
        <RB icon="quoteparastyle" label="Motto" big onClick={() => props.add('quote', { md: '', source: '' })} title="Leitspruch mit Quelle, z. B. über einem Kapitel" />
      </Group>
      <Group label={b ? `Absatzvorlagen für: ${BLOCK_LABEL[b.type]}` : 'Absatzvorlagen'}>
        <div className={st.presets}>
          {PARA_PRESETS.map((p) => (
            <button key={p.id} type="button" className={`${st.preset} ${textBlock && same(p.style) ? st.presetOn : ''}`} disabled={!textBlock} onClick={() => apply(p.style)} title={textBlock ? `„${p.label}“ auf den Baustein übertragen` : 'Erst einen Textbaustein anklicken'}>
              <span style={presetCss(p.style)}>{p.label}</span>
            </button>
          ))}
          {own.map((p, i) => (
            <button
              key={'o' + i}
              type="button"
              className={`${st.preset} ${st.presetOwn} ${textBlock && same(p.style) ? st.presetOn : ''}`}
              disabled={!textBlock}
              onClick={() => apply(p.style)}
              onContextMenu={(e) => (e.preventDefault(), props.setPageOpt({ styles: own.filter((_, j) => j !== i) }))}
              title={`Eigene Vorlage „${p.name}“ übertragen (Rechtsklick löscht sie)`}
            >
              <span style={presetCss(p.style)}>{p.name}</span>
            </button>
          ))}
        </div>
      </Group>
      <Group label="Eigene Vorlage">
        <div className={st.rows}>
          <input className={st.rIn} value={name} onChange={(e) => setName(e.target.value)} placeholder="Name, z. B. Merktext" aria-label="Name der Vorlage" style={{ width: 150 }} disabled={!textBlock} />
          <button
            type="button"
            className="btn"
            disabled={!textBlock || !name.trim()}
            onClick={() => {
              const style = Object.fromEntries(STYLE_KEYS.filter((k) => (cur as Partial<Block>)[k] !== undefined).map((k) => [k, (cur as Partial<Block>)[k]]));
              props.setPageOpt({ styles: [...own.filter((x) => x.name !== name.trim()), { name: name.trim(), style }] });
              setName('');
            }}
            title="Das Format des gewählten Bausteins als Vorlage merken"
          >
            Format merken
          </button>
        </div>
      </Group>
      <Group label="Zeichenvorlagen für markierten Text">
        <div className={st.rows}>
          <div className={st.row}>
            <RB icon="italic" label="Betont" disabled={!rich} onClick={() => sel() && exec('italic')} title="kursiv" />
            <RB icon="bold" label="Stark" disabled={!rich} onClick={() => sel() && exec('bold')} title="fett" />
            <RB icon="backcolor" label="Markiert" disabled={!rich} onClick={() => sel() && exec('hiliteColor', '#fff59a')} title="Textmarker" />
            <RB icon="underline" label="Unterstrichen" disabled={!rich} onClick={() => sel() && exec('underline')} />
          </div>
          <div className={st.row}>
            <RB icon="insertannotation" label="In den Rand" disabled={!rich} onClick={() => wrapNote('margin')} title="Markierten Text als Randbemerkung neben die Zeile setzen" />
            <RB icon="insertfootnote" label="Als Fußnote" disabled={!rich} onClick={() => wrapNote('note')} title="Markierten Text als Fußnote unten auf die Seite" />
            <RB
              icon="insertmultiindex"
              label="Begriff"
              disabled={!rich}
              title="Markiertes Wort als Begriff ins Glossar"
              onClick={() => {
                const w = sel().trim();
                if (!w) return;
                const known = glossaryTerms(doc).find((t) => t.word.toLowerCase() === w.toLowerCase());
                exec('insertHTML', glossHtml(w, known?.explain ?? ''));
                props.ensureGlossary();
              }}
            />
            <RB icon="resetattributes" label="Zeichenformat entfernen" disabled={!rich} onClick={() => sel() && exec('removeFormat')} />
          </div>
        </div>
      </Group>
    </>
  );
}

/** Gestaltung aller Unterschriften unter Bildern, Diagrammen und Tabellen (gilt fürs ganze Blatt) */
function CaptionDrop({ doc, setPageOpt, big }: { doc: BlattDoc; setPageOpt: (p: Partial<BlattDoc['page']>) => void; big?: boolean }) {
  const C = doc.page.caption ?? {};
  const setC = (p: Partial<CaptionStyle>) => setPageOpt({ caption: { ...C, ...p } });
  const size = C.size ?? 85;
  const style = C.style ?? 'normal';
  const STYLE: Record<NonNullable<CaptionStyle['style']>, string> = { normal: 'normal', italic: 'kursiv', bold: 'fett', bolditalic: 'fett kursiv' };
  return (
    <Drop icon="insertcaptiondialog" label="Bildunterschrift" value={`${size} %, ${STYLE[style]}`} big={big} title="Schrift der Unterschriften unter Bildern, Diagrammen und Tabellen (für das ganze Blatt)">
      <MH>Größe</MH>
      {[70, 80, 85, 90, 100].map((v) => (
        <MI key={v} label={`${v} %${v === 85 ? ' (Standard)' : ''}`} on={size === v} stay onClick={() => setC({ size: v === 85 ? undefined : v })} />
      ))}
      <MH>Schnitt</MH>
      {(Object.keys(STYLE) as (keyof typeof STYLE)[]).map((k) => (
        <MI key={k} label={STYLE[k]} on={style === k} stay onClick={() => setC({ style: k === 'normal' ? undefined : k })} />
      ))}
      <MH>Ausrichtung</MH>
      {(
        [
          [undefined, 'wie das Bild (Standard)'],
          ['left', 'links'],
          ['center', 'Mitte'],
          ['right', 'rechts'],
        ] as const
      ).map(([v, l]) => (
        <MI key={l} label={l} on={C.align === v} stay onClick={() => setC({ align: v })} />
      ))}
      <MH>Mehr</MH>
      <MI label="grau" on={!!C.gray} stay onClick={() => setC({ gray: !C.gray || undefined })} />
      <MI label="nummerieren" hint="Abb. 1:, Tab. 1: davor" on={!!C.number} stay onClick={() => setC({ number: !C.number || undefined })} />
    </Drop>
  );
}

/** Linienstärke für Kästen (Kasten, Aufgabe oder Glossar im Kasten, Bewertung) */
function LineDrop({ b, set }: { b: Block | null | undefined; set: (p: Partial<Block>) => void }) {
  const ok = hasFrame(b);
  const cur: LineWeight = b?.line ?? 'thin';
  return (
    <Drop icon="formatline" label="Linie" value={ok ? LINE_LABEL[cur] : '–'} disabled={!ok} title={ok ? 'Stärke der Rahmenlinien' : 'Nur bei Kästen: Kasten, Aufgabe oder Glossar „im Kasten“, Notenkasten'}>
      <MH>Rahmenlinie</MH>
      {(Object.keys(LINE_MM) as LineWeight[]).map((k) => (
        <MI key={k} label={LINE_LABEL[k] + (k === 'thin' ? ' (Standard)' : '')} hint={`${de(LINE_MM[k])} mm`} on={cur === k} onClick={() => set({ line: k === 'thin' ? undefined : k })} />
      ))}
    </Drop>
  );
}
/** Überschrift im Klappmenü */
const MH = ({ children }: { children: React.ReactNode }) => <div className={st.mh}>{children}</div>;

const cm = (mm: number) => `${String(mm / 10).replace('.', ',')} cm`;
const de = (n: number) => String(n).replace('.', ',');
const WEIGHTS = [
  [300, 'Leicht'],
  [400, 'Normal'],
  [500, 'Halbfett (leicht)'],
  [600, 'Halbfett'],
  [700, 'Fett'],
] as const;
const SPACING = [
  [-0.02, 'Eng'],
  [0, 'Normal'],
  [0.03, 'Weit'],
  [0.08, 'Sehr weit'],
] as const;
const WRAPS = [
  ['inline', 'wrapoff', 'Mit Text in Zeile', 'eigene Zeile, Text darüber und darunter'],
  ['left', 'wrapright', 'Links, Text rechts daneben', 'Text umfließt das Bild'],
  ['right', 'wrapleft', 'Rechts, Text links daneben', 'Text umfließt das Bild'],
  ['front', 'bringtofront', 'Vor dem Text', 'frei verschieben, deckt Text ab'],
  ['behind', 'sendtoback', 'Hinter dem Text', 'frei verschieben, Text liegt darüber'],
] as const;
const KORR_LINE = [
  ['thin', 'dünne Linie'],
  ['medium', 'mittlere Linie'],
  ['thick', 'dicke Linie'],
  ['end', 'nur Zeilen enden'],
] as const;

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
  const ctx = props.head ? 'Kopf' : b && CTX_TYPES.includes(b.type) ? (b.type === 'cols' ? 'Spalten' : BLOCK_LABEL[b.type]) : null;
  const P = doc.page;
  const H = P.header;
  const rich = props.editingText && !!inline.current?.rich;
  const fs = s.fs ?? 100;
  const lh = s.lh ?? 1.35;
  const ps = s.ps ?? 0.5;
  const floating = !!b && (b.type === 'image' || b.type === 'chart');
  const wrapOf = (x: Block) => x.wrap ?? (x.free ? (x.over ? 'front' : 'behind') : 'inline');
  const order = P.booklet ? 'booklet' : P.nup ? 'nup' : 'single';
  const marks = ['', 'ENTWURF', 'MUSTER', 'LÖSUNG'];
  const labels = taskLabels(doc);
  const task = b?.type === 'task' ? b : null;
  const total = totalPoints(doc);
  return (
    <div className={`${st.ribbon} ${ctx && tab === 'block' ? st.ctxOn : ''}`} onMouseDown={keep}>
      <div className={st.tabs} role="tablist">
        <button role="tab" aria-selected={tab === 'file'} className={`${st.tab} ${st.tabFile} ${tab === 'file' ? st.tabOn : ''}`} onClick={() => setTab('file')}>
          Datei
        </button>
        {(
          [
            ['start', 'Start'],
            ['insert', 'Einfügen'],
            ['styles', 'Vorlagen'],
            ['task', 'Aufgabe'],
            ['design', 'Entwurf'],
            ['layout', 'Layout'],
          ] as const
        ).map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={`${st.tab} ${tab === k ? st.tabOn : ''}`} onClick={() => setTab(k)}>
            {l}
          </button>
        ))}
        {ctx && (
          <span className={st.ctxWrap}>
            <button role="tab" aria-selected={tab === 'block'} className={`${st.tab} ${st.tabCtx} ${tab === 'block' ? st.tabOn : ''}`} onClick={() => setTab('block')} title={`Einstellungen für den gewählten Baustein: ${ctx}`}>
              {ctx}
            </button>
          </span>
        )}
        <span className="grow" />
        {(
          [
            ['search', 'Suchen', 'recsearch'],
            ['material', 'Material', 'gallery'],
            ['glossary', 'Glossar', 'insertmultiindex'],
            ...(props.pro ? ([['typst', 'Code', 'basicideappear']] as const) : []),
          ] as const
        ).map(([k, l, i]) => (
          <button key={k} className={`${st.tab} ${st.tabSide} ${props.panel === k ? st.tabOn : ''}`} onClick={() => props.setPanel(props.panel === k ? null : k)} title={k === 'typst' ? 'Das ganze Blatt als Typst-Code: lesen und ändern' : 'Seitenleiste rechts ein- und ausblenden'}>
            <Ico n={i} size={16} />
            {l}
          </button>
        ))}
      </div>
      <div className={st.groups}>
        {tab === 'file' && (
          <>
            <Group label="Blatt">
              <RB icon="save" label="Speichern" big onClick={() => props.file('save')} title="Jetzt speichern (Strg+S); sonst speichert das Blatt von selbst" />
              <RB icon="duplicatepage" label="Kopie anlegen" big onClick={() => props.file('copy')} title="Neues Blatt mit demselben Inhalt anlegen und öffnen, z. B. für Gruppe B oder eine Nachschrift" />
            </Group>
            <Group label="Drucken">
              <RB icon="print" label="Drucken …" big onClick={() => props.file('print')} title="Drucken oder als PDF speichern, auch persönliche Exemplare mit QR-Code aus Autogra.fi" />
            </Group>
            <Group label="Exportieren">
              <RB icon="exportdirecttopdf" label="PDF" big onClick={() => props.file('print')} title="Im Druckfenster als Ziel „Als PDF speichern“ wählen" />
              <RB icon="exportto" label="Word" big disabled={!!props.busy} onClick={() => props.file('docx')} title="Als Word-Datei (.docx) zum Weiterbearbeiten; Seitenumbruch und Spalten legt Word selbst fest" />
              <RB icon="insertdoc" label="Webseite" big onClick={() => props.file('html')} title="Alle Seiten als eine HTML-Datei, so wie sie hier aussehen" />
              <RB icon="text" label="Text" big onClick={() => props.file('md')} title="Nur der Text als Markdown (.md), z. B. für eine Lernplattform" />
              {props.pro && <RB icon="basicideappear" label="Typst" big onClick={() => props.file('typst')} title="Typst-Code des Blatts (.typ)" />}
            </Group>
            <Group label="Weitergeben">
              <RB icon="saveas" label="Blatt-Datei" big onClick={() => props.file('json')} title="Das ganze Blatt mit Bildern als Datei (.blatt.json), z. B. für Kolleginnen und Kollegen" />
              <RB icon="open" label="Blatt-Datei öffnen" big onClick={() => props.file('open')} title="Eine Blatt-Datei hier übernehmen; ersetzt den Inhalt (Rückgängig holt ihn zurück)" />
            </Group>
            {props.busy && <span className={st.hint}>{props.busy}</span>}
          </>
        )}
        {tab === 'start' && (
          <>
            <Group label="Format">
              <button
                type="button"
                className={`${st.rb} ${st.rbBig} ${props.painter ? st.rbOn : ''}`}
                disabled={!b && !props.painter}
                onClick={() => props.startPainter(false)}
                onDoubleClick={() => props.startPainter(true)}
                aria-label="Format übertragen"
                title="Format übertragen: Gestaltung des gewählten Bausteins auf den nächsten Baustein übertragen, auf den du klickst. Doppelklick: auf mehrere nacheinander, Esc beendet."
                aria-pressed={!!props.painter}
              >
                <Ico n="formatpaintbrush" />
                <span>Format übertragen</span>
              </button>
            </Group>
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
                  <Drop icon="strongemphasischarstyle" label="Stärke" value={WEIGHTS.find(([w]) => w === (s.fw ?? 400))?.[1]} disabled={!textBlock} title="Schriftstärke des Bausteins">
                    <MH>Schriftstärke</MH>
                    {WEIGHTS.map(([w, l]) => (
                      <MI key={w} label={l} on={(s.fw ?? 400) === w} onClick={() => set({ fw: w === 400 ? undefined : w })} />
                    ))}
                  </Drop>
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
                  <Drop icon="spacing" label="Laufweite" value={SPACING.find(([v]) => v === (s.ls ?? 0))?.[1] ?? `${de(s.ls ?? 0)} em`} disabled={!textBlock} title="Abstand zwischen den Buchstaben">
                    <MH>Laufweite</MH>
                    {SPACING.map(([v, l]) => (
                      <MI key={v} label={l} on={(s.ls ?? 0) === v} onClick={() => set({ ls: v === 0 ? undefined : v })} />
                    ))}
                  </Drop>
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
                  <Drop icon="spacepara15" label="Abstand" value={de(lh)} disabled={!textBlock} title="Zeilen- und Absatzabstand">
                    <MH>Zeilenabstand</MH>
                    {withValue([1, 1.15, 1.25, 1.35, 1.5, 1.8, 2], lh).map((v) => (
                      <MI key={v} label={v === 1.35 ? '1,35 (Standard)' : de(v)} on={lh === v} onClick={() => set({ lh: v })} />
                    ))}
                    <MH>Abstand nach jedem Absatz</MH>
                    {withValue([0, 0.25, 0.5, 0.8, 1.2], ps).map((v) => (
                      <MI key={v} label={v === 0 ? 'kein' : v === 0.5 ? 'eine halbe Zeile (Standard)' : `${de(v)} Zeilen`} on={ps === v} onClick={() => set({ ps: v === 0.5 ? undefined : v })} />
                    ))}
                  </Drop>
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
                  <LineDrop b={b} set={set} />
                  <Drop icon="pagemargin" label="Rand für Notizen" value={s.nm ? cm(s.nm) : 'kein'} disabled={!textBlock} title="Freier Rand rechts für Notizen; Randbemerkungen stehen dort">
                    <MI label="kein Rand" on={!s.nm} onClick={() => set({ nm: 0 })} />
                    {withValue([20, 30, 40, 50], s.nm || undefined).map((v) => (
                      <MI key={v} label={cm(v)} on={s.nm === v} onClick={() => set({ nm: v })} />
                    ))}
                  </Drop>
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
              <SplitDrop b={b} split={props.split} />
            </Group>
          </>
        )}
        {tab === 'insert' && (
          <>
            <Group label="Text">
              {(['text', 'heading', 'material', 'quote', 'box'] as const).map((t) => (
                <RB key={t} icon={BICON[t]} label={BLOCK_LABEL[t]} big onClick={() => props.add(t)} title={`${BLOCK_LABEL[t]} einfügen (${props.selCol ? 'in die gewählte Spalte' : b ? 'nach dem gewählten Baustein' : 'am Ende'})`} />
              ))}
            </Group>
            <Group label="Definitionen">
              <Drop icon="insertmultiindex" label="Definitionen" big title="Begriff links, Erklärung rechts: jede Zeile „Begriff: Erklärung“">
                <MI label="leer" onClick={() => props.add('box', { tpl: 'definitionen', text: 'Definitionen', md: 'Begriff: Erklärung' })} hint="Kasten; jede Zeile „Begriff: Erklärung“" />
                <MI label="Operatoren (Anforderungsbereiche I–III)" onClick={() => props.add('box', { tpl: 'definitionen', text: 'Operatoren', md: OPERATOREN })} hint="Beispiel zum Anpassen an dein Fach" />
                <MI label="als Text ohne Kasten" onClick={() => props.add('text', { tpl: 'definitionen', md: 'Begriff: Erklärung' })} />
              </Drop>
            </Group>
            <Group label="Aufgaben">
              <RB icon={BICON.task} label="Aufgabe" big onClick={() => props.add('task')} />
              <RB icon="hangingindent" label="Teilaufgabe" big onClick={() => props.add('task', { subtask: true })} title="Teilaufgabe: a), b) … oder 1.1, 1.2 …" />
              <RB icon={BICON.lines} label="Linien" big onClick={() => props.add('lines')} title="Schreiblinien, Karos oder Freiraum" />
            </Group>
            <Group label="Illustrationen">
              <RB icon={BICON.image} label="Bild" big onClick={() => props.add('image')} />
              <RB icon="camera" label="Bild aufnehmen" big onClick={props.onScan} title="Blatt, Buchseite oder Karteikarte mit der Kamera aufnehmen: Ecken werden erkannt und gerade gezogen" />
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
              <RB icon={BICON.cols} label="Spalten" big onClick={() => props.add('cols')} title="Bausteine nebeneinander; Zahl und Stege stellst du unter „Layout“ ein" />
              <RB icon={BICON.pagebreak} label="Seitenumbruch" big onClick={() => props.add('pagebreak')} />
              <RB icon={BICON.glossary} label="Glossar" big onClick={() => props.add('glossary')} title="Verzeichnis der Begriffe" />
            </Group>
          </>
        )}
        {tab === 'task' && (
          <>
            <Group label="Neu">
              <RB icon={BICON.task} label="Aufgabe" big onClick={() => props.add('task')} />
              <RB icon="hangingindent" label="Teilaufgabe" big onClick={() => props.add('task', { subtask: true })} />
              <Drop icon="numberformatstandard" label="Nummern" value={(P.sub ?? 'letter') === 'letter' ? 'a), b)' : '1.1, 1.2'} big title="So werden Teilaufgaben nummeriert">
                <MH>Teilaufgaben nummerieren</MH>
                <MI label="a), b), c) …" on={(P.sub ?? 'letter') === 'letter'} onClick={() => props.setPageOpt({ sub: 'letter' })} />
                <MI label="1.1, 1.2, 1.3 …" on={P.sub === 'dot'} onClick={() => props.setPageOpt({ sub: 'dot' })} />
              </Drop>
            </Group>
            <Group label={task ? `Aufgabe ${labels.get(task.id) ?? ''}` : 'Gewählte Aufgabe'}>
              {task ? (
                <>
                  <RB icon="hangingindent" label="Ist Teilaufgabe" big on={!!task.subtask} onClick={() => set({ subtask: !task.subtask })} title="Eingerückt, a), b) … oder 1.1, 1.2 …" />
                  <div className={st.rows}>
                    <label className={st.mini}>
                      Nummer
                      <input className={st.rIn} value={task.num ?? ''} onChange={(e) => set({ num: e.target.value })} placeholder={labels.get(task.id) ?? 'auto'} title="Eigene Nummer, z. B. 1.2 oder 1 b); leer = automatisch" style={{ width: 70 }} />
                    </label>
                    <label className={st.mini}>
                      Punkte
                      <input className={st.rIn} value={task.points ?? ''} onChange={(e) => set({ points: e.target.value })} placeholder="z. B. 4" title="Punkte oder Anteil, z. B. 12 P. oder 50%" style={{ width: 70 }} />
                    </label>
                  </div>
                  <Drop icon="togglegridhorizontal" label="Antwort" value={(task.lines ?? 0) ? `${task.lines} ${task.lineStyle === 'grid' ? 'Karos' : 'Zeilen'}` : 'keine'} big title="Platz für die Antwort unter der Aufgabe">
                    <MH>Zeilen für die Antwort</MH>
                    {withValue([0, 3, 5, 8, 10, 15], task.lines ?? 0).map((v) => (
                      <MI key={v} label={v ? `${v} Zeilen` : 'keine'} on={(task.lines ?? 0) === v} onClick={() => set({ lines: v })} />
                    ))}
                    <MH>Art</MH>
                    <MI label="Schreiblinien" on={(task.lineStyle ?? 'lines') === 'lines'} onClick={() => set({ lineStyle: 'lines' })} />
                    <MI label="Karos (Mathe)" on={task.lineStyle === 'grid'} onClick={() => set({ lineStyle: 'grid' })} />
                  </Drop>
                  <SplitDrop b={task} split={props.split} />
                </>
              ) : (
                <span className={st.hint}>
                  Klick auf eine Aufgabe:
                  <br />
                  Nummer, Punkte, Antwort.
                </span>
              )}
            </Group>
            <Group label="Kopf">
              <RB icon="insertheader" label="Rahmendaten" big on={H.show !== false} onClick={() => props.openHead()} title="Kopf mit vier Feldern in den Ecken: direkt auf der Seite ausfüllen" />
              <Drop icon="qr" label="QR-Code" value={H.qr === 'none' ? 'aus' : H.qr === 'all' ? 'jede Seite' : 'Seite 1'} big title="Persönlicher QR-Code aus Autogra.fi: die Abgabe wird beim Scannen gleich zugeordnet">
                <MH>Persönlicher QR-Code aus Autogra.fi</MH>
                <MI label="kein QR-Code" on={H.qr === 'none'} onClick={() => props.setHeader({ qr: 'none' })} />
                <MI label="auf Seite 1" on={H.qr === 'first'} onClick={() => props.setHeader({ qr: 'first', show: true })} />
                <MI label="auf jeder Seite" on={H.qr === 'all'} onClick={() => props.setHeader({ qr: 'all', show: true })} hint="hilft, wenn Seiten getrennt gescannt werden" />
              </Drop>
            </Group>
            <Group label="Bewertung">
              <Drop icon="checkbox" label="Punktefelder" value={P.earned === 'box' || P.earned === 'line' ? (P.earned === 'box' ? 'Kästchen' : 'Linie') + (P.earnedMax === false ? '' : ' / Soll') : 'aus'} big title="Feld für die erreichten Punkte hinter jeder Aufgabe">
                <MH>Hinter jeder Aufgabe</MH>
                <MI label="kein Feld" hint="Punkte stehen im Text der Aufgabe" on={!P.earned || P.earned === 'none'} onClick={() => props.setPageOpt({ earned: 'none' })} />
                <MI label="Kästchen" hint={P.earnedMax === false ? '[   ] rechts neben der Aufgabe' : '[    / 6 P.] rechts, die Sollpunktzahl steht im Kästchen'} on={P.earned === 'box'} onClick={() => props.setPageOpt({ earned: 'box' })} />
                <MI label="Linie" hint={P.earnedMax === false ? '___ rechts neben der Aufgabe' : '___ / 6 P. rechts neben der Aufgabe'} on={P.earned === 'line'} onClick={() => props.setPageOpt({ earned: 'line' })} />
                <MH>Im Feld</MH>
                <MI label="Sollpunktzahl zeigen" stay hint="„/ 6 P.“; aus: die Punkte stehen im Text der Aufgabe" on={P.earnedMax !== false} disabled={!P.earned || P.earned === 'none'} onClick={() => props.setPageOpt({ earnedMax: P.earnedMax === false ? undefined : false })} />
              </Drop>
              <RB
                icon="tabledialog"
                label="Notenkasten"
                big
                on={walk(doc.blocks).some((x) => x.type === 'grade')}
                onClick={() => {
                  const g = walk(doc.blocks).find((x) => x.type === 'grade');
                  if (g) props.select(g.id);
                  else props.add('grade');
                }}
                title="Kasten für die Bewertung: Punkte je Aufgabe, Summe und ein Feld für die Note (meist am Ende)"
              />
            </Group>
            <Group label="Korrektur">
              <Drop icon="pagemargin" label="Korrekturrand" value={P.korr.side === 'none' ? 'aus' : `${P.korr.side === 'right' ? 'rechts' : 'links'} ${cm(P.korr.width)}`} big title="Freier Rand für die Korrektur neben Linien und Antworten">
                <MH>Seite</MH>
                <MI label="kein Korrekturrand" on={P.korr.side === 'none'} onClick={() => props.setPageOpt({ korr: { ...P.korr, side: 'none' } })} />
                <MI label="rechts" on={P.korr.side === 'right'} onClick={() => props.setPageOpt({ korr: { ...P.korr, side: 'right' } })} />
                <MI label="links" on={P.korr.side === 'left'} onClick={() => props.setPageOpt({ korr: { ...P.korr, side: 'left' } })} />
                {P.korr.side !== 'none' && (
                  <>
                    <MH>Breite</MH>
                    {[20, 25, 30, 40, 50].map((v) => (
                      <MI key={v} label={cm(v)} on={P.korr.width === v} onClick={() => props.setPageOpt({ korr: { ...P.korr, width: v } })} stay />
                    ))}
                    <MH>Linie</MH>
                    {KORR_LINE.map(([v, l]) => (
                      <MI key={v} label={l} on={P.korr.style === v} onClick={() => props.setPageOpt({ korr: { ...P.korr, style: v } })} stay />
                    ))}
                  </>
                )}
              </Drop>
              <Drop icon="watermark" label="Wasserzeichen" value={P.watermark ? P.watermark : 'aus'} big title="Schriftzug quer über jeder Seite">
                {marks.map((m) => (
                  <MI key={m} label={m || 'kein Wasserzeichen'} on={(P.watermark ?? '') === m} onClick={() => props.setPageOpt({ watermark: m })} />
                ))}
                <MH>Eigener Text</MH>
                <div className={st.miIn}>
                  <input className={st.rIn} value={marks.includes(P.watermark ?? '') ? '' : (P.watermark ?? '')} onChange={(e) => props.setPageOpt({ watermark: e.target.value })} placeholder="z. B. NACHSCHRIFT" aria-label="Eigener Text des Wasserzeichens" />
                </div>
              </Drop>
              <span className={st.hint} title="Summe der Punkte aller Aufgaben">
                {total !== null ? (
                  <>
                    zusammen
                    <br />
                    <strong>{de(total)} Punkte</strong>
                  </>
                ) : (
                  <>
                    Punkte: nicht bei
                    <br />
                    allen Aufgaben
                  </>
                )}
              </span>
            </Group>
          </>
        )}
        {tab === 'styles' && (
          <StylesTab
            add={props.add}
            doc={doc}
            b={b}
            textBlock={textBlock}
            rich={rich}
            set={set}
            setPageOpt={props.setPageOpt}
            exec={exec}
            selectedText={selectedText}
            onError={props.onError}
            ensureGlossary={props.ensureGlossary}
          />
        )}
        {tab === 'design' && (
          <>
            <Group label="Schrift des Blatts">
              <Drop icon="charfontname" label="Schriftart" value={P.font === 'serif' ? 'Mit Serifen' : 'Ohne Serifen'} big>
                <MI label="Ohne Serifen (Carlito)" on={P.font !== 'serif'} onClick={() => props.setPageOpt({ font: 'sans' })} />
                <MI label="Mit Serifen (Libertine)" on={P.font === 'serif'} onClick={() => props.setPageOpt({ font: 'serif' })} />
              </Drop>
              <Drop icon="grow" label="Grundschrift" value={`${de(P.fontSize)} pt`} big>
                {[10, 10.5, 11, 12, 13].map((z) => (
                  <MI key={z} label={`${de(z)} pt`} on={P.fontSize === z} onClick={() => props.setPageOpt({ fontSize: z })} />
                ))}
              </Drop>
            </Group>
            <Group label="Unterschriften">
              <CaptionDrop doc={doc} setPageOpt={props.setPageOpt} big />
            </Group>
            <Group label="Kopf der Seite">
              <Drop icon="insertheader" label="Kopfzeile" value={H.style === 'box' ? 'Kasten' : H.style === 'none' ? 'schlicht' : 'Linie'} big>
                <MH>Rahmendaten abgrenzen</MH>
                <MI label="Linie darunter" on={(H.style ?? 'line') === 'line'} onClick={() => props.setHeader({ style: 'line' })} />
                <MI label="im Kasten" on={H.style === 'box'} onClick={() => props.setHeader({ style: 'box' })} />
                <MI label="schlicht, ohne Linie" on={H.style === 'none'} onClick={() => props.setHeader({ style: 'none' })} />
                <MH>Größe des Titels</MH>
                {(
                  [
                    ['s', 'klein'],
                    ['m', 'mittel'],
                    ['l', 'groß'],
                  ] as const
                ).map(([v, l]) => (
                  <MI key={v} label={l} on={(H.titleSize ?? 'm') === v} onClick={() => props.setHeader({ titleSize: v })} stay />
                ))}
              </Drop>
            </Group>
            <Group label="Ansicht">
              <RB icon="controlcodes" label="Textfluss zeigen" big on={props.flowView} onClick={() => props.setFlowView(!props.flowView)} title="Zeigt, wie der Text über Seiten und Spalten weiterläuft und wo Bausteine zusammengehalten werden" />
              <RB
                icon="basicideappear"
                label="Typst-Code"
                big
                on={props.panel === 'typst'}
                onClick={() => {
                  props.setPanel(props.panel === 'typst' ? null : 'typst');
                  try {
                    localStorage.setItem('collegare.blatt.code', '1');
                  } catch {}
                }}
                title="Für Fortgeschrittene: das ganze Blatt als Typst-Code rechts lesen und ändern"
              />
            </Group>
          </>
        )}
        {tab === 'layout' && (
          <>
            <Group label="Seite einrichten">
              <Drop icon="pagemargin" label="Ränder" value={P.margin === 'narrow' ? 'Schmal' : P.margin === 'wide' ? 'Breit' : 'Normal'} big>
                {(
                  [
                    ['narrow', 'Schmal'],
                    ['normal', 'Normal'],
                    ['wide', 'Breit'],
                  ] as const
                ).map(([v, l]) => (
                  <MI key={v} label={l} hint={`${pageGeom({ ...doc, page: { ...P, margin: v } }).m} mm`} on={(P.margin ?? 'normal') === v} onClick={() => props.setPageOpt({ margin: v })} />
                ))}
              </Drop>
              <Drop icon="orientation" label="Ausrichtung" value={P.landscape ? 'Quer' : 'Hoch'} big>
                <MI label="Hochformat" on={!P.landscape} onClick={() => props.setPageOpt({ landscape: false })} />
                <MI label="Querformat" on={!!P.landscape} onClick={() => props.setPageOpt({ landscape: true, booklet: false })} />
              </Drop>
              <Drop icon="attributepagesize" label="Format" value={P.size.toUpperCase()} big>
                <MI label="A4" hint="21 × 29,7 cm" on={P.size === 'a4'} onClick={() => props.setPageOpt({ size: 'a4' })} />
                <MI label="A5" hint="14,8 × 21 cm" on={P.size === 'a5'} onClick={() => props.setPageOpt({ size: 'a5' })} />
              </Drop>
              <div className={st.rows}>
                <RB icon="insertpagenumberfield" label="Seitenzahlen" on={P.pageNumbers} onClick={() => props.setPageOpt({ pageNumbers: !P.pageNumbers })} />
              </div>
            </Group>
            <Group label="Umbrüche">
              <Drop icon="insertbreak" label="Umbrüche" big title="Seitenumbruch einfügen; festlegen, wo der Text über die Seite weiterläuft">
                <MI label="Seitenumbruch einfügen" icon="insertpagebreak" onClick={() => props.add('pagebreak')} hint="nach dem gewählten Baustein" />
                <MH>{b ? `Gewählter Baustein (${BLOCK_LABEL[b.type]})` : 'Gewählter Baustein'}</MH>
                <MI label="beginnt auf neuer Seite" on={!!b?.breakBefore} disabled={!b} onClick={() => set({ breakBefore: !b?.breakBefore || undefined })} stay />
                <MI label="nicht über Seiten teilen" on={!!b?.keep} disabled={!b} onClick={() => set({ keep: !b?.keep || undefined })} stay />
                <MI label="mit dem nächsten zusammenhalten" on={!!b?.keepNext} disabled={!b} onClick={() => set({ keepNext: !b?.keepNext || undefined })} stay hint="z. B. Aufgabe und Material" />
              </Drop>
            </Group>
            <Group label="Spalten">
              <Drop
                iconEl={<ColsIcon n={b?.type === 'cols' ? (b.cols ?? []).length : textBlock && (s.flow ?? 1) > 1 ? s.flow! : 2} />}
                label="Spalten"
                value={b?.type === 'cols' ? `${(b.cols ?? []).length} nebeneinander` : textBlock && (s.flow ?? 1) > 1 ? `Text in ${s.flow}` : undefined}
                big
                wide
                title="Text in Spalten fließen lassen oder Bausteine nebeneinander setzen"
              >
                {textBlock && b?.type !== 'table' && (
                  <>
                    <MH>Text fließt durch verbundene Spalten</MH>
                    {[1, 2, 3].map((n) => (
                      <MI key={n} label={n === 1 ? 'eine Spalte' : `${n} Spalten`} on={(s.flow ?? 1) === n} onClick={() => set({ flow: n === 1 ? undefined : n })} hint={n > 1 ? 'läuft von Spalte zu Spalte und über Seiten weiter' : undefined} />
                    ))}
                  </>
                )}
                {b?.type === 'cols' ? (
                  <>
                    <MH>Bausteine nebeneinander</MH>
                    {[1, 2, 3, 4].map((n) => (
                      <MI key={n} label={n === 1 ? 'Spalten auflösen' : `${n} Spalten`} on={n > 1 && (b.cols ?? []).length === n} onClick={() => props.setColCount(b.id, n)} />
                    ))}
                    <MI label="alle gleich breit" icon="distributecolumns" onClick={() => set({ ratio: (b.cols ?? []).map(() => 1) })} hint="Mittelstege auf der Seite ziehen" />
                  </>
                ) : (
                  <>
                    <MH>Bausteine nebeneinander einfügen</MH>
                    {[2, 3, 4].map((n) => (
                      <MI key={n} label={`${n} Spalten`} onClick={() => props.add('cols', { cols: Array.from({ length: n }, () => []), ratio: Array(n).fill(1) })} />
                    ))}
                  </>
                )}
                {(b?.type === 'cols' || (textBlock && (s.flow ?? 1) > 1)) && (
                  <>
                    <MH>Breite der Stege</MH>
                    {[3, 4, 6, 8, 10, 12].map((g) => (
                      <MI key={g} label={`${g} mm`} on={(b?.gap ?? 6) === g} onClick={() => set({ gap: g === 6 ? undefined : g })} hint={g === 6 ? 'Standard' : undefined} stay />
                    ))}
                  </>
                )}
              </Drop>
            </Group>
            <Group label="Druck">
              <Drop icon="printpreview" label="Seitenfolge" value={order === 'booklet' ? 'Broschüre' : order === 'nup' ? '2 je Blatt' : 'Einzeln'} big wide title="Wie die Seiten aufs Papier kommen">
                <MI label="Einzelseiten" hint={`jede Seite auf ein Blatt ${P.size.toUpperCase()}`} on={order === 'single'} onClick={() => props.setPageOpt({ booklet: false, nup: false })} />
                <MI label="Zwei Seiten je Blatt" hint={`1 | 2, 3 | 4 … auf ${P.size === 'a5' ? 'A4' : 'A3'} quer`} on={order === 'nup'} onClick={() => props.setPageOpt({ booklet: false, nup: true })} />
                <MI label="Broschüre" hint={`falten und heften, ${P.size === 'a5' ? 'A4' : 'A3'} quer, Seite 1 neben der letzten`} on={order === 'booklet'} onClick={() => props.setPageOpt({ booklet: true, nup: false, landscape: false })} />
                {order === 'booklet' && (
                  <>
                    <MH>Leere Seiten am Ende füllen mit</MH>
                    {(
                      [
                        ['lines', 'Schreiblinien'],
                        ['grid', 'Karos'],
                        ['empty', 'nichts'],
                      ] as const
                    ).map(([v, l]) => (
                      <MI key={v} label={l} on={P.fill === v} onClick={() => props.setPageOpt({ fill: v })} stay />
                    ))}
                  </>
                )}
              </Drop>
            </Group>
            <Group label="Anordnen">
              <Drop icon={floating && b ? (WRAPS.find(([w]) => w === wrapOf(b))?.[1] ?? 'wrapoff') : 'wrapoff'} label="Umfluss" value={floating && b ? WRAPS.find(([w]) => w === wrapOf(b))?.[2] : undefined} big wide disabled={!floating} title="Wie der Text um Bild oder Diagramm fließt">
                {WRAPS.map(([w, i, l, h]) => (
                  <MI
                    key={w}
                    icon={i}
                    label={l}
                    hint={h}
                    on={!!b && wrapOf(b) === w}
                    onClick={() => set(w === 'inline' ? { wrap: undefined, free: false, over: false, dx: undefined, dy: undefined } : w === 'left' || w === 'right' ? { wrap: w, free: false, over: false, dx: undefined, dy: undefined, width: Math.min(b?.width ?? 100, 50) } : { wrap: w, free: true, over: w === 'front' })}
                  />
                ))}
              </Drop>
              <Drop icon="objectalignleft" label="Ausrichten" value={floating && b ? ({ left: 'links', center: 'Mitte', right: 'rechts' } as const)[b.align ?? 'center'] : undefined} big disabled={!floating || !!b?.free || b?.wrap === 'left' || b?.wrap === 'right'}>
                {(
                  [
                    ['left', 'objectalignleft', 'links'],
                    ['center', 'alignmiddle', 'Mitte'],
                    ['right', 'objectalignright', 'rechts'],
                  ] as const
                ).map(([v, i, l]) => (
                  <MI key={v} icon={i} label={l} on={(b?.align ?? 'center') === v} onClick={() => set({ align: v })} />
                ))}
              </Drop>
              {b ? (
                <ArrangeRows {...props} b={b} />
              ) : (
                <span className={st.hint}>
                  Klick auf einen
                  <br />
                  Baustein.
                </span>
              )}
            </Group>
          </>
        )}
        {tab === 'block' && props.head && <HeadTab {...props} />}
        {tab === 'block' && !props.head && b && <BlockTab {...props} b={b} />}
        {tab === 'block' && !props.head && !b && <span className={st.hint}>Klick auf einen Baustein auf der Seite.</span>}
      </div>
    </div>
  );
}

/**
 * Ansicht „Textfluss“ (Wunsch Jo, 24. November 2026): wie die Bausteine als verbundene Rahmen durch Spalten und über
 * Seiten laufen. Jedes Stück eines geteilten Bausteins trägt seine Nummer in der Kette und sagt, wo es weitergeht;
 * zwischen zwei Bausteinen verbindet oder trennt ein Kettenknopf (zusammenhalten = auf derselben Seite).
 */
function decorateFlow(h: HTMLElement, doc: BlattDoc) {
  const pages = [...h.querySelectorAll<HTMLElement>('.bl-page')];
  const pieces = new Map<string, { el: HTMLElement; page: number }[]>();
  pages.forEach((pg, i) =>
    pg.querySelectorAll<HTMLElement>('.bl-body [data-bid]').forEach((el) => {
      const id = el.dataset.bid!;
      if (!pieces.has(id)) pieces.set(id, []);
      pieces.get(id)!.push({ el, page: i + 1 });
    }),
  );
  const tag = (el: HTMLElement, cls: string, text: string, title?: string) => {
    const t = document.createElement('span');
    t.className = `bl-fl ${cls}`;
    t.textContent = text;
    if (title) t.title = title;
    el.appendChild(t);
    return t;
  };
  for (const [id, list] of pieces) {
    const b = findBlock(doc.blocks, id);
    if (!b) continue;
    list.forEach(({ el }) => el.classList.add('bl-fl-frame'));
    if (list.length > 1)
      list.forEach(({ el }, k) => {
        tag(el, 'bl-fl-no', String(k + 1), `Rahmen ${k + 1} von ${list.length}`);
        if (k < list.length - 1) tag(el, 'bl-fl-next', `weiter auf Seite ${list[k + 1].page} →`);
        if (k > 0) tag(el, 'bl-fl-prev', `← von Seite ${list[k - 1].page}`);
      });
    const flags = [b.breakBefore && 'neue Seite', b.keep && 'nicht teilen', (b.flow ?? 0) > 1 && `fließt durch ${b.flow} Spalten`].filter(Boolean) as string[];
    if (flags.length) tag(list[0].el, 'bl-fl-flags', flags.join(' · '));
  }
  // Kettenknöpfe zwischen aufeinanderfolgenden Bausteinen der obersten Ebene
  const order = doc.blocks.map((b) => b.id);
  order.forEach((id, k) => {
    if (k === order.length - 1) return;
    const list = pieces.get(id);
    const last = list?.[list.length - 1]?.el;
    if (!last || last.parentElement?.closest('[data-bid]')) return;
    const b = doc.blocks[k];
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `bl-fl-link ${b.keepNext ? 'on' : ''}`;
    btn.dataset.link = id;
    btn.textContent = b.keepNext ? '⛓ verbunden' : '⛓';
    btn.title = b.keepNext ? 'Verbunden: bleibt mit dem nächsten Baustein auf einer Seite. Klick trennt.' : 'Mit dem nächsten Baustein verbinden: beide bleiben auf einer Seite';
    last.appendChild(btn);
  });
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

/** Anordnen: nach oben/unten, verdoppeln, neben den nächsten, entfernen */
function ArrangeRows(props: RibbonProps & { b: Block; noDelete?: boolean }) {
  const { b, doc } = props;
  const inCols = !!listOf(doc.blocks, b.id)?.parent;
  return (
    <div className={st.rows}>
      <div className={st.row}>
        <RB icon="moveup" label="Nach oben" hideLabel onClick={() => props.move(b.id, -1)} />
        <RB icon="movedown" label="Nach unten" hideLabel onClick={() => props.move(b.id, 1)} />
        <RB icon="duplicatepage" label="Verdoppeln" hideLabel onClick={() => props.duplicate(b.id)} />
      </div>
      <div className={st.row}>
        {b.type !== 'cols' && !inCols && <RB icon="formatcolumns" label="Neben den nächsten" hideLabel onClick={() => props.toColumns(b.id)} title="Diesen und den nächsten Baustein nebeneinander setzen" />}
        {!props.noDelete && <RB icon="delete" label="Entfernen" hideLabel onClick={() => props.remove(b.id)} title="Entfernen (Entf)" />}
      </div>
    </div>
  );
}
function Arrange(props: RibbonProps & { b: Block }) {
  return (
    <Group label="Anordnen">
      <ArrangeRows {...props} noDelete />
    </Group>
  );
}

/** Muster für die vier Ecken des Kopfs */
const CORNER_SETS: { label: string; c: Record<CornerKey, string> }[] = [
  { label: 'Standard', c: DEFAULT_CORNERS },
  { label: 'Klassenarbeit', c: { tl: '{Titel}\n{Klasse} · {Lehrkraft}', tr: 'Datum: {Datum}', bl: 'Name: {Name}', br: 'Punkte: {Punkte}   Note: ______' } },
  { label: 'Arbeitsblatt', c: { tl: '{Titel}', tr: '{Klasse}', bl: 'Name: {Name}', br: 'Datum: __________' } },
  { label: 'nur Titel', c: { tl: '{Titel}', tr: '', bl: '', br: '' } },
  { label: 'leer', c: { tl: '', tr: '', bl: '', br: '' } },
];
/** Reiter „Kopf“: Platzhalter und Linien in die Ecke setzen, Muster, Abgrenzung, QR-Code */
function HeadTab(props: RibbonProps) {
  const H = props.doc.page.header;
  const C = headCorners(props.doc);
  const inHead = () => !!props.inline.current?.el.closest('[data-bid="__head"]');
  const insert = (html: string) => {
    const api = props.inline.current;
    if (!api || !inHead()) return props.openHead();
    api.restore();
    // von Hand einsetzen: insertHTML setzt eine Marke am Zeilenende sonst hinter den Absatz
    const sel = getSelection();
    if (!sel?.rangeCount || !api.el.contains(sel.anchorNode)) return;
    const r = sel.getRangeAt(0);
    r.deleteContents();
    const tpl = document.createElement('template');
    tpl.innerHTML = html;
    const last = tpl.content.lastChild;
    r.insertNode(tpl.content);
    if (last) {
      r.setStartAfter(last);
      r.collapse(true);
      sel.removeAllRanges();
      sel.addRange(r);
    }
    api.emit();
  };
  return (
    <>
      <Group label="Einsetzen">
        {HEAD_TOKENS.map((t) => (
          <RB key={t.key} icon={t.key === 'Datum' ? 'datefield' : t.key === 'Name' ? 'edit' : t.key === 'Punkte' ? 'checkbox' : t.key === 'Titel' ? 'inserttitlefield' : 'text'} label={t.label} onClick={() => insert(tokHtml(t.key) + '&nbsp;')} title={`Platzhalter „${t.label}“: ${t.hint}`} />
        ))}
        <RB icon="line" label="Linie" onClick={() => insert('__________')} title="Linie zum Ausfüllen (so lang wie die Unterstriche)" />
      </Group>
      <Group label="Ecken">
        <Drop icon="insertheader" label="Muster" big title="Alle vier Ecken auf einmal füllen">
          {CORNER_SETS.map((m) => (
            <MI key={m.label} label={m.label} on={CORNERS.every(({ key }) => (C[key] ?? '') === m.c[key])} onClick={() => props.setHeader({ corners: { ...m.c }, show: true })} hint={[m.c.tl, m.c.tr, m.c.bl, m.c.br].filter(Boolean).join(' · ').replace(/\n/g, ' ') || 'alle Ecken leer'} />
          ))}
        </Drop>
      </Group>
      <Group label="Gestaltung">
        <Drop icon="insertheader" label="Abgrenzung" value={H.style === 'box' ? 'Kasten' : H.style === 'none' ? 'schlicht' : 'Linie'} big>
          <MH>Kopf abgrenzen</MH>
          <MI label="Linie darunter" on={(H.style ?? 'line') === 'line'} onClick={() => props.setHeader({ style: 'line' })} />
          <MI label="im Kasten" on={H.style === 'box'} onClick={() => props.setHeader({ style: 'box' })} />
          <MI label="schlicht, ohne Linie" on={H.style === 'none'} onClick={() => props.setHeader({ style: 'none' })} />
          <MH>Größe des Titels (erste Zeile oben links)</MH>
          {(
            [
              ['s', 'klein'],
              ['m', 'mittel'],
              ['l', 'groß'],
            ] as const
          ).map(([v, l]) => (
            <MI key={v} label={l} on={(H.titleSize ?? 'm') === v} onClick={() => props.setHeader({ titleSize: v })} stay />
          ))}
        </Drop>
        <Drop icon="qr" label="QR-Code" value={H.qr === 'none' ? 'aus' : H.qr === 'all' ? 'jede Seite' : 'Seite 1'} big title="Persönlicher QR-Code aus Autogra.fi">
          <MI label="kein QR-Code" on={H.qr === 'none'} onClick={() => props.setHeader({ qr: 'none' })} />
          <MI label="auf Seite 1" on={H.qr === 'first'} onClick={() => props.setHeader({ qr: 'first', show: true })} />
          <MI label="auf jeder Seite" on={H.qr === 'all'} onClick={() => props.setHeader({ qr: 'all', show: true })} hint="hilft, wenn Seiten getrennt gescannt werden" />
        </Drop>
      </Group>
      <span className={st.groupGap} />
      <Group label="Kopf">
        <RB icon="delete" label="Löschen" big onClick={() => props.setHeader({ show: false })} title="Kopf ausblenden (Aufgabe → Rahmendaten holt ihn zurück)" />
      </Group>
    </>
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
      {b.type === 'image' && (
        <>
          <Group label="Bild">
            <label className={`${st.rb} ${st.rbBig}`} title="Bild vom Gerät">
              <Ico n="insertgraphic" />
              <span>{b.src ? 'Anderes Bild' : 'Auswählen'}</span>
              <input type="file" accept="image/*" hidden onChange={(e) => (e.target.files?.[0] && props.onImage(e.target.files[0]), (e.target.value = ''))} />
            </label>
            <RB icon="camera" label="Aufnehmen" big onClick={props.onScan} title="Bild mit der Kamera aufnehmen (Scanner)" />
            <RB icon="gallery" label="Aus dem Material" big onClick={() => props.setPanel('material')} />
            <Drop icon="inserthyperlink" label="Aus dem Netz" value={loading ? 'lädt …' : undefined} big wide title="Bild über seine Adresse im Netz holen">
              <MH>Adresse des Bilds</MH>
              <form
                className={st.urlRow}
                style={{ padding: '4px 8px 8px' }}
                onSubmit={(e) => {
                  e.preventDefault();
                  void fromUrl();
                }}
              >
                <input autoFocus value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" aria-label="Adresse des Bilds im Netz" style={{ width: 240 }} />
                <button type="submit" className="btn" disabled={loading || !url.trim()}>
                  {loading ? 'Lädt …' : 'Laden'}
                </button>
              </form>
            </Drop>
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
            ) : null}
          </Group>
          <ImageTools b={b} set={set} crop={props.crop} setCrop={props.setCrop} onError={props.onError} />
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
      {b.type === 'grade' && (
        <Group label="Bewertung">
          <RB icon="tabledialog" label="Punkte je Aufgabe" big on={b.scoreTable !== false} onClick={() => set({ scoreTable: b.scoreTable === false })} title="Tabelle: Aufgaben, mögliche und erreichte Punkte, Summe" />
          <RB icon="insertannotation" label="Bemerkung" big on={!!b.remark} onClick={() => set({ remark: !b.remark })} title="Linie für eine Bemerkung" />
          <RB icon="edit" label="Unterschrift" big on={!!b.sign} onClick={() => set({ sign: !b.sign })} title="Linie für die Unterschrift" />
          <RB icon="qr" label="QR-Hinweis" big on={b.qrHint !== false} onClick={() => set({ qrHint: b.qrHint === false ? undefined : false })} title="Unten im Kasten: „Scannen Sie für ein genaues Feedback erneut den QR-Code.“ Erscheint nur, wenn das Blatt einen QR-Code hat." />
          <div className={st.rows}>
            <div className={st.row}>
              <LineDrop b={b} set={set} />
            </div>
            <label className={st.mini}>
              Feld heißt
              <input className={st.rIn} value={b.text ?? ''} onChange={(e) => set({ text: e.target.value })} placeholder="Note" style={{ width: 110 }} title="z. B. Note, Notenpunkte, Bewertung" />
            </label>
          </div>
        </Group>
      )}
      {b.type === 'pagebreak' && (
        <Group label="Seitenumbruch">
          <span className={st.hint}>Der nächste Baustein beginnt auf einer neuen Seite.</span>
        </Group>
      )}
      {(b.type === 'image' || b.type === 'chart' || b.type === 'table') && (
        <Group label="Unterschrift">
          <CaptionDrop doc={doc} setPageOpt={props.setPageOpt} big />
        </Group>
      )}
      <Arrange {...props} />
      <span className={st.groupGap} />
      <Group label="Baustein">
        <RB icon="delete" label="Löschen" big onClick={() => props.remove(b.id)} title={`${BLOCK_LABEL[b.type]} löschen (Entf)`} />
      </Group>
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

// ---------- Seitenleiste rechts: das Blatt als Typst-Code (für Fortgeschrittene) ----------
function TypstPanel({ doc, onApply, onClose }: { doc: BlattDoc; onApply: (d: BlattDoc) => void; onClose: () => void }) {
  const fresh = useMemo(() => toTypst(doc), [doc]);
  const [code, setCode] = useState(fresh);
  const [dirty, setDirty] = useState(false);
  const [err, setErr] = useState('');
  // Änderungen auf der Seite erscheinen im Code, solange hier nichts Ungespeichertes steht
  useEffect(() => {
    if (!dirty) setCode(fresh);
  }, [fresh, dirty]);
  const apply = () => {
    try {
      const d = fromTypst(code, doc);
      setErr('');
      setDirty(false);
      onApply(d);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <div className={st.code}>
      <div className="row">
        <strong>Typst-Code</strong>
        <span className="grow" />
        <button className="btn" onClick={onClose} title="Schließen">
          ✕
        </button>
      </div>
      <textarea
        className={st.codeArea}
        value={code}
        spellCheck={false}
        aria-label="Typst-Code des Blatts"
        onChange={(e) => (setCode(e.target.value), setDirty(true))}
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault();
            apply();
          } else if (e.key === 'Tab') {
            e.preventDefault();
            const t = e.currentTarget;
            const a = t.selectionStart;
            setCode(code.slice(0, a) + '  ' + code.slice(t.selectionEnd));
            setDirty(true);
            requestAnimationFrame(() => t.setSelectionRange(a + 2, a + 2));
          }
        }}
      />
      {err && <div className="error">{err}</div>}
      <div className="row">
        <button className="btn" disabled={!dirty} onClick={() => (setCode(fresh), setDirty(false), setErr(''))} title="Änderungen im Code verwerfen">
          Verwerfen
        </button>
        <span className="grow" />
        <button className="btn primary" disabled={!dirty} onClick={apply} title="Code aufs Blatt übernehmen (Strg+Enter)">
          Übernehmen
        </button>
      </div>
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
/** Alle Seiten als eine HTML-Datei, mit den Regeln des Seitensatzes (Bilder stecken schon im Blatt) */
function exportHtml(doc: BlattDoc, title: string, head: HeadCtx): string {
  const tmp = document.createElement('div');
  tmp.className = st.host;
  tmp.style.cssText = 'position:absolute;left:-10000px;top:0';
  document.body.appendChild(tmp);
  const r = paginate(doc, tmp, undefined, { head });
  const pages = r.pages.map((p) => p.outerHTML).join('\n');
  tmp.remove();
  const css: string[] = [];
  for (const sh of [...document.styleSheets]) {
    try {
      for (const rule of [...sh.cssRules]) css.push(rule.cssText);
    } catch {
      /* fremde Stilvorlagen */
    }
  }
  const g = pageGeom(doc);
  const esc = (x: string) => x.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title || 'Arbeitsblatt')}</title><style>${css.join('\n')}
body { margin: 0; background: #e8e8e8; }
.${st.host} { display: flex; flex-direction: column; align-items: center; gap: 8mm; padding: 8mm 0; }
@page { size: ${g.w}mm ${g.h}mm; margin: 0; }
@media print { body { background: #fff; } .${st.host} { padding: 0; gap: 0; } .${st.host} .bl-page { box-shadow: none; break-after: page; } }
</style></head><body><div class="${st.host}">${pages}</div></body></html>`;
}

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
