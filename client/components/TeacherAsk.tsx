'use client';
/**
 * Lehrkraft ändert die Gliederung einer Gruppe (Jo, 22. November 2026): Vor der ersten Änderung fragt ein Fenster, ob
 * sie die Gliederung wirklich ändern oder lieber der Gruppe schreiben will. „Nachricht an Gruppe“ öffnet ein gelbes
 * Post-it „Kommentar für die Gruppe …“, das im Chat der Gruppe ankommt. „Gliederung trotzdem ändern“ gilt danach für
 * diese Gruppe, bis die Seite neu geladen wird.
 */
import { useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import s from './teacherask.module.css';

export interface TeacherGroup {
  scope: string;
  group: string;
  message: (text: string) => Promise<boolean>;
}

/** Nur für Lehrkräfte in einer Gruppe (nicht im eigenen Testbereich, nicht in der Themen-Mindmap) */
export function teacherGroup(opts: { role?: string; scope: string | null | undefined; scopes?: { scope: string; title: string }[]; sock: Socket | null; projectId: number }): TeacherGroup | undefined {
  const { role, scope, scopes, sock, projectId } = opts;
  if (role !== 'teacher' || !scope || !/^[gu]\d+$/.test(scope)) return undefined;
  const group = scopes?.find((x) => x.scope === scope)?.title ?? 'Gruppe';
  return {
    scope,
    group,
    // mit Link zur Gliederung; der Chat macht daraus „Zur Stelle springen“
    message: (text) => {
      const body = `📌 Kommentar zur Gliederung:\n${text.slice(0, 1500)}\n/projekt/gliederung/?id=${projectId}&bereich=${scope}`;
      return new Promise((res) => (sock ? sock.emit('chat:send', { projectId, scope, text: body }, (r: { ok: boolean }) => res(!!r?.ok)) : res(false)));
    },
  };
}

const allowed = new Set<string>();

/** send-Funktion mit Rückfrage; dialog muss gerendert werden */
export function useTeacherAsk<A extends unknown[]>(t: TeacherGroup | undefined, send: (...a: A) => Promise<boolean>) {
  const [ask, setAsk] = useState<null | 'ask' | 'note'>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const wait = useRef<{ run: () => Promise<boolean>; done: (ok: boolean) => void }[]>([]);
  const guarded = (...a: A): Promise<boolean> => {
    if (!t || allowed.has(t.scope)) return send(...a);
    return new Promise((done) => {
      wait.current.push({ run: () => send(...a), done });
      setAsk((x) => x ?? 'ask');
    });
  };
  const finish = async (go: boolean) => {
    const list = wait.current;
    wait.current = [];
    setAsk(null);
    setText('');
    for (const w of list) w.done(go ? await w.run() : false);
  };
  const dialog =
    t && ask ? (
      <div className={s.back} onMouseDown={(e) => e.target === e.currentTarget && void finish(false)}>
        {ask === 'ask' ? (
          <div className={s.box} role="dialog" aria-modal="true" aria-label={`Gliederung der Gruppe ${t.group}`}>
            <h3>Gliederung der Gruppe {t.group}</h3>
            <p>Wollen Sie die Gliederung der Gruppe ändern oder lieber eine Nachricht schreiben?</p>
            <div className={s.buttons}>
              <button className="btn" onClick={() => setAsk('note')} autoFocus>
                Nachricht an Gruppe
              </button>
              <button
                className="btn"
                onClick={() => {
                  allowed.add(t.scope);
                  void finish(true);
                }}
              >
                Gliederung trotzdem ändern
              </button>
            </div>
          </div>
        ) : (
          <form
            className={s.postit}
            role="dialog"
            aria-modal="true"
            aria-label={`Kommentar für die Gruppe ${t.group}`}
            onSubmit={async (e) => {
              e.preventDefault();
              if (!text.trim()) return;
              setBusy(true);
              const ok = await t.message(text.trim());
              setBusy(false);
              if (ok) void finish(false);
            }}
          >
            <h4>Kommentar für die Gruppe {t.group}</h4>
            <textarea autoFocus rows={4} value={text} onChange={(e) => setText(e.target.value)} placeholder="Erscheint im Chat der Gruppe" maxLength={2000} />
            <div className={s.buttons}>
              <button type="button" className="btn" onClick={() => void finish(false)}>
                Abbrechen
              </button>
              <button className="btn primary" disabled={busy || !text.trim()}>
                Senden
              </button>
            </div>
          </form>
        )}
      </div>
    ) : null;
  return { guarded, dialog };
}
