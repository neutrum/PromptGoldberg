import { describe, expect, it } from 'vitest';
import { CATALOG, HEROES, libraryIn, libraryNamed, OBSTACLE_PROPS, PartKind, plain, type RecipeBook } from '@pg/core';

const box = { shape: 'box' as const, at: [0, 0, 0] as [number, number, number], size: [1, 1, 1] as [number, number, number], color: '#888888' };
const book: RecipeBook = {
  'cell-phone': { status: 'good', shapes: [box] },
  'phone-booth': { status: 'new', shapes: [box, box] },
  giraffe: { status: 'good', shapes: [box] },
  'taj-mahal': { status: 'bad', shapes: [box] },
  'vampire-coffin': { status: 'new', name: 'vampire coffin', words: ['coffin of the count'], group: 'kept', shapes: [box] },
};

describe('the recipe library', () => {
  it('names every thing once and never a part, an obstacle or a hero the game already has', () => {
    const ids = CATALOG.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(CATALOG.length).toBeGreaterThan(400);
    const words = CATALOG.flatMap((c) => c.words);
    expect(new Set(words).size).toBe(words.length);
    for (const taken of [...PartKind.options, ...OBSTACLE_PROPS, ...HEROES, 'fence', 'tree', 'rock', 'wall']) expect(words).not.toContain(plain(taken));
  });

  it('finds things by any word, plurals too, the longest phrase first, in the order named', () => {
    expect(libraryIn('two giraffes wait by the phone booth', book).map((h) => h.id)).toEqual(['giraffe', 'phone-booth']);
    expect(libraryIn('ring the phone', book).map((h) => h.id)).toEqual(['cell-phone']);
  });

  it('leaves out rejected recipes and finds kept things by their own words', () => {
    expect(libraryIn('a marble rolls to the taj mahal', book)).toEqual([]);
    expect(libraryIn('wake the coffin of the count', book).map((h) => h.name)).toEqual(['vampire coffin']);
    expect(libraryNamed('Giraffes', book)?.id).toBe('giraffe');
    expect(libraryNamed('Taj Mahal', book)).toBeNull();
  });
});
