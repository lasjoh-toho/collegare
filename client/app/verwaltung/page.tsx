'use client';
/** Übersicht der Verwaltung (Issue #5). */
import { Topbar } from '@/components/Topbar';
import { href } from '@/lib/api';
import { useMe } from '@/lib/useMe';
import s from '../start.module.css';

const PAGES = [
  { path: '/verwaltung/lehrkraefte/', title: 'Lehrkräfte', text: 'Konten anlegen, Passwort setzen, als Lehrkraft ansehen.' },
  { path: '/verwaltung/rahmen/', title: 'Rahmen für Projekte', text: 'Erlaubte Dokument- und Dateitypen, KI, Tippfluss-Hinweise, offenes Office.' },
  { path: '/verwaltung/moodle/', title: 'Moodle-Verbindung', text: 'Collegare als externes Tool (LTI 1.3) in Moodle eintragen.' },
];

export default function Verwaltung() {
  const [me] = useMe();
  return (
    <>
      <Topbar me={me ?? null} title="Verwaltung" />
      <main className={s.start}>
        <div className={s.cards}>
          {PAGES.map((p) => (
            <a key={p.path} className={`panel ${s.card}`} href={href(p.path)}>
              <h2>{p.title}</h2>
              <p className="muted">{p.text}</p>
            </a>
          ))}
        </div>
      </main>
    </>
  );
}
