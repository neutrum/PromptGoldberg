import { describe, expect, it } from 'vitest';
import { readableSkin, skinsFromWords, type Skin } from '../src';

describe('skins that still read as their part', () => {
  it('keeps a ramp look that follows the slope and drops one that hides it (seen: ramps drawn as crates)', () => {
    const rail = skinsFromWords('a train').find((s) => s.part === 'ramp')!;
    expect(readableSkin(rail)).toEqual(rail);
    const crate: Skin = { part: 'ramp', name: 'cargo crate', shapes: [{ shape: 'box', at: [0, 0, 0], size: [1, 1, 1], color: '#7a5230' }] };
    expect(readableSkin(crate)).toBeNull();
    const mixed: Skin = { ...crate, shapes: [...crate.shapes, { shape: 'box', at: [0, 0.5, 0], size: [1.1, 0.05, 0.9], color: '#7a5230', tilt: 26.6 }] };
    expect(readableSkin(mixed)!.shapes).toHaveLength(1);
    const wagon = skinsFromWords('a train').find((s) => s.part === 'dominoes')!;
    expect(readableSkin(wagon)).toBe(wagon);
  });
});
