import { describe, expect, it } from 'vitest';
import { boardThings, layoutLevel, libraryItems, MachineSpec } from '../src';

describe('library things on the board', () => {
  it('every recipe in the library makes a valid level when the request names it', () => {
    const items = libraryItems().filter((i) => i.recipe && i.recipe.status !== 'bad');
    for (let i = 0; i < items.length; i += 4) {
      const decor = items.slice(i, i + 4).map((it) => ({ name: it.name, shapes: it.recipe!.shapes }));
      const landscape = { name: 'test', sky: '#88aacc', ground: '#cc9966', land: '#88aa66', rock: '#888888', water: '#3388cc', foliage: '#338844', accent: '#cc3333',
        features: [{ kind: 'houses', amount: 'some' }], decor } as never;
      const spec = layoutLevel({ title: 't', links: [{ via: 'fan' }], end: 'bell', landscape }, { seed: i });
      const r = MachineSpec.safeParse(spec);
      expect(r.success, `${decor.map((d) => d.name).join(', ')}: ${r.success ? '' : JSON.stringify(r.error.issues[0])}`).toBe(true);
    }
  }, 120_000);

  it('does not stand a second goal on the board as scenery', () => {
    const chest = libraryItems().find((i) => i.id === 'treasure-chest')!;
    const landscape = { name: 'test', sky: '#88aacc', ground: '#cc9966', land: '#88aa66', rock: '#888888', water: '#3388cc', foliage: '#338844', accent: '#cc3333',
      features: [{ kind: 'palms', amount: 'few' }], decor: [{ name: 'Treasure Chest', shapes: chest.recipe!.shapes }] } as never;
    const spec = layoutLevel({ title: 't', links: [{ via: 'fan' }], end: 'bucket', names: { target: 'treasure chest' }, landscape }, { seed: 1 });
    expect(spec.parts.filter((p) => /treasure chest/i.test(p.label ?? ''))).toHaveLength(1);
  });

  it('leaves out a bare word that is part of a fuller name beside it', () => {
    const box = [{ shape: 'box', at: [0, 0, 0], size: [1, 1, 1], color: '#888888' }];
    const world = { name: 'harbor', sky: '#88aacc', ground: '#cc9966', land: '#88aa66', rock: '#888888', water: '#3388cc', foliage: '#338844', accent: '#cc3333',
      features: [], landmark: { name: 'Statue of Liberty', shapes: box }, decor: [{ name: 'statue', shapes: box }, { name: 'Paris café', shapes: box }, { name: 'cafe', shapes: box }, { name: 'taxi', shapes: box }] } as never;
    expect(boardThings(world).map((d) => d.name)).toEqual(['Paris café', 'taxi']);
  });

  it("does not add the world's ship when the request already named a pirate ship", () => {
    const ship = libraryItems().find((i) => i.id === 'pirate-ship')!;
    const world = (decor: object[]) => ({ name: 'bay', sky: '#88aacc', ground: '#cc9966', land: '#88aa66', rock: '#888888', water: '#3388cc', foliage: '#338844', accent: '#cc3333',
      features: [{ kind: 'palms', amount: 'few' }], hero: 'ship', decor }) as never;
    const ships = (decor: object[]) => layoutLevel({ title: 't', links: [{ via: 'fan' }], end: 'bucket', landscape: world(decor) }, { seed: 2 }).parts.filter((p) => p.prop === 'ship' || /ship/i.test(p.label ?? ''));
    expect(ships([{ name: 'Pirate Ship', shapes: ship.recipe!.shapes }])).toHaveLength(1);
    expect(ships([])).toHaveLength(1);
  });
});

describe('fitMachine', () => {
  it('fits a level whose things are past the limits instead of refusing it', async () => {
    const { parseMachine } = await import('../src');
    const spec = layoutLevel({ title: 't', links: [{ via: 'fan' }], end: 'bell' }, { seed: 3 }) as unknown as { parts: Record<string, unknown>[] };
    const big = Array.from({ length: 30 }, (_, k) => ({ shape: 'box', at: [0, k * 0.2, 0], size: [9, 0.2, 9], color: '#ffffff' }));
    spec.parts.push({ id: 'huge', kind: 'wall', x: 1, y: 0, z: 20, yaw: 0, fixed: true, prop: 'landmark', build: big, label: 'a very very long name for a very large landmark indeed' });
    spec.parts.push({ id: 'broken', kind: 'nonsense', x: 2, y: 0, z: 2, yaw: 0 });
    const r = parseMachine(spec);
    expect(r.ok, JSON.stringify(!r.ok && r.issues)).toBe(true);
    if (r.ok) { expect(r.spec.parts.some((p) => p.id === 'huge')).toBe(true); expect(r.spec.parts.some((p) => p.id === 'broken')).toBe(false); }
  });
});
