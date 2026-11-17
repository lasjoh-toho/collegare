/**
 * Dateien der Notizen und Quellen (Bilder; später Audio, Video, Handschrift) als Dateien je Gruppe:
 *   <DATA_DIR>/notizen/<Projekt>/<Bereich>/<Zufall>-<Name>
 * Erst wird hochgeladen (oder vom Server aus dem Netz geholt), dann verweist die Notiz beim Anlegen auf den
 * zurückgegebenen Pfad. Der Pfad ist zufällig und gehört zu Projekt und Bereich; notes:add prüft beides.
 */
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';

const safe = (s: string) => s.replace(/[^\p{L}\p{N}._-]+/gu, '_').replace(/^\.+/, '_').slice(0, 80) || 'datei';

/**
 * Erlaubte Dateitypen der Notizen an einer Stelle (für Video, Audio, Handschrift hier ergänzen). SVG nur mit
 * Sandbox ausliefern (siehe Route), weil es Skript enthalten kann.
 */
export const NOTE_FILE_TYPES: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/svg+xml': 'svg',
  // Audio und Video (Konzept 8e.5): Aufnahme am Handy (MediaRecorder: WebM/Ogg/MP4) oder hochgeladen
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/ogg': 'ogg',
  'audio/wav': 'wav',
  'audio/flac': 'flac',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
};

/** Größte Bilddatei; Audio und Video richten sich nach maxFileMb des Projekts, höchstens MEDIA_MAX_BYTES */
export const MEDIA_MAX_BYTES = 200 * 1024 * 1024; // wie der Parser für application/octet-stream (routes/materials.ts)
export const noteFileAllowed = (mime: string) => Object.hasOwn(NOTE_FILE_TYPES, mime);

export class NoteFiles {
  readonly root: string;
  constructor(dataDir: string) {
    this.root = resolve(dataDir, 'notizen');
  }

  /** Ordnerpräfix eines Bereichs (relativ), z. B. „12/g3/“ */
  prefix(projectId: number, scope: string): string {
    return `${Math.trunc(projectId)}/${safe(scope)}/`;
  }

  private abs(rel: string): string {
    const p = resolve(this.root, rel);
    if (!p.startsWith(this.root + sep)) throw new Error('Pfad außerhalb des Notizordners');
    return p;
  }

  /** gehört der Pfad zu diesem Bereich und ist er ein schlichter Dateiname darunter? */
  belongs(rel: string, projectId: number, scope: string): boolean {
    const pre = this.prefix(projectId, scope);
    return rel.startsWith(pre) && /^[0-9a-f]{16}-[\p{L}\p{N}._-]+$/u.test(rel.slice(pre.length));
  }

  async store(projectId: number, scope: string, name: string, data: Buffer): Promise<string> {
    const rel = relative(this.root, join(this.root, this.prefix(projectId, scope), `${randomBytes(8).toString('hex')}-${safe(name)}`)).split(sep).join('/');
    const p = this.abs(rel);
    await mkdir(dirname(p), { recursive: true });
    const tmp = `${p}.${randomBytes(4).toString('hex')}.tmp`;
    await writeFile(tmp, data);
    await rename(tmp, p);
    return rel;
  }

  async read(rel: string): Promise<Buffer | null> {
    try {
      return await readFile(this.abs(rel));
    } catch {
      return null;
    }
  }

  async size(rel: string): Promise<number | null> {
    try {
      return (await stat(this.abs(rel))).size;
    } catch {
      return null;
    }
  }

  async remove(rel: string | null | undefined): Promise<void> {
    if (!rel) return;
    await rm(this.abs(rel), { force: true }).catch(() => {});
  }
}
