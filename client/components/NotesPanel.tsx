'use client';
/**
 * Notizen und Quellen (Konzept 8d.2): Recherche-Karten der Gruppe als Seiten-Thread, nach dem Vorbild von
 * NotesThread.svelte in brausa. Eine Notiz ist ein Datensatz; in die Mindmap gezogen wird sie eine Karte, die
 * Überarbeitungen der Notiz übernimmt. Als eigene Seite (Kachel in der Phase Recherche) oder als Leiste rechts.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import { projectSocket } from '@/lib/api';
import { setChatDrag } from '@/lib/chatDrag';
import type { Me, ProjectView } from '@/lib/types';
import c from './notes.module.css';

type Kind = 'note' | 'source' | 'link';
export interface Note {
  id: number;
  userId: number;
  name: string;
  kind: Kind;
  title: string;
  body: string;
  source: string;
  url: string | null;
  at: number;
  updatedAt: number;
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
}

const KINDS: { kind: Kind; label: string; hint: string }[] = [
  { kind: 'note', label: 'Notiz', hint: 'Gedanke, Frage, Absprache' },
  { kind: 'source', label: 'Quelle', hint: 'Buch, Artikel, Zitat mit Fundstelle' },
  { kind: 'link', label: 'Link', hint: 'Webseite oder Video' },
];
const empty = (kind: Kind = 'note'): Draft => ({ kind, title: '', body: '', source: '', url: '' });
const when = (ms: number) => new Date(ms).toLocaleString('de-DE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/** wie Notes.cardTitle und Notes.cardText im Server: so sieht die Karte in der Mindmap aus */
function cardTitle(n: Note) {
  const first = n.body.trim().split('\n')[0] ?? '';
  return (n.title || (first.length > 120 ? first.slice(0, 117).trimEnd() + '…' : first) || n.url || 'Notiz').slice(0, 200);
}
function cardText(n: Note) {
  const parts = [n.title ? n.body.trim() : n.body.trim().split('\n').slice(1).join('\n').trim(), n.source && `Fundstelle: ${n.source}`, n.url ?? ''];
  return parts.filter(Boolean).join('\n\n').slice(0, 5000);
}

function Editor({ draft, setDraft, onSave, onCancel, busy, adding = false }: { draft: Draft; setDraft: (d: Draft) => void; onSave: () => void; onCancel?: () => void; busy: boolean; adding?: boolean }) {
  const k = KINDS.find((x) => x.kind === draft.kind)!;
  const ok = !!(draft.title.trim() || draft.body.trim() || draft.url.trim());
  return (
    <form
      className={c.editor}
      onSubmit={(e) => {
        e.preventDefault();
        if (ok) onSave();
      }}
    >
      <span className="seg" role="group" aria-label="Art">
        {KINDS.map((x) => (
          <button type="button" key={x.kind} className={`btn ${x.kind === draft.kind ? 'on' : ''}`} aria-pressed={x.kind === draft.kind} title={x.hint} onClick={() => setDraft({ ...draft, kind: x.kind })}>
            {x.label}
          </button>
        ))}
      </span>
      <input value={draft.title} maxLength={200} placeholder={draft.kind === 'source' ? 'Titel, Autorin oder Autor, Jahr' : 'Überschrift (freiwillig)'} onChange={(e) => setDraft({ ...draft, title: e.target.value })} aria-label="Überschrift" />
      <textarea
        rows={3}
        value={draft.body}
        maxLength={10_000}
        placeholder={draft.kind === 'source' ? 'Zitat oder Zusammenfassung …' : draft.kind === 'link' ? 'Worum geht es auf der Seite?' : k.hint + ' …'}
        onChange={(e) => setDraft({ ...draft, body: e.target.value })}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && ok) {
            e.preventDefault();
            onSave();
          }
        }}
        aria-label="Text"
      />
      {draft.kind === 'source' && <input value={draft.source} maxLength={500} placeholder="Fundstelle, z. B. S. 42 oder Kapitel 3" onChange={(e) => setDraft({ ...draft, source: e.target.value })} aria-label="Fundstelle" />}
      {draft.kind !== 'note' && <input type="url" value={draft.url} maxLength={2000} placeholder="https://…" onChange={(e) => setDraft({ ...draft, url: e.target.value })} aria-label="Link" />}
      <div className={c.row}>
        <span className="muted">Strg+Enter speichert</span>
        <span className="grow" />
        {onCancel && (
          <button type="button" className="btn" onClick={onCancel}>
            Abbrechen
          </button>
        )}
        <button className="btn primary" type="submit" disabled={!ok || busy}>
          {onCancel && !adding ? 'Speichern' : 'Hinzufügen'}
        </button>
      </div>
    </form>
  );
}

export function NotesPanel({ me, project, panel = false, onClose, wanted = null }: { me: Me; project: ProjectView; panel?: boolean; onClose?: () => void; wanted?: string | null }) {
  const id = project.id;
  const [join, setJoin] = useState<JoinAck | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [scope, setScope] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(empty());
  // Eingabe erst nach „+“ in der Kopfzeile (Wunsch Jo), nicht gleich ein leeres Formular
  const [adding, setAdding] = useState(false);
  const [edit, setEdit] = useState<{ id: number; d: Draft } | null>(null);
  const [filter, setFilter] = useState<Kind | 'all'>('all');
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState('');
  const sock = useRef<Socket | null>(null);
  const scopeRef = useRef<string | null>(null);
  scopeRef.current = scope;

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
        setNotes(r.notes ?? []);
        setEdit(null);
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
      setNotes((l) => (l.some((x) => x.id === m.note.id) ? l.map((x) => (x.id === m.note.id ? m.note : x)) : [m.note, ...l]));
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

  const payload = (d: Draft) => ({ kind: d.kind, title: d.title, body: d.body, source: d.kind === 'source' ? d.source : '', url: d.kind === 'note' ? '' : d.url.trim() });

  function add() {
    if (!scope) return;
    if (!sock.current?.connected) return show('Keine Verbindung zum Server. Bitte kurz warten.');
    setBusy(true);
    sock.current.emit('notes:add', { projectId: id, scope, note: payload(draft) }, (r: { ok: boolean; error?: string }) => {
      setBusy(false);
      if (r.ok) {
        setDraft(empty(draft.kind));
        setAdding(false);
      }
      else show(r.error ?? 'Speichern fehlgeschlagen');
    });
  }

  function save() {
    if (!edit) return;
    setBusy(true);
    sock.current?.emit('notes:update', { projectId: id, id: edit.id, note: payload(edit.d) }, (r: { ok: boolean; error?: string }) => {
      setBusy(false);
      if (r.ok) setEdit(null);
      else show(r.error ?? 'Speichern fehlgeschlagen');
    });
  }

  function remove(n: Note) {
    if (!confirm('Diese Notiz löschen? Karten in der Mindmap bleiben stehen.')) return;
    sock.current?.emit('notes:delete', { projectId: id, id: n.id }, (r: { ok: boolean; error?: string }) => !r.ok && show(r.error ?? 'Löschen fehlgeschlagen'));
  }

  const teacher = join?.role === 'teacher';
  const scopes = join?.scopes ?? [];
  const title = scopes.find((x) => x.scope === scope)?.title ?? '';
  const shown = filter === 'all' ? notes : notes.filter((n) => n.kind === filter);

  return (
    <div className={`${c.wrap} ${panel ? c.panel : ''}`}>
      <div className={c.bar}>
        {panel && <strong className={c.barTitle}>Notizen und Quellen</strong>}
        {scopes.length > 1 ? (
          <select value={scope ?? ''} onChange={(e) => doJoin(e.target.value)} aria-label="Welche Gruppe?">
            {scopes.map((x) => (
              <option key={x.scope} value={x.scope}>
                {x.title}
              </option>
            ))}
          </select>
        ) : (
          title && <span className={`muted ${c.barScope}`}>{title}</span>
        )}
        {scope && (
          <button className={`btn icon ${c.add} ${adding ? 'on' : ''}`} onClick={() => setAdding((a) => !a)} title={adding ? 'Eingabe schließen' : 'Neue Notiz, Quelle oder Link'} aria-label="Hinzufügen" aria-expanded={adding}>
            +
          </button>
        )}
        <span className="grow" />
        {onClose && (
          <button className={`btn icon ${c.close}`} onClick={onClose} title="Schließen" aria-label="Notizen schließen">
            ×
          </button>
        )}
      </div>
      {join && !scope ? (
        <div className={`panel ${c.notice}`}>{teacher ? 'Noch keine Gruppen.' : 'Du bist noch keiner Gruppe zugeordnet.'}</div>
      ) : (
        <div className={c.list}>
          <div className={c.inner}>
            {adding && <Editor draft={draft} setDraft={setDraft} onSave={add} onCancel={() => setAdding(false)} busy={busy} adding />}
            <div className={c.filter}>
              <span className="seg" role="group" aria-label="Zeigen">
                {([['all', 'Alle'], ...KINDS.map((k) => [k.kind, k.label === 'Notiz' ? 'Notizen' : k.label === 'Quelle' ? 'Quellen' : 'Links'])] as [Kind | 'all', string][]).map(([k, label]) => (
                  <button key={k} className={`btn ${filter === k ? 'on' : ''}`} aria-pressed={filter === k} onClick={() => setFilter(k)}>
                    {label}
                  </button>
                ))}
              </span>
              <span className="muted">{panel ? 'In die Mindmap ziehen' : 'Karten lassen sich in die Mindmap ziehen'}</span>
            </div>
            {join && shown.length === 0 && <p className={`muted ${c.empty}`}>{notes.length ? 'Nichts in dieser Auswahl.' : 'Noch keine Notizen. Mit + oben haltet ihr fest, was ihr gefunden habt.'}</p>}
            {shown.map((n) =>
              edit?.id === n.id ? (
                <div key={n.id} className={`${c.note} ${c.editing}`}>
                  <Editor draft={edit.d} setDraft={(d) => setEdit({ id: n.id, d })} onSave={save} onCancel={() => setEdit(null)} busy={busy} />
                </div>
              ) : (
                <article
                  key={n.id}
                  className={`${c.note} ${c[n.kind]}`}
                  draggable
                  onDragStart={(e) => setChatDrag(e, { name: n.name, body: [n.title, n.body].filter(Boolean).join('\n'), note: { id: n.id, title: cardTitle(n), text: cardText(n) } })}
                  title="In die Mindmap ziehen"
                >
                  <header className={c.head}>
                    <span className={c.kind}>{KINDS.find((k) => k.kind === n.kind)?.label}</span>
                    <span className={c.who}>
                      {n.name} · {when(n.updatedAt)}
                      {n.updatedAt > n.at + 1000 ? ' (überarbeitet)' : ''}
                    </span>
                    {(teacher || n.userId === me.id) && (
                      <span className={c.tools}>
                        <button className="btn icon" onClick={() => setEdit({ id: n.id, d: { kind: n.kind, title: n.title, body: n.body, source: n.source, url: n.url ?? '' } })} title="Überarbeiten" aria-label="Überarbeiten">
                          ✎
                        </button>
                        <button className="btn icon" onClick={() => remove(n)} title="Löschen" aria-label="Löschen">
                          ×
                        </button>
                      </span>
                    )}
                  </header>
                  {n.title && <h3 className={c.title}>{n.title}</h3>}
                  {n.body && <p className={c.body}>{n.body}</p>}
                  {n.source && <p className={c.place}>Fundstelle: {n.source}</p>}
                  {n.url && (
                    <a className={c.url} href={n.url} target="_blank" rel="noopener noreferrer">
                      {n.url.replace(/^https?:\/\//, '')}
                    </a>
                  )}
                </article>
              ),
            )}
          </div>
        </div>
      )}
      {toast && <div className={c.toast}>{toast}</div>}
    </div>
  );
}
