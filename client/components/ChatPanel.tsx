'use client';
/**
 * Chat je Gruppe und für alle im Projekt (Wunsch Jo, 11. November 2026). Echtzeit über den Namespace /project;
 * Lehrkräfte sehen alle Chats und dürfen Nachrichten löschen, Lernende ihre eigenen. Als eigene Seite oder als
 * zuschaltbare Leiste am rechten Rand; Beiträge lassen sich von dort in die Mindmap ziehen.
 * „Bild aufnehmen“ (Wunsch Jo, 24. November 2026): Scanner aus Autogra.fi, das Bild geht mit der Nachricht mit;
 * „Text erkennen“ am Bild legt den erkannten Text ins Eingabefeld.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import { API_URL, BASE_PATH, href, projectSocket } from '@/lib/api';
import { setChatDrag } from '@/lib/chatDrag';
import { ocrState, recognizeText, type OcrState } from '@/lib/ocr';
import type { Me, ProjectView } from '@/lib/types';
import c from './chat.module.css';
import { Icon } from './Icon';
import { ScanDialog } from './ScanDialog';

interface Msg {
  id: number;
  userId: number;
  name: string;
  body: string;
  at: number;
  image?: true;
}
interface JoinAck {
  ok: boolean;
  error?: string;
  role?: 'teacher' | 'student';
  scopes?: { scope: string; title: string }[];
  scope?: string | null;
  messages?: Msg[];
  me?: number;
}

const day = (ms: number) => new Date(ms).toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });
const imageUrl = (projectId: number, id: number) => `${API_URL}${BASE_PATH}/api/projects/${projectId}/chat/${id}/bild`;
const time = (ms: number) => new Date(ms).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });

/** Links im Text anklickbar machen, sonst reiner Text (kein HTML aus Nachrichten). Adressen innerhalb von Collegare
 * (/projekt/…, etwa vom Kommentar der Lehrkraft) werden zu „Zur Stelle springen“ im selben Fenster. */
function Body({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/[^\s<>"]+|(?<![\w/])\/projekt\/[^\s<>"]+)/g);
  return (
    <>
      {parts.map((t, i) =>
        i % 2 ? (
          t.startsWith('/') ? (
            <a key={i} href={href(t)}>
              Zur Stelle springen
            </a>
          ) : (
            <a key={i} href={t} target="_blank" rel="noopener noreferrer">
              {t}
            </a>
          )
        ) : (
          t
        ),
      )}
    </>
  );
}

export function ChatPanel({ me, project, panel = false, onClose, wanted = null }: { me: Me; project: ProjectView; panel?: boolean; onClose?: () => void; wanted?: string | null }) {
  const id = project.id;
  const [join, setJoin] = useState<JoinAck | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [scope, setScope] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [toast, setToast] = useState('');
  const [more, setMore] = useState(true);
  const [scan, setScan] = useState(false);
  /** aufgenommenes Bild, schon hochgeladen, geht mit der nächsten Nachricht mit */
  const [pending, setPending] = useState<{ file: string; preview: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [ocr, setOcr] = useState<OcrState | null>(null);
  const [reading, setReading] = useState<number | null>(null);
  const sock = useRef<Socket | null>(null);
  const scopeRef = useRef<string | null>(null);
  scopeRef.current = scope;
  const list = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  const show = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 4000);
  };

  const doJoin = useCallback(
    (sc: string | null) => {
      sock.current?.emit('chat:join', { projectId: id, scope: sc ?? undefined }, (r: JoinAck) => {
        if (!r.ok) return show(r.error ?? 'Kein Zugriff');
        setJoin(r);
        setScope(r.scope ?? null);
        setMsgs(r.messages ?? []);
        setMore((r.messages?.length ?? 0) >= 200);
        stick.current = true;
      });
    },
    [id],
  );

  useEffect(() => {
    const so = projectSocket();
    sock.current = so;
    so.on('connect', () => doJoin(scopeRef.current ?? wanted));
    so.on('chat', (m: { projectId: number; scope: string; message: Msg }) => {
      if (m.projectId !== id || m.scope !== scopeRef.current) return;
      const el = list.current;
      stick.current = !el || el.scrollHeight - el.scrollTop - el.clientHeight < 80 || m.message.userId === me.id;
      setMsgs((l) => (l.some((x) => x.id === m.message.id) ? l : [...l, m.message]));
    });
    so.on('chat:gone', (m: { projectId: number; scope: string; id: number }) => {
      if (m.projectId === id && m.scope === scopeRef.current) setMsgs((l) => l.filter((x) => x.id !== m.id));
    });
    so.on('connect_error', (e) => show('Verbindung: ' + e.message));
    return () => {
      so.disconnect();
      sock.current = null;
    };
  }, [id, me, doJoin, wanted]);

  useEffect(() => void ocrState(id).then(setOcr, () => setOcr(null)), [id]);
  // Vorschau freigeben, wenn sie nicht mehr gebraucht wird
  useEffect(() => () => void (pending && URL.revokeObjectURL(pending.preview)), [pending]);
  // Bild gehört zum Chat, in dem es aufgenommen wurde
  useEffect(() => setPending(null), [scope]);

  async function upload(f: File) {
    if (!scope) return;
    setUploading(true);
    try {
      const res = await fetch(`${API_URL}${BASE_PATH}/api/projects/${id}/chat/bild?scope=${encodeURIComponent(scope)}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/octet-stream' },
        body: f,
      });
      const j = (await res.json().catch(() => ({}))) as { file?: string; error?: string };
      if (!res.ok || !j.file) throw new Error(j.error ?? `Fehler ${res.status}`);
      setPending({ file: j.file, preview: URL.createObjectURL(f) });
    } catch (e) {
      show('Bild: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setUploading(false);
    }
  }

  async function read(m: Msg) {
    setReading(m.id);
    try {
      const text = (await recognizeText(id, imageUrl(id, m.id))).text.trim();
      if (!text) return show('Auf dem Bild wurde kein Text gefunden.');
      setDraft((d) => (d.trim() ? d.trimEnd() + '\n' + text : text));
    } catch (e) {
      show('Texterkennung: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setReading(null);
    }
  }

  // beim Öffnen und bei neuen Nachrichten nach unten, außer man liest gerade weiter oben
  useLayoutEffect(() => {
    const el = list.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [msgs]);

  function send() {
    const text = draft.trim();
    if ((!text && !pending) || !scope) return;
    if (!sock.current?.connected) return show('Keine Verbindung zum Server. Bitte kurz warten.');
    stick.current = true;
    sock.current.emit('chat:send', { projectId: id, scope, text, ...(pending ? { file: pending.file } : {}) }, (r: { ok: boolean; error?: string }) => {
      if (r.ok) {
        setDraft('');
        setPending(null);
      } else show(r.error ?? 'Senden fehlgeschlagen');
    });
  }

  function remove(m: Msg) {
    if (!confirm('Diese Nachricht löschen?')) return;
    sock.current?.emit('chat:delete', { projectId: id, id: m.id }, (r: { ok: boolean; error?: string }) => !r.ok && show(r.error ?? 'Löschen fehlgeschlagen'));
  }

  function loadMore() {
    const el = list.current;
    const h = el?.scrollHeight ?? 0;
    sock.current?.emit('chat:more', { projectId: id, scope, before: msgs[0]?.id }, (r: { ok: boolean; messages?: Msg[] }) => {
      if (!r.ok || !r.messages) return;
      setMore(r.messages.length >= 200);
      stick.current = false;
      setMsgs((l) => [...r.messages!, ...l]);
      // Lage halten
      requestAnimationFrame(() => el && (el.scrollTop = el.scrollHeight - h));
    });
  }

  const teacher = join?.role === 'teacher';
  const scopes = join?.scopes ?? [];
  const title = scopes.find((x) => x.scope === scope)?.title ?? 'Chat';

  return (
    <div className={`${c.wrap} ${panel ? c.panel : ''}`}>
      <div className={c.bar}>
        {panel && <strong className={c.barTitle}>Chat</strong>}
        {scopes.length > 1 ? (
          <span className="seg" role="group" aria-label="Welcher Chat?">
            {scopes.map((x) => (
              <button key={x.scope} className={`btn ${x.scope === scope ? 'on' : ''}`} onClick={() => doJoin(x.scope)} aria-pressed={x.scope === scope}>
                {x.title}
              </button>
            ))}
          </span>
        ) : (
          <span className="muted">{title}</span>
        )}
        <span className="grow" />
        {onClose && (
          <button className={`btn icon ${c.close}`} onClick={onClose} title="Schließen" aria-label="Chat schließen">
            ×
          </button>
        )}
      </div>
        {join && !scope ? (
          <div className={`panel ${c.notice}`}>
            {scopes.length === 0 && (project.settings.chatAll === false || project.settings.chatGroups === false)
              ? 'Der Chat ist in diesem Projekt ausgeschaltet.'
              : teacher
                ? 'Noch keine Gruppen.'
                : 'Du bist noch keiner Gruppe zugeordnet.'}
          </div>
        ) : (
          <>
            <div className={c.list} ref={list}>
              <div className={c.inner}>
                {more && msgs.length > 0 && (
                  <button className={`btn ${c.more}`} onClick={loadMore}>
                    Ältere Nachrichten
                  </button>
                )}
                {join && msgs.length === 0 && (
                  <p className={`muted ${c.empty}`}>{scope === 'p' ? 'Hier schreiben alle im Projekt. Noch keine Nachrichten.' : `Chat von „${title}“. Noch keine Nachrichten.`}</p>
                )}
                {msgs.map((m, i) => {
                  const prev = msgs[i - 1];
                  const newDay = !prev || new Date(prev.at).toDateString() !== new Date(m.at).toDateString();
                  const cont = !newDay && prev && prev.userId === m.userId && m.at - prev.at < 5 * 60_000;
                  const mine = m.userId === me.id;
                  return (
                    <div key={m.id}>
                      {newDay && <div className={c.day}>{day(m.at)}</div>}
                      <div className={`${c.msg} ${mine ? c.mine : ''} ${cont ? c.cont : ''}`}>
                        {!cont && !mine && <div className={c.name}>{m.name}</div>}
                        <div
                          className={c.bubble}
                          draggable
                          onDragStart={(e) => setChatDrag(e, { name: m.name, body: m.body || 'Bild' })}
                          title="In die Mindmap ziehen"
                        >
                          {m.image && (
                            <a className={c.image} href={imageUrl(id, m.id)} target="_blank" rel="noopener" draggable={false} title="Bild in voller Größe">
                              <img src={imageUrl(id, m.id)} alt={m.body ? '' : `Bild von ${m.name}`} loading="lazy" draggable={false} />
                            </a>
                          )}
                          {m.image && ocr?.available && (
                            <button type="button" className={`btn ${c.read}`} disabled={reading !== null} onClick={() => void read(m)} title="Text auf dem Bild von der KI lesen lassen und ins Eingabefeld legen">
                              <Icon name="scan" size={13} /> {reading === m.id ? 'Text wird erkannt …' : 'Text erkennen'}
                            </button>
                          )}
                          {m.body && (
                            <span className={c.text}>
                              <Body text={m.body} />
                            </span>
                          )}
                          <span className={c.time}>{time(m.at)}</span>
                          {(mine || teacher) && (
                            <button className={c.del} onClick={() => remove(m)} title="Löschen" aria-label="Nachricht löschen">
                              ×
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            {pending && (
              <div className={c.pending}>
                <img src={pending.preview} alt="Aufgenommenes Bild" />
                <span className="muted">Geht mit der nächsten Nachricht mit.</span>
                <button type="button" className="btn icon" onClick={() => setPending(null)} title="Bild weglassen" aria-label="Bild weglassen">
                  ×
                </button>
              </div>
            )}
            <form
              className={c.compose}
              onSubmit={(e) => {
                e.preventDefault();
                send();
              }}
            >
              <button type="button" className="btn icon" onClick={() => setScan(true)} disabled={uploading} title={uploading ? 'Bild wird hochgeladen …' : 'Bild aufnehmen'} aria-label="Bild aufnehmen">
                <Icon name="camera" size={18} />
              </button>
              <textarea
                rows={1}
                value={draft}
                maxLength={2000}
                placeholder={scope === 'p' ? 'Nachricht an alle …' : `Nachricht an „${title}“ …`}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    send();
                  }
                }}
                aria-label="Nachricht"
              />
              <button className="btn primary" type="submit" disabled={(!draft.trim() && !pending) || uploading}>
                Senden
              </button>
            </form>
          </>
        )}
      {scan && <ScanDialog onClose={() => setScan(false)} onImage={(f) => void upload(f)} />}
      {toast && <div className={c.toast}>{toast}</div>}
    </div>
  );
}
