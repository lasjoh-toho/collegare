/**
 * Kollaborationsserver für die OnlyOffice-Editoren.
 *
 * Ersetzt den MockSocket aus office-website: Die Editoren im Browser schicken ihre
 * Protokollnachrichten (auth, getLock, saveChanges, …) über socket.io hierher, der Server
 * speichert Änderungen mit Person und Zeit, vergibt Block-Sperren und verteilt alles an die
 * anderen Teilnehmenden. Referenz für das Nachrichtenformat: ONLYOFFICE/server,
 * DocService/sources/DocsCoServer.js (AGPL-3.0).
 */
import type { Server, Socket } from 'socket.io';
import { DocRegistry, DocState, type EditorKind, type Lock, type Participant, blockKey, cursorBlock } from './docState.js';

export interface CoServerOptions {
  buildVersion?: string;
  buildNumber?: number;
  now?: () => number;
  log?: (msg: string, data?: unknown) => void;
}

interface ConnInfo {
  doc: DocState;
  user: { id: string; name: string };
  view: boolean;
  participant?: Participant;
}

type Msg = Record<string, unknown> & { type?: string };

const ROOM = (docId: string) => `doc:${docId}`;

function parseKind(v: unknown): EditorKind {
  return v === 'slide' || v === 'cell' ? v : 'word';
}

function releasedForClient(locks: Lock[], now: number) {
  return locks.map((l) => ({ block: l.block, user: l.user, time: now, changes: null }));
}

export class CoServer {
  readonly docs = new DocRegistry();
  private conns = new Map<string, ConnInfo>();
  private now: () => number;
  private log: (msg: string, data?: unknown) => void;

  constructor(private io: Server, private opts: CoServerOptions = {}) {
    this.now = opts.now ?? Date.now;
    this.log = opts.log ?? (() => {});
    io.of('/collab').on('connection', (socket) => this.onConnection(socket));
  }

  private nsp() {
    return this.io.of('/collab');
  }

  private onConnection(socket: Socket) {
    const q = { ...(socket.handshake.query as Record<string, unknown>), ...(socket.handshake.auth as Record<string, unknown>) };
    const docId = typeof q.docId === 'string' ? q.docId : '';
    const userId = typeof q.userId === 'string' ? q.userId : '';
    if (!docId || !userId) {
      socket.emit('message', { type: 'drop', code: 4001, description: 'docId und userId fehlen' });
      socket.disconnect(true);
      return;
    }
    const doc = this.docs.get(docId, parseKind(q.kind));
    const info: ConnInfo = {
      doc,
      user: { id: userId, name: typeof q.userName === 'string' && q.userName ? q.userName : userId },
      view: q.view === '1' || q.view === true,
    };
    this.conns.set(socket.id, info);
    void socket.join(ROOM(docId));

    socket.on('message', (msg: Msg) => {
      try {
        this.onMessage(socket, info, msg);
      } catch (e) {
        this.log('Fehler bei Nachricht', { type: msg?.type, error: String(e) });
      }
    });
    socket.on('collegare:event', (ev: { kind?: string; data?: Record<string, unknown> }) => {
      if (!ev || typeof ev.kind !== 'string') return;
      doc.events.push({ time: this.now(), user: info.user.id, kind: ev.kind, data: ev.data ?? {} });
    });
    socket.on('disconnect', () => this.onDisconnect(socket, info));
  }

  private send(socket: Socket, data: Msg) {
    socket.emit('message', data);
  }

  private toOthers(socket: Socket, info: ConnInfo, data: Msg) {
    socket.to(ROOM(info.doc.id)).emit('message', data);
  }

  private toAll(doc: DocState, data: Msg) {
    this.nsp().to(ROOM(doc.id)).emit('message', data);
  }

  private onMessage(socket: Socket, info: ConnInfo, msg: Msg) {
    const { doc } = info;
    switch (msg?.type) {
      case 'auth':
        return this.onAuth(socket, info);
      case 'getLock': {
        if (info.view) return this.send(socket, { type: 'getLock', locks: doc.locksForClient() });
        const blocks = Array.isArray(msg.block) ? msg.block : msg.block != null ? [msg.block] : [];
        const res = doc.acquire(info.user.id, blocks, this.now());
        if (!res.granted) this.log('Sperre verweigert', { doc: doc.id, user: info.user.id, refused: res.refused });
        const locks = doc.locksForClient();
        this.send(socket, { type: 'getLock', locks });
        if (res.granted) this.toOthers(socket, info, { type: 'getLock', locks });
        return;
      }
      case 'saveChanges':
        return this.onSaveChanges(socket, info, msg);
      case 'isSaveLock': {
        const free = doc.saveLockUser === null || doc.saveLockUser === info.user.id;
        if (free) doc.saveLockUser = info.user.id;
        return this.send(socket, { type: 'saveLock', saveLock: !free });
      }
      case 'unSaveLock':
      case 'unLockDocument': {
        if (msg.releaseLocks) this.releaseLocksOf(socket, info);
        if (typeof msg.deleteIndex === 'number') doc.truncate(msg.deleteIndex);
        if (doc.saveLockUser === info.user.id) doc.saveLockUser = null;
        if (msg.isSave || msg.type === 'unSaveLock') {
          this.send(socket, { type: 'unSaveLock', index: -1, time: -1, syncChangesIndex: -1 });
        }
        return;
      }
      case 'cursor': {
        if (doc.kind === 'word') {
          const block = cursorBlock(msg.cursor);
          if (block) doc.cursorBlocks.set(info.user.id, block);
        }
        const m = { cursor: msg.cursor, time: this.now(), user: info.user.id, useridoriginal: info.user.id };
        return this.toOthers(socket, info, { type: 'cursor', messages: [m] });
      }
      case 'message': {
        const m = { docid: doc.id, message: msg.message, time: this.now(), user: info.user.id, useridoriginal: info.user.id, username: info.user.name };
        return this.toAll(doc, { type: 'message', messages: [m] });
      }
      case 'getMessages':
        return this.send(socket, { type: 'message', messages: undefined });
      case 'extendSession':
      case 'clientLog':
      case 'authChangesAck':
      case 'close':
      case 'openDocument':
        return;
      default:
        this.log('Unbekannte Nachricht', msg?.type);
    }
  }

  private onAuth(socket: Socket, info: ConnInfo) {
    const { doc } = info;
    const participant = doc.join({
      connectionId: socket.id,
      id: info.user.id,
      idOriginal: info.user.id,
      username: info.user.name,
      view: info.view,
      isCloseCoAuthoring: false,
      isLiveViewer: false,
      encrypted: false,
    });
    info.participant = participant;
    if (doc.changes.length > 0) this.send(socket, { type: 'authChanges', changes: doc.changes });
    const participants = doc.participantList();
    this.send(socket, {
      type: 'auth',
      result: 1,
      sessionId: socket.id,
      sessionTimeConnect: this.now(),
      participants,
      locks: doc.locksForClient(),
      indexUser: participant.indexUser,
      buildVersion: this.opts.buildVersion ?? '9.3.1',
      buildNumber: this.opts.buildNumber ?? 10,
      licenseType: 3,
      settings: {},
    });
    this.toOthers(socket, info, { type: 'connectState', participantsTimestamp: this.now(), participants, waitAuth: false });
  }

  private onSaveChanges(socket: Socket, info: ConnInfo, msg: Msg) {
    const { doc } = info;
    if (info.view) return;
    if (msg.startSaveChanges && typeof msg.deleteIndex === 'number' && msg.deleteIndex !== -1) doc.truncate(msg.deleteIndex);
    let raw: unknown[] = [];
    if (typeof msg.changes === 'string') {
      try {
        raw = JSON.parse(msg.changes) as unknown[];
      } catch {
        raw = [];
      }
    } else if (Array.isArray(msg.changes)) {
      raw = msg.changes;
    }
    const now = this.now();
    const { startIndex, changesIndex, added } = doc.append(info.user.id, info.user.id, raw, now);
    const ownIndex = msg.startSaveChanges && (msg.deleteIndex == null || msg.deleteIndex === -1) ? startIndex : -1;
    if (msg.endSaveChanges) {
      const released = msg.releaseLocks ? doc.releaseUser(info.user.id) : [];
      this.toOthers(socket, info, {
        type: 'saveChanges',
        changes: added,
        changesIndex,
        syncChangesIndex: changesIndex,
        endSaveChanges: true,
        locks: releasedForClient(released, now),
        excelAdditionalInfo: msg.excelAdditionalInfo,
      });
      if (doc.saveLockUser === info.user.id) doc.saveLockUser = null;
      this.send(socket, { type: 'unSaveLock', index: ownIndex, time: now, syncChangesIndex: changesIndex });
    } else {
      this.toOthers(socket, info, {
        type: 'saveChanges',
        changes: added,
        changesIndex,
        syncChangesIndex: changesIndex,
        endSaveChanges: false,
        locks: [],
      });
      this.send(socket, { type: 'savePartChanges', changesIndex: ownIndex, syncChangesIndex: changesIndex });
    }
  }

  private releaseLocksOf(socket: Socket | null, info: ConnInfo) {
    const released = info.doc.releaseUser(info.user.id);
    if (released.length === 0) return;
    const data = { type: 'releaseLock', locks: releasedForClient(released, this.now()) };
    if (socket) {
      this.send(socket, data);
      this.toOthers(socket, info, data);
    } else {
      this.toAll(info.doc, data);
    }
  }

  private onDisconnect(socket: Socket, info: ConnInfo) {
    this.conns.delete(socket.id);
    const { doc } = info;
    doc.leave(socket.id);
    const stillThere = doc.participantList().some((p) => p.id === info.user.id);
    if (!stillThere) {
      const released = doc.releaseUser(info.user.id);
      if (released.length) this.toAll(doc, { type: 'releaseLock', locks: releasedForClient(released, this.now()) });
      if (doc.saveLockUser === info.user.id) doc.saveLockUser = null;
    }
    this.toAll(doc, { type: 'connectState', participantsTimestamp: this.now(), participants: doc.participantList(), waitAuth: false });
  }

  /** Collegare-Erweiterung: Blöcke als fertig markieren und allen Editoren die neue Sperre melden. */
  finish(docId: string, user: string, keys?: string[]) {
    const doc = this.docs.peek(docId);
    if (!doc) return { finished: [], refused: [] };
    const wanted = keys && keys.length ? keys : [...(doc.recentBlocks.get(user)?.keys() ?? [])];
    const res = doc.finish(user, wanted, this.now());
    if (res.finished.length) this.toAll(doc, { type: 'getLock', locks: doc.locksForClient() });
    return res;
  }

  reopen(docId: string, key: string) {
    const doc = this.docs.peek(docId);
    const f = doc?.reopen(key);
    if (doc && f) {
      this.toAll(doc, { type: 'releaseLock', locks: [{ block: f.block, user: 'collegare-fertig:' + f.owner, time: this.now(), changes: null }] });
    }
    return !!f;
  }

  state(docId: string) {
    const doc = this.docs.peek(docId);
    if (!doc) return null;
    return {
      id: doc.id,
      kind: doc.kind,
      changes: doc.changes.length,
      changesByUser: doc.changes.reduce<Record<string, number>>((m, c) => ((m[c.user] = (m[c.user] ?? 0) + 1), m), {}),
      locks: [...doc.locks.entries()].map(([key, l]) => ({ key, user: l.user })),
      finished: [...doc.finished.values()].map((f) => ({ key: f.key, owner: f.owner })),
      cursors: Object.fromEntries(doc.cursorBlocks),
      authors: Object.fromEntries([...doc.blockAuthors.entries()].map(([k, s]) => [k, [...s]])),
      participants: doc.participantList().map((p) => ({ id: p.id, name: p.username })),
      events: doc.events,
    };
  }
}

export { blockKey };
