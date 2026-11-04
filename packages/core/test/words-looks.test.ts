import { describe, expect, it } from 'vitest';
import { lookIn, looksFromWords } from '../src/words/looks';

const harbor = { name: 'harbor', sky: '#88aacc', ground: '#cc9966', land: '#88aa66', rock: '#888888', water: '#3388cc', foliage: '#338844', accent: '#cc3333', features: [{ kind: 'houses' as const, amount: 'few' as const }] };

describe('looks by words', () => {
  it('reads a look only when that is the whole request', () => {
    for (const [text, look] of [['make it night', 'night'], ['Night', 'night'], ['make it snowy please', 'snow'], ['turn the world into winter', 'snow'], ['sunset', 'sunset'], ["it's daytime", 'day'], ['make it autumn.', 'autumn']] as const)
      expect(lookIn(text), text).toBe(look);
    for (const text of ['make it night and add a castle', 'build a fence around the goal', 'a snowy mountain with a chalet', 'remove the night sky'])
      expect(lookIn(text), text).toBeNull();
  });

  it('changes the colours only, and night then day comes back to the same world', () => {
    const night = looksFromWords('make it night', harbor)!;
    expect(night.landscape.sky).toBe('#121a30');
    expect(night.landscape.ground).toBe('#664d33');
    expect(night.landscape.features.map((f) => f.kind)).toEqual(['houses', 'lanterns']);
    expect(night.landscape.accent).toBe(harbor.accent);
    const day = looksFromWords('make it day', night.landscape)!;
    // Back within a shade (halving odd channels rounds).
    const near = (a: string, b: string) => [1, 3, 5].every((i) => Math.abs(parseInt(a.slice(i, i + 2), 16) - parseInt(b.slice(i, i + 2), 16)) <= 2);
    for (const k of ['ground', 'land', 'rock', 'water', 'foliage'] as const) expect(near(day.landscape[k], harbor[k]), k).toBe(true);
    expect(looksFromWords('make it snowy', harbor)!.landscape).toMatchObject({ snow: true, land: '#eef3f6' });
  });

  it('gives a level without a world of its own a plain one to change', () => {
    expect(looksFromWords('make it night', undefined)!.landscape.sky).toBe('#121a30');
    expect(looksFromWords('add a castle', undefined)).toBeNull();
  });
});
