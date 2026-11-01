'use client';
/** Lehrkräfte anlegen, Passwort setzen und als Lehrkraft ansehen (wie im Autogra.fi-Portal). */
import { useEffect, useState } from 'react';
import { Topbar } from '@/components/Topbar';
import { ApiError, get, href, post } from '@/lib/api';
import { useMe } from '@/lib/useMe';
import s from '../../start.module.css';
import v from '../verwaltung.module.css';

interface Teacher {
  id: number;
  name: string;
  login: string;
  created_at: number;
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

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  return (
    <>
      <Topbar me={me ?? null} title="Lehrkräfte" />
      <main className={s.start} style={{ maxWidth: 820 }}>
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
          <h2>Lehrkraft anlegen</h2>
          <p className="muted">Jede Lehrkraft bekommt einen eigenen Bereich für ihre Kurse. Wer über Moodle startet, braucht kein Konto: Moodle legt die Person beim ersten Start an.</p>
          <div className={v.grid}>
            <div className="field">
              <label>Kürzel (Anmeldename)</label>
              <input value={form.login} onChange={set('login')} placeholder="mue" autoComplete="off" />
            </div>
            <div className="field">
              <label>Name</label>
              <input value={form.name} onChange={set('name')} placeholder="Frau Müller" />
            </div>
            <div className="field">
              <label>Startpasswort</label>
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
        <section className={`panel ${v.box}`}>
          <h2>Lehrkräfte mit Konto ({list.length})</h2>
          {list.length === 0 && <p className="muted">Noch keine.</p>}
          {list.map((t) => (
            <div key={t.id} className={v.person}>
              <span>
                {t.name}
                <small>{t.login}</small>
              </span>
              <span className="muted">{new Date(Number(t.created_at)).toLocaleDateString('de-DE')}</span>
              <span className={v.acts}>
                <button className="btn" onClick={() => setPwFor(t)}>
                  Passwort setzen
                </button>
                {t.id !== me?.id && (
                  <button className="btn" onClick={() => viewAs(t)} title="Collegare so sehen wie diese Lehrkraft (wird protokolliert)">
                    Ansehen als
                  </button>
                )}
              </span>
            </div>
          ))}
        </section>
      </main>
      {pwFor && <PasswordDialog teacher={pwFor} onClose={(msg) => (setPwFor(null), msg && setNote(msg))} />}
    </>
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
