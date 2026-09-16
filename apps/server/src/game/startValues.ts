import { clampControl, getTunable, type Control, type GoalResult, type Level, type Piece, type SystemSpec } from '@og/shared';

export type ShotChecker = (level: Level, values: number[], pieces: Piece[]) => Promise<GoalResult> | GoalResult;

/** Round to a precision that looks hand-picked on a slider (about 1/1000 of the range). */
export function roundForControl(c: Control, v: number): number {
  const step = 10 ** Math.floor(Math.log10((c.max - c.min) / 1000));
  return clampControl(c, Number((Math.round(v / step) * step).toFixed(Math.max(0, Math.round(-Math.log10(step))))));
}

/** Candidate starting points around the solution, nearest first, alternating directions per control. */
export function nudgeCandidates(controls: Control[], solution: number[]): number[][] {
  const out: number[][] = [];
  const patterns = [
    (i: number) => (i % 2 ? -1 : 1),
    (i: number) => (i % 2 ? 1 : -1),
    () => 1,
    () => -1,
  ];
  for (const frac of [0.15, 0.25, 0.35, 0.5]) {
    for (const sign of patterns) {
      out.push(controls.map((c, i) => {
        const span = c.max - c.min;
        let v = solution[i] + sign(i) * frac * span;
        // Reflect off the ends so the nudge stays a real move away from the solution.
        if (v > c.max || v < c.min) v = solution[i] - sign(i) * frac * span;
        return roundForControl(c, v);
      }));
    }
  }
  return out;
}

/**
 * Starting slider values that do not already clear the level: the designer's original
 * guess when it misses, otherwise the nearest nudge away from the solution that misses.
 */
export async function chooseStartValues(
  level: Level,
  solution: number[],
  guess: number[] | undefined,
  check: ShotChecker,
  pieces: Piece[] = [],
): Promise<{ values: number[]; source: 'guess' | 'nudge' | 'fallback' }> {
  const differs = (v: number[]) => v.some((x, i) => Math.abs(x - solution[i]) > 0.02 * (level.controls[i].max - level.controls[i].min));
  if (guess && guess.length === level.controls.length) {
    const g = guess.map((v, i) => roundForControl(level.controls[i], v));
    if (differs(g) && !(await check(level, g, pieces)).success) return { values: g, source: 'guess' };
  }
  for (const candidate of nudgeCandidates(level.controls, solution)) {
    if (!(await check(level, candidate, pieces)).success) return { values: candidate, source: 'nudge' };
  }
  return { values: level.controls.map((c) => roundForControl(c, c.min)), source: 'fallback' };
}

/** Control values read from a spec (e.g. the LLM's design before tuning). */
export function valuesFromSpec(spec: SystemSpec, controls: Control[]): number[] | undefined {
  const v = controls.map((c) => getTunable(spec, c.path));
  return v.every((x): x is number => x !== undefined) ? v : undefined;
}
