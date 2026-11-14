/**
 * Phasen und Oberflächen der Schülerplattform (docs/gestaltung.md, Abschnitte 6 und 7):
 * Seitenmenü und Kacheln lesen beide von hier, damit Reihenfolge, Anleitung und Zustand überall gleich sind.
 */
import type { ProjectSettings, ProjectView } from './types';

export type PhaseKey = 'topic' | 'groups' | 'orientation' | 'research' | 'drafting' | 'presentation';
export type PhaseState = 'open' | 'upcoming' | 'closed' | 'off';

export interface PhaseInfo {
  key: PhaseKey;
  title: string;
  icon: string;
  state: PhaseState;
  /** kurzer Zustand für Abzeichen, z. B. „ab Mo., 10.11.“ */
  badge: string;
  /** Handlungsanleitung für Lernende */
  help: string;
}

const ORDER: { key: PhaseKey; title: string; icon: string }[] = [
  { key: 'topic', title: 'Thema', icon: 'map' },
  { key: 'groups', title: 'Gruppen', icon: 'users' },
  { key: 'orientation', title: 'Orientierung', icon: 'map' },
  { key: 'research', title: 'Recherche', icon: 'search' },
  { key: 'drafting', title: 'Ausarbeitung', icon: 'doc' },
  { key: 'presentation', title: 'Präsentation', icon: 'present' },
];

export const fmtDay = (ms: number) => new Date(ms).toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' });
export const fmtDayTime = (ms: number) =>
  new Date(ms).toLocaleString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

function help(key: PhaseKey, s: ProjectSettings, single: boolean): string {
  switch (key) {
    case 'topic':
      return s.topicMapEdit === 'teacher'
        ? 'In der gemeinsamen Mindmap umreißt deine Lehrkraft das Thema. Schau sie dir an, bevor die Gruppen entstehen.'
        : 'Sammelt gemeinsam in der Themen-Mindmap, was zum Thema gehört. Daraus entstehen später die Gruppen; jede Gruppe kann die Mindmap als Start übernehmen.';
    case 'groups':
      if (single) return 'Ihr arbeitet einzeln. Hier siehst du, wer im Projekt ist.';
      if (s.groupFormation === 'teacher') return 'Deine Lehrkraft teilt die Gruppen ein. Auf dem Board siehst du, mit wem du zusammenarbeitest.';
      return (
        `Zieh deine Karte in die Gruppe, in der du arbeiten möchtest (${s.groupMin}–${s.groupMax} Personen)` +
        (s.groupFormation === 'open' ? '. Ihr dürft auch eine neue Gruppe anlegen' : '') +
        (s.choiceDeadline ? `. Wählen bis ${fmtDayTime(s.choiceDeadline)}.` : '.')
      );
    case 'orientation':
      return 'Sammelt in der Mindmap Ideen und Fragen als Karten und legt Zusammengehöriges in Cluster. Was in die Arbeit soll, nehmt ihr aktiv „In die Gliederung“ auf, nicht alles muss hinein. Dann „Gliederung übernehmen“: Jeder übernommene Ast wird ein Abschnitt.';
    case 'research':
      return 'Haltet in „Notizen und Quellen“ Absprachen, Fragen und Quellen mit Fundstelle fest und ordnet sie euren Abschnitten zu.';
    case 'drafting':
      return s.finishLock
        ? 'Jede Person schreibt ihre Abschnitte im Texteditor. Ist dein Abschnitt fertig, meldest du ihn „fertig“; danach ist er gesperrt.'
        : 'Jede Person schreibt ihre Abschnitte im Texteditor. Ihr könnt alle Abschnitte eurer Gruppe lesen.';
    case 'presentation': {
      const dt = s.docTypes ?? {};
      const parts = [dt.slides && 'die Präsentation', dt.handout && 'ein Handout', dt.brochure && 'euren Teil der gemeinsamen Broschüre'].filter(Boolean) as string[];
      return parts.length ? `Macht aus euren Abschnitten ${parts.join(parts.length > 2 ? ', ' : ' und ').replace(/, ([^,]*)$/, ' und $1')}.` : 'Bereitet die Vorstellung eurer Ergebnisse vor.';
    }
  }
}

export function phaseList(s: ProjectSettings, single: boolean, now = Date.now()): PhaseInfo[] {
  return ORDER.map(({ key, title, icon }) => {
    const ph = s.phases[key] ?? { state: 'on', from: null, to: null };
    let state: PhaseState = 'open';
    let badge = 'offen';
    if (ph.state === 'off') {
      state = 'off';
      badge = 'nicht vorgesehen';
    } else if (ph.state === 'scheduled') {
      if (ph.from && now < ph.from) {
        state = 'upcoming';
        badge = `ab ${fmtDay(ph.from)}`;
      } else if (ph.to && now > ph.to) {
        state = 'closed';
        badge = 'beendet';
      } else if (ph.to) badge = `bis ${fmtDay(ph.to)}`;
    }
    return { key, title, icon, state, badge, help: help(key, s, single) };
  });
}

/**
 * Die Phase, an der gerade gearbeitet wird: die erste freigegebene, deren Oberfläche es gibt und die noch nicht
 * erledigt ist (Gruppe gefunden, Gliederung übernommen, alle eigenen Abschnitte fertig). Sonst die letzte offene.
 */
export function currentPhase(list: PhaseInfo[], done: Partial<Record<PhaseKey, boolean>> = {}): PhaseKey | null {
  // Die Themen-Mindmap ist ein Vorlauf und bleibt offen; als „aktuelle“ Phase gilt sie nur, wenn sonst nichts offen ist
  const open = list.filter((p) => p.state === 'open' && phasePath(p.key) && p.key !== 'topic');
  if (!open.length) return list.find((p) => p.key === 'topic' && p.state === 'open') ? 'topic' : null;
  return open.find((p) => !done[p.key])?.key ?? open[open.length - 1]?.key ?? null;
}

export interface DocSummary {
  outlineAt: number | null;
  docs: { ownerId: number | null; doneAt: number | null }[];
}

/** Erledigt-Zeichen je Phase aus Projekt und Abschnitten. */
export function phaseDone(p: ProjectView, meId: number, docs: DocSummary | null): Partial<Record<PhaseKey, boolean>> {
  const teacher = p.role === 'teacher';
  const mine = (docs?.docs ?? []).filter((d) => teacher || d.ownerId === meId || d.ownerId === null);
  return {
    groups: p.mode === 'single' || (teacher ? p.board.members.length > 0 && p.board.members.every((m) => m.groupId !== null) : p.myGroupId !== null),
    orientation: !!docs?.outlineAt,
    drafting: mine.length > 0 && mine.every((d) => d.doneAt),
  };
}

export type Office = 'word' | 'slide' | 'cell';

export interface TileDef {
  key: string;
  phase: PhaseKey | null;
  title: string;
  icon: string;
  office?: Office;
  /** Pfad mit Platzhalter {id}; fehlt er, ist die Oberfläche noch nicht gebaut */
  path?: string;
  /** nur zeigen, wenn diese Dokumentart in den Einstellungen erlaubt ist */
  docType?: string;
  sub: string;
}

export const TILES: TileDef[] = [
  { key: 'material', phase: null, title: 'Material', icon: 'info', path: '/projekt/material/?id={id}', sub: 'Zum Einarbeiten: Texte, Videos, Webseiten' },
  { key: 'chat', phase: null, title: 'Chat', icon: 'chat', path: '/projekt/chat/?id={id}', sub: 'Mit der Gruppe und mit allen schreiben' },
  { key: 'topic', phase: 'topic', title: 'Themen-Mindmap', icon: 'map', path: '/projekt/mindmap/?id={id}&bereich=p', sub: 'Das Thema gemeinsam umreißen' },
  { key: 'groups', phase: 'groups', title: 'Gruppen', icon: 'users', path: '/projekt/gruppen/?id={id}', sub: 'Board der Gruppenbildung' },
  { key: 'map', phase: 'orientation', title: 'Mindmap', icon: 'map', path: '/projekt/mindmap/?id={id}', sub: 'Ideen sammeln und ordnen' },
  { key: 'outline', phase: 'orientation', title: 'Gliederung', icon: 'outline', path: '/projekt/mindmap/?id={id}&gliederung=1', sub: 'Abschnitte aus den Clustern' },
  { key: 'notes', phase: 'research', title: 'Notizen und Quellen', icon: 'notes', path: '/projekt/notizen/?id={id}', sub: 'Absprachen, Fragen, Literatur und Fundstellen der Gruppe' },
  { key: 'pastes', phase: 'research', title: 'Quellen', icon: 'notes', path: '/projekt/einfuegen/?id={id}', sub: 'Woher eingesetzte Texte von außen stammen' },
  { key: 'sections', phase: 'drafting', title: 'Textabschnitte', icon: 'doc', office: 'word', docType: 'section', path: '/projekt/ausarbeitung/?id={id}', sub: 'Texteditor je Abschnitt' },
  { key: 'pinnwand', phase: 'presentation', title: 'Pinnwand-Präsentation', icon: 'present', path: '/projekt/pinnwand/?id={id}', sub: 'Bilder, Texte und Roter Faden, gezoomt wie Prezi' },
  { key: 'slides', phase: 'presentation', title: 'Folien-Präsentation', icon: 'slides', office: 'slide', docType: 'slides', path: '/projekt/folien/?id={id}', sub: 'Klassisch Folie für Folie, wie PowerPoint' },
  { key: 'brochure', phase: 'presentation', title: 'Broschüre', icon: 'doc', office: 'word', docType: 'brochure', sub: 'Gemeinsames Heft aller Gruppen' },
  { key: 'handout', phase: 'presentation', title: 'Handout', icon: 'doc', office: 'word', docType: 'handout', sub: 'Zusammenfassung für die Klasse' },
  { key: 'sheet', phase: 'research', title: 'Tabelle', icon: 'grid', office: 'cell', docType: 'sheet', sub: 'Daten auswerten' },
];

export const OFFICE_VAR: Record<Office, string> = { word: 'var(--office-word)', slide: 'var(--office-slide)', cell: 'var(--office-cell)' };

/** Hauptoberfläche einer Phase (Link im Seitenmenü). */
export function phasePath(key: PhaseKey): string | null {
  return TILES.find((t) => t.phase === key && t.path)?.path ?? null;
}
