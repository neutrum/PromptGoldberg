import { describe, expect, it } from 'vitest';
import { checkShot, controlValues } from '@og/shared';
import { createLevel, createSolver, LlmError } from '../src';
import { FakeLlm, levelReply } from './helpers';

// Inline solver: no worker threads, so tests stay fast and deterministic.
const solver = createSolver('inline');

describe('createLevel', () => {
  it('turns a prompt into a solved level whose sliders start on a miss', async () => {
    const llm = new FakeLlm([levelReply()]);
    const stages: string[] = [];
    const res = await createLevel({ prompt: 'swing past the giant and reach the ice world' }, {
      llm, solver, onEvent: (e) => { if (e.type === 'stage') stages.push(e.stage); },
    });
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
