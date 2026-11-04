import { describe, expect, it } from 'vitest';
import { readBuildMove, type Part } from '@pg/core';
import { KIT } from '../src/ui/kit';

describe('parts catalog', () => {
  it('every example sentence places its own part', () => {
    const parts = [{ id: 'ball', kind: 'ball', x: 4, y: 0, z: 4, yaw: 0 }, { id: 'goal', kind: 'bucket', label: 'chest', x: 12, y: 0, z: 8, yaw: 0 }] as Part[];
    const hand = KIT.filter((k) => !k.level).map((k, i) => ({ id: `h${i}`, kind: k.kind, x: 0, y: 0, z: 0, yaw: 0 })) as Part[];
    for (const k of KIT.filter((e) => e.say)) {
      expect(readBuildMove(k.say!, { parts, hand, placed: new Set() }), k.say).toMatchObject({ action: 'place', kind: k.kind });
    }
  });
});
