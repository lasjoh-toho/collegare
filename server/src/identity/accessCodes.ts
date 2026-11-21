import type { Db } from '../db/index.js';
import { parseSettings, releaseEnd } from '../projects/settings.js';
import { randomToken, sha256, shortCode } from '../security/crypto.js';

export interface IssuedCode {
  userId: number;
  secret: string;
  code: string;
  expiresAt: number;
  /** gilt, solange das Projekt freigegeben ist */
  followRelease: boolean;
}

/**
 * Zugang für Lernende ohne Konto (wie /zugang in Autogra.fi): je Person ein QR-Geheimnis (im URL-Fragment)
 * und ein 6-stelliger Code. Wiederverwendbar bis Ablauf; ein neuer Code sperrt den alten nicht,
 * nur „Codes sperren“, Ablauf oder Entfernen aus dem Projekt. Gespeichert werden nur Hashes.
 * Ablauf: feste Dauer, Zeitpunkt (Datum und Uhrzeit) oder „solange das Projekt freigegeben ist“; dann folgt das Ende
 * den Freigaben der Phasen und wird bei jedem Speichern der Einstellungen neu gesetzt (syncRelease), auch für
 * schon abgelaufene Codes: Gibt die Lehrkraft wieder frei, gelten sie wieder.
 */
export type Validity = { until: number } | { release: true };

export class AccessCodes {
  constructor(private db: Db, private now: () => number = Date.now) {}

  async issue(projectId: number, userIds: number[], validity: Validity, actorId: number): Promise<IssuedCode[]> {
    const out: IssuedCode[] = [];
    const followRelease = 'release' in validity;
    const expiresAt = followRelease ? await this.releaseOf(projectId) : validity.until;
    for (const userId of userIds) {
      const secret = randomToken(24);
      // Code muss je Projekt eindeutig unter den gültigen sein
      let code = shortCode();
      for (let i = 0; i < 5; i++) {
        const clash = await this.db.selectFrom('access_codes').select('id').where('code_hash', '=', sha256(code)).where('revoked_at', 'is', null).where('expires_at', '>', this.now()).executeTakeFirst();
        if (!clash) break;
        code = shortCode();
      }
      await this.db
        .insertInto('access_codes')
        .values({ project_id: projectId, user_id: userId, secret_hash: sha256(secret), code_hash: sha256(code), expires_at: expiresAt, revoked_at: null, redeem_count: 0, follow_release: followRelease ? 1 : 0, created_by: actorId, created_at: this.now() })
        .execute();
      out.push({ userId, secret, code, expiresAt, followRelease });
    }
    return out;
  }

  async redeem(input: { secret?: string; code?: string }): Promise<{ projectId: number; userId: number } | null> {
    let q = this.db.selectFrom('access_codes').selectAll().where('revoked_at', 'is', null).where('expires_at', '>', this.now());
    if (input.secret) q = q.where('secret_hash', '=', sha256(input.secret));
    else if (input.code) q = q.where('code_hash', '=', sha256(input.code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '')));
    else return null;
    const row = await q.orderBy('id', 'desc').executeTakeFirst();
    if (!row) return null;
    const member = await this.db.selectFrom('group_members').select('user_id').where('project_id', '=', row.project_id).where('user_id', '=', row.user_id).executeTakeFirst();
    if (!member) return null;
    await this.db.updateTable('access_codes').set({ redeem_count: row.redeem_count + 1 }).where('id', '=', row.id).execute();
    return { projectId: row.project_id, userId: row.user_id };
  }

  async revokeAll(projectId: number, userIds?: number[]): Promise<number> {
    let q = this.db.updateTable('access_codes').set({ revoked_at: this.now() }).where('project_id', '=', projectId).where('revoked_at', 'is', null);
    if (userIds?.length) q = q.where('user_id', 'in', userIds);
    const r = await q.executeTakeFirst();
    return Number(r.numUpdatedRows);
  }

  private async releaseOf(projectId: number) {
    const p = await this.db.selectFrom('projects').select('settings').where('id', '=', projectId).executeTakeFirst();
    return releaseEnd(parseSettings(p?.settings).phases, this.now());
  }

  /** Nach dem Speichern der Einstellungen: Ende der Codes „solange freigegeben“ an die Freigaben anpassen. */
  async syncRelease(projectId: number): Promise<void> {
    const until = await this.releaseOf(projectId);
    await this.db.updateTable('access_codes').set({ expires_at: until }).where('project_id', '=', projectId).where('follow_release', '=', 1).where('revoked_at', 'is', null).execute();
  }

  /** Personen, deren gültige Codes den Freigaben folgen. */
  async followingRelease(projectId: number): Promise<number[]> {
    const rows = await this.db.selectFrom('access_codes').select('user_id').distinct().where('project_id', '=', projectId).where('follow_release', '=', 1).where('revoked_at', 'is', null).where('expires_at', '>', this.now()).execute();
    return rows.map((r) => r.user_id);
  }

  /** Gültig bis (je Person), für die Übersicht der Lehrkraft. */
  async validUntil(projectId: number): Promise<Record<number, number>> {
    const rows = await this.db
      .selectFrom('access_codes')
      .select(['user_id', (eb) => eb.fn.max('expires_at').as('until')])
      .where('project_id', '=', projectId)
      .where('revoked_at', 'is', null)
      .where('expires_at', '>', this.now())
      .groupBy('user_id')
      .execute();
    return Object.fromEntries(rows.map((r) => [r.user_id, Number(r.until)]));
  }
}
