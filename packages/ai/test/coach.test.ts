import { describe, expect, it } from 'vitest';
import { checkShot, shotSpec, simulate, type CoachRequest } from '@og/shared';
import { coachTip, controlAdvice, deterministicTip } from '../src/coach';
import { FakeLlm, slingshotLevel } from './helpers';

function request(values: number[]): CoachRequest {
  const level = slingshotLevel();
  const { goal } = checkShot(level, values);
  const events = simulate(shotSpec(level, values), { record: false }).events;
  return { level, values, pieces: [], shots: 2, goal, events };
}

describe('coach', () => {
  it('points toward the solution without numbers', () => {
    const req = request([2.0, 20.0333, 0.0524]);
    expect(req.goal.success).toBe(false);
    const tip = deterministicTip(req);
    expect(tip).toMatch(/more power/);
    expect(tip).not.toMatch(/3\.26|20\.0|0\.05/);
  });

  it('phrases directions per control type', () => {
    const aim = { path: 'bodies.p.placement.angle', label: 'Aim', min: -40, max: 40 };
    expect(controlAdvice(aim, 0, 30)).toBe('aim a lot further outward');
    expect(controlAdvice(aim, 0, -5)).toBe('aim a touch further inward');
    const time = { path: 'bodies.p.placement.time', label: 'Launch time', min: 0, max: 1 };
    expect(controlAdvice(time, 0.5, 0.35)).toBe('launch a bit earlier');
    expect(controlAdvice(time, 0.5, 0.505)).toBeNull();
  });

  it('congratulates a clear', () => {
    expect(deterministicTip(request(slingshotLevel().solution!.values))).toMatch(/Perfect|Cleared/);
  });

  it('uses the LLM phrasing when available and falls back on errors or timeouts', async () => {
    const req = request([2.0, 20.0333, 0.0524]);
    const ok = await coachTip(req, new FakeLlm(['"Punch it! Your probe needs more oomph to reach Jove."']));
    expect(ok).toEqual({ tip: 'Punch it! Your probe needs more oomph to reach Jove.', source: 'llm' });

    expect(await coachTip(req, new FakeLlm([new Error('down')]))).toEqual({ tip: deterministicTip(req), source: 'rules' });

    const slow = { name: 'api' as const, complete: () => new Promise<never>(() => {}) };
    expect((await coachTip(req, slow, { timeoutMs: 20 })).source).toBe('rules');
  });
});
