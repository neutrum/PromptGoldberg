import { describe, expect, it } from 'vitest';
import { SystemSpec, evaluateGoal, parseSpec, simulate, type SystemSpecInput } from '../src';

type Body = SystemSpecInput['bodies'][number];

/** Gravity-free test bench: only the new contact physics acts. */
const probe = (velocity: [number, number, number], position: [number, number, number] = [0, 0, 0]): Body => ({
  id: 'probe', name: 'Probe', type: 'probe', mass: 0, radius: 1e-4, placement: { kind: 'free', position, velocity },
});
const fixedAt = (id: string, type: 'portal' | 'bumper', position: [number, number, number], extra: Partial<Body> = {}): Body => ({
  id, name: id, type, mass: 0, radius: 0.1, fixed: true, placement: { kind: 'free', position, velocity: [0, 0, 0] }, ...extra,
});

function run(bodies: Body[], duration = 2, goal: SystemSpecInput['goal'] = []) {
  const spec = SystemSpec.parse({ title: 't', bodies, goal, sim: { duration } });
  const res = simulate(spec, { record: false });
  const i = res.ids.indexOf('probe');
  const pos = [...res.state.pos.slice(3 * i, 3 * i + 3)];
  const vel = [...res.state.vel.slice(3 * i, 3 * i + 3)];
  return { res, pos, vel, goal: evaluateGoal(spec.goal, res.trace) };
}

describe('portals', () => {
  const pair = [
    fixedAt('a', 'portal', [1, 0, 0], { link: 'b' }),
    fixedAt('b', 'portal', [0, 5, 0], { link: 'a' }),
  ];

  it('sends a body out of the twin portal with the same velocity', () => {
    const { res, pos, vel, goal } = run([probe([1, 0, 0]), ...pair], 2, [{ type: 'warp', body: 'probe', portal: 'a' }]);
    expect(res.trace.warps).toHaveLength(1);
    expect(res.trace.warps[0]).toMatchObject({ body: 'probe', from: 'a', to: 'b' });
    expect(res.trace.warps[0].t).toBeGreaterThan(0.85);
    expect(res.trace.warps[0].t).toBeLessThan(0.95);
    expect(vel[0]).toBeCloseTo(1, 9);
    expect(pos[1]).toBeCloseTo(5, 6);
    // Came out just past b's rim and kept flying along +x for the rest of the run.
    expect(pos[0]).toBeGreaterThan(1.1);
    expect(pos[0]).toBeLessThan(1.3);
    expect(res.trace.collisions).toHaveLength(0);
    expect(res.events.some((e) => e.type === 'warp')).toBe(true);
    expect(goal.success).toBe(true);
  });

  it('gives partial credit for a near miss', () => {
    const { goal } = run([probe([1, 0, 0], [0, 0.3, 0]), ...pair], 2, [{ type: 'warp', body: 'probe', portal: 'a' }]);
    expect(goal.success).toBe(false);
    expect(goal.score).toBeGreaterThan(0.5);
    expect(goal.events[0].note).toMatch(/missed the portal/);
  });

  it('requires linked portals', () => {
    const bad = parseSpec({ title: 't', goal: [], sim: { duration: 1 }, bodies: [probe([1, 0, 0]), fixedAt('a', 'portal', [1, 0, 0])] });
    expect(bad.ok).toBe(false);
    const notPortal = parseSpec({ title: 't', goal: [], sim: { duration: 1 }, bodies: [probe([1, 0, 0]), fixedAt('a', 'portal', [1, 0, 0], { link: 'probe' })] });
    expect(notPortal.ok).toBe(false);
  });
});

describe('bumpers', () => {
  it('bounce a body back instead of merging', () => {
    const { res, pos, vel, goal } = run([probe([1, 0, 0]), fixedAt('bump', 'bumper', [1, 0, 0])], 2, [{ type: 'bounce', body: 'probe', target: 'bump' }]);
    expect(res.trace.bounces).toHaveLength(1);
    expect(res.trace.collisions).toHaveLength(0);
    expect(vel[0]).toBeCloseTo(-1, 9);
    expect(pos[0]).toBeLessThan(0);
    expect(goal.success).toBe(true);
  });

  it('kick harder with a bounce above 1, like pinball', () => {
    const { vel } = run([probe([1, 0, 0]), fixedAt('bump', 'bumper', [1, 0, 0], { bounce: 1.5 })]);
    expect(vel[0]).toBeCloseTo(-1.5, 9);
  });

  it('deflect a glancing hit sideways', () => {
    const { vel } = run([probe([1, 0, 0], [0, 0.05, 0]), fixedAt('bump', 'bumper', [1, 0, 0])]);
    expect(Math.hypot(vel[0], vel[1])).toBeCloseTo(1, 9);
    expect(vel[1]).toBeGreaterThan(0.5);
  });

  it('cannot be tunnelled through by a fast body', () => {
    const { res } = run([probe([200, 0, 0]), fixedAt('bump', 'bumper', [1, 0, 0], { radius: 0.002 })], 0.02);
    expect(res.trace.bounces).toHaveLength(1);
  });

  it('stay put when fixed, even next to a star', () => {
    const sun: Body = { id: 'sun', name: 'Sun', type: 'star', mass: 1, radius: 0.00465, placement: { kind: 'free', position: [0, 0, 0], velocity: [0, 0, 0] } };
    const spec = SystemSpec.parse({ title: 't', goal: [], sim: { duration: 1 }, bodies: [sun, fixedAt('bump', 'bumper', [1, 0, 0])] });
    const res = simulate(spec, { record: false });
    const i = res.ids.indexOf('bump');
    expect(res.state.pos[3 * i]).toBeCloseTo(1, 12);
    expect(res.state.pos[3 * i + 1]).toBeCloseTo(0, 12);
  });
});
