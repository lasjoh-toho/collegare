'use client';
/**
 * Portal für Lehrkräfte und Administration, Aufbau wie das Aufgaben-Portal von Autogra.fi (/portal):
 * Seitenleiste mit „Administration“, „Meine Projekte“ und „Klassen“, unten Konto, Tag/Nacht und Abmelden.
 * Begriffe und Reihenfolge wie dort, damit der spätere Umzug in die gemeinsame Verwaltung nur ein Umzug ist
 * (docs/gestaltung.md 3).
 */
import { useEffect, useState } from 'react';
import { get, href, post } from '@/lib/api';
import type { Course, Me, ProjectListItem } from '@/lib/types';
import { Icon } from './Icon';
import { ThemeSwitch } from './ThemeSwitch';
import ps from './portal.module.css';

export type PortalPage = 'overview' | 'new' | 'teachers' | 'frame' | 'moodle' | 'apps' | 'admin' | `class-${number}`;

export function PortalShell({ me, active, children }: { me: Me; active: PortalPage; children: React.ReactNode }) {
  const teacher = me.teacher || me.admin;
  const [courses, setCourses] = useState<Course[]>([]);
  const [counts, setCounts] = useState<Map<number, number>>(new Map());
  const [navOpen, setNavOpen] = useState(false);

  useEffect(() => {
    if (!teacher) return;
    get<{ courses: Course[] }>('/api/courses').then((r) => setCourses(r.courses), () => {});
    get<{ projects: ProjectListItem[] }>('/api/projects').then((r) => {
      const m = new Map<number, number>();
      for (const p of r.projects) m.set(p.contextId, (m.get(p.contextId) ?? 0) + 1);
      setCounts(m);
    }, () => {});
  }, [teacher]);

  async function logout() {
    await post('/api/auth/logout').catch(() => {});
    location.href = href('/');
  }
  async function back() {
    await post('/api/auth/unimpersonate').catch(() => {});
    location.href = href('/verwaltung/lehrkraefte/');
  }

  const item = (page: PortalPage, path: string, icon: string, label: string, count?: number) => (
    <a key={page} className={`${ps.item} ${active === page ? ps.on : ''}`} href={href(path)}>
      <Icon name={icon} size={16} /> <span className="grow">{label}</span>
      {count !== undefined && <span className={ps.count}>{count}</span>}
    </a>
  );
  const initials = me.name.split(/\s+/).filter(Boolean).map((w) => w[0]).slice(0, 2).join('').toUpperCase();

  return (
    <div className={ps.shell}>
      <aside className={`${ps.side} ${navOpen ? ps.navOpen : ''}`}>
        <div className={ps.brand}>
          <a href={href('/')} className={ps.brandLink}>
            <span className={ps.logo}>
              <Icon name="users" size={15} />
            </span>
            <span>
              <strong>Projekt-Portal</strong>
              <small>Collegare · Kooperative Projektarbeit</small>
            </span>
          </a>
          <button className={`btn icon ${ps.burger}`} onClick={() => setNavOpen((o) => !o)} aria-label="Menü" aria-expanded={navOpen}>
            <Icon name={navOpen ? 'close' : 'menu'} size={18} />
          </button>
        </div>
        <nav className={ps.nav}>
          {me.impersonated && (
            <>
              <div className={ps.section}>Konto</div>
              <button className={ps.item} onClick={back}>
                <Icon name="arrow" size={16} /> <span className="grow">Zurück zur Administration</span>
              </button>
            </>
          )}
          {me.admin && !me.impersonated && (
            <>
              <div className={ps.section}>Administration</div>
              {item('teachers', '/verwaltung/lehrkraefte/', 'users', 'Lehrende')}
              {item('frame', '/verwaltung/rahmen/', 'gear', 'Rahmen für Projekte')}
              {item('moodle', '/verwaltung/moodle/', 'present', 'Moodle-Verbindung')}
              {item('apps', '/verwaltung/apps/', 'key', 'Angebundene Apps')}
            </>
          )}
          {teacher && (
            <>
              <div className={ps.section}>Meine Projekte</div>
              {item('overview', '/', 'grid', 'Übersicht')}
              {item('new', '/?neu=1', 'pen', 'Neues Projekt')}
              {courses.length > 0 && <div className={ps.section}>Klassen</div>}
              {courses.map((c) => item(`class-${c.id}`, `/?klasse=${c.id}`, 'users', c.title + (c.moodle ? ' (Moodle)' : ''), counts.get(c.id) ?? 0))}
            </>
          )}
        </nav>
        <div className={ps.bottom}>
          <div className={ps.user}>
            <span className={ps.avatar}>{initials || '?'}</span>
            <span className="grow">
              <strong>{me.name}</strong>
              <small>{me.admin ? 'Administration' : teacher ? 'Lehrkraft' : 'Lernende'}</small>
            </span>
          </div>
          <div className={ps.bottomRow}>
            <ThemeSwitch />
            <span className="grow" />
            <button className={`btn icon ${ps.logout}`} onClick={logout} title="Abmelden" aria-label="Abmelden">
              <Icon name="logout" size={15} />
            </button>
          </div>
        </div>
      </aside>
      <main className={ps.main}>{children}</main>
    </div>
  );
}

/** Kopf einer Portalseite: Titel und Untertitel wie in Autogra.fi. */
export function PortalHead({ title, sub, icon, children }: { title: string; sub?: string; icon?: string; children?: React.ReactNode }) {
  return (
    <header className={ps.head}>
      <div className="grow">
        <h1>
          {icon && <Icon name={icon} size={24} />} {title}
        </h1>
        {sub && <p>{sub}</p>}
      </div>
      {children}
    </header>
  );
}
