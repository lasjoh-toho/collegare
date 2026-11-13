import type { Generated } from 'kysely';

/** Zeitstempel werden als Millisekunden (Zahl) gespeichert, damit SQLite und MariaDB gleich funktionieren. */
type Ms = number;

export interface ContextsTable {
  id: Generated<number>;
  kind: 'system' | 'school' | 'course';
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
  kind: 'link' | 'video' | 'file' | 'page';
  title: string;
  url: string | null;
  /** Lernseite: Markdown mit Randnotizen (^[…], ^^[…]) */
  body: string | null;
  note: string;
  file_name: string | null;
  mime: string | null;
  size: number | null;
  data: Buffer | null;
  position: number;
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
  data: Buffer;
  created_at: Ms;
}

/** Notizen und Quellen (Recherche-Karten) je Gruppe bzw. Person im Einzelmodus */
export interface NotesTable {
  id: Generated<number>;
  project_id: number;
  scope: string;
  user_id: number;
  kind: 'note' | 'source' | 'link';
  title: string;
  body: string;
  /** Fundstelle einer Quelle (Autor, Titel, Seite …) */
  source: string;
  url: string | null;
  created_at: Ms;
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
  ydocs: YdocsTable;
  audit_log: AuditLogTable;
  gradings: GradingsTable;
  materials: MaterialsTable;
  chat_messages: ChatMessagesTable;
  notes: NotesTable;
  pinnwand_rows: PinnwandRowsTable;
  pinnwand_files: PinnwandFilesTable;
  kv: KeyValueTable;
}
