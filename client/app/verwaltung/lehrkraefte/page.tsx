'use client';
/** Lehrkräfte anlegen, Passwort setzen und als Lehrkraft ansehen (wie im Autogra.fi-Portal). */
import { useEffect, useState } from 'react';
import { Icon } from '@/components/Icon';
import { PortalHead, PortalShell } from '@/components/PortalShell';
import { ApiError, del, get, href, post } from '@/lib/api';
import { useMe } from '@/lib/useMe';
import s from '../../start.module.css';
import v from '../verwaltung.module.css';

interface Teacher {
  id: number;
  name: string;
  login: string;
  created_at: number;
  projects: number;
}

/** Gut lesbares Startpasswort ohne verwechselbare Zeichen. */
function newPassword(): string {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
  const r = crypto.getRandomValues(new Uint32Array(12));
  const p = Array.from(r, (x) => chars[x % chars.length]).join('');
  return `${p.slice(0, 4)}-${p.slice(4, 8)}-${p.slice(8)}`;
}

export default function Lehrkraefte() {
  const [me] = useMe();
  const [list, setList] = useState<Teacher[]>([]);
  const [form, setForm] = useState({ login: '', name: '', password: '' });
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [pwFor, setPwFor] = useState<Teacher | null>(null);

  const fail = (e: unknown) => setError(e instanceof ApiError ? e.message : String(e));
  const load = () => get<{ teachers: Teacher[] }>('/api/admin/teachers').then((r) => setList(r.teachers)).catch(fail);
  useEffect(() => void load(), []);

  async function create() {
    setError('');
    try {
      await post('/api/admin/teachers', form);
      setNote(`${form.name} angelegt. Kürzel ${form.login}, Startpasswort ${form.password}. Bitte jetzt notieren, es wird nicht wieder angezeigt.`);
      setForm({ login: '', name: '', password: '' });
      await load();
    } catch (e) {
      fail(e);
    }
  }

  async function viewAs(t: Teacher) {
    try {
      await post(`/api/admin/teachers/${t.id}/impersonate`);
      location.href = href('/');
    } catch (e) {
      fail(e);
    }
  }

  async function remove(t: Teacher) {
    if (!confirm(`Konto ${t.login} (${t.name}) löschen? Die Anmeldung ist danach nicht mehr möglich.`)) return;
    setError('');
    try {
      await del(`/api/admin/teachers/${t.id}`);
      setNote(`Konto ${t.login} gelöscht.`);
      await load();
    } catch (e) {
      fail(e);
    }
  }

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  if (!me) return null;
  return (
    <PortalShell me={me} active="teachers">
      <div style={{ maxWidth: 900 }}>
        <PortalHead title="Lehrende" />
        {error && <div className="error">{error}</div>}
        {note && (
          <div className="panel" style={{ padding: '10px 14px', boxShadow: '0 0 0 2px var(--ok)' }}>
            {note}{' '}
            <button className="btn" onClick={() => setNote('')}>
              Notiert
            </button>
          </div>
        )}
        <section className={`panel ${v.box}`}>
          <h2>Angelegte Lehrende ({list.length})</h2>
          {list.length === 0 ? (
            <p className="muted">Noch keine. Wer über Moodle startet, erscheint hier nicht: Moodle legt die Person beim ersten Start an.</p>
          ) : (
            <table className={v.table}>
              <thead>
                <tr>
                  <th>Kürzel</th>
                  <th>Name</th>
                  <th className={v.opt}>Projekte</th>
                  <th className={v.opt}>Angelegt</th>
                  <th>Aktionen</th>
                </tr>
              </thead>
              <tbody>
                {list.map((t) => (
                  <tr key={t.id}>
                    <td>
                      <span className={v.chip}>{t.login}</span>
                    </td>
                    <td>{t.name}</td>
                    <td className={v.opt}>{t.projects}</td>
                    <td className={`muted ${v.opt}`}>{new Date(Number(t.created_at)).toLocaleDateString('de-DE')}</td>
                    <td>
                      <span className={v.acts}>
                        {t.id !== me?.id && (
                          <button className="btn" onClick={() => viewAs(t)} title="Als diese Lehrkraft ansehen">
                            Übersicht
                          </button>
                        )}
                        <button className="btn" onClick={() => setPwFor(t)}>
                          Passwort
                        </button>
                        {t.id !== me?.id && (
                          <button className="btn icon" onClick={() => remove(t)} disabled={t.projects > 0} title={t.projects > 0 ? 'Erst die Projekte abschließen oder löschen' : 'Konto löschen'} aria-label="Konto löschen">
                            <Icon name="close" size={14} />
                          </button>
                        )}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
        <section className={`panel ${v.box}`}>
          <h2>Neue Lehrkraft anlegen</h2>
          <p className="muted">Jede Lehrkraft bekommt einen eigenen Bereich für ihre Kurse. Wer über Moodle startet, braucht kein Konto: Moodle legt die Person beim ersten Start an.</p>
          <div className={v.grid}>
            <div className="field">
              <label>Kürzel (2–6 Buchstaben)</label>
              <input value={form.login} onChange={set('login')} placeholder="mue" autoComplete="off" />
            </div>
            <div className="field">
              <label>Vollständiger Name</label>
              <input value={form.name} onChange={set('name')} placeholder="Frau Müller" />
            </div>
            <div className="field">
              <label>Initialkennwort</label>
              <div className="row">
                <input className={v.pw} value={form.password} onChange={set('password')} autoComplete="new-password" />
                <button className="btn icon" title="Passwort erzeugen" onClick={() => setForm({ ...form, password: newPassword() })}>
                  ⟳
                </button>
              </div>
            </div>
          </div>
          <div className="row">
            <span className="grow" />
            <button className="btn primary" disabled={form.login.length < 2 || !form.name || form.password.length < 8} onClick={create}>
              Anlegen
            </button>
          </div>
        </section>
      </div>
      {pwFor && <PasswordDialog teacher={pwFor} onClose={(msg) => (setPwFor(null), msg && setNote(msg))} />}
    </PortalShell>
  );
}

function PasswordDialog({ teacher, onClose }: { teacher: Teacher; onClose: (msg?: string) => void }) {
  const [pw, setPw] = useState(newPassword);
  const [error, setError] = useState('');
  async function save() {
    try {
      await post(`/api/admin/teachers/${teacher.id}/password`, { password: pw });
      onClose(`Neues Passwort für ${teacher.name}: ${pw}. Bestehende Anmeldungen wurden beendet.`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    }
  }
  return (
    <div className="modal-bg" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-label="Passwort setzen">
        <h2>Passwort für {teacher.name}</h2>
        <div className="field">
          <label>Neues Passwort (mindestens 8 Zeichen)</label>
          <input className={v.pw} value={pw} onChange={(e) => setPw(e.target.value)} autoFocus />
        </div>
        {error && <div className="error">{error}</div>}
        <div className="row">
          <span className="grow" />
          <button className="btn" onClick={() => onClose()}>
            Abbrechen
          </button>
          <button className="btn primary" disabled={pw.length < 8} onClick={save}>
            Setzen
          </button>
        </div>
      </div>
    </div>
  );
}
