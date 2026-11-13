/** Chat-Beiträge in die Mindmap ziehen (Wunsch Jo, 11. November 2026): gemeinsames Format für Ziehen und Ablegen. */
export const CHAT_MIME = 'application/x-collegare-chat';

export interface ChatDrop {
  name: string;
  body: string;
  /** aus „Notizen und Quellen“: Karte folgt der Notiz */
  note?: { id: number; title: string; text: string };
}

export function setChatDrag(e: React.DragEvent, d: ChatDrop) {
  e.dataTransfer.setData(CHAT_MIME, JSON.stringify(d));
  e.dataTransfer.setData('text/plain', d.body);
  e.dataTransfer.effectAllowed = 'copy';
}

export const isChatDrag = (e: React.DragEvent) => e.dataTransfer.types.includes(CHAT_MIME);

export function readChatDrop(e: React.DragEvent): ChatDrop | null {
  try {
    const d = JSON.parse(e.dataTransfer.getData(CHAT_MIME)) as ChatDrop;
    return typeof d?.body === 'string' ? d : null;
  } catch {
    return null;
  }
}

/** Titel und Text einer Karte aus einem Beitrag: erste Zeile (gekürzt) als Titel, der Rest als Text. */
export function cardFromChat(d: ChatDrop): { title: string; text: string; noteId?: number } {
  if (d.note) return { title: d.note.title.slice(0, 200), text: d.note.text.slice(0, 5000), noteId: d.note.id };
  const body = d.body.trim();
  const nl = body.indexOf('\n');
  const first = (nl >= 0 ? body.slice(0, nl) : body).trim();
  const title = first.length > 120 ? first.slice(0, 117).trimEnd() + '…' : first;
  const rest = body.length > title.length ? body : '';
  return { title, text: (rest ? rest + '\n' : '') + `(aus dem Chat, ${d.name})`.slice(0, 5000) };
}
