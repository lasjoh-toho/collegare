'use client';
/**
 * Werkzeuge im Portal (Jo, 20. November 2026): Lehrkräfte üben die Werkzeuge von Collegare, indem sie Unterrichts-
 * material erstellen. Ersetzt den Bereich „Nur für dich“ in jedem Projekt: Alles läuft in der eigenen Werkstatt der
 * Lehrkraft (verborgenes Projekt ohne Lernende, Testbereich t<id>). Fertiges sammelt sie unter „Materialien“, sortiert
 * und verschlagwortet es dort und gibt es in Projekten für Gruppen oder Einzelne frei.
 */
import { useEffect, useState } from 'react';
import { Icon } from '@/components/Icon';
import { PortalHead, PortalShell } from '@/components/PortalShell';
import { ApiError, get, href } from '@/lib/api';
import { OFFICE_VAR, TILES } from '@/lib/phases';
import { useMe } from '@/lib/useMe';
import t from '../projekt/tiles.module.css';

/** Werkzeuge der Werkstatt mit eigenem Untertitel: wozu man sie beim Vorbereiten nutzt */
const TOOLS: { key: string; sub: string }[] = [
  { key: 'map', sub: 'Ein Thema umreißen, z. B. als Tafelbild oder Einstieg' },
  { key: 'notes', sub: 'Quellen, Bilder, Videos und Fundstellen sammeln' },
  { key: 'sections', sub: 'Texte schreiben wie im Office, aus der Gliederung der Mindmap' },
  { key: 'pinnwand', sub: 'Eine Präsentation zum Zoomen mit Bildern und Rotem Faden' },
  { key: 'slides', sub: 'Folien wie in PowerPoint, z. B. für einen Input' },
];

export default function Werkzeuge() {
  const [me] = useMe();
  const [werkstatt, setWerkstatt] = useState<number | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (me === null) location.replace(href('/'));
    if (!me) return;
    get<{ projectId: number }>('/api/werkstatt').then(
      (r) => setWerkstatt(r.projectId),
      (e) => setError(e instanceof ApiError ? e.message : String(e)),
    );
  }, [me]);

  if (!me) return null;
  const bereich = `&bereich=t${me.id}`;
  return (
    <PortalShell me={me} active="tools">
      <PortalHead
        icon="tools"
        title="Werkzeuge"
        sub="Probier die Werkzeuge aus, die deine Lernenden im Projekt nutzen, und mach dabei gleich Unterrichtsmaterial. Was du hier anlegst, sieht niemand außer dir."
      />
      {error && <div className="error">{error}</div>}
      {werkstatt !== null && (
        <div className={t.grid}>
          <a className={`${t.tile} ${t.released}`} href={href('/materialien/?neu=1')} style={{ '--tile-color': 'var(--ui-accent)' } as React.CSSProperties}>
            <span className={t.icon} style={{ color: 'var(--ui-accent)' }}>
              <Icon name="pen" size={26} />
            </span>
            <span className={t.title}>Lernseite</span>
            <span className={t.line}>Eine gut lesbare Seite mit Randnotizen, Bildern und Videos, z. B. als Einführung</span>
          </a>
          {TOOLS.map(({ key, sub }) => {
            const tile = TILES.find((x) => x.key === key)!;
            const color = tile.office ? OFFICE_VAR[tile.office] : 'var(--ui-muted)';
            return (
              <a key={key} className={`${t.tile} ${t.released}`} href={href(tile.path!.replace('{id}', String(werkstatt)) + bereich)} data-office={tile.office ?? undefined} style={{ '--tile-color': color } as React.CSSProperties}>
                <span className={t.icon} style={{ color }}>
                  <Icon name={tile.icon} size={26} />
                </span>
                <span className={t.title}>{tile.title}</span>
                <span className={t.line}>{sub}</span>
              </a>
            );
          })}
        </div>
      )}
      {werkstatt !== null && (
        <p className="muted" style={{ marginTop: 22, maxWidth: 640 }}>
          Lernseiten, Webseiten, Videos und Dateien sammelst du unter{' '}
          <a href={href('/materialien/')}>
            <strong>Materialien</strong>
          </a>
          . Dort sortierst du sie, gibst ihnen Schlagworte und übernimmst sie in deine Projekte, für alle Lernenden, einzelne Gruppen oder einzelne Personen, zum Beispiel als
          einführendes Material.
        </p>
      )}
    </PortalShell>
  );
}
