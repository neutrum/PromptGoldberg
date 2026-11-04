import { CELL, type MachineGoal } from './schema';
import type { MachineRun } from './sim';

export interface GoalStepResult {
  index: number;
  satisfied: boolean;
  /** Time the step happened. */
  t?: number;
  /** Progress toward the step in [0, 1); 1 when satisfied. */
  partial: number;
  note: string;
}

export interface MachineResult {
  success: boolean;
  satisfiedCount: number;
  /** satisfiedCount + partial progress of the first unmet step. */
  score: number;
  progress: number;
  failedAt: number | null;
  steps: GoalStepResult[];
}

const fmt = (x: number) => x.toFixed(1);
/** Partial credit from how close the ball came: 1 at touching, 0 at `reach` cells away. */
const closeness = (d: number, reach = 8) => Math.max(0, Math.min(1, 1 - d / (reach * CELL)));

type Match = { t: number; note: string } | { partial: number; note: string };

function matchStep(g: MachineGoal, run: MachineRun, after: number): Match {
  const near = run.closest[g.part];
  const miss = (what: string): Match => near
    ? { partial: 0.95 * closeness(near.d), note: `the ball never ${what} ${g.part}; closest was ${fmt(near.d / CELL)} cells away at ${fmt(near.t)} s` }
    : { partial: 0, note: `the ball never ${what} ${g.part}` };
  switch (g.type) {
    case 'bucket': {
      const hit = run.events.find((e) => e.type === 'bucket' && e.part === g.part && e.t >= after);
      if (hit) return { t: hit.t, note: `the ball settled in ${g.part} at ${fmt(hit.t)} s` };
      const touched = run.events.find((e) => e.type === 'touch' && e.part === g.part && e.t >= after);
      if (touched) return { partial: 0.97, note: `the ball hit ${g.part} at ${fmt(touched.t)} s but did not stay in it` };
      return miss('landed in');
    }
    case 'bell': {
      const rings = run.events.filter((e) => e.type === 'bell' && e.part === g.part && e.t >= after);
      if (rings.length >= g.times) return { t: rings[g.times - 1].t, note: g.times > 1 ? `${g.part} rang ${g.times} times, the last at ${fmt(rings[g.times - 1].t)} s` : `${g.part} rang at ${fmt(rings[0].t)} s` };
      if (rings.length) return { partial: 0.5 + 0.45 * (rings.length / g.times), note: `${g.part} rang only ${rings.length} of ${g.times} times` };
      return miss('rang');
    }
    case 'topple': {
      const hit = run.events.find((e) => e.type === 'topple' && e.part === g.part && e.t >= after);
      if (hit) return { t: hit.t, note: `${g.part} all fell by ${fmt(hit.t)} s` };
      const touched = run.events.find((e) => e.type === 'touch' && e.part === g.part && e.t >= after);
      if (touched) return { partial: 0.8, note: `the ball hit ${g.part} at ${fmt(touched.t)} s but not all of them fell` };
      return miss('reached');
    }
    case 'touch': {
      const hit = run.events.find((e) => e.type === 'touch' && e.part === g.part && e.t >= after);
      if (hit) return { t: hit.t, note: `the ball reached ${g.part} at ${fmt(hit.t)} s` };
      return miss('reached');
    }
  }
}

/** Check an ordered goal against a run: each step must happen no earlier than the previous one. */
export function evaluateMachine(goal: MachineGoal[], run: MachineRun): MachineResult {
  const steps: GoalStepResult[] = [];
  let after = 0;
  let failedAt: number | null = null;
  let partial = 0;
  goal.forEach((g, index) => {
    if (failedAt !== null) {
      steps.push({ index, satisfied: false, partial: 0, note: 'not reached' });
      return;
    }
    const m = matchStep(g, run, after);
    if ('t' in m) {
      steps.push({ index, satisfied: true, t: m.t, partial: 1, note: m.note });
      after = m.t;
    } else {
      failedAt = index;
      partial = m.partial;
      steps.push({ index, satisfied: false, partial: m.partial, note: m.note });
    }
  });
  const satisfiedCount = failedAt ?? goal.length;
  const score = satisfiedCount + partial;
  return { success: failedAt === null, satisfiedCount, score, progress: goal.length ? score / goal.length : 1, failedAt, steps };
}
