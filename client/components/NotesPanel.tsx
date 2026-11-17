'use client';
/**
 * Notizen und Quellen (Konzept 8d.2, 8e): Recherche-Karten der Gruppe als Seiten-Thread, nach dem Vorbild von
 * NotesThread.svelte in brausa. Eine Notiz ist ein Datensatz; in die Mindmap gezogen wird sie eine Karte, die
 * Überarbeitungen der Notiz übernimmt. Als eigene Seite (Kachel in der Phase Recherche) oder als Leiste rechts.
 *
 * Zweite Fassung (8e): Thread von alt nach neu mit großem „+ Neue Notiz“ darunter; Sichtbarkeit Privat / Gruppe /
 * Allgemein je Karte, dasselbe Select in der Kopfzeile filtert; Melden; Bearbeiten auf dem Desktop im großen Fenster.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import { projectSocket } from '@/lib/api';
import { isChatDrag, setChatDrag } from '@/lib/chatDrag';
import { imagesFrom, mayHoldImages, noteFileUrl, setImageDrag, takeImages, uploadImage, type ImageNoteInput } from '@/lib/imageDrop';
import { ImageImport } from './ImageImport';
import type { Me, ProjectView } from '@/lib/types';
import c from './notes.module.css';

type Kind = 'note' | 'source' | 'link' | 'image' | 'data';
export type Visibility = 'private' | 'group' | 'all';
export interface Note {
  id: number;
  userId: number;
  name: string;
  kind: Kind;
  title: string;
  body: string;
  source: string;
  url: string | null;
  /** Urheber, Lizenz, Ursprungsseite (Bilder) */
  credit?: string;
  license?: string;
  origin?: string | null;
  /** angehängte Datei: GET /api/projects/:id/notizen/:noteId/datei */
  file?: { mime: string; size: number } | null;
  visibility: Visibility;
  rows: string[][] | null;
  at: number;
  updatedAt: number;
  /** Bereich der Notiz (nur unter „Allgemein“ gesetzt, dort aus verschiedenen Gruppen) */
  scope?: string;
  reported?: boolean;
  reportedByMe?: boolean;
  reports?: { userId: number; name: string; reason: string; at: number }[];
}
interface JoinAck {
  ok: boolean;
  error?: string;
  role?: 'teacher' | 'student';
  scopes?: { scope: string; title: string }[];
  scope?: string | null;
  notes?: Note[];
}
interface Draft {
  kind: Kind;
  title: string;
  body: string;
  source: string;
  url: string;
  visibility: Visibility;
  rows: string[][];
  /** Bild: Urheber, Lizenz, Ursprungsseite; file = neu hochgeladener Pfad (undefined = Datei bleibt), preview zum Anzeigen */
  credit: string;
  license: string;
  origin: string;
  file?: string;
  preview?: string;
}
type Res = { ok: boolean; error?: string };

/** „Allgemein (alle Gruppen)“, wie SHARED im Server */
const SHARED = '*';

/** Arten im Editor; Bilder kommen meist über Ziehen und Einfügen (lib/imageDrop.ts), „Bild“ hier für eine Datei vom Gerät */
const KINDS: { kind: Kind; label: string; plural: string; hint: string }[] = [
  { kind: 'note', label: 'Notiz', plural: 'Notizen', hint: 'Gedanke, Frage, Absprache' },
  { kind: 'source', label: 'Quelle', plural: 'Quellen', hint: 'Buch, Artikel, Zitat mit Fundstelle' },
  { kind: 'link', label: 'Link', plural: 'Links', hint: 'Webseite oder Video' },
  { kind: 'data', label: 'Daten', plural: 'Daten', hint: 'Kleine Tabelle, auch aus einer Tabellenkalkulation eingefügt' },
  { kind: 'image', label: 'Bild', plural: 'Bilder', hint: 'Bild mit Urheber, Lizenz und Ursprungsseite. Bilder aus anderen Tabs einfach hierher ziehen oder einfügen.' },
];
/** Reihenfolge wie im Select gewünscht (Jo): Gruppe in der Mitte */
const VIS: { v: Visibility; label: string; long: string; icon: string }[] = [
  { v: 'private', label: 'Privat', long: 'Privat (nur ich und die Lehrkraft)', icon: '🔒' },
  { v: 'group', label: 'Gruppe', long: 'Gruppe', icon: '👥' },
  { v: 'all', label: 'Allgemein', long: 'Allgemein (alle im Projekt)', icon: '🌐' },
];
const visOf = (v: Visibility) => VIS.find((x) => x.v === v)!;
const blankRows = () => [
  ['', ''],
  ['', ''],
];
const empty = (kind: Kind = 'note', visibility: Visibility = 'group'): Draft => ({ kind, title: '', body: '', source: '', url: '', visibility, rows: blankRows(), credit: '', license: '', origin: '' });
const when = (ms: number) => new Date(ms).toLocaleString('de-DE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/** wie Notes.cardTitle und Notes.cardText im Server: so sieht die Karte in der Mindmap aus */
function cardTitle(n: Note) {
  const first = n.body.trim().split('\n')[0] ?? '';
  return (n.title || (first.length > 120 ? first.slice(0, 117).trimEnd() + '…' : first) || n.url || 'Notiz').slice(0, 200);
}
function cardText(n: Note) {
  const table = n.rows?.length ? n.rows.map((r) => r.join(' | ')).join('\n') : '';
  const rights = [n.credit, n.license].filter(Boolean).join(', ');
  const parts = [n.title ? n.body.trim() : n.body.trim().split('\n').slice(1).join('\n').trim(), table, n.source && `Fundstelle: ${n.source}`, rights && `Bild: ${rights}`, n.origin ?? n.url ?? ''];
  return parts.filter(Boolean).join('\n\n').slice(0, 5000);
}

/** großes Fenster nur auf dem Desktop (8e.6); am Handy bleibt die Eingabe in der Liste */
function useWide() {
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const m = window.matchMedia('(min-width: 760px) and (hover: hover)');
    const on = () => setWide(m.matches);
    on();
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return wide;
}

/** Tabelle bearbeiten: Zellen, Zeile/Spalte dazu, Einfügen aus der Tabellenkalkulation (Tabs und Zeilenumbrüche) */
function TableEdit({ rows, set }: { rows: string[][]; set: (r: string[][]) => void }) {
  const cols = Math.max(1, ...rows.map((r) => r.length));
  const norm = rows.map((r) => Array.from({ length: cols }, (_, i) => r[i] ?? ''));
  const cell = (ri: number, ci: number, v: string) => set(norm.map((r, i) => (i === ri ? r.map((x, j) => (j === ci ? v : x)) : r)));
  function paste(e: React.ClipboardEvent, ri: number, ci: number) {
    const t = e.clipboardData.getData('text/plain');
    if (!t.includes('\t') && !t.includes('\n')) return;
    e.preventDefault();
    const grid = t.replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n').map((l) => l.split('\t'));
    const out = norm.map((r) => [...r]);
    grid.forEach((line, i) =>
      line.forEach((v, j) => {
        const R = ri + i,
          C = ci + j;
        if (R >= 50 || C >= 12) return;
        while (out.length <= R) out.push(Array(cols).fill(''));
        for (const r of out) while (r.length <= C) r.push('');
        out[R][C] = v.trim();
      }),
    );
    set(out);
  }
  return (
    <div className={c.tableEdit}>
      <table>
        <tbody>
          {norm.map((r, ri) => (
            <tr key={ri}>
              {r.map((v, ci) => (
                <td key={ci}>
                  <input value={v} maxLength={500} placeholder={ri === 0 ? 'Überschrift' : ''} className={ri === 0 ? c.th : ''} onChange={(e) => cell(ri, ci, e.target.value)} onPaste={(e) => paste(e, ri, ci)} aria-label={`Zeile ${ri + 1}, Spalte ${ci + 1}`} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div className={c.row}>
        <button type="button" className="btn" disabled={norm.length >= 50} onClick={() => set([...norm, Array(cols).fill('')])}>
          + Zeile
        </button>
        <button type="button" className="btn" disabled={cols >= 12} onClick={() => set(norm.map((r) => [...r, '']))}>
          + Spalte
        </button>
        <span className="muted">Erste Zeile = Überschriften. Aus Excel oder Calc einfügen geht auch.</span>
      </div>
    </div>
  );
}

function VisSelect({ value, onChange, allowed, small = false }: { value: Visibility; onChange: (v: Visibility) => void; allowed?: Visibility[]; small?: boolean }) {
  return (
    <select className={small ? c.visSmall : c.vis} value={value} onChange={(e) => onChange(e.target.value as Visibility)} aria-label="Wer sieht die Notiz?" title="Wer sieht die Notiz?">
      {VIS.map((x) => (
        <option key={x.v} value={x.v} disabled={allowed && !allowed.includes(x.v)}>
          {x.icon} {small ? x.label : x.long}
        </option>
      ))}
    </select>
  );
}

function Editor({
  draft,
  setDraft,
  onSave,
  onCancel,
  busy,
  adding = false,
  visAllowed,
  showVis = true,
  pickImage,
}: {
  draft: Draft;
  setDraft: (d: Draft) => void;
  onSave: () => void;
  onCancel?: () => void;
  busy: boolean;
  adding?: boolean;
  visAllowed?: Visibility[];
  showVis?: boolean;
  /** Bild vom Gerät hochladen; setzt file und preview im Entwurf */
  pickImage?: (f: File, d: Draft) => void;
}) {
  const k = KINDS.find((x) => x.kind === draft.kind)!;
  const ok = draft.kind === 'image' ? !!(draft.file || draft.preview) : !!(draft.title.trim() || draft.body.trim() || draft.url.trim() || (draft.kind === 'data' && draft.rows.some((r) => r.some((x) => x.trim()))));
  const first = useRef<HTMLInputElement>(null);
  useEffect(() => first.current?.focus(), []);
  return (
    <form
      className={c.editor}
      onSubmit={(e) => {
        e.preventDefault();
        if (ok) onSave();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && onCancel) onCancel();
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && ok) {
          e.preventDefault();
          onSave();
        }
      }}
    >
      <div className={c.row}>
        <span className="seg" role="group" aria-label="Art">
          {KINDS.map((x) => (
            <button type="button" key={x.kind} className={`btn ${x.kind === draft.kind ? 'on' : ''}`} aria-pressed={x.kind === draft.kind} title={x.hint} onClick={() => setDraft({ ...draft, kind: x.kind })}>
              {x.label}
            </button>
          ))}
        </span>
        <span className="grow" />
        {showVis && <VisSelect value={draft.visibility} onChange={(v) => setDraft({ ...draft, visibility: v })} allowed={visAllowed} />}
      </div>
      <input ref={first} value={draft.title} maxLength={200} placeholder={draft.kind === 'source' ? 'Titel, Autorin oder Autor, Jahr' : draft.kind === 'data' ? 'Was zeigt die Tabelle?' : 'Überschrift (freiwillig)'} onChange={(e) => setDraft({ ...draft, title: e.target.value })} aria-label="Überschrift" />
      {draft.kind === 'data' && <TableEdit rows={draft.rows} set={(rows) => setDraft({ ...draft, rows })} />}
      {draft.kind === 'image' && (
        <div className={c.imageEdit}>
          {draft.preview ? <img src={draft.preview} alt="" /> : <span className="muted">Noch kein Bild. Wähle eine Datei, oder schließ das Fenster und zieh Bilder aus einem anderen Tab auf die Notizen.</span>}
          <label className="btn">
            {draft.preview ? 'Anderes Bild …' : 'Bild wählen …'}
            <input type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && pickImage?.(e.target.files[0], draft)} />
          </label>
        </div>
      )}
      <textarea
        rows={draft.kind === 'data' ? 2 : 4}
        value={draft.body}
        maxLength={10_000}
        placeholder={draft.kind === 'source' ? 'Zitat oder Zusammenfassung …' : draft.kind === 'link' ? 'Worum geht es auf der Seite?' : draft.kind === 'data' ? 'Erklärung zur Tabelle (freiwillig)' : k.hint + ' …'}
        onChange={(e) => setDraft({ ...draft, body: e.target.value })}
        aria-label="Text"
      />
      {(draft.kind === 'source' || draft.kind === 'data') && <input value={draft.source} maxLength={500} placeholder={draft.kind === 'data' ? 'Quelle der Daten, z. B. Statistisches Bundesamt 2024' : 'Fundstelle, z. B. S. 42 oder Kapitel 3'} onChange={(e) => setDraft({ ...draft, source: e.target.value })} aria-label="Fundstelle" />}
      {draft.kind !== 'note' && draft.kind !== 'image' && <input type="url" value={draft.url} maxLength={2000} placeholder="https://…" onChange={(e) => setDraft({ ...draft, url: e.target.value })} aria-label="Link" />}
      {draft.kind === 'image' && (
        <>
          <input value={draft.credit} maxLength={300} placeholder="Urheber: Fotografin, Zeichner, Rechteinhaber" onChange={(e) => setDraft({ ...draft, credit: e.target.value })} aria-label="Urheber" />
          <input value={draft.license} maxLength={200} placeholder="Lizenz, z. B. CC BY-SA 4.0 oder gemeinfrei" onChange={(e) => setDraft({ ...draft, license: e.target.value })} aria-label="Lizenz" />
          <input type="url" value={draft.origin} maxLength={2000} placeholder="Ursprungsseite: wo du das Bild gefunden hast (https://…)" onChange={(e) => setDraft({ ...draft, origin: e.target.value })} aria-label="Ursprungsseite" />
        </>
      )}
      <div className={c.row}>
        <span className="muted">Strg+Enter speichert</span>
        <span className="grow" />
        {onCancel && (
          <button type="button" className="btn" onClick={onCancel}>
            Abbrechen
          </button>
        )}
        <button className="btn primary" type="submit" disabled={!ok || busy}>
          {adding ? 'Hinzufügen' : 'Speichern'}
        </button>
      </div>
    </form>
  );
}

/** Editor als großes Fenster (Desktop) oder an Ort und Stelle (Handy) */
function EditShell({ wide, title, onClose, children }: { wide: boolean; title: string; onClose: () => void; children: React.ReactNode }) {
  if (!wide) return <div className={`${c.note} ${c.editing}`}>{children}</div>;
  return (
    <div className="modal-bg" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${c.modal}`} role="dialog" aria-label={title}>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}

function Table({ rows }: { rows: string[][] }) {
  const [head, ...body] = rows;
  return (
    <div className={c.tableWrap}>
      <table className={c.table}>
        {head && (
          <thead>
            <tr>
              {head.map((h, i) => (
                <th key={i}>{h}</th>
              ))}
            </tr>
          </thead>
        )}
        <tbody>
          {body.map((r, i) => (
            <tr key={i}>
              {r.map((v, j) => (
                <td key={j}>{v}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function NotesPanel({ me, project, panel = false, onClose, wanted = null }: { me: Me; project: ProjectView; panel?: boolean; onClose?: () => void; wanted?: string | null }) {
  const id = project.id;
  const wide = useWide();
  const [join, setJoin] = useState<JoinAck | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [scope, setScope] = useState<string | null>(null);
  // Lernende: Filter Privat / Gruppe / Allgemein (8e.3); Privat und Gruppe zeigen den eigenen Bereich
  const [level, setLevel] = useState<Visibility>('group');
  const [draft, setDraft] = useState<Draft>(empty());
  const [adding, setAdding] = useState(false);
  const [edit, setEdit] = useState<{ id: number; d: Draft } | null>(null);
  const [reporting, setReporting] = useState<{ id: number; reason: string } | null>(null);
  const [kind, setKind] = useState<Kind | 'all'>('all');
  // Bilder aus dem Netz: Auswahl von einer Seite, Hervorheben beim Ziehen
  const [pageImport, setPageImport] = useState<string | null>(null);
  const [dropping, setDropping] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState('');
  const sock = useRef<Socket | null>(null);
  const scopeRef = useRef<string | null>(null);
  scopeRef.current = scope;
  const ownScope = useRef<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const toBottom = useRef(false);

  const show = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 4000);
  };

  const doJoin = useCallback(
    (sc: string | null) => {
      sock.current?.emit('notes:join', { projectId: id, scope: sc ?? undefined }, (r: JoinAck) => {
        if (!r.ok) return show(r.error ?? 'Kein Zugriff');
        setJoin(r);
        setScope(r.scope ?? null);
        if (r.role === 'student' && r.scope !== SHARED) ownScope.current = r.scope ?? null;
        setNotes(r.notes ?? []);
        setEdit(null);
        toBottom.current = true;
      });
    },
    [id],
  );

  useEffect(() => {
    const so = projectSocket();
    sock.current = so;
    so.on('connect', () => doJoin(scopeRef.current ?? wanted));
    so.on('note', (m: { projectId: number; scope: string; note: Note }) => {
      if (m.projectId !== id || m.scope !== scopeRef.current) return;
      setNotes((l) => {
        if (l.some((x) => x.id === m.note.id)) return l.map((x) => (x.id === m.note.id ? m.note : x));
        toBottom.current = true;
        return [m.note, ...l];
      });
    });
    so.on('note:gone', (m: { projectId: number; scope: string; id: number }) => {
      if (m.projectId === id && m.scope === scopeRef.current) setNotes((l) => l.filter((x) => x.id !== m.id));
    });
    so.on('connect_error', (e) => show('Verbindung: ' + e.message));
    return () => {
      so.disconnect();
      sock.current = null;
    };
  }, [id, doJoin, wanted]);

  // wie ein Chat: beim Öffnen und bei neuen Notizen ans Ende
  useLayoutEffect(() => {
    if (!toBottom.current || !listRef.current) return;
    toBottom.current = false;
    listRef.current.scrollTop = listRef.current.scrollHeight;
  });

  const teacher = join?.role === 'teacher';
  const shared = scope === SHARED;

  function chooseLevel(v: Visibility) {
    setLevel(v);
    const target = v === 'all' ? SHARED : ownScope.current;
    if (target && target !== scope) doJoin(target);
  }

  const payload = (d: Draft) => ({
    kind: d.kind,
    title: d.title,
    body: d.body,
    source: d.kind === 'source' || d.kind === 'data' ? d.source : '',
    url: d.kind === 'note' ? '' : d.url.trim(),
    rows: d.kind === 'data' ? d.rows : undefined,
    visibility: shared ? 'all' : d.visibility,
    ...(d.kind === 'image' ? { credit: d.credit, license: d.license, origin: d.origin.trim(), url: d.url.trim(), ...(d.file ? { file: d.file } : {}) } : {}),
  });

  /** neue Notizen aus Bildern bekommen die Stufe, die gerade im Filter steht */
  const levelNow = (): Visibility => (shared ? 'all' : teacher ? 'group' : level);

  function addImageNote(n: ImageNoteInput): Promise<Res> {
    return new Promise((resolve) => {
      if (!scope || !sock.current?.connected) return resolve({ ok: false, error: 'Keine Verbindung zum Server. Bitte kurz warten.' });
      sock.current.emit('notes:add', { projectId: id, scope, note: { ...n, visibility: levelNow() } }, (r: Res) => resolve(r));
    });
  }

  /** Bilder aus anderen Tabs, Bildschirmfotos, Dateien: ablegen oder einfügen (lib/imageDrop.ts) */
  async function takeDropped(dt: DataTransfer) {
    if (!scope) return;
    const { images, pageLink } = imagesFrom(dt);
    if (!images.length) {
      if (pageLink) setPageImport(pageLink);
      return;
    }
    const r = await takeImages(id, scope, images, addImageNote, (d, all) => all > 1 && d < all && show(`Bild ${d + 1} von ${all} …`));
    if (r.page) return setPageImport(r.page);
    if (!r.added) return show(r.error ?? 'Kein Bild übernommen');
    show(`${r.added === 1 ? 'Bild' : r.added + ' Bilder'} übernommen${r.error ? ` (${r.error})` : ''}. Prüf Urheber, Lizenz und Ursprungsseite.`);
  }

  async function pickImage(f: File, d: Draft, put: (d: Draft) => void) {
    if (!scope) return;
    try {
      const up = await uploadImage(id, scope, { file: f });
      put({ ...d, file: up.file, preview: URL.createObjectURL(f), title: d.title || f.name.replace(/\.[a-z0-9]+$/i, '') });
    } catch (e) {
      show(e instanceof Error ? e.message : 'Hochladen fehlgeschlagen');
    }
  }

  function openAdd() {
    // neue Notiz bekommt die Stufe, die gerade im Filter steht
    setDraft(empty(draft.kind, teacher ? (shared ? 'all' : 'group') : level));
    setEdit(null);
    setAdding(true);
  }

  function add() {
    if (!scope) return;
    if (!sock.current?.connected) return show('Keine Verbindung zum Server. Bitte kurz warten.');
    setBusy(true);
    sock.current.emit('notes:add', { projectId: id, scope, note: payload(draft) }, (r: Res) => {
      setBusy(false);
      if (r.ok) {
        setDraft(empty(draft.kind, draft.visibility));
        setAdding(false);
      } else show(r.error ?? 'Speichern fehlgeschlagen');
    });
  }

  function update(n: Note, d: Draft, done?: () => void) {
    setBusy(true);
    sock.current?.emit('notes:update', { projectId: id, id: n.id, note: { ...payload(d), visibility: d.visibility } }, (r: Res) => {
      setBusy(false);
      if (r.ok) done?.();
      else show(r.error ?? 'Speichern fehlgeschlagen');
    });
  }

  const toDraft = (n: Note): Draft => ({
    kind: n.kind,
    title: n.title,
    body: n.body,
    source: n.source,
    url: n.url ?? '',
    visibility: n.visibility,
    rows: n.rows?.length ? n.rows : blankRows(),
    credit: n.credit ?? '',
    license: n.license ?? '',
    origin: n.origin ?? '',
    preview: n.file ? noteFileUrl(id, n.id, n.updatedAt) : undefined,
  });

  function save() {
    const n = edit && notes.find((x) => x.id === edit.id);
    if (n && edit) update(n, edit.d, () => setEdit(null));
  }

  function remove(n: Note) {
    if (!confirm('Diese Notiz löschen? Karten in der Mindmap bleiben stehen.')) return;
    sock.current?.emit('notes:delete', { projectId: id, id: n.id }, (r: Res) => !r.ok && show(r.error ?? 'Löschen fehlgeschlagen'));
  }

  function report() {
    if (!reporting) return;
    sock.current?.emit('notes:report', { projectId: id, id: reporting.id, reason: reporting.reason }, (r: Res) => {
      if (r.ok) {
        setReporting(null);
        show('Gemeldet. Die Karte sehen jetzt nur noch die Lehrkraft, wer sie geschrieben hat, und du.');
      } else show(r.error ?? 'Melden fehlgeschlagen');
    });
  }

  function unreport(n: Note) {
    sock.current?.emit('notes:unreport', { projectId: id, id: n.id }, (r: Res) => !r.ok && show(r.error ?? 'Aufheben fehlgeschlagen'));
  }

  /** Welche Stufen darf ich bei dieser Notiz wählen? Erstellerin alle, Lehrkraft nur zurück auf Privat */
  const allowedFor = (n: Note): Visibility[] => (n.userId === me.id ? ['private', 'group', 'all'] : teacher ? [n.visibility, 'private'] : [n.visibility]);

  const scopes = join?.scopes ?? [];
  const title = scopes.find((x) => x.scope === scope)?.title ?? '';
  // Thread wie ein Chat: alt oben, neu unten (Server liefert neu zuerst)
  const ordered = [...notes].reverse();
  const byLevel = !teacher && !shared && level === 'private' ? ordered.filter((n) => n.visibility === 'private' && n.userId === me.id) : ordered;
  const shown = kind === 'all' ? byLevel : byLevel.filter((n) => n.kind === kind);
  const editing = edit ? notes.find((n) => n.id === edit.id) : undefined;

  const editorFor = (n: Note) =>
    edit && (
      <Editor
        draft={edit.d}
        setDraft={(d) => setEdit({ id: n.id, d })}
        onSave={save}
        onCancel={() => setEdit(null)}
        busy={busy}
        visAllowed={allowedFor(n)}
        pickImage={(f, d) => void pickImage(f, d, (nd) => setEdit({ id: n.id, d: nd }))}
      />
    );

  const addEditor = <Editor draft={draft} setDraft={setDraft} onSave={add} onCancel={() => setAdding(false)} busy={busy} adding showVis={!shared} pickImage={(f, d) => void pickImage(f, d, setDraft)} />;

  // Ablegen nur für Bilder und Links von außen, nicht für eigene Karten (die gehen in die Mindmap)
  const canDrop = (e: React.DragEvent) => !!scope && !isChatDrag(e) && mayHoldImages(e.dataTransfer);

  return (
    <div
      className={`${c.wrap} ${panel ? c.panel : ''} ${dropping ? c.dropping : ''}`}
      onDragOver={(e) => {
        if (!canDrop(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        setDropping(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropping(false);
      }}
      onDrop={(e) => {
        setDropping(false);
        if (!canDrop(e)) return;
        e.preventDefault();
        void takeDropped(e.dataTransfer);
      }}
      onPaste={(e) => {
        // in Eingabefeldern bleibt Einfügen Text; sonst Bilder (Bildschirmfoto, kopiertes Bild) übernehmen
        const t = e.target as HTMLElement;
        if (!scope || t.closest('input, textarea, [contenteditable="true"]')) return;
        const { images, pageLink } = imagesFrom(e.clipboardData);
        if (!images.length && !pageLink) return;
        e.preventDefault();
        void takeDropped(e.clipboardData);
      }}
      tabIndex={-1}
    >
      <div className={c.bar}>
        {panel && <strong className={c.barTitle}>Notizen und Quellen</strong>}
        {teacher ? (
          <select value={scope ?? ''} onChange={(e) => doJoin(e.target.value)} aria-label="Welche Gruppe?" title="Welche Gruppe?">
            {scopes.map((x) => (
              <option key={x.scope} value={x.scope}>
                {x.title}
              </option>
            ))}
            <option value={SHARED}>🌐 Allgemein (alle Gruppen)</option>
          </select>
        ) : (
          join &&
          ownScope.current && (
            <>
              <select className={c.vis} value={level} onChange={(e) => chooseLevel(e.target.value as Visibility)} aria-label="Welche Notizen zeigen?" title="Privat: nur deine eigenen. Gruppe: alles deiner Gruppe. Allgemein: was die Gruppen für alle freigegeben haben.">
                {VIS.map((x) => (
                  <option key={x.v} value={x.v}>
                    {x.icon} {x.label}
                  </option>
                ))}
              </select>
              {!panel && title && <span className={`muted ${c.barScope}`}>{title}</span>}
            </>
          )
        )}
        <span className="grow" />
        {scope && (
          <button className={`btn icon ${c.fromPage}`} onClick={() => setPageImport('')} title="Bilder von einer Seite übernehmen: Adresse einfügen, Bilder auswählen. Einzelne Bilder kannst du auch einfach aus einem anderen Tab hierher ziehen." aria-label="Bilder von einer Seite">
            🖼
          </button>
        )}
        {onClose && (
          <button className={`btn icon ${c.close}`} onClick={onClose} title="Schließen" aria-label="Notizen schließen">
            ×
          </button>
        )}
      </div>
      {join && !scope ? (
        <div className={`panel ${c.notice}`}>{teacher ? 'Noch keine Gruppen.' : 'Du bist noch keiner Gruppe zugeordnet.'}</div>
      ) : (
        <div className={c.list} ref={listRef}>
          <div className={c.inner}>
            <div className={c.filter}>
              <span className="seg" role="group" aria-label="Zeigen">
                {([['all', 'Alle'], ...KINDS.map((k) => [k.kind, k.plural])] as [Kind | 'all', string][]).map(([k, label]) => (
                  <button key={k} className={`btn ${kind === k ? 'on' : ''}`} aria-pressed={kind === k} onClick={() => setKind(k)}>
                    {label}
                  </button>
                ))}
              </span>
              <span className="muted">{panel ? 'In die Mindmap ziehen' : 'Karten lassen sich in die Mindmap ziehen'}</span>
            </div>
            {join && shown.length === 0 && (
              <p className={`muted ${c.empty}`}>
                {notes.length ? 'Nichts in dieser Auswahl.' : shared ? 'Noch hat niemand etwas für alle freigegeben.' : 'Noch keine Notizen. Mit „Neue Notiz“ unten haltet ihr fest, was ihr gefunden habt.'}
              </p>
            )}
            {shown.map((n) => {
              const mine = n.userId === me.id;
              const canEdit = teacher || mine;
              if (edit?.id === n.id && !wide) return <div key={n.id} className={`${c.note} ${c.editing}`}>{editorFor(n)}</div>;
              return (
                <article
                  key={n.id}
                  className={`${c.note} ${c[n.kind]} ${n.visibility === 'all' && !shared ? c.released : ''} ${n.visibility === 'private' ? c.private : ''} ${n.reported ? c.reported : ''}`}
                  draggable={!n.reported}
                  onDragStart={(e) => {
                    setChatDrag(e, { name: n.name, body: [n.title, n.body].filter(Boolean).join('\n'), note: { id: n.id, title: cardTitle(n), text: cardText(n) } });
                    // Bilder auch auf Folien (Bento übernimmt Bild und Quellenangabe)
                    if (n.file && n.kind === 'image')
                      setImageDrag(e.dataTransfer, {
                        url: noteFileUrl(id, n.id, n.updatedAt),
                        alt: n.title,
                        citation: { author: [n.credit, n.license].filter(Boolean).join(', ') || undefined, title: n.title || undefined, sourceUrl: n.origin || n.url || '', retrievedAt: new Date(n.at).toISOString().slice(0, 10) },
                      });
                  }}
                  title={n.reported ? undefined : n.kind === 'image' ? 'In die Mindmap oder auf eine Folie ziehen' : 'In die Mindmap ziehen'}
                >
                  <header className={c.head}>
                    <span className={c.kind}>{KINDS.find((k) => k.kind === n.kind)?.label ?? (n.kind === 'image' ? 'Bild' : n.kind)}</span>
                    <span className={c.who}>
                      {n.name} · {when(n.updatedAt)}
                      {n.updatedAt > n.at + 1000 ? ' (überarbeitet)' : ''}
                    </span>
                    {canEdit && !shared ? (
                      <VisSelect small value={n.visibility} allowed={allowedFor(n)} onChange={(v) => update(n, { ...toDraft(n), visibility: v })} />
                    ) : (
                      <span className={c.visTag} title={visOf(n.visibility).long}>
                        {visOf(n.visibility).icon}
                      </span>
                    )}
                    <span className={c.tools}>
                      {canEdit && (
                        <button
                          className="btn icon"
                          onClick={() => {
                            setAdding(false);
                            setEdit({ id: n.id, d: toDraft(n) });
                          }}
                          title="Überarbeiten"
                          aria-label="Überarbeiten"
                        >
                          ✎
                        </button>
                      )}
                      {!mine && !n.reportedByMe && (
                        <button className="btn icon" onClick={() => setReporting({ id: n.id, reason: '' })} title="Melden: Die Karte sehen dann nur noch die Lehrkraft, wer sie geschrieben hat, und du." aria-label="Melden">
                          ⚑
                        </button>
                      )}
                      {canEdit && (
                        <button className="btn icon" onClick={() => remove(n)} title="Löschen" aria-label="Löschen">
                          ×
                        </button>
                      )}
                    </span>
                  </header>
                  {n.reported && (
                    <div className={c.reportBox}>
                      <strong>⚑ Gemeldet.</strong>{' '}
                      {teacher ? (
                        <>
                          {n.reports?.map((r) => `${r.name}${r.reason ? ': „' + r.reason + '“' : ''}`).join('; ')}{' '}
                          <button className="btn" onClick={() => unreport(n)}>
                            Meldung aufheben
                          </button>
                        </>
                      ) : n.reportedByMe ? (
                        'Du hast diese Karte gemeldet. Die Lehrkraft schaut sie sich an.'
                      ) : (
                        'Diese Karte wurde gemeldet. Bis die Lehrkraft sie ansieht, sehen sie nur du und die Lehrkraft.'
                      )}
                    </div>
                  )}
                  {reporting?.id === n.id && (
                    <form
                      className={c.reportForm}
                      onSubmit={(e) => {
                        e.preventDefault();
                        report();
                      }}
                    >
                      <input autoFocus value={reporting.reason} maxLength={300} placeholder="Grund (freiwillig)" onChange={(e) => setReporting({ id: n.id, reason: e.target.value })} aria-label="Grund" />
                      <button type="button" className="btn" onClick={() => setReporting(null)}>
                        Abbrechen
                      </button>
                      <button className="btn primary">Melden</button>
                    </form>
                  )}
                  {n.kind === 'image' && n.file && <img className={c.picture} src={noteFileUrl(id, n.id, n.updatedAt)} alt={n.title} loading="lazy" draggable={false} />}
                  {n.title && <h3 className={c.title}>{n.title}</h3>}
                  {n.kind === 'image' && (
                    <p className={c.place}>
                      {[n.credit && `Urheber: ${n.credit}`, n.license && `Lizenz: ${n.license}`].filter(Boolean).join(' · ') || 'Urheber und Lizenz fehlen noch.'}
                      {n.origin ? (
                        <>
                          {' · '}
                          <a href={n.origin} target="_blank" rel="noopener noreferrer">
                            {(() => {
                              try {
                                return new URL(n.origin).hostname.replace(/^www\./, '');
                              } catch {
                                return n.origin;
                              }
                            })()}
                          </a>
                        </>
                      ) : (
                        <span className={c.missing}> · Ursprungsseite fehlt{canEdit ? ', bitte mit ✎ nachtragen' : ''}</span>
                      )}
                    </p>
                  )}
                  {n.rows && n.rows.length > 0 && <Table rows={n.rows} />}
                  {n.body && <p className={c.body}>{n.body}</p>}
                  {n.source && <p className={c.place}>{n.kind === 'data' ? 'Quelle' : 'Fundstelle'}: {n.source}</p>}
                  {n.url && n.kind !== 'image' && (
                    <a className={c.url} href={n.url} target="_blank" rel="noopener noreferrer">
                      {n.url.replace(/^https?:\/\//, '')}
                    </a>
                  )}
                </article>
              );
            })}
            {join && scope && (adding && !wide ? addEditor : <button className={c.addBig} onClick={openAdd}>
                <span aria-hidden>+</span> Neue Notiz
              </button>)}
          </div>
        </div>
      )}
      {wide && adding && (
        <EditShell wide title={shared ? 'Neue Notiz für alle' : 'Neue Notiz'} onClose={() => setAdding(false)}>
          {addEditor}
        </EditShell>
      )}
      {wide && editing && (
        <EditShell wide title="Notiz überarbeiten" onClose={() => setEdit(null)}>
          {editorFor(editing)}
        </EditShell>
      )}
      {pageImport !== null && scope && <ImageImport projectId={id} scope={scope} start={pageImport} addNote={addImageNote} onClose={() => setPageImport(null)} onDone={show} />}
      {dropping && <div className={c.dropHint}>Bilder hier ablegen: Sie kommen mit Urheber, Lizenz und Ursprungsseite in die Notizen.</div>}
      {toast && <div className={c.toast}>{toast}</div>}
    </div>
  );
}
