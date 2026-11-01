import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { io as ioc, type Socket } from 'socket.io-client';
import type { AddressInfo } from 'node:net';
import { buildApp, type App } from '../src/app.js';

let app: App;
let base: string;
const sockets: Socket[] = [];

beforeEach(async () => {
  app = buildApp();
  await app.http.listen({ port: 0, host: '127.0.0.1' });
  base = `http://127.0.0.1:${(app.http.server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  sockets.splice(0).forEach((s) => s.disconnect());
  app.io.close();
  await app.http.close();
});

type Msg = Record<string, any>;

function client(docId: string, userId: string, kind = 'word') {
  const s = ioc(base + '/collab', { query: { docId, userId, userName: userId.toUpperCase(), kind }, transports: ['websocket'], forceNew: true });
  sockets.push(s);
  const inbox: Msg[] = [];
  s.on('message', (m: Msg) => inbox.push(m));
  const next = (type: string, timeout = 2000) =>
    new Promise<Msg>((resolve, reject) => {
      const t0 = Date.now();
      const tick = () => {
        const i = inbox.findIndex((m) => m.type === type);
        if (i >= 0) return resolve(inbox.splice(i, 1)[0]);
        if (Date.now() - t0 > timeout) return reject(new Error(`keine Nachricht ${type} für ${userId}`));
        setTimeout(tick, 10);
      };
      tick();
    });
  return { s, inbox, next, send: (m: Msg) => s.emit('message', m) };
}

describe('Kollaborationsserver (OnlyOffice-Protokoll)', () => {
  it('meldet Teilnehmende und vergibt indexUser', async () => {
    const a = client('d1', 'anna');
    a.send({ type: 'auth' });
    const authA = await a.next('auth');
    expect(authA.result).toBe(1);
    expect(authA.indexUser).toBe(1);
    const b = client('d1', 'ben');
    b.send({ type: 'auth' });
    const authB = await b.next('auth');
    expect(authB.indexUser).toBe(2);
    expect(authB.participants.map((p: Msg) => p.id).sort()).toEqual(['anna', 'ben']);
    const cs = await a.next('connectState');
    expect(cs.participants).toHaveLength(2);
  });

  it('verteilt Änderungen und liefert sie Nachzüglern als authChanges', async () => {
    const a = client('d2', 'anna');
    const b = client('d2', 'ben');
    a.send({ type: 'auth' });
    b.send({ type: 'auth' });
    await a.next('auth');
    await b.next('auth');
    a.send({ type: 'saveChanges', changes: JSON.stringify(['c1', 'c2']), startSaveChanges: true, endSaveChanges: true, deleteIndex: -1, releaseLocks: true });
    const own = await a.next('unSaveLock');
    expect(own).toMatchObject({ index: 0, syncChangesIndex: 2 });
    const got = await b.next('saveChanges');
    expect(got.changes.map((c: Msg) => JSON.parse(c.change))).toEqual(['c1', 'c2']);
    expect(got.changes[0].user).toBe('anna');
    expect(got.changesIndex).toBe(2);

    const c = client('d2', 'clara');
    c.send({ type: 'auth' });
    const ac = await c.next('authChanges');
    expect(ac.changes).toHaveLength(2);
    await c.next('auth');
  });

  it('verweigert eine fremde Sperre und gibt sie nach releaseLocks frei', async () => {
    const a = client('d3', 'anna');
    const b = client('d3', 'ben');
    a.send({ type: 'auth' });
    b.send({ type: 'auth' });
    await a.next('auth');
    await b.next('auth');
    a.send({ type: 'getLock', block: ['p1'] });
    const la = await a.next('getLock');
    expect(la.locks.p1.user).toBe('anna');
    await b.next('getLock');
    b.send({ type: 'getLock', block: ['p1'] });
    const lb = await b.next('getLock');
    expect(lb.locks.p1.user).toBe('anna');
    a.send({ type: 'saveChanges', changes: '["x"]', startSaveChanges: true, endSaveChanges: true, releaseLocks: true });
    const rel = await b.next('saveChanges');
    expect(rel.locks.map((l: Msg) => l.block)).toEqual(['p1']);
    b.send({ type: 'getLock', block: ['p1'] });
    const lb2 = await b.next('getLock');
    expect(lb2.locks.p1.user).toBe('ben');
  });

  it('gibt Sperren beim Verlassen frei', async () => {
    const a = client('d4', 'anna');
    const b = client('d4', 'ben');
    a.send({ type: 'auth' });
    b.send({ type: 'auth' });
    await a.next('auth');
    await b.next('auth');
    a.send({ type: 'getLock', block: ['p9'] });
    await a.next('getLock');
    await b.next('getLock');
    a.s.disconnect();
    const rel = await b.next('releaseLock');
    expect(rel.locks[0].block).toBe('p9');
  });

  it('Fertig-Markierung sperrt den Block dauerhaft für alle', async () => {
    const a = client('d5', 'anna');
    const b = client('d5', 'ben');
    a.send({ type: 'auth' });
    b.send({ type: 'auth' });
    await a.next('auth');
    await b.next('auth');
    a.send({ type: 'getLock', block: ['p1'] });
    await a.next('getLock');
    await b.next('getLock');
    a.send({ type: 'saveChanges', changes: '["x"]', startSaveChanges: true, endSaveChanges: true, releaseLocks: true });
    await a.next('unSaveLock');
    await b.next('saveChanges');

    const res = await fetch(`${base}/api/spike/docs/d5/finish`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ user: 'anna' }) }).then((r) => r.json());
    expect(res.finished).toEqual(['p1']);
    const pushed = await b.next('getLock');
    expect(pushed.locks.p1.user).toBe('collegare-fertig:anna');

    b.send({ type: 'getLock', block: ['p1'] });
    const lb = await b.next('getLock');
    expect(lb.locks.p1.user).toBe('collegare-fertig:anna');
    a.send({ type: 'getLock', block: ['p1'] });
    const la = await a.next('getLock');
    expect(la.locks.p1.user).toBe('collegare-fertig:anna');

    const r2 = await fetch(`${base}/api/spike/docs/d5/reopen`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: 'p1' }) }).then((r) => r.json());
    expect(r2.reopened).toBe(true);
    await b.next('releaseLock');
    b.send({ type: 'getLock', block: ['p1'] });
    expect((await b.next('getLock')).locks.p1.user).toBe('ben');
  });

  it('Fertig nur bei Alleinautorschaft', async () => {
    const a = client('d6', 'anna');
    const b = client('d6', 'ben');
    a.send({ type: 'auth' });
    b.send({ type: 'auth' });
    await a.next('auth');
    await b.next('auth');
    for (const [who, other] of [[a, b], [b, a]] as const) {
      who.send({ type: 'getLock', block: ['p1'] });
      await who.next('getLock');
      await other.next('getLock');
      who.send({ type: 'saveChanges', changes: '["x"]', startSaveChanges: true, endSaveChanges: true, releaseLocks: true });
      await who.next('unSaveLock');
      await other.next('saveChanges');
    }
    const res = await fetch(`${base}/api/spike/docs/d6/finish`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ user: 'anna', keys: ['p1'] }) }).then((r) => r.json());
    expect(res.refused).toEqual([{ key: 'p1', reason: 'mitautoren' }]);
  });

  it('Folien: Sperren als Liste mit Objekt-Blöcken', async () => {
    const a = client('d7', 'anna', 'slide');
    a.send({ type: 'auth' });
    const auth = await a.next('auth');
    expect(Array.isArray(auth.locks)).toBe(true);
    a.send({ type: 'getLock', block: [{ type: 1, val: 'slide-1', guid: 'g-slide-1' }] });
    const l = await a.next('getLock');
    expect(l.locks[0]).toMatchObject({ user: 'anna', block: { val: 'slide-1' } });
  });
});

describe('Cursor-Nachricht', () => {
  it('liest die Element-ID aus der Cursor-Nachricht', async () => {
    const { cursorBlock } = await import('../src/collab/docState.js');
    expect(cursorBlock('14;BgAAADYANwA1AAAAAAA=')).toBe('675');
    expect(cursorBlock('kaputt')).toBeNull();
  });

  it('Fertig mit ausdrücklicher Absatz-ID sperrt auch ohne vorherige Sperre (schneller Modus)', async () => {
    const a = client('d8', 'anna');
    const b = client('d8', 'ben');
    a.send({ type: 'auth' });
    b.send({ type: 'auth' });
    await a.next('auth');
    await b.next('auth');
    a.send({ type: 'saveChanges', changes: '["x"]', startSaveChanges: true, endSaveChanges: true });
    await a.next('unSaveLock');
    const res = await fetch(`${base}/api/spike/docs/d8/finish`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ user: 'anna', keys: ['668'] }) }).then((r) => r.json());
    expect(res.finished).toEqual(['668']);
    const pushed = await b.next('getLock');
    expect(pushed.locks['668'].user).toBe('collegare-fertig:anna');
  });
});
