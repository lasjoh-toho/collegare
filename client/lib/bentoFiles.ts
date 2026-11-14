/**
 * Datei-Aktionen der Folien-Seite für Bento (Wunsch Jo, 14. November 2026): Bento meldet „Datei › Importieren/
 * Exportieren“ per postMessage, diese Seite wählt die Datei, wandelt um und schickt das Ergebnis zurück.
 * PowerPoint-Import: bentoconvert.js aus mod_bento (nicht-kommerziell wie der Kern, scripts/bento-holen.sh);
 * PowerPoint-Export: lib/pptxExport.ts.
 */
import { BASE_PATH } from './api';

type J = Record<string, any>;

declare global {
  interface Window {
    collegareBento?: {
      convertPptx(file: File, log?: (m: string) => void): Promise<{ doc: J; warnings: string[]; slideCount: number }>;
      convertPpt(file: File): Promise<{ doc: J; warnings: string[]; slideCount: number }>;
    };
  }
}

let converter: Promise<NonNullable<Window['collegareBento']>> | null = null;
function loadConverter() {
  if (window.collegareBento) return Promise.resolve(window.collegareBento);
  converter ??= new Promise((resolve, reject) => {
    const sc = document.createElement('script');
    sc.src = `${BASE_PATH}/bento/bentoconvert.js`;
    sc.onload = () => (window.collegareBento ? resolve(window.collegareBento) : reject(new Error('PowerPoint-Import nicht geladen')));
    sc.onerror = () => {
      converter = null;
      reject(new Error('Der PowerPoint-Import ist auf diesem Server nicht installiert.'));
    };
    document.head.appendChild(sc);
  });
  return converter;
}

export function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.addEventListener('change', () => resolve(input.files?.[0] ?? null));
    input.addEventListener('cancel', () => resolve(null));
    input.click();
  });
}

export function download(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 30_000);
}

export const fileBase = (title: unknown) =>
  String(title || 'Präsentation')
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .trim()
    .slice(0, 80) || 'Präsentation';

export function checkDoc(d: unknown): J {
  const doc = d as J;
  if (!doc || typeof doc !== 'object') throw new Error('Die Datei enthält keine Präsentation.');
  if (doc.format === 'bento/enc') throw new Error('Die Präsentation ist mit einem Kennwort verschlüsselt. Bitte in Bento öffnen, das Kennwort entfernen und erneut speichern.');
  if (doc.format !== 'bento/slides' || !Array.isArray(doc.slides) || !doc.slides.length) throw new Error('Die Datei ist keine Bento-Präsentation.');
  delete doc.collab;
  return doc;
}

export async function importPowerPoint(file: File): Promise<{ doc: J; warnings: string[] }> {
  const conv = await loadConverter();
  const r = /\.ppt$/i.test(file.name) ? await conv.convertPpt(file) : await conv.convertPptx(file);
  return { doc: checkDoc(r.doc), warnings: r.warnings ?? [] };
}

/** Präsentation aus einer gespeicherten Bento-Datei (.bento.html): der Datenblock #bento-doc */
export async function importBentoHtml(file: File): Promise<J> {
  const html = await file.text();
  const m = html.match(/<script[^>]*id=["']bento-doc["'][^>]*>([\s\S]*?)<\/script>/);
  if (!m || !m[1].trim()) throw new Error('In der Datei steckt keine Bento-Präsentation.');
  return checkDoc(JSON.parse(m[1]));
}

export async function importJson(file: File): Promise<J> {
  try {
    return checkDoc(JSON.parse(await file.text()));
  } catch (e) {
    if (e instanceof SyntaxError) throw new Error('Die Datei ist kein gültiges JSON.');
    throw e;
  }
}
