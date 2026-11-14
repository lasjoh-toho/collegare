/**
 * Speicher der Pinnwand (Konzept 8d.5): Zeilen der Tabellen von mod_pinnwand als JSON je Bereich (Gruppe bzw. Person
 * im Einzelmodus) und Dateien als Blobs. Ein Aufruf lädt alle Zeilen des Bereichs (ein Board hat einige hundert),
 * ändert sie und schreibt geänderte Zeilen sofort; Aufrufe eines Bereichs laufen nacheinander.
 */
import type { Db } from '../db/index.js';

export type Row = Record<string, any> & { id: number };
export type Table = 'photos' | 'threads' | 'thread_items' | 'board_ink' | 'board_names' | 'object_placements' | 'prefs';

export interface PinFile {
  id: number;
  area: string;
  itemId: number;
  name: string;
  mime: string;
  createdAt: number;
}

export class Scope {
  private rows = new Map<Table, Map<number, Row>>();

  constructor(
    private db: Db,
    readonly projectId: number,
    readonly scope: string,
    loaded: { id: number; tbl: string; data: string }[],
    private files: PinFile[],
    readonly now: () => number,
  ) {
    for (const r of loaded) {
      try {
        this.table(r.tbl as Table).set(r.id, { ...JSON.parse(r.data), id: r.id });
      } catch {
        /* kaputte Zeile überspringen */
      }
    }
  }

  private table(t: Table) {
    let m = this.rows.get(t);
    if (!m) this.rows.set(t, (m = new Map()));
    return m;
  }

  /** alle Zeilen einer Tabelle, nach id (wie Moodle ohne Sortierung) */
  all(t: Table, where: Partial<Row> = {}): Row[] {
    return [...this.table(t).values()].filter((r) => Object.entries(where).every(([k, v]) => r[k] == v)).sort((a, b) => a.id - b.id);
  }
  get(t: Table, id: number): Row | null {
    return this.table(t).get(Number(id)) ?? null;
  }
  first(t: Table, where: Partial<Row>): Row | null {
    return this.all(t, where)[0] ?? null;
  }
  must(t: Table, where: Partial<Row>): Row {
    const r = this.first(t, where);
    if (!r) throw new PinError('invalidrecord');
    return r;
  }

  async insert(t: Table, data: Record<string, any>): Promise<number> {
    const { id: _drop, ...rest } = data;
    const r = await this.db.insertInto('pinnwand_rows').values({ project_id: this.projectId, scope: this.scope, tbl: t, data: JSON.stringify(rest) }).executeTakeFirst();
    const id = Number(r.insertId);
    this.table(t).set(id, { ...rest, id });
    return id;
  }
  async update(t: Table, row: Row): Promise<void> {
    const { id, ...rest } = row;
    await this.db.updateTable('pinnwand_rows').set({ data: JSON.stringify(rest) }).where('id', '=', id).where('project_id', '=', this.projectId).where('scope', '=', this.scope).execute();
    this.table(t).set(id, { ...row });
  }
  async remove(t: Table, ids: number[]): Promise<void> {
    if (!ids.length) return;
    await this.db.deleteFrom('pinnwand_rows').where('id', 'in', ids).where('project_id', '=', this.projectId).where('scope', '=', this.scope).execute();
    for (const id of ids) this.table(t).delete(id);
  }

  // ---- Dateien (Moodle File API) ----
  areaFiles(area: string, itemId: number): PinFile[] {
    return this.files.filter((f) => f.area === area && f.itemId === itemId);
  }
  async deleteArea(area: string, itemId: number): Promise<void> {
    const ids = this.areaFiles(area, itemId).map((f) => f.id);
    if (!ids.length) return;
    await this.db.deleteFrom('pinnwand_files').where('id', 'in', ids).execute();
    this.files = this.files.filter((f) => !ids.includes(f.id));
  }
  async putFile(area: string, itemId: number, name: string, mime: string, data: Buffer): Promise<PinFile> {
    const createdAt = this.now();
    const r = await this.db
      .insertInto('pinnwand_files')
      .values({ project_id: this.projectId, scope: this.scope, area, item_id: itemId, name, mime, data, created_at: createdAt })
      .executeTakeFirst();
    const f = { id: Number(r.insertId), area, itemId, name, mime, createdAt };
    this.files.push(f);
    return f;
  }
  async copyFile(from: PinFile, area: string, itemId: number): Promise<PinFile | null> {
    const row = await this.db.selectFrom('pinnwand_files').select('data').where('id', '=', from.id).executeTakeFirst();
    return row ? this.putFile(area, itemId, from.name, from.mime, Buffer.from(row.data)) : null;
  }
  async fileData(f: PinFile): Promise<Buffer | null> {
    const row = await this.db.selectFrom('pinnwand_files').select('data').where('id', '=', f.id).executeTakeFirst();
    return row ? Buffer.from(row.data) : null;
  }
  fileByName(area: string, name: string): PinFile | null {
    return this.files.find((f) => f.area === area && f.name === name) ?? null;
  }
}

/** Fehler wie moodle_exception: Schlüssel der Sprachdatei, die Oberfläche zeigt die Meldung */
export class PinError extends Error {}

export class PinStore {
  private queues = new Map<string, Promise<unknown>>();
  constructor(
    private db: Db,
    private now: () => number = Date.now,
  ) {}

  /**
   * Geladene Bereiche bleiben im Speicher (alle Schreibzugriffe laufen über Scope, der Server ist ein Prozess), damit
   * nicht jeder Aufruf alle Zeilen eines Boards neu liest. Höchstens CACHE_MAX Bereiche, nach CACHE_IDLE ohne Zugriff
   * verworfen; schlägt ein Aufruf fehl (auch mit PinError, falls schon etwas geändert war), wird der Bereich neu geladen.
   */
  private cache = new Map<string, { sc: Scope; at: number }>();
  static CACHE_MAX = 64;
  static CACHE_IDLE = 10 * 60_000;

  private async load(projectId: number, scope: string): Promise<Scope> {
    const [rows, files] = await Promise.all([
      this.db.selectFrom('pinnwand_rows').select(['id', 'tbl', 'data']).where('project_id', '=', projectId).where('scope', '=', scope).execute(),
      this.db.selectFrom('pinnwand_files').select(['id', 'area', 'item_id', 'name', 'mime', 'created_at']).where('project_id', '=', projectId).where('scope', '=', scope).execute(),
    ]);
    return new Scope(
      this.db,
      projectId,
      scope,
      rows.map((r) => ({ id: Number(r.id), tbl: r.tbl, data: r.data })),
      files.map((f) => ({ id: Number(f.id), area: f.area, itemId: Number(f.item_id), name: f.name, mime: f.mime, createdAt: Number(f.created_at) })),
      this.now,
    );
  }

  private evict() {
    const now = this.now();
    for (const [k, v] of this.cache) if (now - v.at > PinStore.CACHE_IDLE && !this.queues.has(k)) this.cache.delete(k);
    while (this.cache.size > PinStore.CACHE_MAX) {
      const oldest = [...this.cache].filter(([k]) => !this.queues.has(k)).sort((a, b) => a[1].at - b[1].at)[0];
      if (!oldest) break;
      this.cache.delete(oldest[0]);
    }
  }

  /** Arbeit an einem Bereich, nacheinander (wie eine Transaktion je Aufruf) */
  run<T>(projectId: number, scope: string, fn: (s: Scope) => Promise<T>): Promise<T> {
    const key = projectId + ':' + scope;
    const prev = this.queues.get(key) ?? Promise.resolve();
    const next = prev.catch(() => {}).then(async () => {
      let hit = this.cache.get(key);
      if (!hit) {
        hit = { sc: await this.load(projectId, scope), at: 0 };
        this.cache.set(key, hit);
      }
      hit.at = this.now();
      try {
        return await fn(hit.sc);
      } catch (e) {
        // Speicher und Datenbank könnten auseinanderlaufen: beim nächsten Aufruf neu laden
        this.cache.delete(key);
        throw e;
      }
    });
    this.queues.set(key, next);
    void next
      .finally(() => {
        if (this.queues.get(key) === next) this.queues.delete(key);
        this.evict();
      })
      .catch(() => {});
    return next;
  }

  async file(projectId: number, scope: string, id: number): Promise<{ name: string; mime: string; data: Buffer } | null> {
    const r = await this.db.selectFrom('pinnwand_files').select(['name', 'mime', 'data']).where('id', '=', id).where('project_id', '=', projectId).where('scope', '=', scope).executeTakeFirst();
    return r ? { name: r.name, mime: r.mime, data: Buffer.from(r.data) } : null;
  }

  async fileByName(projectId: number, scope: string, area: string, name: string): Promise<{ name: string; mime: string; data: Buffer } | null> {
    const r = await this.db
      .selectFrom('pinnwand_files')
      .select(['name', 'mime', 'data'])
      .where('project_id', '=', projectId)
      .where('scope', '=', scope)
      .where('area', '=', area)
      .where('name', '=', name)
      .executeTakeFirst();
    return r ? { name: r.name, mime: r.mime, data: Buffer.from(r.data) } : null;
  }
}
