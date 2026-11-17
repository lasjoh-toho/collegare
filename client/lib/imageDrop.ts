/**
 * Bilder aus anderen Tabs ziehen oder einfügen (Wunsch Jo, 17. November 2026), für „Notizen und Quellen“.
 *
 * Was der Browser beim Ziehen mitgibt: die Adresse des Bildes (text/uri-list), ein Stück HTML mit <img> (und dem
 * Link drumherum, wenn das Bild verlinkt ist), manchmal die Datei selbst. Die Seite, von der das Bild kommt, gibt er
 * nicht mit. Ist das Bild verlinkt und zeigt der Link nicht auf ein Bild, nehmen wir ihn als Ursprungsseite; Wikimedia
 * liefert Urheber und Lizenz über den Server (/api/bild-info). Sonst tragen die Lernenden die Seite nach.
 *
 * Die Bytes fremder Bilder darf der Browser wegen CORS meist nicht lesen; deshalb lädt der Server sie (POST
 * …/notizen/datei mit {url}).
 */
import { API_URL, BASE_PATH } from './api';

/** höchstens so viele Bilder auf einmal (Ziehen, Einfügen, Auswahl von einer Seite) */
export const MAX_IMAGES = 12;

export interface DroppedImage {
  /** Datei (Bildschirmfoto, aus dem Dateimanager, data:-Bild) oder Adresse im Netz */
  file?: File;
  url?: string;
  alt: string;
  /** Link um das Bild, wenn er auf eine Seite zeigt */
  page: string | null;
}

export interface UploadedFile {
  file: string;
  mime: string;
  size: number;
}

export interface ImageInfo {
  title: string;
  credit: string;
  license: string;
  licenseUrl: string | null;
  origin: string | null;
  imageUrl?: string;
  via: 'wikimedia' | 'page' | 'none';
}

export interface PageImage {
  url: string;
  alt: string;
  caption: string;
  width: number | null;
  height: number | null;
}
export interface PageInfo {
  url: string;
  title: string;
  site: string;
  author: string;
  license: string;
  licenseUrl: string | null;
  images: PageImage[];
}

const IMG_EXT = /\.(png|jpe?g|gif|webp|avif|svg)(\?|#|$)/i;
const isHttp = (u: string) => /^https?:\/\//i.test(u);
/** Adresse sieht nach Bild aus (Endung oder bekannte Bildserver) */
export const looksLikeImage = (u: string) => IMG_EXT.test(u) || /^https?:\/\/upload\.wikimedia\.org\//i.test(u);
const isOwn = (u: string) => {
  try {
    return new URL(u, location.href).origin === location.origin;
  } catch {
    return false;
  }
};

function dataUrlToFile(src: string, i: number): File | null {
  const m = /^data:(image\/[a-z0-9.+-]+);base64,(.*)$/i.exec(src);
  if (!m) return null;
  try {
    const bin = atob(m[2]);
    const buf = new Uint8Array(bin.length);
    for (let k = 0; k < bin.length; k++) buf[k] = bin.charCodeAt(k);
    return new File([buf], `bild-${i + 1}.${m[1].split('/')[1].replace('svg+xml', 'svg').replace('jpeg', 'jpg')}`, { type: m[1] });
  } catch {
    return null;
  }
}

/** Zieht die Daten eher Bilder oder einen Link? (für dragover: nur dann Ablegen anbieten) */
export function mayHoldImages(dt: DataTransfer): boolean {
  const t = [...dt.types];
  return t.includes('Files') || t.includes('text/uri-list') || t.includes('text/html');
}

/**
 * Bilder aus Ziehen/Einfügen. pageLink: ein einzelner Link ohne Bild (eine Seite) – dann „Bilder dieser Seite“
 * anbieten.
 */
export function imagesFrom(dt: DataTransfer): { images: DroppedImage[]; pageLink: string | null } {
  const images: DroppedImage[] = [];
  const seen = new Set<string>();
  for (const f of [...dt.files]) if (f.type.startsWith('image/') && images.length < MAX_IMAGES) images.push({ file: f, alt: f.name.replace(/\.[a-z0-9]+$/i, ''), page: null });
  const html = dt.getData('text/html');
  if (html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    doc.querySelectorAll('img').forEach((img, i) => {
      if (images.length >= MAX_IMAGES) return;
      const src = (img.getAttribute('src') ?? '').trim();
      const alt = (img.getAttribute('alt') ?? img.getAttribute('title') ?? '').trim().slice(0, 300);
      const a = img.closest('a')?.getAttribute('href') ?? '';
      const page = isHttp(a) && !looksLikeImage(a) ? a : null;
      if (src.startsWith('data:')) {
        const file = dataUrlToFile(src, i);
        // die Datei selbst kam meist schon über dt.files mit
        if (file && !images.some((x) => x.file && x.file.size === file.size)) images.push({ file, alt, page });
      } else if (isHttp(src) && !seen.has(src)) {
        seen.add(src);
        // bei Datei-Ziehen (Firefox) hat images schon die Datei: dann die Adresse nur als Herkunft nachtragen
        const sameFile = images.find((x) => x.file && !x.url);
        if (sameFile && dt.files.length === 1) Object.assign(sameFile, { url: src, alt: alt || sameFile.alt, page });
        else images.push({ url: src, alt, page });
      }
    });
  }
  if (images.length) return { images, pageLink: null };
  const uri = (dt.getData('text/uri-list') || dt.getData('text/x-moz-url') || dt.getData('text/plain'))
    .split(/\r?\n/)
    .map((x) => x.trim())
    .find((x) => x && !x.startsWith('#') && isHttp(x));
  if (!uri) return { images, pageLink: null };
  if (looksLikeImage(uri) && !isOwn(uri)) return { images: [{ url: uri, alt: '', page: null }], pageLink: null };
  return { images, pageLink: isOwn(uri) ? null : uri };
}

const api = (path: string) => API_URL + BASE_PATH + path;

async function json<T>(res: Response): Promise<T> {
  const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw Object.assign(new Error(typeof j.error === 'string' ? j.error : `Fehler ${res.status}`), { code: j.code, page: j.page });
  return j as T;
}

/** Bild in die Ablage der Notizen: Datei hochladen oder den Server die Adresse holen lassen */
export async function uploadImage(projectId: number, scope: string, img: { file?: File; url?: string }): Promise<UploadedFile> {
  if (img.file) {
    const q = new URLSearchParams({ scope, name: img.file.name || 'bild' });
    return json(await fetch(api(`/api/projects/${projectId}/notizen/datei?${q}`), { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/octet-stream' }, body: img.file }));
  }
  return json(await fetch(api(`/api/projects/${projectId}/notizen/datei`), { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ scope, url: img.url }) }));
}

export async function imageInfo(url: string, page: string | null): Promise<ImageInfo> {
  const q = new URLSearchParams({ url });
  if (page) q.set('seite', page);
  return json(await fetch(api(`/api/bild-info?${q}`), { credentials: 'include' }));
}

export async function readPage(url: string): Promise<PageInfo> {
  return json(await fetch(api(`/api/seite-lesen?${new URLSearchParams({ url })}`), { credentials: 'include' }));
}

/** fremdes Bild zur Vorschau über den Server (CORS) */
export const proxied = (url: string) => api(`/api/bild-holen?${new URLSearchParams({ url })}`);

/** Datei einer Notiz (v = Stand, damit ein getauschtes Bild nicht aus dem Zwischenspeicher kommt) */
export const noteFileUrl = (projectId: number, noteId: number, v: number) => api(`/api/projects/${projectId}/notizen/${noteId}/datei?v=${v}`);

/**
 * Format für Ziehen in Bento (Folien): Bento liest application/x-bento-image und übernimmt Bild und Quellenangabe
 * (Citation in Bento: author, title, sourceUrl, retrievedAt).
 */
export const BENTO_IMAGE_MIME = 'application/x-bento-image';
export interface BentoImageDrag {
  url: string;
  alt: string;
  citation: { author?: string; title?: string; sourceUrl: string; retrievedAt: string; license?: string };
}
export function setImageDrag(dt: DataTransfer, d: BentoImageDrag) {
  const absUrl = new URL(d.url, location.href).href;
  dt.setData(BENTO_IMAGE_MIME, JSON.stringify({ ...d, url: absUrl }));
  dt.setData('text/uri-list', absUrl);
}

/** Angaben, mit denen eine Bild-Notiz angelegt wird (notes:add, kind image) */
export interface ImageNoteInput {
  kind: 'image';
  title: string;
  body: string;
  source: string;
  url: string;
  credit: string;
  license: string;
  origin: string;
  file: string;
}

/**
 * Bilder nacheinander übernehmen: hochladen bzw. vom Server holen lassen, Angaben zur Quelle suchen, Notiz anlegen.
 * Gibt zurück, wie viele angekommen sind, und die erste Fehlermeldung.
 */
export async function takeImages(
  projectId: number,
  scope: string,
  images: (DroppedImage & { title?: string; credit?: string; license?: string })[],
  addNote: (n: ImageNoteInput) => Promise<{ ok: boolean; error?: string }>,
  progress?: (done: number, all: number) => void,
): Promise<{ added: number; error: string | null; page: string | null }> {
  let added = 0;
  let error: string | null = null;
  let page: string | null = null;
  const list = images.slice(0, MAX_IMAGES);
  for (const [i, img] of list.entries()) {
    progress?.(i, list.length);
    try {
      // Wikimedia und verlinkte Seiten: Angaben vorab, dort steht ggf. eine handlichere Bildgröße
      const info = img.url && (img.page || looksLikeImage(img.url)) ? await imageInfo(img.url, img.page).catch(() => null) : null;
      const up = await uploadImage(projectId, scope, img.file ? { file: img.file } : { url: info?.imageUrl ?? img.url });
      const r = await addNote({
        kind: 'image',
        title: (img.title || info?.title || img.alt || '').slice(0, 200),
        body: '',
        source: '',
        url: img.url ?? '',
        credit: (img.credit || info?.credit || '').slice(0, 300),
        license: (img.license || info?.license || '').slice(0, 200),
        origin: info?.origin ?? img.page ?? '',
        file: up.file,
      });
      if (r.ok) added++;
      else error ??= r.error ?? 'Speichern fehlgeschlagen';
    } catch (e) {
      const x = e as Error & { page?: boolean };
      // ein Link auf eine Seite statt auf ein Bild
      if (x.page && img.url && list.length === 1) page = img.url;
      else error ??= x.message;
    }
  }
  progress?.(list.length, list.length);
  return { added, error, page };
}
