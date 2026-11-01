import { sha256 } from '../security/crypto.js';
import type { Db } from '../db/index.js';

export interface AuditEntry {
  actorId: number | null;
  action: string;
  contextId?: number | null;
  projectId?: number | null;
  data?: Record<string, unknown>;
}

/**
 * Hash-verkettetes Prüfprotokoll (Konzept 6.5), wie in autografi-kern: Jeder Eintrag enthält den
 * Hash des vorigen; eine nachträgliche Änderung bricht die Kette und fällt bei verify() auf.
 * Keine Inhalte und keine Namen von Lernenden in data.
 */
export class AuditLog {
  private chain: Promise<unknown> = Promise.resolve();

  constructor(private db: Db, private now: () => number = Date.now) {}

  append(e: AuditEntry): Promise<void> {
    // Einträge nacheinander schreiben, damit prev_hash eindeutig ist
    const run = this.chain.then(() => this.write(e));
    this.chain = run.catch(() => {});
    return run;
  }

  private async write(e: AuditEntry) {
    await this.db.transaction().execute(async (tx) => {
      const last = await tx.selectFrom('audit_log').select('hash').orderBy('id', 'desc').limit(1).executeTakeFirst();
      const prev = last?.hash ?? '0'.repeat(64);
      const time = this.now();
      const data = JSON.stringify(e.data ?? {});
      const hash = sha256([prev, time, e.actorId ?? '', e.action, e.contextId ?? '', e.projectId ?? '', data].join('|'));
      await tx
        .insertInto('audit_log')
        .values({ time, actor_id: e.actorId, action: e.action, context_id: e.contextId ?? null, project_id: e.projectId ?? null, data, prev_hash: prev, hash })
        .execute();
    });
  }

  async verify(): Promise<{ ok: boolean; brokenAt?: number }> {
    const rows = await this.db.selectFrom('audit_log').selectAll().orderBy('id').execute();
    let prev = '0'.repeat(64);
    for (const r of rows) {
      const hash = sha256([prev, Number(r.time), r.actor_id ?? '', r.action, r.context_id ?? '', r.project_id ?? '', r.data].join('|'));
      if (r.prev_hash !== prev || r.hash !== hash) return { ok: false, brokenAt: r.id };
      prev = r.hash;
    }
    return { ok: true };
  }
}
