import { describe, expect, it } from 'vitest';
import { SystemSpec, applyTunables, evaluateGoal, optimize, parseSpec, simulate } from '../src';
import slingshot from '../src/fixtures/slingshot.json';
import eclipse from '../src/fixtures/eclipse.json';
import rogue from '../src/fixtures/rogue.json';

const fixtures = { slingshot, eclipse, rogue };

describe('fixtures', () => {
  for (const [name, raw] of Object.entries(fixtures)) {
    it(`${name} parses and reaches its goal`, () => {
      const parsed = parseSpec(raw);
      expect(parsed.ok, JSON.stringify(!parsed.ok && parsed.issues)).toBe(true);
      const spec = (parsed as { spec: SystemSpec }).spec;
      const run = simulate(spec, { record: false });
      const result = evaluateGoal(spec.goal, run.trace);
      expect(result.success, result.events.map((e) => e.note).join('; ')).toBe(true);
    });
  }

  it('slingshot logs the launch and the flybys in order', () => {
    const spec = SystemSpec.parse(slingshot);
    const { events } = simulate(spec, { record: false });
    const launch = events.find((e) => e.type === 'launch');
    const flyby = events.find((e) => e.type === 'flyby' && e.bodies.includes('jove'));
    expect(launch).toBeDefined();
    expect(flyby).toBeDefined();
    expect(flyby!.t).toBeGreaterThan(launch!.t);
  });
});

describe('goal checker', () => {
  it('fails with partial credit and an explanation when the flyby misses', () => {
    const spec = SystemSpec.parse(slingshot);
    const off = applyTunables(spec, [{ path: 'bodies.probe.placement.angle', min: -90, max: 90 }], [-60]);
    const result = evaluateGoal(off.goal, simulate(off, { record: false }).trace);
    expect(result.success).toBe(false);
    expect(result.failedAt).toBe(0);
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThan(1);
    expect(result.events[0].note).toMatch(/closest approach|never approached/);
  });

  it('respects event order', () => {
    const spec = SystemSpec.parse(slingshot);
    const reversed = { ...spec, goal: [...spec.goal].reverse() };
    const result = evaluateGoal(reversed.goal, simulate(reversed, { record: false }).trace);
    expect(result.success).toBe(false);
    expect(result.satisfiedCount).toBe(1);
  });

  it('rejects references to unknown bodies', () => {
    const bad = JSON.parse(JSON.stringify(slingshot));
    bad.goal[0].target = 'nowhere';
    const parsed = parseSpec(bad);
    expect(parsed.ok).toBe(false);
  });
});

describe('optimizer', () => {
  it('recovers a perturbed launch', () => {
    const spec = SystemSpec.parse(slingshot);
    const tunables = spec.tunables.filter((t) => t.path.startsWith('bodies.probe'));
    const perturbed = { ...applyTunables(spec, tunables, [2.9, 12, 0.05]), tunables };
    expect(evaluateGoal(perturbed.goal, simulate(perturbed, { record: false }).trace).success).toBe(false);
    const res = optimize(perturbed, { budget: 1500, timeLimitMs: 30_000 });
    expect(res.solved).toBe(true);
  }, 60_000);
});
