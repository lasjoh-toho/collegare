'use client';
import { href, post } from '@/lib/api';
import type { Me } from '@/lib/types';

export function Topbar({ me, title, children }: { me: Me | null; title?: string; children?: React.ReactNode }) {
  async function logout() {
    await post('/api/auth/logout').catch(() => {});
    location.href = href('/');
  }
  async function back() {
    await post('/api/auth/unimpersonate').catch(() => {});
    location.href = href('/verwaltung/lehrkraefte/');
  }
  return (
    <header className="topbar">
      <a className="brand" href={href('/')}>
        Colle<span>gare</span>
      </a>
      {title && <span className="title">· {title}</span>}
      {children}
      <div className="right">
        {me?.impersonated && <span className="chip" style={{ background: 'var(--attr-soft)', color: 'var(--attr)' }}>Ansicht als {me.name}</span>}
        {me?.impersonated && (
          <button className="btn" onClick={back}>
            Zurück zur Verwaltung
          </button>
        )}
        {me?.admin && !me.projectId && (
          <a className="btn" href={href('/verwaltung/')}>
            Verwaltung
          </a>
        )}
        {me && <span className="muted">{me.name}</span>}
        {me && (
          <button className="btn" onClick={logout}>
            Abmelden
          </button>
        )}
      </div>
    </header>
  );
}
