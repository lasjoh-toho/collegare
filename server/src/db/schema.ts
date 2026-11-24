import type { Generated } from 'kysely';

/** Zeitstempel werden als Millisekunden (Zahl) gespeichert, damit SQLite und MariaDB gleich funktionieren. */
type Ms = number;

export interface ContextsTable {
  id: Generated<number>;
  /** werkstatt: eigener Kontext einer Lehrkraft für ihre Werkstatt (ohne Elternkontext, auch die Administration sieht ihn nicht) */
  kind: 'system' | 'school' | 'course' | 'werkstatt';
  parent_id: number | null;
  title: string;
  lti_platform_id: number | null;
  lti_context_id: string | null;
  nrps_url: string | null;
  created_at: Ms;
}

export interface UsersTable {
  id: Generated<number>;
  issuer: string;
  subject: string;
  name: string;
  email: string | null;
  created_at: Ms;
}

export interface MembershipsTable {
  user_id: number;
  context_id: number;
  role: 'admin' | 'teacher' | 'student';
  created_at: Ms;
}

export interface LocalAccountsTable {
  user_id: number;
  login: string;
  password_hash: string;
  failed_count: number;
  created_at: Ms;
}

export interface SessionsTable {
  token_hash: string;
  user_id: number;
  /** Sitzung gilt nur für ein Projekt (Zugang per QR/Code) oder überall (null). */
  project_id: number | null;
  impersonator_id: number | null;
  expires_at: Ms;
  created_at: Ms;
}

export interface AccessCodesTable {
  id: Generated<number>;
  project_id: number;
  user_id: number;
  secret_hash: string;
  code_hash: string;
  expires_at: Ms;
  revoked_at: Ms | null;
  redeem_count: number;
  /** 1: Ende folgt den Freigaben der Phasen, beim Speichern der Einstellungen neu gesetzt */
  follow_release: Generated<number>;
  created_by: number;
  created_at: Ms;
}

export interface LtiPlatformsTable {
  id: Generated<number>;
  issuer: string;
  client_id: string;
  deployment_id: string;
  auth_url: string;
  jwks_url: string;
  token_url: string | null;
  title: string;
  created_at: Ms;
}

export interface LtiStatesTable {
  state: string;
  nonce: string;
  platform_id: number;
  expires_at: Ms;
}

export interface LtiNoncesTable {
  nonce: string;
  expires_at: Ms;
}

export interface LtiLinksTable {
  id: Generated<number>;
  platform_id: number;
  resource_link_id: string;
  context_id: number;
  project_id: number | null;
  title: string | null;
  ags_lineitem_url: string | null;
  created_at: Ms;
}

export interface ProjectsTable {
  id: Generated<number>;
  context_id: number;
  title: string;
  mode: 'group' | 'single';
  /** werkstatt = Werkzeuge und Materialien einer Lehrkraft, erscheint in keiner Projektliste */
  kind: Generated<'project' | 'werkstatt'>;
  settings: string;
  created_by: number;
  created_at: Ms;
  archived_at: Ms | null;
}

export interface GroupsTable {
  id: Generated<number>;
  project_id: number;
  title: string;
  position: number;
  color: string | null;
  created_at: Ms;
}

export interface GroupMembersTable {
  project_id: number;
  user_id: number;
  /** null = noch ohne Gruppe (Säule „Noch ohne Gruppe“) */
  group_id: number | null;
  role_label: string | null;
  position: number;
  created_at: Ms;
}

export interface YdocsTable {
  name: string;
  state: Uint8Array;
  updated_at: Ms;
}

export interface MapsTable {
  project_id: number;
  /** g<Gruppen-ID> oder u<Personen-ID> (Einzelprojekt) */
  scope: string;
  data: string;
  version: number;
  updated_at: Ms;
}

export interface DocumentsTable {
  id: Generated<number>;
  project_id: number;
  scope: string;
  /** Cluster der Gliederung, aus dem der Abschnitt stammt */
  section_id: string;
  section_title: string;
  card_id: string | null;
  kind: 'word' | 'slide' | 'cell';
  title: string;
  owner_id: number | null;
  position: number;
  done_at: Ms | null;
  done_by: number | null;
  created_at: Ms;
  /** Text aus dem eigenen Schreibeditor (Markdown wie lib/tufte.ts im Client); null = noch nie geschrieben */
  body: string | null;
  /** zählt jedes Speichern; wer mit altem Stand speichert, bekommt 409 */
  rev: Generated<number>;
  text_at: Ms | null;
  text_by: number | null;
  /** Linie der Gliederung, aus der der Abschnitt stammt: ausarb (führende Linie) oder praes */
  line: Generated<string>;
}

/** Frühere Fassungen eines Abschnitts (Schnappschüsse beim Schreiben, vor dem Wiederherstellen) */
export interface DocRevisionsTable {
  id: Generated<number>;
  doc_id: number;
  rev: number;
  body: string;
  at: Ms;
  by: number | null;
  reason: string;
}

/** Notiz in einen Abschnitt der Ausarbeitung gezogen (Text ausgepackt); snippet = Anfang des eingesetzten Textes */
export interface NoteUsesTable {
  id: Generated<number>;
  doc_id: number;
  note_id: number;
  snippet: string;
  at: Ms;
  by: number | null;
}

/** Kommentar der Lehrkraft an einem Abschnitt der Ausarbeitung (Post-it) */
export interface DocCommentsTable {
  id: Generated<number>;
  doc_id: number;
  by: number;
  body: string;
  at: Ms;
  done_at: Ms | null;
}

/** Folien: Freigabe und Sperre je Präsentation (fehlt eine Zeile: nicht freigegeben, nicht gesperrt) */
export interface DeckAccessTable {
  doc_id: number;
  shared: number;
  locked_by: number | null;
  locked_at: Ms | null;
}

export interface BentoDecksTable {
  doc_id: number;
  data: string;
  version: number;
  updated_at: Ms;
  updated_by: number | null;
}

export interface DocChangesTable {
  doc_id: string;
  seq: number;
  user_id: string;
  time: Ms;
  /** eine Änderung des Editors, JSON-kodiert wie im Protokoll */
  data: string;
}

export interface AuditLogTable {
  id: Generated<number>;
  time: Ms;
  actor_id: number | null;
  action: string;
  context_id: number | null;
  project_id: number | null;
  data: string;
  prev_hash: string;
  hash: string;
}

/** Bewertung je Person und Projekt (Korrektur wie in Autogra.fi; Noten bleiben je Person, gestaltung.md 4). */
export interface GradingsTable {
  project_id: number;
  user_id: number;
  /** Notenpunkte 0–15, null = noch keine Note */
  points: number | null;
  /** Rückmeldung an die Person (HTML wie im Autogra.fi-Editor, „Ausblenden“ als Kommentar) */
  feedback: string;
  /** Notizen der Lehrkraft, nie für Lernende */
  notes: string;
  final_at: Ms | null;
  graded_by: number;
  updated_at: Ms;
}

/** Einführendes Material: eigene Lernseite (page), Webseite (link), Video (video, Link oder Datei), Datei (file: PDF, Dokument, Bild). */
export interface MaterialsTable {
  id: Generated<number>;
  project_id: number;
  kind: 'link' | 'video' | 'file' | 'page' | 'blatt';
  title: string;
  url: string | null;
  /** Lernseite: Markdown mit Randnotizen (^[…], ^^[…]); Arbeitsblatt: JSON im Format „ag-blatt/1“ */
  body: string | null;
  note: string;
  file_name: string | null;
  mime: string | null;
  size: number | null;
  data: Buffer | null;
  position: number;
  /** 1 = Lernende sehen es, 0 = nur Lehrkräfte (in Vorbereitung) */
  visible: Generated<number>;
  /** Schlagworte, durch Komma getrennt */
  tags: Generated<string>;
  /** Für wen: null = alle Lernenden des Projekts, sonst JSON {"groups":[…],"users":[…]} */
  audience: string | null;
  /** Herkunft: Material aus den „Materialien“ der Lehrkraft, aus dem dieses kopiert wurde */
  source_id: number | null;
  created_by: number;
  created_at: Ms;
}

/** Chat: scope 'p' = alle im Projekt, 'g<id>' = eine Gruppe */
export interface ChatMessagesTable {
  id: Generated<number>;
  project_id: number;
  scope: string;
  user_id: number;
  body: string;
  created_at: Ms;
  /** Bild der Nachricht (Bild aufnehmen), relativ zum Chat-Ordner */
  file_path: string | null;
}

/**
 * Pinnwand als Modul (Konzept 8d.5): die Tabellen von mod_pinnwand (photos, threads, thread_items, board_ink,
 * board_names, object_placements, prefs) als JSON-Zeilen je Bereich (Gruppe bzw. Person im Einzelmodus).
 */
export interface PinnwandRowsTable {
  id: Generated<number>;
  project_id: number;
  scope: string;
  tbl: string;
  data: string;
}

/** Dateien der Pinnwand (Moodle-Dateibereiche photo, photoorig, photomask, background, backgroundpdf, slidemedia) */
export interface PinnwandFilesTable {
  id: Generated<number>;
  project_id: number;
  scope: string;
  area: string;
  item_id: number;
  name: string;
  mime: string;
  /** nur noch für den Umzug älterer Installationen; neue Dateien liegen im Ordner (path), data ist dann leer */
  data: Buffer;
  /** relativ zu <DATA_DIR>/pinnwand, null = noch als Blob in data */
  path: string | null;
  size: number | null;
  created_at: Ms;
}

/** Notizen und Quellen (Recherche-Karten) je Gruppe bzw. Person im Einzelmodus */
export interface NotesTable {
  id: Generated<number>;
  project_id: number;
  scope: string;
  user_id: number;
  kind: string;
  title: string;
  body: string;
  /** Fundstelle einer Quelle (Autor, Titel, Seite …) */
  source: string;
  url: string | null;
  /** Urheber, Lizenz, Ursprungsseite (Bilder aus dem Netz) */
  credit: Generated<string>;
  license: Generated<string>;
  origin: string | null;
  /** angehängte Datei unter DATA_DIR/notizen (relativ), Typ und Größe */
  file_path: string | null;
  file_mime: string | null;
  file_size: number | null;
  /** private = nur Erstellerin (und Lehrkraft), group = eigene Gruppe, all = ganzes Projekt (Konzept 8e.2) */
  visibility: Generated<string>;
  /** Art „data“: {rows: string[][]}, erste Zeile = Kopfzeile */
  data_json: string | null;
  created_at: Ms;
  updated_at: Ms;
}

/** Gemeldete Notizen (Konzept 8e.4): sichtbar nur noch für Lehrkraft, Erstellerin und Meldende */
export interface NoteReportsTable {
  id: Generated<number>;
  note_id: number;
  user_id: number;
  reason: string;
  created_at: Ms;
}

/** Einfüge-Protokoll (Konzept 6.1, 8d.3): Einsetzen von außen ab der Schwelle, mit Antwort auf „Woher?“ */
export interface PastesTable {
  id: Generated<number>;
  project_id: number;
  scope: string;
  user_id: number;
  /** wohin eingesetzt wurde, z. B. Karte „Inflation“ */
  place: string;
  chars: number;
  /** Anfang des Texts und Prüfsumme, nicht der ganze Text */
  sample: string;
  hash: string;
  /** quote, draft, ai, other; null = noch offen („später“) */
  answer: string | null;
  note: string;
  created_at: Ms;
  answered_at: Ms | null;
  /** ganzer Text (für die Spur im Text), seit 0018 */
  full_text: string | null;
  /** Ziel: card:<id> oder note:<id>; leer bei älteren Einträgen */
  target: Generated<string>;
  /** paste: eingefügt; print/hand: per Texterkennung aus Druckschrift bzw. Handschrift */
  origin: Generated<string>;
  /** Notiz mit dem Bild (Texterkennung) */
  note_id: number | null;
}

/** Eigene Linie (Konzept 8e.7): Stationen mit Notiz, Abschnitt der Gliederung und angehängten Karten, als JSON */
export interface NoteLinesTable {
  id: Generated<number>;
  project_id: number;
  scope: string;
  user_id: number;
  data: string;
  updated_at: Ms;
}

export interface KeyValueTable {
  k: string;
  v: string;
}

export interface Database {
  contexts: ContextsTable;
  users: UsersTable;
  memberships: MembershipsTable;
  local_accounts: LocalAccountsTable;
  sessions: SessionsTable;
  access_codes: AccessCodesTable;
  lti_platforms: LtiPlatformsTable;
  lti_states: LtiStatesTable;
  lti_nonces: LtiNoncesTable;
  lti_links: LtiLinksTable;
  projects: ProjectsTable;
  groups: GroupsTable;
  group_members: GroupMembersTable;
  maps: MapsTable;
  documents: DocumentsTable;
  doc_changes: DocChangesTable;
  doc_revisions: DocRevisionsTable;
  note_uses: NoteUsesTable;
  doc_comments: DocCommentsTable;
  bento_decks: BentoDecksTable;
  deck_access: DeckAccessTable;
  ydocs: YdocsTable;
  audit_log: AuditLogTable;
  gradings: GradingsTable;
  materials: MaterialsTable;
  chat_messages: ChatMessagesTable;
  notes: NotesTable;
  note_reports: NoteReportsTable;
  note_lines: NoteLinesTable;
  pinnwand_rows: PinnwandRowsTable;
  pinnwand_files: PinnwandFilesTable;
  pastes: PastesTable;
  kv: KeyValueTable;
}
