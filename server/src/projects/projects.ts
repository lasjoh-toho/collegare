import type { Db } from '../db/index.js';
import type { Users } from '../identity/users.js';
import { randomToken } from '../security/crypto.js';
import { DEFAULT_SETTINGS, type ProjectSettings, parseSettings } from './settings.js';

export { DEFAULT_SETTINGS, type ProjectSettings };

export const ROSTER_ISSUER = 'collegare:klassenliste';

export type ProjectRole = 'teacher' | 'student' | null;

export interface BoardGroup {
  id: number;
  title: string;
  position: number;
  color: string | null;
}

export interface BoardMember {
  userId: number;
  name: string;
  groupId: number | null;
  position: number;
  roleLabel: string | null;
}

export interface Board {
  projectId: number;
  mode: 'group' | 'single';
  groups: BoardGroup[];
  members: BoardMember[];
}

export class ProjectError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

/** Projekte, Gruppen und Zuordnung der Lernenden (Kanban der Gruppenbildung). */
export class Projects {
  constructor(private db: Db, private users: Users, private now: () => number = Date.now) {}

  async create(contextId: number, title: string, mode: 'group' | 'single', actorId: number): Promise<number> {
    title = title.trim();
    if (!title) throw new ProjectError('Titel fehlt');
    const res = await this.db
      .insertInto('projects')
      .values({ context_id: contextId, title, mode, settings: JSON.stringify(DEFAULT_SETTINGS), created_by: actorId, created_at: this.now(), archived_at: null })
      .executeTakeFirstOrThrow();
    return Number(res.insertId);
  }

  async get(id: number) {
    const p = await this.db.selectFrom('projects').selectAll().where('id', '=', id).executeTakeFirst();
    if (!p) return undefined;
    const { revision, ...settings } = parseSettings(p.settings);
    return { ...p, settings: settings as ProjectSettings, revision };
  }

  async roleOf(userId: number, projectId: number): Promise<ProjectRole> {
    const p = await this.db.selectFrom('projects').select(['context_id']).where('id', '=', projectId).executeTakeFirst();
    if (!p) return null;
    const roles = await this.users.rolesIn(userId, p.context_id);
    if (roles.has('teacher') || roles.has('admin')) return 'teacher';
    const member = await this.db.selectFrom('group_members').select('user_id').where('project_id', '=', projectId).where('user_id', '=', userId).executeTakeFirst();
    return member ? 'student' : null;
  }

  /** Projekte, die eine Person sieht: als Lehrkraft alle in ihren Kursen, als Lernende die eigenen. */
  async listFor(userId: number) {
    const taught = await this.db
      .selectFrom('memberships')
      .select('context_id')
      .where('user_id', '=', userId)
      .where('role', 'in', ['teacher', 'admin'])
      .execute();
    const ctxIds = new Set<number>();
    // Unterkontexte einsammeln (Bereich › Kurse)
    let frontier = taught.map((t) => t.context_id);
    while (frontier.length) {
      frontier.forEach((c) => ctxIds.add(c));
      const kids = await this.db.selectFrom('contexts').select('id').where('parent_id', 'in', frontier).execute();
      frontier = kids.map((k) => k.id).filter((k) => !ctxIds.has(k));
    }
    const asTeacher = ctxIds.size
      ? await this.db.selectFrom('projects').selectAll().where('context_id', 'in', [...ctxIds]).where('archived_at', 'is', null).orderBy('created_at', 'desc').execute()
      : [];
    const asStudent = await this.db
      .selectFrom('projects')
      .innerJoin('group_members', 'group_members.project_id', 'projects.id')
      .selectAll('projects')
      .where('group_members.user_id', '=', userId)
      .where('projects.archived_at', 'is', null)
      .execute();
    const seen = new Set<number>();
    const out: { id: number; title: string; mode: string; contextId: number; role: 'teacher' | 'student'; createdAt: number }[] = [];
    for (const p of asTeacher) {
      seen.add(p.id);
      out.push({ id: p.id, title: p.title, mode: p.mode, contextId: p.context_id, role: 'teacher', createdAt: Number(p.created_at) });
    }
    for (const p of asStudent) if (!seen.has(p.id)) out.push({ id: p.id, title: p.title, mode: p.mode, contextId: p.context_id, role: 'student', createdAt: Number(p.created_at) });
    return out;
  }

  /**
   * Kennzahlen je Projekt für das Portal (Konzept 8b): Lernende, Gruppen, Abschnitte und neue Fertig-Meldungen
   * seit einem Zeitpunkt. Wenige gebündelte Abfragen statt einer je Projekt.
   */
  async summaries(projectIds: number[], since: number | null) {
    const out = new Map<number, { subject: string | null; phases: ProjectSettings['phases']; students: number; unassigned: number; groups: number; docs: number; done: number; newDone: number }>();
    if (!projectIds.length) return out;
    const projects = await this.db.selectFrom('projects').select(['id', 'settings']).where('id', 'in', projectIds).execute();
    for (const p of projects) {
      const st = parseSettings(p.settings) as ProjectSettings;
      out.set(p.id, { subject: st.subject, phases: st.phases, students: 0, unassigned: 0, groups: 0, docs: 0, done: 0, newDone: 0 });
    }
    const members = await this.db.selectFrom('group_members').select(['project_id', 'group_id']).where('project_id', 'in', projectIds).execute();
    for (const m of members) {
      const o = out.get(m.project_id)!;
      o.students++;
      if (m.group_id === null) o.unassigned++;
    }
    const groups = await this.db.selectFrom('groups').select(['project_id']).where('project_id', 'in', projectIds).execute();
    for (const g of groups) out.get(g.project_id)!.groups++;
    const docs = await this.db.selectFrom('documents').select(['project_id', 'done_at']).where('project_id', 'in', projectIds).execute();
    for (const d of docs) {
      const o = out.get(d.project_id)!;
      o.docs++;
      if (d.done_at !== null) {
        o.done++;
        if (since !== null && Number(d.done_at) > since) o.newDone++;
      }
    }
    return out;
  }

  async board(projectId: number): Promise<Board> {
    const p = await this.db.selectFrom('projects').select(['mode']).where('id', '=', projectId).executeTakeFirstOrThrow();
    const groups = await this.db.selectFrom('groups').select(['id', 'title', 'position', 'color']).where('project_id', '=', projectId).orderBy('position').orderBy('id').execute();
    const members = await this.db
      .selectFrom('group_members')
      .innerJoin('users', 'users.id', 'group_members.user_id')
      .select(['group_members.user_id as userId', 'users.name as name', 'group_members.group_id as groupId', 'group_members.position as position', 'group_members.role_label as roleLabel'])
      .where('group_members.project_id', '=', projectId)
      .orderBy('group_members.position')
      .orderBy('users.name')
      .execute();
    return { projectId, mode: p.mode, groups, members };
  }

  /** Lernende hinzufügen: aus einer Namensliste (Einzelbetrieb) oder vorhandene Personen (Moodle). */
  async addStudentsByName(projectId: number, names: string[]): Promise<number[]> {
    const p = await this.db.selectFrom('projects').select(['context_id', 'mode']).where('id', '=', projectId).executeTakeFirstOrThrow();
    const ids: number[] = [];
    for (const raw of names) {
      const name = raw.trim().replace(/\s+/g, ' ');
      if (!name) continue;
      if (name.length > 120) throw new ProjectError('Name zu lang');
      const user = await this.users.upsert(ROSTER_ISSUER, randomToken(12), name);
      await this.users.grant(user.id, p.context_id, 'student');
      await this.addMember(projectId, user.id, p.mode);
      ids.push(user.id);
    }
    return ids;
  }

  async addMember(projectId: number, userId: number, mode?: 'group' | 'single'): Promise<void> {
    const exists = await this.db.selectFrom('group_members').select('user_id').where('project_id', '=', projectId).where('user_id', '=', userId).executeTakeFirst();
    if (exists) return;
    mode ??= (await this.db.selectFrom('projects').select('mode').where('id', '=', projectId).executeTakeFirstOrThrow()).mode;
    let groupId: number | null = null;
    if (mode === 'single') groupId = await this.createGroup(projectId, '');
    const pos = await this.nextMemberPosition(projectId, groupId);
    await this.db.insertInto('group_members').values({ project_id: projectId, user_id: userId, group_id: groupId, role_label: null, position: pos, created_at: this.now() }).execute();
  }

  async removeMember(projectId: number, userId: number): Promise<void> {
    await this.db.deleteFrom('group_members').where('project_id', '=', projectId).where('user_id', '=', userId).execute();
  }

  async createGroup(projectId: number, title: string, color: string | null = null): Promise<number> {
    const max = await this.db.selectFrom('groups').select((eb) => eb.fn.max('position').as('m')).where('project_id', '=', projectId).executeTakeFirst();
    const res = await this.db
      .insertInto('groups')
      .values({ project_id: projectId, title: title.trim().slice(0, 255), position: Number(max?.m ?? -1) + 1, color, created_at: this.now() })
      .executeTakeFirstOrThrow();
    return Number(res.insertId);
  }

  async renameGroup(projectId: number, groupId: number, title: string): Promise<void> {
    const res = await this.db.updateTable('groups').set({ title: title.trim().slice(0, 255) }).where('id', '=', groupId).where('project_id', '=', projectId).executeTakeFirst();
    if (!Number(res.numUpdatedRows)) throw new ProjectError('Gruppe nicht gefunden', 404);
  }

  async setGroupColor(projectId: number, groupId: number, color: string | null): Promise<void> {
    if (color !== null && !/^#[0-9a-f]{6}$/i.test(color)) throw new ProjectError('Farbe ungültig');
    await this.db.updateTable('groups').set({ color }).where('id', '=', groupId).where('project_id', '=', projectId).execute();
  }

  /** Gruppe löschen: Mitglieder wandern zurück nach „Noch ohne Gruppe“. */
  async deleteGroup(projectId: number, groupId: number): Promise<void> {
    await this.db.transaction().execute(async (tx) => {
      await tx.updateTable('group_members').set({ group_id: null }).where('project_id', '=', projectId).where('group_id', '=', groupId).execute();
      await tx.deleteFrom('groups').where('id', '=', groupId).where('project_id', '=', projectId).execute();
    });
  }

  async reorderGroups(projectId: number, order: number[]): Promise<void> {
    await this.db.transaction().execute(async (tx) => {
      for (let i = 0; i < order.length; i++) await tx.updateTable('groups').set({ position: i }).where('id', '=', order[i]).where('project_id', '=', projectId).execute();
    });
  }

  /** Person in eine Säule ziehen (groupId null = „Noch ohne Gruppe“) an eine Position. */
  async moveMember(projectId: number, userId: number, groupId: number | null, position: number): Promise<void> {
    if (groupId !== null) {
      const g = await this.db.selectFrom('groups').select('id').where('id', '=', groupId).where('project_id', '=', projectId).executeTakeFirst();
      if (!g) throw new ProjectError('Gruppe nicht gefunden', 404);
    }
    await this.db.transaction().execute(async (tx) => {
      const member = await tx.selectFrom('group_members').select('user_id').where('project_id', '=', projectId).where('user_id', '=', userId).executeTakeFirst();
      if (!member) throw new ProjectError('Person gehört nicht zum Projekt', 404);
      let q = tx.selectFrom('group_members').select('user_id').where('project_id', '=', projectId).where('user_id', '!=', userId);
      q = groupId === null ? q.where('group_id', 'is', null) : q.where('group_id', '=', groupId);
      const column = await q.orderBy('position').execute();
      const ids = column.map((c) => c.user_id);
      const at = Math.max(0, Math.min(position, ids.length));
      ids.splice(at, 0, userId);
      for (let i = 0; i < ids.length; i++) {
        await tx
          .updateTable('group_members')
          .set(ids[i] === userId ? { position: i, group_id: groupId } : { position: i })
          .where('project_id', '=', projectId)
          .where('user_id', '=', ids[i])
          .execute();
      }
    });
  }

  async setRoleLabel(projectId: number, userId: number, label: string | null): Promise<void> {
    await this.db.updateTable('group_members').set({ role_label: label?.trim().slice(0, 100) || null }).where('project_id', '=', projectId).where('user_id', '=', userId).execute();
  }

  async groupOf(projectId: number, userId: number): Promise<number | null> {
    const m = await this.db.selectFrom('group_members').select('group_id').where('project_id', '=', projectId).where('user_id', '=', userId).executeTakeFirst();
    return m?.group_id ?? null;
  }

  /**
   * Speichert Einstellungen. Mit revision: nur, wenn niemand inzwischen gespeichert hat (sonst 409),
   * wie die Einstellungsseite in Autogra.fi.
   */
  async updateSettings(projectId: number, patch: Partial<ProjectSettings>, revision?: number): Promise<{ settings: ProjectSettings; revision: number }> {
    return this.db.transaction().execute(async (tx) => {
      const row = await tx.selectFrom('projects').select('settings').where('id', '=', projectId).executeTakeFirst();
      if (!row) throw new ProjectError('Projekt nicht gefunden', 404);
      const { revision: current, ...settings } = parseSettings(row.settings);
      if (revision !== undefined && revision !== current) throw new ProjectError('Inzwischen hat jemand anderes gespeichert. Bitte neu laden.', 409);
      const next = { ...(settings as ProjectSettings), ...patch };
      if (next.groupMin > next.groupMax) throw new ProjectError('Mindestzahl ist größer als Höchstzahl');
      // Vergleichen und Tauschen: schlägt fehl, wenn zwischen Lesen und Schreiben jemand gespeichert hat
      const res = await tx.updateTable('projects').set({ settings: JSON.stringify({ ...next, revision: current + 1 }) }).where('id', '=', projectId).where('settings', '=', row.settings).executeTakeFirst();
      if (Number(res.numUpdatedRows) !== 1) throw new ProjectError('Inzwischen hat jemand anderes gespeichert. Bitte neu laden.', 409);
      return { settings: next, revision: current + 1 };
    });
  }

  /**
   * Wahlmodus: Lernende ordnen sich selbst einer Säule zu (oder zurück in „Noch ohne Gruppe“).
   * Prüft Schluss-Termin und Höchstzahl in derselben Transaktion, damit zwei gleichzeitige Klicks die Grenze nicht sprengen.
   */
  async choose(projectId: number, userId: number, groupId: number | null): Promise<void> {
    const p = await this.get(projectId);
    if (!p) throw new ProjectError('Projekt nicht gefunden', 404);
    const s = p.settings;
    if (p.mode === 'single' || s.groupFormation === 'teacher') throw new ProjectError('Die Gruppen teilt hier die Lehrkraft ein', 403);
    if (s.choiceDeadline !== null && this.now() > s.choiceDeadline) throw new ProjectError('Die Wahl ist beendet. Änderungen nur noch über die Lehrkraft.', 403);
    if (groupId !== null) {
      const g = await this.db.selectFrom('groups').select('id').where('id', '=', groupId).where('project_id', '=', projectId).executeTakeFirst();
      if (!g) throw new ProjectError('Gruppe nicht gefunden', 404);
      const n = await this.db
        .selectFrom('group_members')
        .select((eb) => eb.fn.countAll().as('n'))
        .where('project_id', '=', projectId)
        .where('group_id', '=', groupId)
        .where('user_id', '!=', userId)
        .executeTakeFirst();
      if (Number(n?.n ?? 0) >= s.groupMax) throw new ProjectError(`Diese Gruppe ist voll (höchstens ${s.groupMax})`, 409);
    }
    await this.moveMember(projectId, userId, groupId, Number.MAX_SAFE_INTEGER);
  }

  private async nextMemberPosition(projectId: number, groupId: number | null): Promise<number> {
    let q = this.db.selectFrom('group_members').select((eb) => eb.fn.max('position').as('m')).where('project_id', '=', projectId);
    q = groupId === null ? q.where('group_id', 'is', null) : q.where('group_id', '=', groupId);
    const r = await q.executeTakeFirst();
    return Number(r?.m ?? -1) + 1;
  }
}
