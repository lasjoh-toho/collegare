/**
 * Notizen und Quellen (Konzept 8d.2, 8e): Recherche-Karten einer Gruppe im Seiten-Thread. Eine Notiz ist ein
 * Datensatz; Karten in der Mindmap verweisen auf sie (noteId) und übernehmen Überarbeitungen.
 *
 * Sichtbarkeit (8e.2): private = nur die Erstellerin, group = ihre Gruppe (Standard), all = das ganze Projekt. Die
 * Lehrkraft sieht alles. Gemeldete Notizen (8e.4) sehen nur noch Lehrkraft, Erstellerin und Meldende.
 */
import { z } from 'zod';
import type { Db } from '../db/index.js';

export const NOTE_KINDS = ['note', 'source', 'link', 'data'] as const;
export const VISIBILITIES = ['private', 'group', 'all'] as const;
export type Visibility = (typeof VISIBILITIES)[number];

/** Tabelle einer Daten-Notiz: höchstens 50 Zeilen × 12 Spalten, erste Zeile = Kopfzeile */
const Rows = z.array(z.array(z.string().max(500)).max(12)).max(50);

export const NoteInput = z.object({
  kind: z.enum(NOTE_KINDS).default('note'),
  title: z.string().max(200).default(''),
  body: z.string().max(10_000).default(''),
  source: z.string().max(500).default(''),
  url: z
    .string()
    .max(2000)
    .regex(/^https?:\/\//i, 'Link muss mit http:// oder https:// beginnen')
    .nullable()
    .or(z.literal('').transform(() => null))
    .default(null),
  visibility: z.enum(VISIBILITIES).optional(),
  rows: Rows.optional(),
});
export type NoteInput = z.infer<typeof NoteInput>;

export interface NoteReport {
  userId: number;
  name: string;
  reason: string;
  at: number;
}

export interface Note {
  id: number;
  userId: number;
  name: string;
  kind: (typeof NOTE_KINDS)[number];
  title: string;
  body: string;
  source: string;
  url: string | null;
  visibility: Visibility;
  rows: string[][] | null;
  at: number;
  updatedAt: number;
}

/** Was eine bestimmte Person von einer Notiz sieht */
export interface NoteView extends Note {
  /** gemeldet: nur für Lehrkraft, Erstellerin und Meldende sichtbar */
  reported?: boolean;
  reportedByMe?: boolean;
  /** nur für die Lehrkraft: wer gemeldet hat und warum */
  reports?: NoteReport[];
}

export interface Viewer {
  userId: number;
  role: 'teacher' | 'student';
}

export type NoteRow = Note & { projectId: number; scope: string; reporters: NoteReport[] };

const COLS = ['n.id', 'n.project_id', 'n.scope', 'n.user_id', 'u.name', 'n.kind', 'n.title', 'n.body', 'n.source', 'n.url', 'n.visibility', 'n.data_json', 'n.created_at', 'n.updated_at'] as const;

export class Notes {
  constructor(
    private db: Db,
    private now: () => number = Date.now,
  ) {}

  /** Notizen eines Bereichs (Gruppe, Person, Testbereich), soweit die Person sie sehen darf */
  async list(projectId: number, scope: string, viewer: Viewer): Promise<NoteView[]> {
    const rows = await this.db.selectFrom('notes as n').innerJoin('users as u', 'u.id', 'n.user_id').select(COLS).where('n.project_id', '=', projectId).where('n.scope', '=', scope).orderBy('n.id', 'desc').limit(500).execute();
    return this.views(rows, viewer);
  }

  /** „Allgemein“: alle freigegebenen Notizen des Projekts aus allen Gruppen (ohne Testbereiche der Lehrkräfte) */
  async listShared(projectId: number, viewer: Viewer): Promise<(NoteView & { scope: string })[]> {
    const rows = await this.db
      .selectFrom('notes as n')
      .innerJoin('users as u', 'u.id', 'n.user_id')
      .select(COLS)
      .where('n.project_id', '=', projectId)
      .where('n.visibility', '=', 'all')
      .where('n.scope', 'not like', 't%')
      .orderBy('n.id', 'desc')
      .limit(500)
      .execute();
    const views = await this.views(rows, viewer);
    const scopeOf = new Map(rows.map((r) => [Number(r.id), r.scope]));
    return views.map((v) => ({ ...v, scope: scopeOf.get(v.id)! }));
  }

  async get(id: number): Promise<NoteRow | null> {
    const r = await this.db.selectFrom('notes as n').innerJoin('users as u', 'u.id', 'n.user_id').select(COLS).where('n.id', '=', id).executeTakeFirst();
    if (!r) return null;
    const reporters = (await this.reports([Number(r.id)])).get(Number(r.id)) ?? [];
    return { ...this.view(r), projectId: r.project_id, scope: r.scope, reporters };
  }

  async add(projectId: number, scope: string, userId: number, input: NoteInput, visibility: Visibility = 'group'): Promise<NoteRow> {
    const n = this.clean(input);
    if (!n.title && !n.body && !n.url && !n.data_json) throw new Error('Leere Notiz');
    const at = this.now();
    const r = await this.db
      .insertInto('notes')
      .values({ project_id: projectId, scope, user_id: userId, ...n, visibility: input.visibility ?? visibility, created_at: at, updated_at: at })
      .executeTakeFirst();
    return (await this.get(Number(r.insertId)))!;
  }

  async update(id: number, input: NoteInput, visibility: Visibility): Promise<NoteRow> {
    const n = this.clean(input);
    await this.db.updateTable('notes').set({ ...n, visibility, updated_at: this.now() }).where('id', '=', id).execute();
    return (await this.get(id))!;
  }

  async remove(id: number): Promise<void> {
    await this.db.deleteFrom('note_reports').where('note_id', '=', id).execute();
    await this.db.deleteFrom('notes').where('id', '=', id).execute();
  }

  /** Meldung eintragen; false, wenn diese Person die Notiz schon gemeldet hat */
  async report(id: number, userId: number, reason: string): Promise<boolean> {
    const had = await this.db.selectFrom('note_reports').select('id').where('note_id', '=', id).where('user_id', '=', userId).executeTakeFirst();
    if (had) return false;
    await this.db.insertInto('note_reports').values({ note_id: id, user_id: userId, reason: reason.trim().slice(0, 300), created_at: this.now() }).execute();
    return true;
  }

  async clearReports(id: number): Promise<void> {
    await this.db.deleteFrom('note_reports').where('note_id', '=', id).execute();
  }

  /**
   * Darf diese Person die Notiz sehen? Die Lehrkraft immer. Sonst: gemeldet → nur Erstellerin und Meldende; privat → nur
   * die Erstellerin; Gruppe → wer den Bereich sehen darf (inScope); Allgemein → alle im Projekt.
   */
  static canSee(n: Pick<NoteRow, 'userId' | 'visibility' | 'reporters'>, viewer: Viewer, inScope: boolean): boolean {
    if (viewer.role === 'teacher' || n.userId === viewer.userId) return true;
    if (n.reporters.length) return n.reporters.some((r) => r.userId === viewer.userId);
    if (n.visibility === 'private') return false;
    return n.visibility === 'all' || inScope;
  }

  /** Neue Sichtbarkeit: die Erstellerin wählt frei, die Lehrkraft darf nur auf Privat zurückstellen (8e.2) */
  static allowedVisibility(row: Pick<NoteRow, 'userId' | 'visibility'>, viewer: Viewer, wanted: Visibility | undefined): Visibility | null {
    if (!wanted || wanted === row.visibility) return row.visibility;
    if (row.userId === viewer.userId) return wanted;
    if (viewer.role === 'teacher' && wanted === 'private') return wanted;
    return null;
  }

  /** Sicht einer Person auf eine Notiz: Meldungen je nach Rolle */
  static viewFor(n: NoteRow, viewer: Viewer): NoteView {
    const { projectId: _p, scope: _s, reporters, ...note } = n;
    const v: NoteView = { ...note };
    if (reporters.length) {
      const mine = reporters.some((r) => r.userId === viewer.userId);
      if (viewer.role === 'teacher' || n.userId === viewer.userId || mine) v.reported = true;
      if (mine) v.reportedByMe = true;
      if (viewer.role === 'teacher') v.reports = reporters;
    }
    return v;
  }

  /** Titel einer Notiz: eigener Titel, sonst erste Zeile des Texts, sonst der Link. */
  static cardTitle(n: Pick<Note, 'title' | 'body' | 'url'>): string {
    const first = n.body.trim().split('\n')[0] ?? '';
    return (n.title || (first.length > 120 ? first.slice(0, 117).trimEnd() + '…' : first) || n.url || 'Notiz').slice(0, 200);
  }

  /** Text einer Karte aus einer Notiz: Text, Tabelle, Fundstelle, Link. */
  static cardText(n: Pick<Note, 'title' | 'body' | 'source' | 'url'> & { rows?: string[][] | null }): string {
    const table = n.rows?.length ? n.rows.map((r) => r.join(' | ')).join('\n') : '';
    const parts = [n.title ? n.body.trim() : n.body.trim().split('\n').slice(1).join('\n').trim(), table, n.source && `Fundstelle: ${n.source}`, n.url ?? ''];
    return parts.filter(Boolean).join('\n\n').slice(0, 5000);
  }

  private async views(rows: RawRow[], viewer: Viewer): Promise<NoteView[]> {
    const reps = await this.reports(rows.map((r) => Number(r.id)));
    const out: NoteView[] = [];
    for (const r of rows) {
      const row: NoteRow = { ...this.view(r), projectId: r.project_id, scope: r.scope, reporters: reps.get(Number(r.id)) ?? [] };
      // wer den Bereich abfragt, darf ihn sehen (geprüft im Socket); „Allgemein“ enthält nur freigegebene
      if (Notes.canSee(row, viewer, true)) out.push(Notes.viewFor(row, viewer));
    }
    return out;
  }

  private async reports(ids: number[]): Promise<Map<number, NoteReport[]>> {
    const m = new Map<number, NoteReport[]>();
    if (!ids.length) return m;
    const rows = await this.db
      .selectFrom('note_reports as r')
      .innerJoin('users as u', 'u.id', 'r.user_id')
      .select(['r.note_id', 'r.user_id', 'u.name', 'r.reason', 'r.created_at'])
      .where('r.note_id', 'in', ids)
      .orderBy('r.id')
      .execute();
    for (const r of rows) {
      const l = m.get(Number(r.note_id)) ?? [];
      l.push({ userId: r.user_id, name: r.name, reason: r.reason, at: Number(r.created_at) });
      m.set(Number(r.note_id), l);
    }
    return m;
  }

  private clean(i: NoteInput) {
    const rows = i.kind === 'data' ? (i.rows ?? []).map((r) => r.map((c) => c.replace(/\r\n?/g, ' ').trim())).filter((r) => r.some(Boolean)) : [];
    return {
      kind: i.kind,
      title: i.title.trim(),
      body: i.body.replace(/\r\n?/g, '\n').trim(),
      source: i.source.trim(),
      url: i.url,
      data_json: rows.length ? JSON.stringify({ rows }) : null,
    };
  }

  private view(r: RawRow): Note {
    let rows: string[][] | null = null;
    if (r.data_json) {
      try {
        rows = (JSON.parse(r.data_json) as { rows?: string[][] }).rows ?? null;
      } catch {
        rows = null;
      }
    }
    return {
      id: Number(r.id),
      userId: r.user_id,
      name: r.name,
      kind: r.kind as Note['kind'],
      title: r.title,
      body: r.body,
      source: r.source,
      url: r.url,
      visibility: (VISIBILITIES as readonly string[]).includes(r.visibility) ? (r.visibility as Visibility) : 'group',
      rows,
      at: Number(r.created_at),
      updatedAt: Number(r.updated_at),
    };
  }
}

interface RawRow {
  id: number;
  project_id: number;
  scope: string;
  user_id: number;
  name: string;
  kind: string;
  title: string;
  body: string;
  source: string;
  url: string | null;
  visibility: string;
  data_json: string | null;
  created_at: number;
  updated_at: number;
}
