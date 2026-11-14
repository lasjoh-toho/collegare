import type { Db } from '../db/index.js';
import { randomToken, sha256 } from '../security/crypto.js';

export interface Session {
  userId: number;
  projectId: number | null;
  impersonatorId: number | null;
  expiresAt: number;
}

/** Sitzungen: Token im Cookie (Browser) oder als Bearer (spätere App, Konzept 7.8). Gespeichert wird nur der Hash. */
export class Sessions {
  /** Kurzer Zwischenspeicher je Token-Hash: Jeder Seitenwechsel löst eine Sitzung mehrfach auf (API und Socket) */
  private cache = new Map<string, { s: Session | null; until: number }>();
  static CACHE_MS = 30_000;

  constructor(private db: Db, private now: () => number = Date.now) {}

  async create(userId: number, opts: { projectId?: number | null; ttlMs?: number; impersonatorId?: number | null } = {}): Promise<{ token: string; expiresAt: number }> {
    const token = randomToken();
    const expiresAt = this.now() + (opts.ttlMs ?? 12 * 3600_000);
    await this.db
      .insertInto('sessions')
      .values({ token_hash: sha256(token), user_id: userId, project_id: opts.projectId ?? null, impersonator_id: opts.impersonatorId ?? null, expires_at: expiresAt, created_at: this.now() })
      .execute();
    return { token, expiresAt };
  }

  async resolve(token: string | undefined | null): Promise<Session | null> {
    if (!token) return null;
    const hash = sha256(token);
    const now = this.now();
    const hit = this.cache.get(hash);
    if (hit && hit.until > now) return hit.s && hit.s.expiresAt >= now ? hit.s : null;
    const row = await this.db.selectFrom('sessions').selectAll().where('token_hash', '=', hash).executeTakeFirst();
    const s = !row || Number(row.expires_at) < now ? null : { userId: row.user_id, projectId: row.project_id, impersonatorId: row.impersonator_id, expiresAt: Number(row.expires_at) };
    if (this.cache.size > 5000) this.cache.clear();
    this.cache.set(hash, { s, until: now + Sessions.CACHE_MS });
    return s;
  }

  async destroy(token: string): Promise<void> {
    this.cache.delete(sha256(token));
    await this.db.deleteFrom('sessions').where('token_hash', '=', sha256(token)).execute();
  }

  async destroyAllFor(userId: number): Promise<void> {
    for (const [k, v] of this.cache) if (v.s?.userId === userId) this.cache.delete(k);
    await this.db.deleteFrom('sessions').where('user_id', '=', userId).execute();
  }

  async cleanup(): Promise<void> {
    await this.db.deleteFrom('sessions').where('expires_at', '<', this.now()).execute();
  }
}
