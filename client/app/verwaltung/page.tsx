'use client';
/** Übersicht der Verwaltung. Lehrkräfte und Rahmen folgen in Issue #5. */
import { Topbar } from '@/components/Topbar';
import { href } from '@/lib/api';
import { useMe } from '@/lib/useMe';
import s from '../start.module.css';

export default function Verwaltung() {
  const [me] = useMe();
  return (
    <>
      <Topbar me={me ?? null} title="Verwaltung" />
      <main className={s.start}>
        <div className={s.cards}>
          <a className={`panel ${s.card}`} href={href('/verwaltung/moodle/')}>
            <h2>Moodle-Verbindung</h2>
            <p className="muted">Collegare als externes Tool (LTI 1.3) in Moodle eintragen.</p>
          </a>
        </div>
      </main>
    </>
  );
}
