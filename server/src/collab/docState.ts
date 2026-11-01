/**
 * Zustand eines gemeinsam bearbeiteten Dokuments (Abschnitt, Folien, Handout).
 *
 * Bildet die Teile des OnlyOffice-Kollaborationsprotokolls nach, die der Editor braucht:
 * Änderungsliste (mit Person und Zeit), Block-Sperren (Absatz bzw. Folie) und Anwesenheit.
 * Dazu kommt die Collegare-Erweiterung „fertig“: Blöcke, die als fertig markiert sind,
 * tragen eine dauerhafte Sperre, die niemand per getLock erhält.
 *
 * M0-Spike: nur im Speicher. Ab M1 liegen Änderungen und Sperren in MariaDB.
 */

export type EditorKind = 'word' | 'slide' | 'cell';

export interface Participant {
  connectionId: string;
  id: string;
  idOriginal: string;
  username: string;
  indexUser: number;
  view: boolean;
  isCloseCoAuthoring: boolean;
  isLiveViewer: boolean;
  encrypted: boolean;
}

/** Ein gespeichertes Änderungspaket, im Format, das der Editor in authChanges/saveChanges erwartet. */
export interface StoredChange {
  docid: string;
  change: string;
  time: number;
  user: string;
  useridoriginal: string;
}

export interface Lock {
  time: number;
  user: string;
  block: unknown;
}

/** Präfix der Pseudo-Person, der fertig markierte Blöcke gehören. */
export const FINISHED_USER_PREFIX = 'collegare-fertig:';

export function blockKey(block: unknown): string {
  if (typeof block === 'string') return block;
  if (block && typeof block === 'object') {
    const b = block as Record<string, unknown>;
    if (typeof b.guid === 'string') return b.guid;
  }
  return JSON.stringify(block);
}

/**
 * Liest die Element-ID aus einer Cursor-Nachricht des Texteditors.
 * Format (beobachtet, OnlyOffice 9.3): "<Länge>;<base64>", base64 = int32 Bytelänge, UTF-16LE-ID, int32 Position.
 * Achtung: Das ist die ID des innersten Elements (Textlauf), nicht die des Absatzes. Für Sperren
 * braucht es die Absatz-ID, die der Browser aus dem Editor liest (M1).
 */
export function cursorBlock(cursor: unknown): string | null {
  if (typeof cursor !== 'string') return null;
  const i = cursor.indexOf(';');
  if (i < 0) return null;
  try {
    const buf = Buffer.from(cursor.slice(i + 1), 'base64');
    if (buf.length < 4) return null;
    const len = buf.readInt32LE(0);
    if (len <= 0 || len % 2 !== 0 || 4 + len > buf.length) return null;
    const id = buf.subarray(4, 4 + len).toString('utf16le');
    return /^[\w.-]{1,64}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

export interface FinishedBlock {
  key: string;
  block: unknown;
  owner: string;
  time: number;
}

export interface ProcessEvent {
  time: number;
  user: string;
  kind: string;
  data: Record<string, unknown>;
}

export class DocState {
  readonly changes: StoredChange[] = [];
  readonly locks = new Map<string, Lock>();
  readonly finished = new Map<string, FinishedBlock>();
  readonly participants = new Map<string, Participant>();
  /** Zuletzt von einer Person gesperrte Blöcke (für „Fertig markieren“ im Spike). */
  readonly recentBlocks = new Map<string, Map<string, unknown>>();
  /** Wer zuletzt an einem Block gearbeitet hat (Grundlage für „allein bearbeitet“). */
  readonly blockAuthors = new Map<string, Set<string>>();
  readonly events: ProcessEvent[] = [];
  /** Element unter dem Cursor einer Person (aus Cursor-Nachrichten; Textlauf, nicht Absatz). */
  readonly cursorBlocks = new Map<string, string>();
  private nextIndexUser = 1;
  saveLockUser: string | null = null;

  constructor(readonly id: string, readonly kind: EditorKind) {}

  join(p: Omit<Participant, 'indexUser'>): Participant {
    const existing = [...this.participants.values()].find((x) => x.id === p.id);
    const full: Participant = { ...p, indexUser: existing?.indexUser ?? this.nextIndexUser++ };
    this.participants.set(p.connectionId, full);
    return full;
  }

  leave(connectionId: string): Participant | undefined {
    const p = this.participants.get(connectionId);
    this.participants.delete(connectionId);
    return p;
  }

  participantList(): Participant[] {
    return [...this.participants.values()];
  }

  /** Sperren in der Form, die der Editor im auth-/getLock-Paket erwartet (Text: Objekt, sonst Liste). */
  locksForClient(): Record<string, Lock> | Lock[] {
    const all = new Map<string, Lock>(this.locks);
    for (const f of this.finished.values()) {
      all.set(f.key, { time: f.time, user: FINISHED_USER_PREFIX + f.owner, block: f.block });
    }
    if (this.kind === 'word') return Object.fromEntries(all);
    return [...all.values()];
  }

  /**
   * Versucht, Blöcke für eine Person zu sperren. Alles oder nichts, wie im Dokumentenserver:
   * Ist ein Block durch andere gesperrt oder fertig markiert, wird keine der neuen Sperren vergeben.
   */
  acquire(user: string, blocks: unknown[], now: number): { granted: boolean; refused: string[] } {
    const refused: string[] = [];
    for (const block of blocks) {
      const key = blockKey(block);
      if (this.finished.has(key)) {
        refused.push(key);
        continue;
      }
      const held = this.locks.get(key);
      if (held && held.user !== user) refused.push(key);
    }
    if (refused.length > 0) return { granted: false, refused };
    let recent = this.recentBlocks.get(user);
    if (!recent) this.recentBlocks.set(user, (recent = new Map()));
    for (const block of blocks) {
      const key = blockKey(block);
      this.locks.set(key, { time: now, user, block });
      recent.set(key, block);
    }
    return { granted: true, refused };
  }

  releaseUser(user: string): Lock[] {
    const released: Lock[] = [];
    for (const [key, lock] of this.locks) {
      if (lock.user === user) {
        this.locks.delete(key);
        released.push(lock);
      }
    }
    return released;
  }

  /** Hängt Änderungen an, merkt sich die Autorschaft der aktuell gesperrten Blöcke und liefert den neuen Index. */
  append(user: string, idOriginal: string, rawChanges: unknown[], now: number): { startIndex: number; changesIndex: number; added: StoredChange[] } {
    const startIndex = this.changes.length;
    const added = rawChanges.map((c) => ({
      docid: this.id,
      // wie DocsCoServer ohne binaryChanges: jedes Element JSON-kodiert speichern
      change: JSON.stringify(c),
      time: now,
      user,
      useridoriginal: idOriginal,
    }));
    this.changes.push(...added);
    const touched = new Set<string>();
    for (const [key, lock] of this.locks) if (lock.user === user) touched.add(key);
    for (const key of touched) {
      let authors = this.blockAuthors.get(key);
      if (!authors) this.blockAuthors.set(key, (authors = new Set()));
      authors.add(user);
      let recent = this.recentBlocks.get(user);
      if (!recent) this.recentBlocks.set(user, (recent = new Map()));
      if (!recent.has(key)) recent.set(key, this.locks.get(key)?.block ?? key);
    }
    return { startIndex, changesIndex: this.changes.length, added };
  }

  /** Entfernt Änderungen ab einem Index (Editor schickt deleteIndex beim Neuaufsetzen). */
  truncate(deleteIndex: number): void {
    if (deleteIndex >= 0 && deleteIndex < this.changes.length) this.changes.length = deleteIndex;
  }

  /**
   * Markiert Blöcke als fertig. Nur erlaubt, wenn die Person allein daran gearbeitet hat
   * (laut Revisionshistorie) und niemand sonst den Block gerade gesperrt hält.
   */
  finish(user: string, keys: string[], now: number): { finished: string[]; refused: { key: string; reason: string }[] } {
    const finished: string[] = [];
    const refused: { key: string; reason: string }[] = [];
    for (const key of keys) {
      const authors = this.blockAuthors.get(key);
      const others = authors ? [...authors].filter((a) => a !== user) : [];
      if (others.length > 0) {
        refused.push({ key, reason: 'mitautoren' });
        continue;
      }
      const held = this.locks.get(key);
      if (held && held.user !== user) {
        refused.push({ key, reason: 'gesperrt' });
        continue;
      }
      const block = held?.block ?? this.recentBlocks.get(user)?.get(key) ?? key;
      this.locks.delete(key);
      this.finished.set(key, { key, block, owner: user, time: now });
      finished.push(key);
    }
    return { finished, refused };
  }

  reopen(key: string): FinishedBlock | undefined {
    const f = this.finished.get(key);
    this.finished.delete(key);
    return f;
  }
}

export class DocRegistry {
  private docs = new Map<string, DocState>();

  get(id: string, kind: EditorKind = 'word'): DocState {
    let d = this.docs.get(id);
    if (!d) this.docs.set(id, (d = new DocState(id, kind)));
    return d;
  }

  peek(id: string): DocState | undefined {
    return this.docs.get(id);
  }
}
