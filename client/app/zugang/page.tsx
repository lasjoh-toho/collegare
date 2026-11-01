'use client';
/**
 * Anmeldung mit Code oder QR wie /zugang in Autogra.fi: großes Codefeld, „Weiter“,
 * Hinweis auf die Handykamera. Das QR-Geheimnis steht im URL-Fragment (#k=…) und geht nie an Server-Logs.
 */
import { useEffect, useState } from 'react';
import { ApiError, href, post } from '@/lib/api';
import s from '../start.module.css';
import z from './zugang.module.css';

export default function Zugang() {
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [hello, setHello] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function redeem(body: { code?: string; secret?: string }) {
    setBusy(true);
    setError('');
    try {
      const r = await post<{ projectId: number; name: string }>('/api/access/redeem', body);
      setHello(r.name);
      setTimeout(() => location.replace(href(`/projekt/?id=${r.projectId}`)), 700);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Keine Verbindung zum Server');
      setBusy(false);
    }
  }

  useEffect(() => {
    const k = new URLSearchParams(location.hash.slice(1)).get('k');
    if (k) {
      history.replaceState(null, '', location.pathname);
      void redeem({ secret: k });
    }
  }, []);

  return (
    <main className={s.loginWrap}>
      <div className={`panel ${s.login}`}>
        <h1 className={s.logo}>
          Colle<span>gare</span>
        </h1>
        {hello ? (
          <p className={z.hello}>
            <span className={z.check}>✓</span>
            Hallo {hello}!
          </p>
        ) : (
          <>
            <p>Gib den Code von deinem Zettel ein.</p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void redeem({ code: code.trim() });
              }}
              className={s.form}
            >
              <input
                className={z.code}
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6))}
                maxLength={6}
                autoCapitalize="characters"
                spellCheck={false}
                autoComplete="off"
                placeholder="ABC234"
                aria-label="Code"
                autoFocus
              />
              {error && <div className="error">{error}</div>}
              <button className="btn primary big" disabled={busy || code.length < 6}>
                Weiter zum Projekt →
              </button>
            </form>
            <p className="muted">Du kannst auch einfach den QR-Code auf deinem Zettel mit der Handykamera scannen.</p>
          </>
        )}
      </div>
    </main>
  );
}
