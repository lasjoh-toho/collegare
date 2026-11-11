/**
 * Einführendes Material je Projekt (Wunsch Jo, 11. November 2026): Lehrkräfte veröffentlichen Webseiten, Videos,
 * PDFs und Dokumente, mit denen sich die Lernenden einarbeiten. Dateien liegen in der Datenbank (wie die Dokumente),
 * damit Sicherung und Umzug nur die Datenbank brauchen; die Größe begrenzt die Projekt-Einstellung maxFileMb.
 */
import type { Db } from '../db/index.js';

export class MaterialError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

/** Erlaubte Dateien: Endung → Inhaltstyp. Kein HTML/SVG, damit nichts im Namen der Seite Skripte ausführt. */
export const MATERIAL_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  odt: 'application/vnd.oasis.opendocument.text',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  odp: 'application/vnd.oasis.opendocument.presentation',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  txt: 'text/plain; charset=utf-8',
  md: 'text/plain; charset=utf-8',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
};

export interface MaterialView {
  id: number;
  kind: 'link' | 'video' | 'file' | 'page';
  title: string;
  url: string | null;
  note: string;
  fileName: string | null;
  mime: string | null;
  size: number | null;
  position: number;
  createdAt: number;
}

export class Materials {
  constructor(private db: Db, private now: () => number = Date.now) {}

  async list(projectId: number): Promise<MaterialView[]> {
    const rows = await this.db
      .selectFrom('materials')
      .select(['id', 'kind', 'title', 'url', 'note', 'file_name', 'mime', 'size', 'position', 'created_at'])
      .where('project_id', '=', projectId)
      .orderBy('position')
      .orderBy('id')
      .execute();
    return rows.map((r) => ({ id: r.id, kind: r.kind, title: r.title, url: r.url, note: r.note, fileName: r.file_name, mime: r.mime, size: r.size, position: r.position, createdAt: Number(r.created_at) }));
  }

  private async nextPosition(projectId: number) {
    const r = await this.db.selectFrom('materials').select((eb) => eb.fn.max('position').as('m')).where('project_id', '=', projectId).executeTakeFirst();
    return Number(r?.m ?? -1) + 1;
  }

  async addLink(projectId: number, by: number, kind: 'link' | 'video', title: string, url: string, note: string): Promise<number> {
    let u: URL;
    try {
      u = new URL(url);
    } catch {
      throw new MaterialError('Keine gültige Adresse');
    }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new MaterialError('Adresse muss mit https:// beginnen');
    const res = await this.db
      .insertInto('materials')
      .values({ project_id: projectId, kind, body: null, title: title.trim() || u.hostname, url: u.toString(), note, file_name: null, mime: null, size: null, data: null, position: await this.nextPosition(projectId), created_by: by, created_at: this.now() })
      .executeTakeFirstOrThrow();
    return Number(res.insertId);
  }

  async addFile(projectId: number, by: number, title: string, fileName: string, data: Buffer, maxMb: number, note = ''): Promise<number> {
    const ext = (fileName.split('.').pop() ?? '').toLowerCase();
    const mime = MATERIAL_TYPES[ext];
    if (!mime) throw new MaterialError(`Dateiart .${ext} ist nicht vorgesehen (erlaubt: ${Object.keys(MATERIAL_TYPES).join(', ')})`);
    if (!data.length) throw new MaterialError('Die Datei ist leer');
    if (data.length > maxMb * 1024 * 1024) throw new MaterialError(`Die Datei ist größer als ${maxMb} MB (Projekt-Einstellung). Größere Videos besser als Link einbinden.`, 413);
    const kind = mime.startsWith('video/') ? 'video' : 'file';
    const name = fileName.replace(/[\\/\0]/g, '_').slice(0, 255);
    const res = await this.db
      .insertInto('materials')
      .values({ project_id: projectId, kind, body: null, title: title.trim() || name, url: null, note, file_name: name, mime, size: data.length, data, position: await this.nextPosition(projectId), created_by: by, created_at: this.now() })
      .executeTakeFirstOrThrow();
    return Number(res.insertId);
  }

  /** Lernseite anlegen (Text als Markdown mit Randnotizen; Bilder als data:-Adressen eingebettet). */
  async addPage(projectId: number, by: number, title: string, body: string, note = ''): Promise<number> {
    const res = await this.db
      .insertInto('materials')
      .values({ project_id: projectId, kind: 'page', title: title.trim().slice(0, 200) || 'Neue Seite', url: null, body, note, file_name: null, mime: null, size: body.length, data: null, position: await this.nextPosition(projectId), created_by: by, created_at: this.now() })
      .executeTakeFirstOrThrow();
    return Number(res.insertId);
  }

  async page(projectId: number, id: number): Promise<(MaterialView & { body: string }) | null> {
    const r = await this.db.selectFrom('materials').selectAll().where('id', '=', id).where('project_id', '=', projectId).where('kind', '=', 'page').executeTakeFirst();
    if (!r) return null;
    return { id: r.id, kind: 'page', title: r.title, url: null, note: r.note, fileName: null, mime: null, size: r.size, position: r.position, createdAt: Number(r.created_at), body: r.body ?? '' };
  }

  async update(projectId: number, id: number, patch: { title?: string; note?: string; position?: number; body?: string }) {
    const set: Record<string, unknown> = {};
    if (patch.body !== undefined) {
      set.body = patch.body;
      set.size = patch.body.length;
    }
    if (patch.title !== undefined) set.title = patch.title.trim().slice(0, 200) || 'Ohne Titel';
    if (patch.note !== undefined) set.note = patch.note;
    if (patch.position !== undefined) set.position = patch.position;
    if (!Object.keys(set).length) return;
    const r = await this.db.updateTable('materials').set(set).where('id', '=', id).where('project_id', '=', projectId).executeTakeFirst();
    if (!Number(r.numUpdatedRows)) throw new MaterialError('Material nicht gefunden', 404);
  }

  /** Reihenfolge setzen (Liste der IDs von oben nach unten). */
  async reorder(projectId: number, ids: number[]) {
    for (const [i, id] of ids.entries()) await this.db.updateTable('materials').set({ position: i }).where('id', '=', id).where('project_id', '=', projectId).execute();
  }

  async remove(projectId: number, id: number) {
    await this.db.deleteFrom('materials').where('id', '=', id).where('project_id', '=', projectId).execute();
  }

  async file(id: number): Promise<{ projectId: number; name: string; mime: string; data: Buffer } | null> {
    const r = await this.db.selectFrom('materials').select(['project_id', 'file_name', 'mime', 'data']).where('id', '=', id).executeTakeFirst();
    if (!r?.data || !r.mime) return null;
    return { projectId: r.project_id, name: r.file_name ?? 'datei', mime: r.mime, data: Buffer.from(r.data) };
  }
}
