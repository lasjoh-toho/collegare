'use client';
/**
 * „Angebundene Apps“ (Konzept 8c): Collegare als Kontodienst. Die Administration trägt Apps wie Autogra.fi ein;
 * diese melden Lehrkräfte dann per OpenID Connect mit ihrem Collegare-Konto an.
 */
import { useEffect, useState } from 'react';
import { PortalHead, PortalShell } from '@/components/PortalShell';
import { ApiError, del, get, post } from '@/lib/api';
import { useMe } from '@/lib/useMe';
import v from '../verwaltung.module.css';

interface App {
  clientId: string;
  title: string;
  redirectUris: string[];
  createdAt: number;
}

export default function AppsPage() {
  const [me] = useMe();
  const [issuer, setIssuer] = useState('');
  const [apps, setApps] = useState<App[]>([]);
  const [title, setTitle] = useState('Autogra.fi');
  const [uri, setUri] = useState('');
  const [error, setError] = useState('');
  const [shown, setShown] = useState<{ title: string; clientId: string; secret: string } | null>(null);

  const fail = (e: unknown) => setError(e instanceof ApiError ? e.message : String(e));
  const load = () =>
    get<{ issuer: string; apps: App[] }>('/api/admin/apps').then((r) => {
      setIssuer(r.issuer);
      setApps(r.apps);
    }, fail);
  useEffect(() => void load(), []);

  async function add() {
    setError('');
    try {
      const r = await post<{ app: App; secret: string }>('/api/admin/apps', { title, redirectUris: [uri.trim()] });
      setShown({ title: r.app.title, clientId: r.app.clientId, secret: r.secret });
      setUri('');
      await load();
    } catch (e) {
      fail(e);
    }
  }

  async function renew(a: App) {
    if (!confirm(`Neues Geheimnis für ${a.title}? Das alte gilt dann nicht mehr; die App muss das neue eingetragen bekommen.`)) return;
    try {
      const r = await post<{ secret: string }>(`/api/admin/apps/${a.clientId}/secret`);
      setShown({ title: a.title, clientId: a.clientId, secret: r.secret });
    } catch (e) {
      fail(e);
    }
  }

  async function remove(a: App) {
    if (!confirm(`${a.title} trennen? Lehrkräfte können sich dort dann nicht mehr mit Collegare anmelden.`)) return;
    try {
      await del(`/api/admin/apps/${a.clientId}`);
      await load();
    } catch (e) {
      fail(e);
    }
  }

  if (!me) return null;
  const row = (label: string, value: string) => (
    <tr>
      <td className="muted">{label}</td>
      <td>
        <code className={v.pw}>{value}</code>
      </td>
    </tr>
  );
  return (
    <PortalShell me={me} active="apps">
      <div style={{ maxWidth: 900 }}>
        <PortalHead title="Angebundene Apps" sub="Collegare als Kontodienst: Lehrkräfte melden sich in diesen Apps mit ihrem Collegare-Konto an." />
        {error && <div className="error">{error}</div>}
        {shown && (
          <div className="panel" style={{ padding: '12px 14px', boxShadow: '0 0 0 2px var(--ok)', marginBottom: 14 }}>
            <strong>{shown.title}: diese Werte jetzt in der App eintragen.</strong> Das Geheimnis wird nicht wieder angezeigt.
            <table className={v.table} style={{ marginTop: 8 }}>
              <tbody>
                {row('Anbieter (Issuer)', issuer)}
                {row('Client-ID', shown.clientId)}
                {row('Client-Geheimnis', shown.secret)}
              </tbody>
            </table>
            <div className="row" style={{ marginTop: 8 }}>
              <span className="grow" />
              <button className="btn" onClick={() => setShown(null)}>
                Notiert
              </button>
            </div>
          </div>
        )}
        <section className={`panel ${v.box}`}>
          <h2>Eingetragene Apps ({apps.length})</h2>
          {apps.length === 0 ? (
            <p className="muted">Noch keine. Läuft Autogra.fi auf demselben Schulserver, hier eintragen: Dann gibt es Kürzel, Passwörter und Lehrende nur noch an einer Stelle.</p>
          ) : (
            <table className={v.table}>
              <thead>
                <tr>
                  <th>App</th>
                  <th>Rücksprung-Adresse</th>
                  <th className={v.opt}>Eingetragen</th>
                  <th>Aktionen</th>
                </tr>
              </thead>
              <tbody>
                {apps.map((a) => (
                  <tr key={a.clientId}>
                    <td>
                      <strong>{a.title}</strong>
                      <br />
                      <small className="muted">{a.clientId}</small>
                    </td>
                    <td>
                      <code className={v.pw} style={{ fontSize: 12 }}>
                        {a.redirectUris.join(', ')}
                      </code>
                    </td>
                    <td className={`muted ${v.opt}`}>{new Date(Number(a.createdAt)).toLocaleDateString('de-DE')}</td>
                    <td>
                      <span className={v.acts}>
                        <button className="btn" onClick={() => renew(a)}>
                          Neues Geheimnis
                        </button>
                        <button className="btn" onClick={() => remove(a)}>
                          Trennen
                        </button>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
        <section className={`panel ${v.box}`}>
          <h2>App eintragen</h2>
          <p className="muted">
            Die Rücksprung-Adresse nennt die App. Für die App gilt:
            Anbieter <code className={v.pw}>{issuer}</code>, Anmeldung mit PKCE.
          </p>
          <div className={v.cols}>
            <div className="field">
              <label>Name der App</label>
              <input value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div className="field">
              <label>Rücksprung-Adresse</label>
              <input value={uri} onChange={(e) => setUri(e.target.value)} placeholder="https://server.schule.de/autografi/oidc/callback" />
            </div>
          </div>
          <div className="row">
            <span className="grow" />
            <button className="btn primary" disabled={!title.trim() || !uri.trim().startsWith('http')} onClick={add}>
              Eintragen
            </button>
          </div>
        </section>
      </div>
    </PortalShell>
  );
}
