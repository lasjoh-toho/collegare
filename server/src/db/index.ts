import { Kysely, MysqlDialect, SqliteDialect } from 'kysely';
import { createPool } from 'mysql2';
import type { Database } from './schema.js';

export type Db = Kysely<Database>;

/**
 * DATABASE_URL: mysql://user:pass@host:3306/collegare (Betrieb, MariaDB) oder sqlite:pfad bzw. sqlite::memory: (Tests).
 */
export async function createDb(url: string): Promise<Db> {
  if (url.startsWith('sqlite:')) {
    // SQLite nur für Entwicklung und Tests; im Release-Paket fehlt das native Modul absichtlich
    const { default: SQLite } = await import('better-sqlite3').catch(() => {
      throw new Error('SQLite ist in diesem Paket nicht enthalten. Bitte DATABASE_URL=mysql://… (MariaDB) setzen.');
    });
    const file = url.slice('sqlite:'.length) || ':memory:';
    const sqlite = new SQLite(file);
    sqlite.pragma('journal_mode = WAL');
    sqlite.pragma('foreign_keys = ON');
    return new Kysely<Database>({ dialect: new SqliteDialect({ database: sqlite }) });
  }
  if (url.startsWith('mysql:') || url.startsWith('mariadb:')) {
    const u = new URL(url.replace(/^mariadb:/, 'mysql:'));
    const pool = createPool({
      host: u.hostname,
      port: Number(u.port || 3306),
      user: decodeURIComponent(u.username),
      password: decodeURIComponent(u.password),
      database: u.pathname.replace(/^\//, ''),
      connectionLimit: 10,
      charset: 'utf8mb4',
      // BIGINT-Zeitstempel als Zahl, nicht als Zeichenkette
      supportBigNumbers: true,
      bigNumberStrings: false,
      timezone: 'Z',
    });
    return new Kysely<Database>({ dialect: new MysqlDialect({ pool }) });
  }
  throw new Error('DATABASE_URL muss mit sqlite: oder mysql: beginnen');
}
