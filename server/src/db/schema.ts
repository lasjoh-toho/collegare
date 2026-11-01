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
  ydocs: YdocsTable;
  audit_log: AuditLogTable;
  kv: KeyValueTable;
}
