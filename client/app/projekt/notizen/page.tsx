'use client';
/** Notizen und Quellen als eigene Seite (Kachel in der Phase Recherche); dieselbe Leiste lässt sich rechts zuschalten. */
import { useEffect, useState } from 'react';
import { NotesPanel } from '@/components/NotesPanel';
import { ProjectShell } from '@/components/ProjectShell';
import { Topbar } from '@/components/Topbar';
import { get, href } from '@/lib/api';
import type { ProjectView } from '@/lib/types';
import { useMe, useQuery } from '@/lib/useMe';

export default function NotesPage() {
  const [me] = useMe();
  const idParam = useQuery('id');
  const id = idParam ? Number(idParam) : NaN;
  const wanted = useQuery('bereich');
  const [project, setProject] = useState<ProjectView | null>(null);
  useEffect(() => {
    if (me === null) location.replace(href('/'));
  }, [me]);
  useEffect(() => {
    if (Number.isInteger(id)) get<ProjectView>(`/api/projects/${id}`).then(setProject, () => setProject(null));
  }, [id]);
  if (!me || !project) return <Topbar me={me ?? null} />;
  return (
    <ProjectShell me={me} project={project} info={{ key: 'notizen', title: 'Notizen und Quellen', text: 'Haltet hier fest, was ihr bei der Recherche findet: Gedanken als Notiz, Bücher und Artikel als Quelle mit Fundstelle, Webseiten als Link. Mit „Neue Notiz“ unten legt ihr etwas an. Das Auswahlfeld oben zeigt eure privaten Notizen, die der Gruppe oder das, was alle Gruppen für alle freigegeben haben. Doppelklick auf eine Notiz bearbeitet sie an Ort und Stelle. „Bild aufnehmen“ fotografiert ein Blatt, eine Buchseite oder ein Tafelbild: Die Ecken werden erkannt und das Bild gerade gerückt. Mit „Text erkennen“ liest die KI den Text auf dem Bild; vergleicht ihn danach mit dem Bild und verbessert ihn, bevor ihr ihn verwendet. Die Notiz vermerkt dann „Scan – Handschrift“ oder „Scan – Druckschrift“; stimmt die Schrift nicht, lässt sie sich beim Bearbeiten umstellen. Jede Notiz lässt sich in die Mindmap ziehen; überarbeitet ihr sie später, ändert sich die Karte mit. Rechts steht die Gliederung (Knopf „Gliederung“): Zieht Notizen auf einen Punkt, um sie dort anzuhängen, oder direkt auf die Linie, dann entsteht an dieser Stelle ein neuer Punkt.' }} where="Notizen und Quellen" phase="research" fill>
      <NotesPanel me={me} project={project} wanted={wanted} />
    </ProjectShell>
  );
}
