'use client';
/** Seite „Moodle-Verbindung“ wie in Autogra.fi: Werte für Moodle anzeigen, Plattform aus Moodle eintragen. */
import { useEffect, useState } from 'react';
import { PortalHead, PortalShell } from '@/components/PortalShell';
import { ApiError, del, get, post } from '@/lib/api';
import { useMe } from '@/lib/useMe';
import s from '../../start.module.css';
import m from './moodle.module.css';

interface Tool {
  toolUrl: string;
  loginUrl: string;
  redirectUris: string[];
  jwksUrl: string;
  keyType: string;
  services: string[];
  privacy: string;
  launchContainer: string;
}
interface Platform {
  id: number;
  title: string;
  issuer: string;
  client_id: string;
  deployment_id: string;
  auth_url: string;
  jwks_url: string;
  token_url: string | null;
}

const EMPTY = { title: '', issuer: '', client_id: '', deployment_id: '', auth_url: '', jwks_url: '', token_url: '' };

export default function MoodlePage() {
  const [me] = useMe();
  const [tool, setTool] = useState<Tool | null>(null);
  const [platforms, setPlatforms] = useState<Platform[]>([]);
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState('');
  const load = () =>
    get<{ tool: Tool; platforms: Platform[] }>('/api/admin/lti')
      .then((r) => (setTool(r.tool), setPlatforms(r.platforms)))
      .catch((e) => setError(e instanceof ApiError ? e.message : String(e)));
  useEffect(() => void load(), []);

  // Aus der Moodle-Plattform-URL die üblichen Endpunkte ableiten
  function fromMoodle(url: string) {
    const u = url.trim().replace(/\/$/, '');
    setForm((f) => ({ ...f, issuer: u, auth_url: `${u}/mod/lti/auth.php`, jwks_url: `${u}/mod/lti/certs.php`, token_url: `${u}/mod/lti/token.php` }));
  }

  async function add() {
    setError('');
    try {
      await post('/api/admin/lti/platforms', { ...form, token_url: form.token_url || null });
      setForm(EMPTY);
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    }
  }

  const copy = (v: string) => void navigator.clipboard?.writeText(v);
  const Row = ({ label, value }: { label: string; value: string }) => (
    <div className={m.kv}>
      <span className="label">{label}</span>
      <code>{value}</code>
      <button className="btn icon" title="Kopieren" onClick={() => copy(value)}>
        ⧉
      </button>
    </div>
  );
  const set = (k: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  if (!me) return null;
  return (
    <PortalShell me={me} active="moodle">
      <div style={{ maxWidth: 900 }}>
        <PortalHead title="Moodle-Verbindung" />
        {error && <div className="error">{error}</div>}
        {tool && (
          <section className={`panel ${m.box}`}>
            <h2>1. In Moodle eintragen</h2>
            <p className="muted">Website-Administration › Plugins › Aktivitäten › Externes Tool › Tools verwalten › „Tool manuell konfigurieren“, LTI-Version 1.3.</p>
            <Row label="Tool-URL" value={tool.toolUrl} />
            <Row label="Login-URL (Initiierung)" value={tool.loginUrl} />
            <Row label="Weiterleitungs-URI(s)" value={tool.redirectUris.join('\n')} />
            <Row label="Öffentlicher Schlüsseltyp" value={tool.keyType} />
            <Row label="Schlüsselsatz-URL" value={tool.jwksUrl} />
            <ul className={m.list}>
              {tool.services.map((x) => (
                <li key={x}>{x}</li>
              ))}
              <li>{tool.privacy}</li>
              <li>Standard-Startcontainer: {tool.launchContainer}</li>
            </ul>
          </section>
        )}
        <section className={`panel ${m.box}`}>
          <h2>2. Werte aus Moodle hier eintragen</h2>
          <p className="muted">Nach dem Speichern zeigt Moodle beim Tool „Konfigurationsdetails“ (Lupe in der Tool-Liste). Daraus kommen Client-ID und Deployment-ID.</p>
          <div className="field">
            <label>Adresse des Moodle (füllt die übrigen Adressen aus)</label>
            <input placeholder="https://moodle.schule.de" onBlur={(e) => e.target.value && fromMoodle(e.target.value)} />
          </div>
          <div className={m.grid}>
            <div className="field"><label>Name</label><input value={form.title} onChange={set('title')} placeholder="Schul-Moodle" /></div>
            <div className="field"><label>Plattform-ID (Aussteller)</label><input value={form.issuer} onChange={set('issuer')} /></div>
            <div className="field"><label>Client-ID</label><input value={form.client_id} onChange={set('client_id')} /></div>
            <div className="field"><label>Deployment-ID</label><input value={form.deployment_id} onChange={set('deployment_id')} /></div>
            <div className="field"><label>Authentifizierungs-URL</label><input value={form.auth_url} onChange={set('auth_url')} /></div>
            <div className="field"><label>Schlüsselsatz-URL (Moodle)</label><input value={form.jwks_url} onChange={set('jwks_url')} /></div>
            <div className="field"><label>Zugriffstoken-URL</label><input value={form.token_url} onChange={set('token_url')} /></div>
          </div>
          <div className="row">
            <span className="grow" />
            <button className="btn primary" disabled={!form.title || !form.issuer || !form.client_id || !form.deployment_id || !form.auth_url || !form.jwks_url} onClick={add}>
              Plattform speichern
            </button>
          </div>
        </section>
        <section className={`panel ${m.box}`}>
          <h2>Eingetragene Plattformen</h2>
          {platforms.length === 0 && <p className="muted">Noch keine.</p>}
          {platforms.map((p) => (
            <div key={p.id} className={m.platform}>
              <div className="grow">
                <strong>{p.title}</strong>
                <div className="muted">
                  {p.issuer} · Client {p.client_id} · Deployment {p.deployment_id}
                </div>
              </div>
              <button className="btn danger" onClick={() => confirm(`${p.title} entfernen? Starts aus diesem Moodle gehen dann nicht mehr.`) && del(`/api/admin/lti/platforms/${p.id}`).then(load)}>
                Entfernen
              </button>
            </div>
          ))}
        </section>
      </div>
    </PortalShell>
  );
}
