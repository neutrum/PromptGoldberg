import { describe, expect, it } from 'vitest';
import {
  EARTH_MASS, JUPITER_MASS, JUPITER_RADIUS, SUN_RADIUS, EARTH_RADIUS, MOON_RADIUS,
  SystemSpec, type SystemSpecInput, computeTiming, initState, orbitalPeriod, simulate, G,
} from '../src';

const sun: SystemSpecInput['bodies'][number] = { id: 'sun', name: 'Sun', type: 'star', mass: 1, radius: SUN_RADIUS, placement: { kind: 'free', position: [0, 0, 0], velocity: [0, 0, 0] } };

function spec(input: Partial<SystemSpecInput> & Pick<SystemSpecInput, 'bodies'>) {
  return SystemSpec.parse({ title: 'test', goal: [], sim: { duration: 1 }, ...input });
}

function energy(s: ReturnType<typeof initState>) {
  const n = s.ids.length;
  let e = 0;
  for (let i = 0; i < n; i++) {
    const v2 = s.vel[3 * i] ** 2 + s.vel[3 * i + 1] ** 2 + s.vel[3 * i + 2] ** 2;
    e += 0.5 * s.mass[i] * v2;
    for (let j = i + 1; j < n; j++) {
      const d = Math.hypot(s.pos[3 * i] - s.pos[3 * j], s.pos[3 * i + 1] - s.pos[3 * j + 1], s.pos[3 * i + 2] - s.pos[3 * j + 2]);
      e -= (G * s.mass[i] * s.mass[j]) / d;
    }
  }
  return e;
}

describe('initial conditions', () => {
  it('places a circular orbit at the right speed', () => {
    const s = initState(spec({
      bodies: [sun, { id: 'earth', name: 'Earth', type: 'planet', mass: 0, radius: EARTH_RADIUS, placement: { kind: 'orbit', parent: 'sun', a: 1 } }],
    }));
    const r = Math.hypot(s.pos[3] - s.pos[0], s.pos[4] - s.pos[1]);
    const v = Math.hypot(s.vel[3] - s.vel[0], s.vel[4] - s.vel[1]);
    expect(r).toBeCloseTo(1, 10);
    expect(v).toBeCloseTo(2 * Math.PI, 8);
  });

  it('uses vis-viva at periapsis for eccentric orbits', () => {
    const s = initState(spec({
      bodies: [sun, { id: 'c', name: 'Comet', type: 'comet', mass: 0, radius: 1e-6, placement: { kind: 'orbit', parent: 'sun', a: 2, e: 0.5 } }],
    }));
    const r = Math.hypot(s.pos[3], s.pos[4]);
    const v = Math.hypot(s.vel[3], s.vel[4]);
    expect(r).toBeCloseTo(1, 10);
    expect(v * v).toBeCloseTo(G * (2 / r - 1 / 2), 8);
  });
});

describe('integrator', () => {
  it('returns a circular orbit to its start after one period', () => {
    const sys = spec({
      bodies: [sun, { id: 'earth', name: 'Earth', type: 'planet', mass: EARTH_MASS, radius: EARTH_RADIUS, placement: { kind: 'orbit', parent: 'sun', a: 1 } }],
      sim: { duration: orbitalPeriod(1, 1 + EARTH_MASS), samples: 100 },
    });
    const res = simulate(sys);
    const f = res.frames!;
    const last = (res.frameCount - 1) * res.frameStride;
    const dx = f[last + 4] - f[4], dy = f[last + 5] - f[5];
    expect(Math.hypot(dx, dy)).toBeLessThan(0.01);
  });

  it('keeps energy drift small over 100 eccentric orbits', () => {
    const sys = spec({
      bodies: [sun, { id: 'p', name: 'P', type: 'planet', mass: JUPITER_MASS, radius: JUPITER_RADIUS, placement: { kind: 'orbit', parent: 'sun', a: 1, e: 0.3 } }],
      sim: { duration: 100 },
    });
    const e0 = energy(initState(sys));
    const e1 = energy(simulate(sys, { record: false }).state);
    expect(Math.abs((e1 - e0) / e0)).toBeLessThan(1e-3);
  });

  it('merges bodies on collision and conserves momentum', () => {
    const sys = spec({
      bodies: [
        { id: 'a', name: 'A', type: 'planet', mass: 1e-3, radius: 0.01, placement: { kind: 'free', position: [-1, 0, 0], velocity: [1, 0, 0] } },
        { id: 'b', name: 'B', type: 'planet', mass: 1e-3, radius: 0.01, placement: { kind: 'free', position: [1, 0, 0], velocity: [-1, 0, 0] } },
      ],
      sim: { duration: 2, dt: 0.001 },
    });
    const res = simulate(sys);
    expect(res.trace.collisions).toHaveLength(1);
    expect(res.events.some((e) => e.type === 'collision')).toBe(true);
  });
});

describe('timing', () => {
  it('resolves the shortest orbit with ~200 steps', () => {
    const sys = spec({
      bodies: [
        sun,
        { id: 'j', name: 'J', type: 'planet', mass: JUPITER_MASS, radius: JUPITER_RADIUS, placement: { kind: 'orbit', parent: 'sun', a: 1 } },
        { id: 'm', name: 'M', type: 'moon', mass: 0, radius: MOON_RADIUS, placement: { kind: 'orbit', parent: 'j', a: 0.004 } },
      ],
      sim: { duration: 0.1 },
    });
    const { dt } = computeTiming(sys);
    expect(dt).toBeLessThanOrEqual(orbitalPeriod(0.004, JUPITER_MASS) / 200 + 1e-12);
  });
});
