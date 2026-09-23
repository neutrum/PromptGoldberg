import { describe, expect, it } from 'vitest';
import { checkShot, controlValues } from '@og/shared';
import { createLevel, createSolver, LlmError, SolverError } from '../src';
import { FakeLlm, impossibleSpec, levelReply } from './helpers';

// Inline solver: no worker threads, so tests stay fast and deterministic.
const solver = createSolver('inline');

describe('createLevel', () => {
  it('turns a prompt into a solved level whose sliders start on a miss', async () => {
    const llm = new FakeLlm([levelReply()]);
    const stages: string[] = [];
    const order: string[] = [];
    const res = await createLevel({ prompt: 'swing past the giant and reach the ice world' }, {
      llm, solver, onEvent: (e) => {
        if (e.type === 'stage') stages.push(e.stage);
        if (e.type === 'stage' || e.type === 'draft') order.push(e.type === 'draft' ? `draft:${e.status}` : e.stage);
        if (e.type === 'sketch' && order[order.length - 1] !== 'sketch') order.push('sketch');
        if (e.type === 'draft') {
          expect(e.attempt).toBe(1);
          expect(e.level.spec.bodies.length).toBeGreaterThan(1);
          if (e.status === 'designed') expect(e.level.solution).toBeUndefined();
          if (e.status === 'solved') expect(e.level.solution).toBeDefined();
        }
      },
    });
    // Playable before the proof, and again once proven.
    expect(order).toEqual(['designing', 'sketch', 'draft:designed', 'verifying', 'draft:solved']);
    expect(res.solved).toBe(true);
    expect(res.attempts).toBe(1);
    expect(stages).toEqual(['designing', 'verifying']);
    expect(res.usage).toHaveLength(1);
    expect(res.usage[0].backend).toBe('api');
    expect(checkShot(res.level, res.level.solution!.values).goal.success).toBe(true);
    expect(checkShot(res.level, controlValues(res.level)).goal.success).toBe(false);
  });

  it('edits a level with the same call, keeping the player and controls', async () => {
    const first = await createLevel({ prompt: 'grand tour' }, { llm: new FakeLlm([levelReply()]), solver });
    const llm = new FakeLlm([levelReply(undefined, { briefing: 'Now with a heavier Jove.' })]);
    const res = await createLevel({ level: first.level, instruction: 'make Jove heavier' }, { llm, solver });
    expect(res.level.player).toBe(first.level.player);
    expect(res.level.controls.map((c) => c.path)).toEqual(first.level.controls.map((c) => c.path));
    expect(res.level.briefing).toBe('Now with a heavier Jove.');
    expect(llm.requests[0].prompt).toContain('make Jove heavier');
  });

  it('redesigns a design that is too slow to simulate instead of failing', async () => {
    let calls = 0;
    const slowOnce: typeof solver = {
      ...solver,
      get mode() { return solver.mode; },
      optimize: (spec, job) => (++calls === 1 ? Promise.reject(new SolverError('simulation took too long')) : solver.optimize(spec, job)),
    };
    const llm = new FakeLlm([levelReply()]);
    const res = await createLevel({ prompt: 'grand tour' }, { llm, solver: slowOnce });
    expect(res.solved).toBe(true);
    expect(res.attempts).toBe(2);
    expect(llm.requests[1].prompt).toContain('too slow to simulate');
  });

  it('builds a parts-bin puzzle when the design asks for one', async () => {
    const placed = [{ kind: 'portal' as const, r: 1.2, angle: 30 }, { kind: 'portal' as const, r: 2, angle: 200 }];
    const withSearch: typeof solver = {
      ...solver,
      get mode() { return solver.mode; },
      searchPieces: async () => ({ pieces: placed, score: 1, success: true, robustness: 0.75, evals: 42 }),
    };
    // A shot that cannot reach its goal on its own: the parts have to do the work.
    const llm = new FakeLlm([levelReply(impossibleSpec(), { pieces: { kinds: ['portal'], max: 2 } })]);
    const drafts: string[] = [];
    const res = await createLevel({ prompt: 'a wormhole workshop' }, {
      llm, solver: withSearch, onEvent: (e) => { if (e.type === 'draft') drafts.push(e.status); },
    });
    expect(res.solved).toBe(true);
    expect(res.level.controls).toEqual([]);
    expect(res.level.pieces).toEqual({ kinds: ['portal'], max: 2 });
    expect(res.level.solution?.pieces).toEqual(placed);
    expect(drafts).toEqual(['designed', 'solved']);
    expect(res.notes.join(' ')).toMatch(/75% of slightly off drops/);
  });

  it('rejects a build puzzle whose fixed shot already wins', async () => {
    const llm = new FakeLlm([levelReply(undefined, { pieces: { kinds: ['portal'], max: 2 } })]);
    const res = await createLevel({ prompt: 'a wormhole workshop' }, { llm, solver, maxAttempts: 1 });
    expect(res.solved).toBe(false);
    expect(res.notes.join(' ')).toMatch(/already wins with no parts/);
  });

  it('fails clearly when no LLM backend is available', async () => {
    const env = { key: process.env.ANTHROPIC_API_KEY, backend: process.env.LLM_BACKEND, node: process.env.NODE_ENV };
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.LLM_BACKEND;
    process.env.NODE_ENV = 'production';
    try {
      await expect(createLevel({ prompt: 'x' }, { solver })).rejects.toBeInstanceOf(LlmError);
    } finally {
      if (env.key !== undefined) process.env.ANTHROPIC_API_KEY = env.key;
      if (env.backend !== undefined) process.env.LLM_BACKEND = env.backend;
      process.env.NODE_ENV = env.node;
    }
  });
});
