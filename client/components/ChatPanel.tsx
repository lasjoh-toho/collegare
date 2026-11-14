'use client';
/**
 * Chat je Gruppe und für alle im Projekt (Wunsch Jo, 11. November 2026). Echtzeit über den Namespace /project;
 * Lehrkräfte sehen alle Chats und dürfen Nachrichten löschen, Lernende ihre eigenen. Als eigene Seite oder als
 * zuschaltbare Leiste am rechten Rand; Beiträge lassen sich von dort in die Mindmap ziehen.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import { projectSocket } from '@/lib/api';
import { setChatDrag } from '@/lib/chatDrag';
import type { Me, ProjectView } from '@/lib/types';
import c from './chat.module.css';

interface Msg {
  id: number;
  userId: number;
  name: string;
  body: string;
  at: number;
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
const time = (ms: number) => new Date(ms).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });

/** Links im Text anklickbar machen, sonst reiner Text (kein HTML aus Nachrichten). */
function Body({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/[^\s<>"]+)/g);
  return (
    <>
      {parts.map((t, i) =>
        i % 2 ? (
          <a key={i} href={t} target="_blank" rel="noopener noreferrer">
            {t}
          </a>
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

  // beim Öffnen und bei neuen Nachrichten nach unten, außer man liest gerade weiter oben
  useLayoutEffect(() => {
    const el = list.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [msgs]);

  function send() {
    const text = draft.trim();
    if (!text || !scope) return;
    if (!sock.current?.connected) return show('Keine Verbindung zum Server. Bitte kurz warten.');
    stick.current = true;
    sock.current.emit('chat:send', { projectId: id, scope, text }, (r: { ok: boolean; error?: string }) => {
      if (r.ok) setDraft('');
      else show(r.error ?? 'Senden fehlgeschlagen');
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
        {panel && <span className={`muted ${c.tip}`}>Beiträge lassen sich in die Mindmap ziehen</span>}
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
                          onDragStart={(e) => setChatDrag(e, { name: m.name, body: m.body })}
                          title="In die Mindmap ziehen"
                        >
                          <span className={c.text}>
                            <Body text={m.body} />
                          </span>
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
            <form
              className={c.compose}
              onSubmit={(e) => {
                e.preventDefault();
                send();
              }}
            >
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
              <button className="btn primary" type="submit" disabled={!draft.trim()}>
                Senden
              </button>
            </form>
          </>
        )}
      {toast && <div className={c.toast}>{toast}</div>}
    </div>
  );
}
