/**
 * Texterkennung für „Bild aufnehmen“ (Wunsch Jo, 24. November 2026). Das gespeicherte Bild bleibt wie aufgenommen;
 * erst unmittelbar vor der Erkennung bereitet der Browser eine Kopie auf (Jo: „Bilder müssten nicht automatisch im
 * Scanner farblich angepasst werden. Das könnte dann vor der Erkennung passieren.“):
 *  - verkleinern auf höchstens 2000 Bildpunkte Kantenlänge (Grenze vieler Bildmodelle, weniger Tokens),
 *  - Weißabgleich und Aufhellen des Papiers wie der Dokumentfilter des Autogra.fi-Scanners (options.js),
 *  - Graustufen mit Kontraststreckung (1. und 99. Perzentil), damit Bleistift und blasse Tinte deutlich werden.
 * Die Kopie geht an den Server, der sie an die KI-Modellkarte „Texterkennung“ weiterreicht und nicht speichert.
 */
import { API_URL, BASE_PATH, get, post } from './api';

const MAX_EDGE = 2000;

export interface OcrState {
  available: boolean;
  reason?: string;
}

export const ocrState = (projectId: number) => get<OcrState>(`/api/projects/${projectId}/texterkennung`);

function load(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'use-credentials';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Das Bild ließ sich nicht laden.'));
    img.src = src;
  });
}

/** Aufbereitete Kopie für die Erkennung (JPEG) */
export async function prepareForOcr(src: string): Promise<Blob> {
  const img = await load(src);
  const k = Math.min(1, MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * k));
  const h = Math.max(1, Math.round(img.naturalHeight * k));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  const id = ctx.getImageData(0, 0, w, h);
  const px = id.data;
  // Weißabgleich (Grauwelt) wie enhanceDocument im Scanner
  let sr = 0,
    sg = 0,
    sb = 0;
  for (let i = 0; i < px.length; i += 4) {
    sr += px[i];
    sg += px[i + 1];
    sb += px[i + 2];
  }
  const n = px.length / 4;
  const gray = (sr + sg + sb) / (3 * n);
  const fr = gray / (sr / n || 1),
    fg = gray / (sg / n || 1),
    fb = gray / (sb / n || 1);
  // Graustufen und Verteilung für die Kontraststreckung
  const lum = new Uint8ClampedArray(n);
  const hist = new Uint32Array(256);
  for (let i = 0, j = 0; i < px.length; i += 4, j++) {
    const r = Math.min(255, px[i] * fr),
      g = Math.min(255, px[i + 1] * fg),
      b = Math.min(255, px[i + 2] * fb);
    const l = 0.299 * r + 0.587 * g + 0.114 * b;
    lum[j] = l;
    hist[lum[j]]++;
  }
  const pct = (p: number) => {
    let acc = 0;
    for (let v = 0; v < 256; v++) {
      acc += hist[v];
      if (acc >= n * p) return v;
    }
    return 255;
  };
  const lo = pct(0.01);
  const hi = Math.max(lo + 1, pct(0.99));
  for (let i = 0, j = 0; i < px.length; i += 4, j++) {
    // strecken, dann helles Papier ganz weiß (wie „Aufhellen“ im Dokumentfilter)
    let v = ((lum[j] - lo) / (hi - lo)) * 255;
    if (v > 215) v = 255;
    px[i] = px[i + 1] = px[i + 2] = v;
  }
  ctx.putImageData(id, 0, 0);
  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('Bild ließ sich nicht aufbereiten.'))), 'image/jpeg', 0.88));
}

export async function recognizeText(projectId: number, src: string): Promise<string> {
  const blob = await prepareForOcr(src);
  const res = await fetch(API_URL + BASE_PATH + `/api/projects/${projectId}/notizen/erkennen`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/octet-stream' },
    body: blob,
  });
  const j = (await res.json().catch(() => ({}))) as { text?: string; error?: string };
  if (!res.ok) throw new Error(j.error ?? `Fehler ${res.status}`);
  return j.text ?? '';
}

/** Erkannten Text zur gespeicherten Notiz ins Einfüge-Protokoll (Herkunft „Handschrift“ statt „von außen“) */
export const logRecognised = (projectId: number, noteId: number, text: string) => post(`/api/projects/${projectId}/notizen/${noteId}/erkannt`, { text, script: 'hand' }).catch(() => {});
