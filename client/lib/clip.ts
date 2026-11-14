/**
 * Herkunftsmarke in der Zwischenablage (Konzept 6.1, 8d.3): Was innerhalb von Collegare kopiert wird, trägt eine Marke
 * mit Projekt, Herkunft (z. B. Karte „Ursachen“), Person und Zeit. Beim Einsetzen erkennt der Karten-Editor daran, dass
 * der Text aus dem Projekt stammt, und bietet die Zuschreibung an. Die Marke steht zusätzlich in localStorage, weil
 * manche Browser (besonders mobil) eigene Formate in der Zwischenablage verwerfen.
 */
export const CLIP_MIME = 'application/x-collegare';
const KEY = 'collegare-clip';

export interface ClipMark {
  projectId: number;
  text: string;
  /** Herkunft, z. B. Karte „Ursachen“ */
  from: string;
  by: string;
  at: number;
}

const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Kopierter Text aus Eingabefeldern oder aus der Seite */
function selectedText(target: EventTarget | null): string {
  const el = target as HTMLInputElement | HTMLTextAreaElement | null;
  if (el && (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') && typeof el.selectionStart === 'number') {
    return el.value.slice(el.selectionStart, el.selectionEnd ?? el.selectionStart);
  }
  return window.getSelection()?.toString() ?? '';
}

/** Kopieren in der Projektoberfläche mit Marke versehen; gibt die Aufräumfunktion zurück. */
export function watchCopy(projectId: number, by: string): () => void {
  const onCopy = (e: ClipboardEvent) => {
    const text = selectedText(e.target);
    if (!text.trim()) return;
    const host = (e.target as Element | null)?.closest?.('[data-clip]');
    const mark: ClipMark = { projectId, text, from: host?.getAttribute('data-clip') || 'Collegare', by, at: Date.now() };
    try {
      e.clipboardData?.setData(CLIP_MIME, JSON.stringify(mark));
    } catch {
      /* Format nicht erlaubt: localStorage genügt */
    }
    try {
      localStorage.setItem(KEY, JSON.stringify(mark));
    } catch {
      /* privates Fenster */
    }
  };
  document.addEventListener('copy', onCopy, true);
  document.addEventListener('cut', onCopy, true);
  return () => {
    document.removeEventListener('copy', onCopy, true);
    document.removeEventListener('cut', onCopy, true);
  };
}

/** Stammt der eingesetzte Text aus diesem Projekt? Dann die Marke, sonst null. */
export function clipOrigin(data: DataTransfer | null, projectId: number, text: string): ClipMark | null {
  const candidates: string[] = [];
  try {
    const raw = data?.getData(CLIP_MIME);
    if (raw) candidates.push(raw);
  } catch {
    /* ignorieren */
  }
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) candidates.push(raw);
  } catch {
    /* ignorieren */
  }
  for (const raw of candidates) {
    try {
      const m = JSON.parse(raw) as ClipMark;
      if (m.projectId === projectId && norm(m.text) === norm(text)) return m;
    } catch {
      /* kaputte Marke */
    }
  }
  return null;
}
