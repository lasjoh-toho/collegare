'use client';
/**
 * Notizen und Quellen (Konzept 8d.2, 8e): Recherche-Karten der Gruppe als Seiten-Thread, nach dem Vorbild von
 * NotesThread.svelte in brausa. Eine Notiz ist ein Datensatz; in die Mindmap gezogen wird sie eine Karte, die
 * Überarbeitungen der Notiz übernimmt. Als eigene Seite (Kachel in der Phase Recherche) oder als Leiste rechts.
 *
 * Zweite Fassung (8e): Thread von alt nach neu mit großem „+ Neue Notiz“ darunter; Sichtbarkeit Privat / Gruppe /
 * Allgemein je Karte, dasselbe Select in der Kopfzeile filtert; Melden.
 *
 * Dritte Fassung (Wunsch Jo, 20. November 2026): Bearbeiten an Ort und Stelle per Doppelklick, Klick daneben
 * speichert; Feld „Material“ oben (Adresse, Datei, Foto, Art wird erkannt); Überschrift aus markierten Wörtern;
 * eingefügter Text von außen steht unter „Arbeitsprozess“; Bilder mit Text aus anderen Tabs „auf Notizen verteilen“;
 * Filter „Quellenangabe fehlt“ statt eines Hinweises unter jeder Notiz; Ton und Video nur, wenn erlaubt.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import { projectSocket } from '@/lib/api';
import { isChatDrag, setChatDrag } from '@/lib/chatDrag';
import { imageInfo, imagesFrom, looksLikeImage, mayHoldImages, noteFileUrl, proxied, readPage, setImageDrag, takeImages, uploadImage, type ImageNoteInput } from '@/lib/imageDrop';
import { post } from '@/lib/api';
import { clipOrigin } from '@/lib/clip';
import type { PasteRules } from '@/lib/pasteRules';
import { blocksFrom, textLength, type Block } from '@/lib/splitPaste';
import { usePasteGuard, type PasteGuard } from '@/lib/usePasteGuard';
import { Icon } from './Icon';
import { ImageImport } from './ImageImport';
import { NoteSplit, type SplitNoteInput } from './NoteSplit';
import { PasteNotes } from './PasteNotes';
import type { Me, ProjectView } from '@/lib/types';
import { GliederungLive } from './GliederungLive';
import c from './notes.module.css';

type Kind = 'note' | 'source' | 'link' | 'image' | 'data' | 'video' | 'audio' | 'hand';
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
  /** Typ der Datei, damit die Vorschau Bild, Ton oder Video zeigt */
  mime?: string;
}
type Res = { ok: boolean; error?: string; id?: number };

/** „Allgemein (alle Gruppen)“, wie SHARED im Server */
const SHARED = '*';

/** Arten im Editor; Bilder kommen meist über Ziehen und Einfügen (lib/imageDrop.ts), „Bild“ hier für eine Datei vom Gerät */
const KINDS: { kind: Kind; label: string; plural: string; hint: string }[] = [
  { kind: 'note', label: 'Notiz', plural: 'Notizen', hint: 'Gedanke, Frage, Absprache' },
  { kind: 'source', label: 'Quelle', plural: 'Quellen', hint: 'Buch, Artikel, Zitat mit Fundstelle' },
  { kind: 'link', label: 'Link', plural: 'Links', hint: 'Webseite oder Video' },
  { kind: 'data', label: 'Daten', plural: 'Daten', hint: 'Kleine Tabelle, auch aus einer Tabellenkalkulation eingefügt' },
  { kind: 'image', label: 'Bild', plural: 'Bilder', hint: 'Bild mit Urheber, Lizenz und Ursprungsseite. Bilder aus anderen Tabs einfach hierher ziehen oder einfügen.' },
  { kind: 'video', label: 'Video', plural: 'Videos', hint: 'Video aufnehmen, hochladen oder verlinken' },
  { kind: 'audio', label: 'Audio', plural: 'Audio', hint: 'Ton aufnehmen oder hochladen, z. B. ein Interview' },
  { kind: 'hand', label: 'Handschrift', plural: 'Handschrift', hint: 'Foto einer handschriftlichen Notiz mit dem Text dazu' },
];
/** Arten mit Datei und was der Dateiwähler annimmt */
const FILE_KINDS: Partial<Record<Kind, { accept: string; capture?: 'environment' | 'user'; what: string }>> = {
  image: { accept: 'image/*', what: 'Bild' },
  hand: { accept: 'image/*', capture: 'environment', what: 'Foto' },
  video: { accept: 'video/*', what: 'Video' },
  audio: { accept: 'audio/*,.m4a,.mp3,.ogg,.wav,.webm', what: 'Tonaufnahme' },
};
/** Reihenfolge wie im Select gewünscht (Jo): Gruppe in der Mitte */
const VIS: { v: Visibility; label: string; long: string; icon: 'lock' | 'users' | 'globe' }[] = [
  { v: 'private', label: 'Privat', long: 'Privat (nur ich und die Lehrkraft)', icon: 'lock' },
  { v: 'group', label: 'Gruppe', long: 'Gruppe', icon: 'users' },
  { v: 'all', label: 'Allgemein', long: 'Allgemein (alle im Projekt)', icon: 'globe' },
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
          {small ? x.label : x.long}
        </option>
      ))}
    </select>
  );
}

/** Aufnahme mit Mikrofon oder Kamera (MediaRecorder); das Ergebnis geht wie eine gewählte Datei hoch */
function Recorder({ video, onDone, onError }: { video: boolean; onDone: (f: File) => void; onError: (m: string) => void }) {
  const [rec, setRec] = useState<{ r: MediaRecorder; stream: MediaStream; t0: number } | null>(null);
  const [secs, setSecs] = useState(0);
  const live = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (!rec) return;
    const t = setInterval(() => setSecs(Math.round((Date.now() - rec.t0) / 1000)), 500);
    if (video && live.current) live.current.srcObject = rec.stream;
    return () => clearInterval(t);
  }, [rec, video]);
  useEffect(() => () => rec?.stream.getTracks().forEach((t) => t.stop()), [rec]);
  async function start() {
    if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices?.getUserMedia) return onError('Aufnehmen geht in diesem Browser nicht. Bitte eine Datei wählen.');
    try {
      const stream = await navigator.mediaDevices.getUserMedia(video ? { video: { facingMode: 'environment' }, audio: true } : { audio: true });
      const r = new MediaRecorder(stream);
      const parts: Blob[] = [];
      r.ondataavailable = (e) => e.data.size && parts.push(e.data);
      r.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const type = r.mimeType || (video ? 'video/webm' : 'audio/webm');
        const ext = type.includes('mp4') ? (video ? 'mp4' : 'm4a') : type.includes('ogg') ? 'ogg' : 'webm';
        const stamp = new Date().toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).replace(/[^0-9]+/g, '-');
        onDone(new File(parts, `${video ? 'video' : 'aufnahme'}-${stamp}.${ext}`, { type }));
        setRec(null);
      };
      r.start(1000);
      setSecs(0);
      setRec({ r, stream, t0: Date.now() });
    } catch {
      onError(video ? 'Kein Zugriff auf Kamera und Mikrofon.' : 'Kein Zugriff auf das Mikrofon.');
    }
  }
  return (
    <span className={c.recorder} data-recording={rec ? '' : undefined}>
      {rec && video && <video ref={live} autoPlay muted playsInline />}
      {rec ? (
        <button type="button" className="btn" onClick={() => rec.r.stop()}>
          <span className={c.recDot} /> Stopp ({Math.floor(secs / 60)}:{String(secs % 60).padStart(2, '0')})
        </button>
      ) : (
        <button type="button" className="btn" onClick={() => void start()} title={video ? 'Video mit der Kamera aufnehmen' : 'Ton mit dem Mikrofon aufnehmen'}>
          <Icon name={video ? 'video' : 'mic'} size={15} /> {video ? 'Video' : 'Ton'}
        </button>
      )}
    </span>
  );
}

/** Vorschau einer Notizdatei je nach Typ */
function Media({ src, mime, kind, title, className }: { src: string; mime?: string; kind: Kind; title?: string; className?: string }) {
  if (kind === 'audio' || mime?.startsWith('audio/')) return <audio className={c.audio} controls preload="metadata" src={src} />;
  if (kind === 'video' || mime?.startsWith('video/')) return <video className={c.video} controls preload="metadata" playsInline src={src} />;
  return <img className={className} src={src} alt={title ?? ''} loading="lazy" draggable={false} />;
}

/** Was Ton und Video in diesem Projekt dürfen (Einstellungen notesAudio, notesVideo, notesMediaMb) */
interface MediaRules {
  audio: boolean;
  video: boolean;
  mb: number;
}

const VIDEO_URL = /(youtube\.com\/|youtu\.be\/|vimeo\.com\/|\.(mp4|webm|mov|m4v)(\?|#|$))/i;
const AUDIO_URL = /\.(mp3|m4a|ogg|oga|wav|flac|opus)(\?|#|$)/i;
const NEEDS_FILE: Kind[] = ['image', 'audio', 'hand'];

/** Welche Art passt zu einer Datei? null = nicht erlaubt */
function kindForFile(f: File, current: Kind): Kind | null {
  if (f.type.startsWith('image/')) return current === 'hand' ? 'hand' : 'image';
  if (f.type.startsWith('audio/')) return 'audio';
  if (f.type.startsWith('video/')) return current === 'audio' ? 'audio' : 'video';
  if (/\.(m4a|mp3|ogg|wav|flac|opus)$/i.test(f.name)) return 'audio';
  if (/\.(mp4|webm|mov|m4v)$/i.test(f.name)) return 'video';
  return null;
}

/**
 * Notiz bearbeiten, an Ort und Stelle (Wunsch Jo, 20. November 2026): Doppelklick öffnet, Klick daneben speichert und
 * schließt, Esc verwirft. Oben das Feld „Material“: Adresse einfügen, Datei wählen oder Foto aufnehmen; die Art der
 * Notiz ergibt sich daraus und lässt sich im kleinen Menü ändern. Wörter im Text markieren macht sie zur Überschrift.
 */
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
  fromUrl,
  guard,
  media,
}: {
  draft: Draft;
  setDraft: (d: Draft) => void;
  onSave: () => void;
  onCancel: () => void;
  busy: boolean;
  adding?: boolean;
  visAllowed?: Visibility[];
  showVis?: boolean;
  /** Datei vom Gerät (oder Aufnahme) hochladen; setzt file, preview und mime im Entwurf */
  pickImage: (f: File, d: Draft) => void;
  /** Adresse im Feld Material: Bild holen, Seite lesen */
  fromUrl: (url: string, d: Draft) => void;
  guard: PasteGuard;
  media: MediaRules;
}) {
  const fk = FILE_KINDS[draft.kind];
  const hasFile = !!(draft.file || draft.preview);
  const [err, setErr] = useState('');
  const [sel, setSel] = useState('');
  const root = useRef<HTMLFormElement>(null);
  const body = useRef<HTMLTextAreaElement>(null);
  const ok = NEEDS_FILE.includes(draft.kind)
    ? hasFile
    : draft.kind === 'video'
      ? hasFile || !!draft.url.trim()
      : !!(draft.title.trim() || draft.body.trim() || draft.url.trim() || (draft.kind === 'data' && draft.rows.some((r) => r.some((x) => x.trim()))));
  // aktuelle Werte für den Klick daneben
  const now = useRef({ ok, busy, onSave, onCancel });
  now.current = { ok, busy, onSave, onCancel };
  useEffect(() => {
    body.current?.focus();
    const down = (e: PointerEvent) => {
      const t = e.target as Element | null;
      if (!t || root.current?.contains(t) || t.closest('.modal-bg') || document.querySelector('[data-recording]')) return;
      const n = now.current;
      if (n.busy) return;
      if (n.ok) n.onSave();
      else n.onCancel();
    };
    // erst nach dem öffnenden Doppelklick lauschen
    const id = setTimeout(() => document.addEventListener('pointerdown', down, true), 0);
    return () => {
      clearTimeout(id);
      document.removeEventListener('pointerdown', down, true);
    };
  }, []);

  function file(f: File) {
    setErr('');
    const k = kindForFile(f, draft.kind);
    if (!k) return setErr('Als Material gehen Bilder, Ton und Video. Andere Dateien gehören ins Material der Lehrkraft oder in die Ausarbeitung.');
    if (k === 'audio' && !media.audio) return setErr('Ton ist in diesem Projekt ausgeschaltet.');
    if (k === 'video' && !media.video) return setErr('Videos lassen sich hier nicht hochladen. Ein Link auf ein Video geht.');
    if ((k === 'audio' || k === 'video') && f.size > media.mb * 1024 * 1024) return setErr(`Die Datei ist größer als ${media.mb} MB.`);
    pickImage(f, { ...draft, kind: k });
  }

  function material(raw: string) {
    const url = raw.trim();
    setErr('');
    if (!url) return;
    if (!/^https?:\/\//i.test(url)) return setErr('Eine Adresse beginnt mit http:// oder https://');
    // Bild schon da: die Adresse ist die Ursprungsseite
    if (draft.kind === 'image' && hasFile) return setDraft({ ...draft, origin: url });
    if (VIDEO_URL.test(url)) return setDraft({ ...draft, kind: 'video', url });
    if (AUDIO_URL.test(url)) return setDraft({ ...draft, kind: draft.kind === 'note' ? 'link' : draft.kind, url });
    fromUrl(url, { ...draft, url });
  }

  function onSelect() {
    const ta = body.current;
    if (!ta) return;
    const s = ta.value.slice(ta.selectionStart, ta.selectionEnd).replace(/\s+/g, ' ').trim();
    setSel(s.length >= 2 && s.length <= 200 && s !== draft.title ? s : '');
  }

  const kindSelect = (
    <select className={c.visSmall} value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value as Kind })} aria-label="Art der Notiz" title="Art der Notiz">
      {KINDS.filter((x) => x.kind !== 'audio' || media.audio || draft.kind === 'audio').map((x) => (
        <option key={x.kind} value={x.kind} title={x.hint}>
          {x.label}
        </option>
      ))}
    </select>
  );

  return (
    <form
      ref={root}
      className={c.editor}
      onSubmit={(e) => {
        e.preventDefault();
        if (ok) onSave();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onCancel();
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && ok) {
          e.preventDefault();
          onSave();
        }
      }}
    >
      <div className={c.material}>
        <input
          type="url"
          value={draft.kind === 'image' ? draft.origin || draft.url : draft.url}
          maxLength={2000}
          placeholder="Material: Adresse einfügen, Datei wählen oder Foto aufnehmen (freiwillig)"
          onChange={(e) => setDraft(draft.kind === 'image' ? { ...draft, origin: e.target.value } : { ...draft, url: e.target.value })}
          onPaste={(e) => {
            const t = e.clipboardData.getData('text/plain').trim();
            if (/^https?:\/\/\S+$/i.test(t)) {
              e.preventDefault();
              material(t);
            }
          }}
          onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== draft.url && draft.kind !== 'image' && material(e.target.value)}
          aria-label="Material"
        />
        <label className="btn" title="Bild, Ton oder Video vom Gerät">
          <Icon name="upload" size={15} /> Datei
          <input type="file" accept={['image/*', media.audio ? 'audio/*,.m4a,.mp3,.ogg,.wav' : '', media.video ? 'video/*' : ''].filter(Boolean).join(',')} hidden onChange={(e) => e.target.files?.[0] && file(e.target.files[0])} />
        </label>
        <label className="btn" title="Foto aufnehmen (am Handy öffnet sich die Kamera)">
          <Icon name="camera" size={15} /> Foto
          <input type="file" accept="image/*" capture="environment" hidden onChange={(e) => e.target.files?.[0] && file(e.target.files[0])} />
        </label>
        {media.audio && <Recorder video={false} onDone={(f) => pickImage(f, { ...draft, kind: 'audio' })} onError={setErr} />}
        {media.video && <Recorder video onDone={(f) => pickImage(f, { ...draft, kind: 'video' })} onError={setErr} />}
      </div>
      {err && <span className="error">{err}</span>}
      {(hasFile || (fk && NEEDS_FILE.includes(draft.kind))) && (
        <div className={c.imageEdit}>
          {draft.preview ? <Media src={draft.preview} mime={draft.mime} kind={draft.kind} /> : <span className="muted">{draft.kind === 'hand' ? 'Fotografiere deine handschriftliche Notiz.' : `Noch kein${draft.kind === 'audio' ? 'e Aufnahme' : ' Bild'}: oben wählen oder aufnehmen.`}</span>}
        </div>
      )}
      <div className={c.row}>
        <input
          className={c.titleInput}
          value={draft.title}
          maxLength={200}
          placeholder={draft.kind === 'source' ? 'Titel, Autorin oder Autor, Jahr' : draft.kind === 'data' ? 'Was zeigt die Tabelle?' : 'Überschrift (Wörter im Text markieren)'}
          onChange={(e) => setDraft({ ...draft, title: e.target.value })}
          onPaste={guard.onPaste}
          aria-label="Überschrift"
        />
        {kindSelect}
        {showVis && <VisSelect small value={draft.visibility} onChange={(v) => setDraft({ ...draft, visibility: v })} allowed={visAllowed} />}
      </div>
      {draft.kind === 'data' && <TableEdit rows={draft.rows} set={(rows) => setDraft({ ...draft, rows })} />}
      {draft.kind === 'hand' && (
        <div className={c.row}>
          <button type="button" className="btn" disabled title="Die Texterkennung kommt über Autogra.fi, sobald Collegare damit verbunden ist (Konzept 8d.4). Erkannter Text erscheint dann auch unter „Arbeitsprozess“.">
            Text erkennen
          </button>
          <span className="muted">Bis dahin den Text unten selbst abtippen.</span>
        </div>
      )}
      <textarea
        ref={body}
        rows={draft.kind === 'data' ? 2 : 4}
        value={draft.body}
        maxLength={10_000}
        placeholder={
          draft.kind === 'source'
            ? 'Zitat oder Zusammenfassung …'
            : draft.kind === 'link'
              ? 'Worum geht es auf der Seite?'
              : draft.kind === 'hand'
                ? 'Text der Notiz (abgetippt oder erkannt)'
                : draft.kind === 'audio' || draft.kind === 'video'
                  ? 'Worum geht es? Wichtige Stellen mit Zeit, z. B. 1:20 …'
                  : draft.kind === 'data'
                    ? 'Erklärung zur Tabelle (freiwillig)'
                    : 'Gedanke, Frage, Absprache …'
        }
        onChange={(e) => setDraft({ ...draft, body: e.target.value })}
        onSelect={onSelect}
        onPaste={guard.onPaste}
        aria-label="Text"
      />
      {sel && (
        <div className={c.row}>
          <button
            type="button"
            className={`btn ${c.selTitle}`}
            onPointerDown={(e) => e.preventDefault()}
            onClick={() => {
              setDraft({ ...draft, title: sel.slice(0, 200) });
              setSel('');
            }}
          >
            „{sel.length > 60 ? sel.slice(0, 57) + '…' : sel}“ als Überschrift
          </button>
        </div>
      )}
      <PasteNotes g={guard} onCite={(src) => setDraft({ ...draft, source: draft.source || src, kind: draft.kind === 'note' ? 'source' : draft.kind })} citeLabel="Angeben und als Fundstelle eintragen" />
      {(draft.kind === 'source' || draft.kind === 'data') && <input value={draft.source} maxLength={500} placeholder={draft.kind === 'data' ? 'Quelle der Daten, z. B. Statistisches Bundesamt 2024' : 'Fundstelle, z. B. S. 42 oder Kapitel 3'} onChange={(e) => setDraft({ ...draft, source: e.target.value })} aria-label="Fundstelle" />}
      {draft.kind === 'image' && (
        <>
          <input value={draft.credit} maxLength={300} placeholder="Urheber: Fotografin, Zeichner, Rechteinhaber" onChange={(e) => setDraft({ ...draft, credit: e.target.value })} aria-label="Urheber" />
          <input value={draft.license} maxLength={200} placeholder="Lizenz, z. B. CC BY-SA 4.0 oder gemeinfrei" onChange={(e) => setDraft({ ...draft, license: e.target.value })} aria-label="Lizenz" />
        </>
      )}
      <div className={c.row}>
        <span className="muted">Klick daneben speichert, Esc verwirft</span>
        <span className="grow" />
        <button type="button" className="btn" onClick={onCancel}>
          Verwerfen
        </button>
        <button className="btn primary" type="submit" disabled={!ok || busy}>
          {adding ? 'Hinzufügen' : 'Fertig'}
        </button>
      </div>
    </form>
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

/** Braucht die Notiz eine Quellenangabe? Eigene Gedanken, Aufnahmen und Handschrift nicht */
const needsSource = (n: Note) => n.kind === 'source' || n.kind === 'link' || n.kind === 'image' || n.kind === 'data' || (n.kind === 'video' && !n.file);
/** Hat sie eine? Bilder: Ursprungsseite und Urheber oder Lizenz; sonst Fundstelle oder Link */
const hasSource = (n: Note) => (n.kind === 'image' ? !!(n.origin && (n.credit || n.license)) : !!(n.source.trim() || n.url || n.origin));
const host = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, '');
  } catch {
    return u;
  }
};

export function NotesPanel({ me, project, panel = false, onClose, wanted = null }: { me: Me; project: ProjectView; panel?: boolean; onClose?: () => void; wanted?: string | null }) {
  const id = project.id;
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
  // Quellenangabe: alle, mit, fehlt (Wunsch Jo: Filter statt Hinweis unter jeder Notiz)
  const [cited, setCited] = useState<'all' | 'with' | 'missing'>('all');
  // Stück einer Webseite mit Text und Bildern: auf Notizen verteilen
  const [split, setSplit] = useState<Block[] | null>(null);
  // Gliederung rechts neben dem Thread (Konzept 8h, früher „Meine Linie“), nur auf der eigenen Seite, nicht in der Leiste
  const [lineView, setLineView] = useState(false);
  useEffect(() => {
    try {
      const v = localStorage.getItem('collegare-notizen-gliederung');
      setLineView(v ? v === '1' : window.innerWidth >= 1000);
    } catch {}
  }, []);
  const toggleLine = (on: boolean) => {
    setLineView(on);
    try {
      localStorage.setItem('collegare-notizen-gliederung', on ? '1' : '0');
    } catch {}
  };
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

  const st = project.settings;
  const media = { audio: st.notesAudio !== false, video: st.notesVideo !== false, mb: st.notesMediaMb ?? 25 };
  const rules: PasteRules | null = scope ? { projectId: id, scope, outside: st.pasteOutside, threshold: st.pasteThreshold, logAll: st.pasteLogAll !== false } : null;
  const placeOf = (d: Draft) => `Notiz „${(d.title || d.body.split('\n')[0] || 'Ohne Titel').slice(0, 120)}“`;
  const addGuard = usePasteGuard(rules, null, () => placeOf(draft));
  const editGuard = usePasteGuard(rules, edit ? `note:${edit.id}` : null, () => (edit ? placeOf(edit.d) : 'Notiz'));

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
    ...(d.kind === 'image' ? { credit: d.credit, license: d.license, origin: d.origin.trim(), url: d.url.trim() } : {}),
    ...(FILE_KINDS[d.kind] && d.file ? { file: d.file } : {}),
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
    // Stück einer Seite mit Text (und vielleicht Bildern): verteilen statt nur Bilder übernehmen
    const html = dt.getData('text/html');
    const plain = dt.getData('text/plain');
    if (html || plain) {
      const blocks = blocksFrom(html, html ? '' : plain);
      const fromProject = !!clipOrigin(dt, id, plain);
      if (!fromProject && textLength(blocks) >= 30) return setSplit(blocks);
    }
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
      if (d.kind === 'audio' || d.kind === 'video') show('Wird hochgeladen …');
      const up = await uploadImage(id, scope, { file: f, art: d.kind === 'audio' ? 'audio' : undefined });
      put({ ...d, file: up.file, mime: up.mime, preview: URL.createObjectURL(f), title: d.title || (d.kind === 'image' ? f.name.replace(/\.[a-z0-9]+$/i, '') : '') });
    } catch (e) {
      show(e instanceof Error ? e.message : 'Hochladen fehlgeschlagen');
    }
  }

  /** Adresse im Feld Material: Bild über den Server holen, sonst Seite lesen (Titel, Autor) und als Link bzw. Quelle */
  async function fromUrl(url: string, d: Draft, put: (d: Draft) => void) {
    if (!scope) return;
    if (looksLikeImage(url)) {
      try {
        show('Bild wird geholt …');
        const info = await imageInfo(url, null).catch(() => null);
        const up = await uploadImage(id, scope, { url: info?.imageUrl ?? url });
        put({ ...d, kind: 'image', url, file: up.file, mime: up.mime, preview: proxied(url), title: d.title || info?.title || '', credit: d.credit || info?.credit || '', license: d.license || info?.license || '', origin: d.origin || info?.origin || '' });
        return;
      } catch (e) {
        const x = e as Error & { page?: boolean };
        if (!x.page) return show(x.message);
      }
    }
    put({ ...d, kind: d.kind === 'note' ? 'link' : d.kind });
    try {
      const pg = await readPage(url);
      put({ ...d, kind: d.kind === 'note' ? 'link' : d.kind, title: d.title || pg.title.slice(0, 200), source: d.source || (d.kind === 'source' ? [pg.author, pg.site].filter(Boolean).join(', ').slice(0, 500) : '') });
    } catch {
      /* Seite nicht lesbar: Link bleibt */
    }
  }

  function openAdd() {
    // neue Notiz bekommt die Stufe, die gerade im Filter steht
    setDraft(empty('note', teacher ? (shared ? 'all' : 'group') : level));
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
        if (r.id) addGuard.flush(`note:${r.id}`);
        setDraft(empty('note', draft.visibility));
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
    mime: n.file?.mime,
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
  const byKind = kind === 'all' ? byLevel : byLevel.filter((n) => n.kind === kind);
  const missingCount = byKind.filter((n) => needsSource(n) && !hasSource(n)).length;
  const shown = cited === 'all' ? byKind : cited === 'with' ? byKind.filter(hasSource) : byKind.filter((n) => needsSource(n) && !hasSource(n));

  const putEdit = (n: Note) => (nd: Draft) => setEdit((cur) => (cur?.id === n.id ? { id: n.id, d: nd } : cur));
  const editorFor = (n: Note) =>
    edit && (
      <Editor
        key={n.id}
        draft={edit.d}
        setDraft={(d) => setEdit({ id: n.id, d })}
        onSave={save}
        onCancel={() => setEdit(null)}
        busy={busy}
        visAllowed={allowedFor(n)}
        pickImage={(f, d) => void pickImage(f, d, putEdit(n))}
        fromUrl={(u, d) => void fromUrl(u, d, putEdit(n))}
        guard={editGuard}
        media={media}
      />
    );

  const addEditor = (
    <Editor
      draft={draft}
      setDraft={setDraft}
      onSave={add}
      onCancel={() => setAdding(false)}
      busy={busy}
      adding
      showVis={!shared}
      pickImage={(f, d) => void pickImage(f, d, setDraft)}
      fromUrl={(u, d) => void fromUrl(u, d, setDraft)}
      guard={addGuard}
      media={media}
    />
  );

  /** Notiz aus „Auf Notizen verteilen“ */
  function addSplitNote(x: SplitNoteInput): Promise<Res> {
    return new Promise((resolve) => {
      if (!scope || !sock.current?.connected) return resolve({ ok: false, error: 'Keine Verbindung zum Server. Bitte kurz warten.' });
      sock.current.emit('notes:add', { projectId: id, scope, note: { ...x, visibility: levelNow() } }, (r: Res) => resolve(r));
    });
  }
  /** Text von außen, der über „Auf Notizen verteilen“ kam, ins Protokoll */
  function logSplit(text: string, noteId: number, title: string) {
    if (!rules || shared) return;
    if (!rules.logAll && [...text].length < rules.threshold) return;
    void post(`/api/projects/${id}/einfuegen`, { scope: rules.scope, place: `Notiz „${(title || text.split('\n')[0]).slice(0, 120)}“`, text, target: `note:${noteId}` }).catch(() => {});
  }


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
        if (!images.length && !pageLink && textLength(blocksFrom(e.clipboardData.getData('text/html'), e.clipboardData.getData('text/plain'))) < 30) return;
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
            <option value={SHARED}>Allgemein (alle Gruppen)</option>
          </select>
        ) : (
          join &&
          ownScope.current && (
            <>
              <select className={c.vis} value={level} onChange={(e) => chooseLevel(e.target.value as Visibility)} aria-label="Welche Notizen zeigen?" title="Privat: nur deine eigenen. Gruppe: alles deiner Gruppe. Allgemein: was die Gruppen für alle freigegeben haben.">
                {VIS.map((x) => (
                  <option key={x.v} value={x.v}>
                    {x.label}
                  </option>
                ))}
              </select>
              {!panel && title && <span className={`muted ${c.barScope}`}>{title}</span>}
            </>
          )
        )}
        {!panel && scope && !shared && (
          <button className={`btn ${lineView ? 'on' : ''}`} aria-pressed={lineView} onClick={() => toggleLine(!lineView)} title="Gliederung als U-Bahn-Linie rechts neben den Notizen: Notizen auf die Punkte ziehen">
            <Icon name="outline" size={14} /> Gliederung
          </button>
        )}
        <span className="grow" />
        {scope && (
          <button className={`btn icon ${c.fromPage}`} onClick={() => setPageImport('')} title="Bilder von einer Seite übernehmen: Adresse einfügen, Bilder auswählen. Einzelne Bilder kannst du auch einfach aus einem anderen Tab hierher ziehen." aria-label="Bilder von einer Seite">
            <Icon name="image" />
          </button>
        )}
        {onClose && (
          <button className={`btn icon ${c.close}`} onClick={onClose} title="Schließen" aria-label="Notizen schließen">
            <Icon name="close" />
          </button>
        )}
      </div>
      {join && !scope ? (
        <div className={`panel ${c.notice}`}>{teacher ? 'Noch keine Gruppen.' : 'Du bist noch keiner Gruppe zugeordnet.'}</div>
      ) : (
        <div className={lineView && !panel && !shared ? c.split : c.single}>
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
              <span className="seg" role="group" aria-label="Quellenangabe">
                {(
                  [
                    ['all', 'Alle'],
                    ['with', 'Mit Quellenangabe'],
                    ['missing', `Quellenangabe fehlt${missingCount ? ` (${missingCount})` : ''}`],
                  ] as const
                ).map(([k, label]) => (
                  <button key={k} className={`btn ${cited === k ? 'on' : ''} ${k === 'missing' && missingCount ? c.missingBtn : ''}`} aria-pressed={cited === k} onClick={() => setCited(k)}>
                    {label}
                  </button>
                ))}
              </span>
            </div>
            {join && shown.length === 0 && (
              <p className={`muted ${c.empty}`}>
                {notes.length ? 'Nichts in dieser Auswahl.' : shared ? 'Noch hat niemand etwas für alle freigegeben.' : 'Noch keine Notizen. Mit „Neue Notiz“ unten haltet ihr fest, was ihr gefunden habt.'}
              </p>
            )}
            {shown.map((n) => {
              const mine = n.userId === me.id;
              const canEdit = teacher || mine;
              if (edit?.id === n.id) return <div key={n.id} className={`${c.note} ${c.editing}`}>{editorFor(n)}</div>;
              const startEdit = () => {
                setAdding(false);
                setEdit({ id: n.id, d: toDraft(n) });
              };
              return (
                <article
                  key={n.id}
                  className={`${c.note} ${c[n.kind]} ${n.visibility === 'all' && !shared ? c.released : ''} ${n.visibility === 'private' ? c.private : ''} ${n.reported ? c.reported : ''}`}
                  draggable={!n.reported}
                  onDoubleClick={(e) => {
                    if (!canEdit || shared || (e.target as Element).closest('a, audio, video, select, button, input')) return;
                    window.getSelection()?.removeAllRanges();
                    startEdit();
                  }}
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
                  title={n.reported ? undefined : `${canEdit && !shared ? 'Doppelklick zum Bearbeiten. ' : ''}${n.kind === 'image' ? 'In die Mindmap oder auf eine Folie ziehen' : 'In die Mindmap ziehen'}`}
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
                      <span className={c.visTag} title={visOf(n.visibility).long} aria-label={visOf(n.visibility).long}>
                        <Icon name={visOf(n.visibility).icon} size={14} />
                      </span>
                    )}
                    <span className={c.tools}>
                      {canEdit && !shared && (
                        <button className="btn icon" onClick={startEdit} title="Überarbeiten (oder Doppelklick auf die Notiz)" aria-label="Überarbeiten">
                          <Icon name="pen" size={15} />
                        </button>
                      )}
                      {!mine && !n.reportedByMe && (
                        <button className="btn icon" onClick={() => setReporting({ id: n.id, reason: '' })} title="Melden: Die Karte sehen dann nur noch die Lehrkraft, wer sie geschrieben hat, und du." aria-label="Melden">
                          <Icon name="flag" size={15} />
                        </button>
                      )}
                      {canEdit && (
                        <button className="btn icon" onClick={() => remove(n)} title="Löschen" aria-label="Löschen">
                          <Icon name="trash" size={15} />
                        </button>
                      )}
                    </span>
                  </header>
                  {n.reported && (
                    <div className={c.reportBox}>
                      <strong>Gemeldet.</strong>{' '}
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
                  {n.file && n.kind !== 'image' && <Media className={c.picture} src={noteFileUrl(id, n.id, n.updatedAt)} mime={n.file.mime} kind={n.kind} title={n.title} />}
                  {n.kind === 'image' && n.file && <img className={c.picture} src={noteFileUrl(id, n.id, n.updatedAt)} alt={n.title} loading="lazy" draggable={false} />}
                  {n.title && <h3 className={c.title}>{n.title}</h3>}
                  {n.kind === 'image' && (n.credit || n.license || n.origin) && (
                    <p className={c.place}>
                      {[n.credit && `Urheber: ${n.credit}`, n.license && `Lizenz: ${n.license}`].filter(Boolean).join(' · ')}
                      {n.origin && (
                        <>
                          {n.credit || n.license ? ' · ' : ''}
                          <a href={n.origin} target="_blank" rel="noopener noreferrer">
                            {host(n.origin)}
                          </a>
                        </>
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
            {join && scope && (adding ? <div className={`${c.note} ${c.editing}`}>{addEditor}</div> : <button className={c.addBig} onClick={openAdd}>
                <span aria-hidden>+</span> Neue Notiz
              </button>)}
          </div>
        </div>
        {lineView && !panel && !shared && scope && (
          <div className={c.lineCol}>
            <GliederungLive sock={sock.current} project={project} scope={scope} meId={me.id} noteInfo={(nid) => { const n = notes.find((x) => x.id === nid); return n ? { label: n.title || n.body.split('\n')[0].slice(0, 90), kind: n.kind } : undefined; }} show={show} onClose={() => toggleLine(false)} />
          </div>
        )}
        </div>
      )}
      {split && scope && (
        <NoteSplit
          projectId={id}
          scope={scope}
          blocks={split}
          limit={!shared && st.pasteOutside === 'limit' ? st.pasteThreshold : null}
          addNote={addSplitNote}
          logPaste={logSplit}
          onClose={() => setSplit(null)}
          onDone={show}
        />
      )}
      {pageImport !== null && scope && <ImageImport projectId={id} scope={scope} start={pageImport} addNote={addImageNote} onClose={() => setPageImport(null)} onDone={show} />}
      {dropping && <div className={c.dropHint}>Hier ablegen: Bilder kommen mit Urheber, Lizenz und Ursprungsseite in die Notizen, Text mit Bildern lässt sich auf mehrere Notizen verteilen.</div>}
      {toast && <div className={c.toast}>{toast}</div>}
    </div>
  );
}
