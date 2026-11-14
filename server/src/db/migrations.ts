import { type Kysely, sql } from 'kysely';
import { type Migration, type MigrationProvider, Migrator } from 'kysely/migration';

/**
 * Migrationen im Code (kein Dateisystem-Scan), damit das Release-Paket nichts nachladen muss.
 * Typen so gewählt, dass SQLite (Tests) und MariaDB (Betrieb) dasselbe Schema bekommen.
 */
function blobType(db: Kysely<any>) {
  return isMysql(db) ? sql`longblob` : sql`blob`;
}

export function isMysql(db: Kysely<any>): boolean {
  const name = (db.getExecutor().adapter.constructor?.name ?? '').toLowerCase();
  return name.includes('mysql');
}

const ms = 'bigint' as const;

const migrations: Record<string, Migration> = {
  '0001_grundlage': {
    async up(db) {
      await db.schema
        .createTable('contexts')
        .addColumn('id', 'integer', (c) => c.primaryKey().autoIncrement())
        .addColumn('kind', 'varchar(16)', (c) => c.notNull())
        .addColumn('parent_id', 'integer')
        .addColumn('title', 'varchar(255)', (c) => c.notNull())
        .addColumn('lti_platform_id', 'integer')
        .addColumn('lti_context_id', 'varchar(255)')
        .addColumn('nrps_url', 'varchar(1024)')
        .addColumn('created_at', ms, (c) => c.notNull())
        .execute();
      await db.schema.createIndex('contexts_lti').on('contexts').columns(['lti_platform_id', 'lti_context_id']).unique().execute();

      await db.schema
        .createTable('users')
        .addColumn('id', 'integer', (c) => c.primaryKey().autoIncrement())
        .addColumn('issuer', 'varchar(255)', (c) => c.notNull())
        .addColumn('subject', 'varchar(255)', (c) => c.notNull())
        .addColumn('name', 'varchar(255)', (c) => c.notNull())
        .addColumn('email', 'varchar(255)')
        .addColumn('created_at', ms, (c) => c.notNull())
        .execute();
      await db.schema.createIndex('users_identity').on('users').columns(['issuer', 'subject']).unique().execute();

      await db.schema
        .createTable('memberships')
        .addColumn('user_id', 'integer', (c) => c.notNull())
        .addColumn('context_id', 'integer', (c) => c.notNull())
        .addColumn('role', 'varchar(16)', (c) => c.notNull())
        .addColumn('created_at', ms, (c) => c.notNull())
        .addPrimaryKeyConstraint('memberships_pk', ['user_id', 'context_id', 'role'])
        .execute();

      await db.schema
        .createTable('local_accounts')
        .addColumn('user_id', 'integer', (c) => c.primaryKey())
        .addColumn('login', 'varchar(100)', (c) => c.notNull().unique())
        .addColumn('password_hash', 'varchar(255)', (c) => c.notNull())
        .addColumn('failed_count', 'integer', (c) => c.notNull().defaultTo(0))
        .addColumn('created_at', ms, (c) => c.notNull())
        .execute();

      await db.schema
        .createTable('sessions')
        .addColumn('token_hash', 'varchar(64)', (c) => c.primaryKey())
        .addColumn('user_id', 'integer', (c) => c.notNull())
        .addColumn('project_id', 'integer')
        .addColumn('impersonator_id', 'integer')
        .addColumn('expires_at', ms, (c) => c.notNull())
        .addColumn('created_at', ms, (c) => c.notNull())
        .execute();

      await db.schema
        .createTable('access_codes')
        .addColumn('id', 'integer', (c) => c.primaryKey().autoIncrement())
        .addColumn('project_id', 'integer', (c) => c.notNull())
        .addColumn('user_id', 'integer', (c) => c.notNull())
        .addColumn('secret_hash', 'varchar(64)', (c) => c.notNull().unique())
        .addColumn('code_hash', 'varchar(64)', (c) => c.notNull())
        .addColumn('expires_at', ms, (c) => c.notNull())
        .addColumn('revoked_at', ms)
        .addColumn('redeem_count', 'integer', (c) => c.notNull().defaultTo(0))
        .addColumn('created_by', 'integer', (c) => c.notNull())
        .addColumn('created_at', ms, (c) => c.notNull())
        .execute();
      await db.schema.createIndex('access_codes_code').on('access_codes').column('code_hash').execute();

      await db.schema
        .createTable('lti_platforms')
        .addColumn('id', 'integer', (c) => c.primaryKey().autoIncrement())
        .addColumn('issuer', 'varchar(255)', (c) => c.notNull())
        .addColumn('client_id', 'varchar(255)', (c) => c.notNull())
        .addColumn('deployment_id', 'varchar(255)', (c) => c.notNull())
        .addColumn('auth_url', 'varchar(1024)', (c) => c.notNull())
        .addColumn('jwks_url', 'varchar(1024)', (c) => c.notNull())
        .addColumn('token_url', 'varchar(1024)')
        .addColumn('title', 'varchar(255)', (c) => c.notNull())
        .addColumn('created_at', ms, (c) => c.notNull())
        .execute();
      await db.schema.createIndex('lti_platforms_client').on('lti_platforms').columns(['issuer', 'client_id', 'deployment_id']).unique().execute();

      await db.schema
        .createTable('lti_states')
        .addColumn('state', 'varchar(64)', (c) => c.primaryKey())
        .addColumn('nonce', 'varchar(64)', (c) => c.notNull())
        .addColumn('platform_id', 'integer', (c) => c.notNull())
        .addColumn('expires_at', ms, (c) => c.notNull())
        .execute();
      await db.schema
        .createTable('lti_nonces')
        .addColumn('nonce', 'varchar(255)', (c) => c.primaryKey())
        .addColumn('expires_at', ms, (c) => c.notNull())
        .execute();

      await db.schema
        .createTable('lti_links')
        .addColumn('id', 'integer', (c) => c.primaryKey().autoIncrement())
        .addColumn('platform_id', 'integer', (c) => c.notNull())
        .addColumn('resource_link_id', 'varchar(255)', (c) => c.notNull())
        .addColumn('context_id', 'integer', (c) => c.notNull())
        .addColumn('project_id', 'integer')
        .addColumn('title', 'varchar(255)')
        .addColumn('ags_lineitem_url', 'varchar(1024)')
        .addColumn('created_at', ms, (c) => c.notNull())
        .execute();
      await db.schema.createIndex('lti_links_rl').on('lti_links').columns(['platform_id', 'resource_link_id']).unique().execute();

      await db.schema
        .createTable('projects')
        .addColumn('id', 'integer', (c) => c.primaryKey().autoIncrement())
        .addColumn('context_id', 'integer', (c) => c.notNull())
        .addColumn('title', 'varchar(255)', (c) => c.notNull())
        .addColumn('mode', 'varchar(16)', (c) => c.notNull())
        .addColumn('settings', 'text', (c) => c.notNull())
        .addColumn('created_by', 'integer', (c) => c.notNull())
        .addColumn('created_at', ms, (c) => c.notNull())
        .addColumn('archived_at', ms)
        .execute();

      await db.schema
        .createTable('groups')
        .addColumn('id', 'integer', (c) => c.primaryKey().autoIncrement())
        .addColumn('project_id', 'integer', (c) => c.notNull())
        .addColumn('title', 'varchar(255)', (c) => c.notNull())
        .addColumn('position', 'integer', (c) => c.notNull())
        .addColumn('color', 'varchar(32)')
        .addColumn('created_at', ms, (c) => c.notNull())
        .execute();

      await db.schema
        .createTable('group_members')
        .addColumn('project_id', 'integer', (c) => c.notNull())
        .addColumn('user_id', 'integer', (c) => c.notNull())
        .addColumn('group_id', 'integer')
        .addColumn('role_label', 'varchar(100)')
        .addColumn('position', 'integer', (c) => c.notNull())
        .addColumn('created_at', ms, (c) => c.notNull())
        .addPrimaryKeyConstraint('group_members_pk', ['project_id', 'user_id'])
        .execute();

      await db.schema
        .createTable('ydocs')
        .addColumn('name', 'varchar(191)', (c) => c.primaryKey())
        .addColumn('state', blobType(db), (c) => c.notNull())
        .addColumn('updated_at', ms, (c) => c.notNull())
        .execute();

      await db.schema
        .createTable('audit_log')
        .addColumn('id', 'integer', (c) => c.primaryKey().autoIncrement())
        .addColumn('time', ms, (c) => c.notNull())
        .addColumn('actor_id', 'integer')
        .addColumn('action', 'varchar(100)', (c) => c.notNull())
        .addColumn('context_id', 'integer')
        .addColumn('project_id', 'integer')
        .addColumn('data', 'text', (c) => c.notNull())
        .addColumn('prev_hash', 'varchar(64)', (c) => c.notNull())
        .addColumn('hash', 'varchar(64)', (c) => c.notNull())
        .execute();

      await db.schema
        .createTable('kv')
        .addColumn('k', 'varchar(100)', (c) => c.primaryKey())
        .addColumn('v', 'text', (c) => c.notNull())
        .execute();
    },
  },
};

// Mindmap je Gruppe (oder je Person im Einzelprojekt), als JSON mit Versionszähler
migrations['0002_mindmap'] = {
  async up(db) {
    await db.schema
      .createTable('maps')
      .addColumn('project_id', 'integer', (c) => c.notNull())
      .addColumn('scope', 'varchar(32)', (c) => c.notNull())
      .addColumn('data', isMysql(db) ? sql`longtext` : 'text', (c) => c.notNull())
      .addColumn('version', 'integer', (c) => c.notNull())
      .addColumn('updated_at', ms, (c) => c.notNull())
      .addPrimaryKeyConstraint('maps_pk', ['project_id', 'scope'])
      .execute();
  },
};

// Dokumente der Ausarbeitung (eines je Karte der Gliederung) und ihre Änderungen aus dem Editor
migrations['0003_dokumente'] = {
  async up(db) {
    const long = isMysql(db) ? sql`longtext` : sql`text`;
    await db.schema
      .createTable('documents')
      .addColumn('id', 'integer', (c) => c.primaryKey().autoIncrement())
      .addColumn('project_id', 'integer', (c) => c.notNull())
      .addColumn('scope', 'varchar(32)', (c) => c.notNull())
      .addColumn('section_id', 'varchar(40)', (c) => c.notNull())
      .addColumn('section_title', 'varchar(255)', (c) => c.notNull())
      .addColumn('card_id', 'varchar(40)')
      .addColumn('kind', 'varchar(8)', (c) => c.notNull())
      .addColumn('title', 'varchar(255)', (c) => c.notNull())
      .addColumn('owner_id', 'integer')
      .addColumn('position', 'integer', (c) => c.notNull())
      .addColumn('done_at', ms)
      .addColumn('done_by', 'integer')
      .addColumn('created_at', ms, (c) => c.notNull())
      .execute();
    await db.schema.createIndex('documents_scope').on('documents').columns(['project_id', 'scope']).execute();
    await db.schema
      .createTable('doc_changes')
      .addColumn('doc_id', 'varchar(64)', (c) => c.notNull())
      .addColumn('seq', 'integer', (c) => c.notNull())
      .addColumn('user_id', 'varchar(64)', (c) => c.notNull())
      .addColumn('time', ms, (c) => c.notNull())
      .addColumn('data', long, (c) => c.notNull())
      .addPrimaryKeyConstraint('doc_changes_pk', ['doc_id', 'seq'])
      .execute();
  },
};

// Korrektur: Bewertung je Person und Projekt
migrations['0004_bewertungen'] = {
  async up(db) {
    const long = isMysql(db) ? sql`longtext` : sql`text`;
    await db.schema
      .createTable('gradings')
      .addColumn('project_id', 'integer', (c) => c.notNull())
      .addColumn('user_id', 'integer', (c) => c.notNull())
      .addColumn('points', 'integer')
      .addColumn('feedback', long, (c) => c.notNull())
      .addColumn('notes', long, (c) => c.notNull())
      .addColumn('final_at', ms)
      .addColumn('graded_by', 'integer', (c) => c.notNull())
      .addColumn('updated_at', ms, (c) => c.notNull())
      .addPrimaryKeyConstraint('gradings_pk', ['project_id', 'user_id'])
      .execute();
  },
};

// Einführendes Material je Projekt: Links, Videos, Dateien (Wunsch Jo, 11. November 2026)
migrations['0005_material'] = {
  async up(db) {
    const long = isMysql(db) ? sql`longtext` : sql`text`;
    await db.schema
      .createTable('materials')
      .addColumn('id', 'integer', (c) => c.primaryKey().autoIncrement())
      .addColumn('project_id', 'integer', (c) => c.notNull())
      .addColumn('kind', 'varchar(10)', (c) => c.notNull())
      .addColumn('title', 'varchar(200)', (c) => c.notNull())
      .addColumn('url', 'varchar(2000)')
      .addColumn('note', long, (c) => c.notNull())
      .addColumn('file_name', 'varchar(255)')
      .addColumn('mime', 'varchar(120)')
      .addColumn('size', 'integer')
      .addColumn('data', blobType(db))
      .addColumn('position', 'integer', (c) => c.notNull())
      .addColumn('created_by', 'integer', (c) => c.notNull())
      .addColumn('created_at', ms, (c) => c.notNull())
      .execute();
    await db.schema.createIndex('materials_project').on('materials').column('project_id').execute();
  },
};

// Lernseite im Tufte-Stil: Text (Markdown mit Randnotizen) direkt am Material
migrations['0006_material_seite'] = {
  async up(db) {
    const long = isMysql(db) ? sql`longtext` : sql`text`;
    await db.schema.alterTable('materials').addColumn('body', long).execute();
  },
};

// Chat je Gruppe und für das ganze Projekt (Wunsch Jo, 11. November 2026)
migrations['0007_chat'] = {
  async up(db) {
    const long = isMysql(db) ? sql`text` : sql`text`;
    await db.schema
      .createTable('chat_messages')
      .addColumn('id', 'integer', (c) => c.primaryKey().autoIncrement())
      .addColumn('project_id', 'integer', (c) => c.notNull())
      .addColumn('scope', 'varchar(20)', (c) => c.notNull())
      .addColumn('user_id', 'integer', (c) => c.notNull())
      .addColumn('body', long, (c) => c.notNull())
      .addColumn('created_at', ms, (c) => c.notNull())
      .execute();
    await db.schema.createIndex('chat_project_scope').on('chat_messages').columns(['project_id', 'scope', 'id']).execute();
  },
};

// Notizen und Quellen je Gruppe: Recherche-Karten im Seiten-Thread (Konzept 8d.2, Issue #8)
migrations['0008_notes'] = {
  async up(db) {
    await db.schema
      .createTable('notes')
      .addColumn('id', 'integer', (c) => c.primaryKey().autoIncrement())
      .addColumn('project_id', 'integer', (c) => c.notNull())
      .addColumn('scope', 'varchar(20)', (c) => c.notNull())
      .addColumn('user_id', 'integer', (c) => c.notNull())
      .addColumn('kind', 'varchar(10)', (c) => c.notNull())
      .addColumn('title', 'varchar(200)', (c) => c.notNull())
      .addColumn('body', sql`text`, (c) => c.notNull())
      .addColumn('source', 'varchar(500)', (c) => c.notNull())
      .addColumn('url', 'varchar(2000)')
      .addColumn('created_at', ms, (c) => c.notNull())
      .addColumn('updated_at', ms, (c) => c.notNull())
      .execute();
    await db.schema.createIndex('notes_project_scope').on('notes').columns(['project_id', 'scope', 'id']).execute();
  },
};

migrations['0009_pinnwand'] = {
  async up(db) {
    await db.schema
      .createTable('pinnwand_rows')
      .addColumn('id', 'integer', (c) => c.primaryKey().autoIncrement())
      .addColumn('project_id', 'integer', (c) => c.notNull())
      .addColumn('scope', 'varchar(20)', (c) => c.notNull())
      .addColumn('tbl', 'varchar(20)', (c) => c.notNull())
      .addColumn('data', isMysql(db) ? sql`mediumtext` : sql`text`, (c) => c.notNull())
      .execute();
    await db.schema.createIndex('pinnwand_rows_scope').on('pinnwand_rows').columns(['project_id', 'scope']).execute();
    await db.schema
      .createTable('pinnwand_files')
      .addColumn('id', 'integer', (c) => c.primaryKey().autoIncrement())
      .addColumn('project_id', 'integer', (c) => c.notNull())
      .addColumn('scope', 'varchar(20)', (c) => c.notNull())
      .addColumn('area', 'varchar(20)', (c) => c.notNull())
      .addColumn('item_id', 'integer', (c) => c.notNull())
      .addColumn('name', 'varchar(200)', (c) => c.notNull())
      .addColumn('mime', 'varchar(100)', (c) => c.notNull())
      .addColumn('data', blobType(db), (c) => c.notNull())
      .addColumn('created_at', ms, (c) => c.notNull())
      .execute();
    await db.schema.createIndex('pinnwand_files_item').on('pinnwand_files').columns(['project_id', 'scope', 'area', 'item_id']).execute();
  },
};

migrations['0010_pastes'] = {
  async up(db) {
    await db.schema
      .createTable('pastes')
      .addColumn('id', 'integer', (c) => c.primaryKey().autoIncrement())
      .addColumn('project_id', 'integer', (c) => c.notNull())
      .addColumn('scope', 'varchar(20)', (c) => c.notNull())
      .addColumn('user_id', 'integer', (c) => c.notNull())
      .addColumn('place', 'varchar(300)', (c) => c.notNull())
      .addColumn('chars', 'integer', (c) => c.notNull())
      .addColumn('sample', 'varchar(400)', (c) => c.notNull())
      .addColumn('hash', 'varchar(64)', (c) => c.notNull())
      .addColumn('answer', 'varchar(10)')
      .addColumn('note', 'varchar(1000)', (c) => c.notNull())
      .addColumn('created_at', ms, (c) => c.notNull())
      .addColumn('answered_at', ms)
      .execute();
    await db.schema.createIndex('pastes_project').on('pastes').columns(['project_id', 'scope', 'id']).execute();
  },
};

class InCodeProvider implements MigrationProvider {
  async getMigrations() {
    return migrations;
  }
}

export async function migrate(db: Kysely<any>): Promise<void> {
  const migrator = new Migrator({ db, provider: new InCodeProvider() });
  const { error, results } = await migrator.migrateToLatest();
  if (error) {
    const failed = results?.find((r) => r.status === 'Error');
    throw new Error(`Migration fehlgeschlagen${failed ? ' (' + failed.migrationName + ')' : ''}: ${String(error)}`);
  }
}
