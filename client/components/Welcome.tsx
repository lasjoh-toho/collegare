'use client';
/**
 * Startseite wie /anmelden in Autogra.fi (Vorbild welcome.php): Kopfbereich im Markenverlauf, darunter die
 * Code-Karte für Lernende, „Lehrkräfte – Zum Login“ und Erklärkarten. Collegare trägt den rot-orangen Verlauf
 * (docs/gestaltung.md, Abschnitt 2). Das QR-Geheimnis kommt im URL-Fragment (#k=…) und geht nie in Server-Logs.
 */
import { useEffect, useState } from 'react';
import { ApiError, BASE_PATH, get, href, post } from '@/lib/api';
import { Icon } from './Icon';
import { ThemeSwitch } from './ThemeSwitch';
import w from './welcome.module.css';

export function Welcome({ onLogin, showLogin = true, forApp = false }: { onLogin?: () => void; showLogin?: boolean; forApp?: boolean }) {
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState('');
  const [hello, setHello] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loginOpen, setLoginOpen] = useState(forApp);
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [loginError, setLoginError] = useState('');
  const [openOffice, setOpenOffice] = useState(false);

  useEffect(() => {
    get<{ openOffice: boolean }>('/api/public').then((r) => setOpenOffice(r.openOffice), () => {});
  }, []);

  async function redeem(body: { code?: string; secret?: string }) {
    setBusy(true);
    setCodeError('');
    try {
      const r = await post<{ projectId: number; name: string }>('/api/access/redeem', body);
      setHello(r.name);
      setTimeout(() => location.replace(href(`/projekt/?id=${r.projectId}`)), 700);
    } catch (e) {
      setCodeError(e instanceof ApiError ? e.message : 'Keine Verbindung zum Server');
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

  async function submitLogin(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setLoginError('');
    try {
      await post('/api/auth/login', { login, password });
      if (onLogin) onLogin();
      else location.replace(href('/'));
    } catch (err) {
      setLoginError(err instanceof ApiError ? err.message : 'Keine Verbindung zum Server');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={w.page}>
      <div className={w.hero}>
        <div className={w.logo}>
          <Icon name="users" size={34} />
        </div>
        <h1>Collegare</h1>
        <p>Gemeinsam forschen, schreiben und präsentieren.</p>
      </div>

      <div className={w.card}>
        {forApp ? (
          <>
            <h2>
              <Icon name="lock" size={18} /> Anmelden mit Collegare
            </h2>
            <p className={w.lead}>Eine angebundene App (zum Beispiel Autogra.fi) möchte dich mit deinem Collegare-Konto anmelden. Danach geht es automatisch zurück.</p>
          </>
        ) : hello ? (
          <div className={w.hello}>
            <span className={w.check}>
              <Icon name="check" size={28} />
            </span>
            Hallo {hello}!
          </div>
        ) : (
          <>
            <h2>
              <Icon name="qr" size={18} /> Mit Code anmelden
            </h2>
            <p className={w.lead}>Gib den Code von deinem Zettel ein. Oder scanne den QR-Code auf dem Zettel einfach mit der Handykamera.</p>
            <form
              autoComplete="off"
              onSubmit={(e) => {
                e.preventDefault();
                void redeem({ code: code.trim() });
              }}
            >
              <div className={w.codeRow}>
                <input
                  className={w.code}
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6))}
                  maxLength={6}
                  autoCapitalize="characters"
                  spellCheck={false}
                  placeholder="z. B. AB3K7X"
                  aria-label="Code"
                  autoFocus={!showLogin}
                />
                <button className={w.go} disabled={busy || code.length < 6} aria-label="Weiter zum Projekt">
                  <Icon name="arrow" size={20} />
                </button>
              </div>
              {codeError && <div className={w.err}>{codeError}</div>}
            </form>
          </>
        )}

        {showLogin && !hello && (
          <>
            {!forApp && <div className={w.divider}>Lehrkräfte</div>}
          </>
        )}
        {showLogin && !hello && (
          <>
            {!loginOpen ? (
              <button type="button" className={w.toggle} onClick={() => setLoginOpen(true)}>
                <Icon name="lock" size={16} /> Zum Login
              </button>
            ) : (
              <form onSubmit={submitLogin} autoComplete="on" className={w.login}>
                <div className="field">
                  <label htmlFor="login">Kürzel</label>
                  <input id="login" autoComplete="username" value={login} onChange={(e) => setLogin(e.target.value)} autoFocus />
                </div>
                <div className="field">
                  <label htmlFor="pw">Passwort</label>
                  <div className={w.pwWrap}>
                    <input id="pw" type={showPw ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
                    <button type="button" className={w.eye} onClick={() => setShowPw((v) => !v)} title={showPw ? 'Passwort verbergen' : 'Passwort zeigen'}>
                      {showPw ? 'verbergen' : 'zeigen'}
                    </button>
                  </div>
                </div>
                {loginError && <div className={w.err}>{loginError}</div>}
                <button className={w.wide} disabled={busy || !login || !password}>
                  Anmelden
                </button>
              </form>
            )}
          </>
        )}
      </div>

      {openOffice && !hello && !forApp && (
        <section className={w.apps} aria-labelledby="appsTitle">
          <h2 id="appsTitle">Ohne Anmeldung loslegen</h2>
          <p className={w.lead}>Die Office-Programme laufen ganz in deinem Browser. Was du hier schreibst, bleibt auf diesem Gerät, bis du es speicherst oder herunterlädst.</p>
          <div className={w.appGrid}>
            {(
              [
                ['docx', 'Text', 'doc', 'var(--office-word)'],
                ['pptx', 'Präsentation', 'slides', 'var(--office-slide)'],
                ['xlsx', 'Tabelle', 'grid', 'var(--office-cell)'],
              ] as const
            ).map(([type, title, icon, color]) => (
              <a key={type} className={w.app} href={`${BASE_PATH}/office/editor/?new=${type}&lang=de`} style={{ '--app': color } as React.CSSProperties}>
                <span className={w.appIcon}>
                  <Icon name={icon} size={22} />
                </span>
                <strong>{title}</strong>
                <small>Neu anlegen</small>
              </a>
            ))}
            <a className={w.app} href={`${BASE_PATH}/office/`} style={{ '--app': 'var(--ui-muted)' } as React.CSSProperties}>
              <span className={w.appIcon}>
                <Icon name="outline" size={22} />
              </span>
              <strong>Datei öffnen</strong>
              <small>und zuletzt bearbeitete</small>
            </a>
          </div>
        </section>
      )}

      <section className={w.explain} aria-labelledby="explainTitle">
        <h2 id="explainTitle">So funktioniert Collegare</h2>
        <div className={w.features}>
          {[
            ['users', 'Gruppen finden', 'Ihr bildet Gruppen auf einem Board. Je nach Projekt teilt eure Lehrkraft ein oder ihr wählt selbst.'],
            ['map', 'Ideen ordnen', 'In der Mindmap sammelt ihr Ideen und Fragen. Daraus wird die Gliederung eurer Arbeit.'],
            ['doc', 'Gemeinsam schreiben', 'Jede Person schreibt ihre Abschnitte, alle sehen den Stand. Fertige Abschnitte meldet ihr „fertig“.'],
            ['present', 'Präsentieren', 'Aus euren Abschnitten entstehen Präsentation und Handout. Eure Lehrkraft gibt Rückmeldung.'],
          ].map(([icon, title, text]) => (
            <div key={title} className={w.feature}>
              <div className={w.fIcon}>
                <Icon name={icon} size={22} />
              </div>
              <h3>{title}</h3>
              <p>{text}</p>
            </div>
          ))}
        </div>
      </section>
      <footer className={w.foot}>
        <span>Collegare · Kooperative Projektarbeit</span>
        <ThemeSwitch compact />
      </footer>
    </div>
  );
}
