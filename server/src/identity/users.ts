import type { Db } from '../db/index.js';

export type Role = 'admin' | 'teacher' | 'student';

export interface User {
  id: number;
  issuer: string;
  subject: string;
  name: string;
}

/** Personen und Rollen je Kontext (Schule › Kurs). Projekte hängen an einem Kurs-Kontext. */
export class Users {
  constructor(private db: Db, private now: () => number = Date.now) {}

  async upsert(issuer: string, subject: string, name: string, email: string | null = null): Promise<User> {
    const existing = await this.db.selectFrom('users').selectAll().where('issuer', '=', issuer).where('subject', '=', subject).executeTakeFirst();
    if (existing) {
      if (name && existing.name !== name) await this.db.updateTable('users').set({ name }).where('id', '=', existing.id).execute();
      return { id: existing.id, issuer, subject, name: name || existing.name };
    }
    const res = await this.db.insertInto('users').values({ issuer, subject, name, email, created_at: this.now() }).executeTakeFirstOrThrow();
    return { id: Number(res.insertId), issuer, subject, name };
  }

  async byId(id: number): Promise<User | undefined> {
    return this.db.selectFrom('users').select(['id', 'issuer', 'subject', 'name']).where('id', '=', id).executeTakeFirst();
  }

  async grant(userId: number, contextId: number, role: Role): Promise<void> {
    const has = await this.db.selectFrom('memberships').select('role').where('user_id', '=', userId).where('context_id', '=', contextId).where('role', '=', role).executeTakeFirst();
    if (!has) await this.db.insertInto('memberships').values({ user_id: userId, context_id: contextId, role, created_at: this.now() }).execute();
  }

  async revoke(userId: number, contextId: number, role: Role): Promise<void> {
    await this.db.deleteFrom('memberships').where('user_id', '=', userId).where('context_id', '=', contextId).where('role', '=', role).execute();
  }

  /** Rollen einer Person in einem Kontext, einschließlich der übergeordneten Kontexte. */
  async rolesIn(userId: number, contextId: number): Promise<Set<Role>> {
    const roles = new Set<Role>();
    let current: number | null = contextId;
    const seen = new Set<number>();
    while (current !== null && !seen.has(current)) {
      seen.add(current);
      const rows = await this.db.selectFrom('memberships').select('role').where('user_id', '=', userId).where('context_id', '=', current).execute();
      rows.forEach((r) => roles.add(r.role));
      const ctx: { parent_id: number | null } | undefined = await this.db.selectFrom('contexts').select('parent_id').where('id', '=', current).executeTakeFirst();
      current = ctx?.parent_id ?? null;
    }
    return roles;
  }

  async isSystemAdmin(userId: number): Promise<boolean> {
    const sys = await this.db.selectFrom('contexts').select('id').where('kind', '=', 'system').executeTakeFirst();
    if (!sys) return false;
    return (await this.rolesIn(userId, sys.id)).has('admin');
  }
}
