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
    applyOp(m, add('rechts', 500, 10, { kind: 'cluster', title: 'Folgen', pick: true }), 1, people);
    applyOp(m, add('links', 0, 0, { kind: 'cluster', title: 'Ursachen', pick: true }), 1, people);
    applyOp(m, add('unten', 0, 400, { kind: 'cluster', title: '', pick: true }), 1, people);
    applyOp(m, add('k2', 0, 120, { parent: 'links', owner: 2, pick: true }), 1, people);
    applyOp(m, add('k1', 0, 0, { parent: 'links', owner: 1, pick: true }), 1, people);
    applyOp(m, add('lose', 900, 900), 1, people);
    const o = buildOutline(m);
    expect(o.map((x) => x.title)).toEqual(['Ursachen', 'Folgen', 'Ohne Titel']);
    expect(o[0]).toMatchObject({ cards: ['k1', 'k2'], owners: [1, 2] });
    applyOp(m, { type: 'outline' }, 2, people, 1234);
    expect(m.outline).toMatchObject({ at: 1234, by: 2 });
    expect(() => applyOp(emptyMap(), { type: 'outline' }, 1, people)).toThrow('übernommen');
  });

  it('Ast-Ansicht: Idee an einer Karte, Abzweigung an einem Zwischenstopp', async () => {
    const { MapOp: Schema } = await import('../src/projects/maps.js');
    const m = emptyMap();
    applyOp(m, add('clus1', 0, 0, { kind: 'cluster' }), 1, people);
    applyOp(m, add('clus2', 400, 0, { kind: 'cluster' }), 1, people);
    applyOp(m, add('card1', 0, 0, { parent: 'clus1' }), 1, people);
    applyOp(m, Schema.parse({ type: 'add', card: { id: 'card2', kind: 'card', x: 0, y: 100, w: 160, h: 90, parent: 'clus1', under: 'card1' } }), 1, people);
    expect(m.cards.card2).toMatchObject({ parent: 'clus1', under: 'card1' });
    applyOp(m, Schema.parse({ type: 'update', id: 'clus1', patch: { via: [[100, -100]] } }), 1, people);
    applyOp(m, Schema.parse({ type: 'update', id: 'clus2', patch: { fork: { from: 'clus1', i: 0 } } }), 1, people);
    expect(m.cards.clus2.fork).toEqual({ from: 'clus1', i: 0 });
    applyOp(m, Schema.parse({ type: 'update', id: 'clus2', patch: { fork: null } }), 1, people);
    expect(m.cards.clus2.fork).toBeNull();
    expect(() => Schema.parse({ type: 'update', id: 'clus2', patch: { fork: { from: 'clus1', i: 12 } } })).toThrow();
  });

  it('in die Gliederung kommt nur, was aktiv übernommen ist', () => {
    const m = emptyMap();
    applyOp(m, add('clus1', 0, 0, { kind: 'cluster' }), 1, people);
    applyOp(m, add('clus2', 400, 0, { kind: 'cluster' }), 1, people);
    applyOp(m, add('card1', 0, 0, { parent: 'clus1' }), 1, people);
    applyOp(m, add('card2', 0, 100, { parent: 'clus1' }), 1, people);
    applyOp(m, add('clus3', 800, 0, { kind: 'cluster' }), 1, people);
    applyOp(m, add('card3', 0, 0, { parent: 'clus3' }), 1, people);
    expect(buildOutline(m)).toEqual([]);
    applyOp(m, { type: 'update', id: 'clus1', patch: { pick: true } }, 1, people);
    applyOp(m, { type: 'update', id: 'card1', patch: { pick: true } }, 1, people);
    // eine übernommene Karte bringt ihren Ast mit
    applyOp(m, { type: 'update', id: 'card3', patch: { pick: true } }, 1, people);
    expect(buildOutline(m).map((x) => [x.id, x.cards])).toEqual([
      ['clus1', ['card1']],
      ['clus3', ['card3']],
    ]);
  });
});

describe('Gliederung als Linien (Konzept 8h)', () => {
  const pt = (id: string, card: string | null, extra: Record<string, unknown> = {}) => ({ id, key: card ?? id, card, title: id, owner: null, hidden: false, removed: false, items: [], sub: [], ...extra });
  it('leitet pick und outline ab, Schloss sperrt Änderungen', () => {
    const m = emptyMap();
    applyOp(m, add('ast01', 0, 0, { kind: 'cluster', title: 'Ursachen' }), 1, people);
    applyOp(m, add('kar01', 0, 0, { parent: 'ast01', owner: 2 }), 1, people);
    applyOp(m, add('kar02', 0, 100, { parent: 'ast01' }), 1, people);
    const lines = {
      praes: { points: [pt('p0001', 'ast01')] },
      ausarb: { points: [pt('p0002', 'ast01', { sub: [pt('p0003', 'kar01'), pt('p0004', 'kar02', { hidden: true }), pt('p0005', null)] }), pt('p0006', null, { title: 'Neu' })] },
      locked: false,
      at: null,
    };
    applyOp(m, { type: 'lines', lines }, 1, people, 500);
    expect(m.cards.ast01.pick).toBe(true);
    expect(m.cards.kar01.pick).toBe(true);
    expect(m.cards.kar02.pick).toBe(true);
    expect(m.outline).toMatchObject({ at: 500, sections: [{ id: 'ast01', title: 'Ursachen', cards: ['kar01'], owners: [2] }, { id: 'p0006', title: 'Neu', cards: [] }] });
    applyOp(m, { type: 'lines', lines: { ...lines, locked: true } }, 1, people);
    expect(() => applyOp(m, { type: 'lines', lines: { ...lines, praes: { points: [] }, locked: true } }, 1, people)).toThrow('gesperrt');
    applyOp(m, { type: 'lines', lines: { ...lines, locked: false } }, 1, people);
    applyOp(m, { type: 'remove', ids: ['kar01'] }, 1, people);
    expect(m.lines!.ausarb.points[0].sub[0]).toMatchObject({ card: null, title: 'kar01' });
  });
  it('erlaubt vier Ebenen und meldet die tieferen als subs', () => {
    const m = emptyMap();
    const deep = (n: number): ReturnType<typeof pt> => pt('p000' + n, null, { title: 'E' + n, sub: n < 4 ? [deep(n + 1)] : [] });
    applyOp(m, { type: 'lines', lines: { praes: { points: [] }, ausarb: { points: [deep(1)] }, locked: false, at: null } }, 1, people, 9);
    expect(m.outline!.sections[0]).toMatchObject({ title: 'E1', subs: [{ title: 'E2', level: 2 }, { title: 'E3', level: 3 }, { title: 'E4', level: 4 }] });
    const five = { ...deep(1), sub: [{ ...deep(2), sub: [{ ...deep(3), sub: [{ ...deep(4), sub: [pt('p0009', null)] }] }] }] };
    expect(() => applyOp(m, { type: 'lines', lines: { praes: { points: [] }, ausarb: { points: [five] }, locked: false, at: null } }, 1, people)).toThrow('vier Ebenen');
  });
});
