import type { Db } from '../db/index.js';
import { hashPassword, verifyPassword } from '../security/crypto.js';
import type { Users } from './users.js';

export const LOCAL_ISSUER = 'collegare:lokal';

/** Lokale Konten für Lehrkräfte und Administration im Einzelbetrieb (wie das Autogra.fi-Portal). */
export class LocalAccounts {
  constructor(private db: Db, private users: Users, private now: () => number = Date.now) {}

  async create(login: string, name: string, password: string): Promise<number> {
    login = login.trim().toLowerCase();
    if (!/^[a-z0-9._-]{2,100}$/.test(login)) throw new AccountError('Kürzel: 2–100 Zeichen, nur a–z, 0–9, Punkt, Strich');
    if (password.length < 8) throw new AccountError('Passwort: mindestens 8 Zeichen');
    const taken = await this.db.selectFrom('local_accounts').select('user_id').where('login', '=', login).executeTakeFirst();
    if (taken) throw new AccountError('Kürzel ist schon vergeben');
    const user = await this.users.upsert(LOCAL_ISSUER, login, name);
    await this.db.insertInto('local_accounts').values({ user_id: user.id, login, password_hash: await hashPassword(password), failed_count: 0, created_at: this.now() }).execute();
    return user.id;
  }

  async verify(login: string, password: string): Promise<number | null> {
    const row = await this.db.selectFrom('local_accounts').selectAll().where('login', '=', login.trim().toLowerCase()).executeTakeFirst();
    if (!row) {
      await hashPassword(password); // gleiche Laufzeit wie bei vorhandenem Konto
      return null;
    }
    const ok = await verifyPassword(password, row.password_hash);
    await this.db.updateTable('local_accounts').set({ failed_count: ok ? 0 : row.failed_count + 1 }).where('user_id', '=', row.user_id).execute();
    return ok ? row.user_id : null;
  }

  async setPassword(userId: number, password: string): Promise<void> {
    if (password.length < 8) throw new AccountError('Passwort: mindestens 8 Zeichen');
    await this.db.updateTable('local_accounts').set({ password_hash: await hashPassword(password), failed_count: 0 }).where('user_id', '=', userId).execute();
  }

  async list() {
    return this.db
      .selectFrom('local_accounts')
      .innerJoin('users', 'users.id', 'local_accounts.user_id')
      .select(['users.id', 'users.name', 'local_accounts.login', 'local_accounts.created_at'])
      .orderBy('users.name')
      .execute();
  }
}

export class AccountError extends Error {}
