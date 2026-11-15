/**
 * Medien der Pinnwand als Dateien: je Pinnwand (Projekt und Bereich) ein eigener Ordner
 *   <DATA_DIR>/pinnwand/<Projekt>/<Bereich>/<Dateibereich>/<Objekt>/<id>-<Name>
 * Die Tabelle pinnwand_files hält nur noch die Angaben (Name, Typ, Größe, Pfad). Ältere Installationen hatten die
 * Dateien als Blobs in der Tabelle; moveBlobs() trägt sie nach und nach in die Ordner um, solange liest readFile()
 * beides.
 */
import { mkdir, readFile, rename, rm, stat, writeFile, readdir } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { randomBytes } from 'node:crypto';
import type { Db } from '../db/index.js';

const safe = (s: string) => s.replace(/[^\p{L}\p{N}._-]+/gu, '_').replace(/^\.+/, '_').slice(0, 120) || 'datei';

export class PinMedia {
  readonly root: string;
  constructor(dataDir: string) {
    this.root = resolve(dataDir, 'pinnwand');
  }

  /** Ordner einer Pinnwand */
  dirOf(projectId: number, scope: string): string {
    return join(this.root, String(Math.trunc(projectId)), safe(scope));
  }

  /** relativer Pfad einer neuen Datei */
  pathFor(projectId: number, scope: string, area: string, itemId: number, id: number, name: string): string {
    return relative(this.root, join(this.dirOf(projectId, scope), safe(area), String(Math.trunc(itemId)), `${id}-${safe(name)}`));
  }

  private abs(rel: string): string {
    const p = resolve(this.root, rel);
    if (p !== this.root && !p.startsWith(this.root + sep)) throw new Error('Pfad außerhalb des Medienordners');
    return p;
  }

  /** schreibt atomar (erst unter anderem Namen, dann umbenennen) */
  async write(rel: string, data: Buffer): Promise<void> {
    const p = this.abs(rel);
    await mkdir(dirname(p), { recursive: true });
    const tmp = `${p}.${randomBytes(4).toString('hex')}.tmp`;
    await writeFile(tmp, data);
    await rename(tmp, p);
  }

  async read(rel: string): Promise<Buffer | null> {
    try {
      return await readFile(this.abs(rel));
    } catch {
      return null;
    }
  }

  async remove(rel: string | null | undefined): Promise<void> {
    if (!rel) return;
    await rm(this.abs(rel), { force: true }).catch(() => {});
  }

  async size(rel: string): Promise<number | null> {
    try {
      return (await stat(this.abs(rel))).size;
    } catch {
      return null;
    }
  }

  /** alle Dateien unter dem Medienordner (relativ), für die Prüfung */
  async listAll(): Promise<string[]> {
    const out: string[] = [];
    const walk = async (dir: string) => {
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        const p = join(dir, e.name);
        if (e.isDirectory()) await walk(p);
        else if (!e.name.endsWith('.tmp')) out.push(relative(this.root, p));
      }
    };
    await walk(this.root);
    return out;
  }
}

/**
 * Blobs aus der Tabelle in die Ordner umtragen (einmalig nach dem Update, in kleinen Schritten, damit der Server
 * dabei erreichbar bleibt). Gibt die Zahl der umgetragenen Dateien zurück.
 */
export async function moveBlobs(db: Db, media: PinMedia, log: (msg: string) => void = () => {}): Promise<number> {
  let moved = 0;
  for (;;) {
    const batch = await db
      .selectFrom('pinnwand_files')
      .select(['id', 'project_id', 'scope', 'area', 'item_id', 'name'])
      .where('path', 'is', null)
      .orderBy('id')
      .limit(20)
      .execute();
    if (!batch.length) break;
    for (const f of batch) {
      const row = await db.selectFrom('pinnwand_files').select('data').where('id', '=', f.id).executeTakeFirst();
      const data = row?.data ? Buffer.from(row.data) : Buffer.alloc(0);
      const rel = media.pathFor(Number(f.project_id), f.scope, f.area, Number(f.item_id), Number(f.id), f.name);
      await media.write(rel, data);
      // erst nach dem Schreiben den Blob leeren: bricht etwas ab, bleibt er erhalten und wird später erneut umgetragen
      await db.updateTable('pinnwand_files').set({ path: rel, size: data.length, data: Buffer.alloc(0) }).where('id', '=', f.id).execute();
      moved++;
    }
  }
  if (moved) log(`Pinnwand: ${moved} Datei(en) aus der Datenbank in ${media.root} umgetragen.`);
  return moved;
}

export interface MediaCheck {
  files: number;
  missing: { id: number; path: string }[];
  wrongSize: { id: number; path: string }[];
  orphans: string[];
  inDb: number;
}

/** Prüft, ob zu jedem Eintrag die Datei da ist (und umgekehrt) – für `collegare pruefen`. */
export async function checkMedia(db: Db, media: PinMedia): Promise<MediaCheck> {
  const rows = await db.selectFrom('pinnwand_files').select(['id', 'path', 'size']).execute();
  const res: MediaCheck = { files: 0, missing: [], wrongSize: [], orphans: [], inDb: 0 };
  const known = new Set<string>();
  for (const r of rows) {
    if (!r.path) {
      res.inDb++;
      continue;
    }
    res.files++;
    known.add(r.path);
    const size = await media.size(r.path);
    if (size === null) res.missing.push({ id: Number(r.id), path: r.path });
    else if (r.size != null && Number(r.size) !== size) res.wrongSize.push({ id: Number(r.id), path: r.path });
  }
  for (const p of await media.listAll()) if (!known.has(p)) res.orphans.push(p);
  return res;
}
