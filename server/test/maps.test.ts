import { describe, expect, it } from 'vitest';
import { applyOp, buildOutline, emptyMap, HEADER, MapError, PAD, type MapOp } from '../src/projects/maps.js';

const people = new Set([1, 2]);
const add = (id: string, x: number, y: number, extra: Partial<Extract<MapOp, { type: 'add' }>['card']> = {}): MapOp => ({
  type: 'add',
  card: { id, kind: 'card', title: id, text: '', x, y, w: 160, h: 90, color: null, parent: null, owner: null, ...extra },
});

describe('Mindmap-Operationen', () => {
  it('legt Karten in Cluster, Cluster wächst mit', () => {
    const m = emptyMap();
    applyOp(m, add('clus1', 0, 0, { kind: 'cluster', w: 200, h: 120 }), 1, people);
    applyOp(m, add('card1', 400, 0), 1, people);
    applyOp(m, { type: 'move', id: 'card1', x: 300, y: 50, parent: 'clus1' }, 1, people);
    expect(m.roots).toEqual(['clus1']);
    expect(m.cards.clus1.children).toEqual(['card1']);
    expect(m.cards.clus1.w).toBe(300 + 160 + 2 * PAD);
    expect(m.cards.clus1.h).toBe(HEADER + 50 + 90 + PAD);
  });

  it('verbietet Cluster im Cluster und Karten in Karten', () => {
    const m = emptyMap();
    applyOp(m, add('clus1', 0, 0, { kind: 'cluster' }), 1, people);
    applyOp(m, add('clus2', 500, 0, { kind: 'cluster' }), 1, people);
    applyOp(m, add('card1', 0, 300), 1, people);
    expect(() => applyOp(m, { type: 'move', id: 'clus2', x: 0, y: 0, parent: 'clus1' }, 1, people)).toThrow(MapError);
    expect(() => applyOp(m, add('card2', 0, 0, { parent: 'card1' }), 1, people)).toThrow(MapError);
  });

  it('löscht Cluster, Karten bleiben an ihrer Stelle, Pfeile verschwinden', () => {
    const m = emptyMap();
    applyOp(m, add('clus1', 100, 100, { kind: 'cluster' }), 1, people);
    applyOp(m, add('card1', 20, 30, { parent: 'clus1' }), 1, people);
    applyOp(m, add('card2', 600, 0), 1, people);
    applyOp(m, { type: 'link', id: 'lnk1', from: 'clus1', to: 'card2' }, 1, people);
    applyOp(m, { type: 'remove', ids: ['clus1'] }, 1, people);
    expect(m.cards.card1).toMatchObject({ parent: null, x: 100 + PAD + 20, y: 100 + HEADER + 30 });
    expect(m.links).toEqual([]);
    expect(m.roots.sort()).toEqual(['card1', 'card2']);
  });

  it('ordnet nur Personen der Gruppe zu', () => {
    const m = emptyMap();
    applyOp(m, add('card1', 0, 0), 1, people);
    applyOp(m, { type: 'update', id: 'card1', patch: { owner: 2 } }, 1, people);
    expect(m.cards.card1.owner).toBe(2);
    expect(() => applyOp(m, { type: 'update', id: 'card1', patch: { owner: 99 } }, 1, people)).toThrow(MapError);
  });

  it('Gliederung in Lesereihenfolge: Zeilen, dann links nach rechts', () => {
    const m = emptyMap();
    applyOp(m, add('rechts', 500, 10, { kind: 'cluster', title: 'Folgen' }), 1, people);
    applyOp(m, add('links', 0, 0, { kind: 'cluster', title: 'Ursachen' }), 1, people);
    applyOp(m, add('unten', 0, 400, { kind: 'cluster', title: '' }), 1, people);
    applyOp(m, add('k2', 0, 120, { parent: 'links', owner: 2 }), 1, people);
    applyOp(m, add('k1', 0, 0, { parent: 'links', owner: 1 }), 1, people);
    applyOp(m, add('lose', 900, 900), 1, people);
    const o = buildOutline(m);
    expect(o.map((x) => x.title)).toEqual(['Ursachen', 'Folgen', 'Ohne Titel']);
    expect(o[0]).toMatchObject({ cards: ['k1', 'k2'], owners: [1, 2] });
    applyOp(m, { type: 'outline' }, 2, people, 1234);
    expect(m.outline).toMatchObject({ at: 1234, by: 2 });
    expect(() => applyOp(emptyMap(), { type: 'outline' }, 1, people)).toThrow('Cluster');
  });
});
