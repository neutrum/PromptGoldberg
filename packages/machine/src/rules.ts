/**
 * Challenge rules: a level can ask for a build with few parts ("only three parts") or a run that
 * lasts ("make it take longer than 10 seconds"). The goal still has to happen; the rules come on top,
 * and the browser and the server check them the same way.
 */
import type { MachineResult } from './goal';
import type { Rules } from './schema';

const NUMBER: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, ten: 10, twelve: 12 };
const num = (w: string) => NUMBER[w.toLowerCase()] ?? Number(w);

/** The rules a mission's words ask for ("only three parts", "at least 8 seconds", "the slowest"), or undefined. */
export function rulesOf(text: string): Rules | undefined {
  const rules: Rules = {};
  const parts = /\b(?:only|just|at most|no more than|max(?:imum)?|with)\s+(one|two|three|four|five|six|\d)\s+(?:parts?|pieces?)\b/i.exec(text);
  if (parts) rules.maxParts = Math.max(1, Math.min(8, num(parts[1])));
  const secs = /\b(?:longer than|at least|more than|over|last(?:s|ing)?|takes?)\s+(\d+|one|two|three|four|five|six|seven|eight|ten|twelve)\s*(?:s|secs?|seconds?)\b/i.exec(text);
  if (secs) rules.minSeconds = Math.max(1, Math.min(14, num(secs[1])));
  else if (/\b(slowest|longest|slow ?motion|take (?:its|your) time|as slow as)\b/i.test(text)) rules.minSeconds = 6;
  return rules.maxParts || rules.minSeconds ? rules : undefined;
}

/** When the last goal step happened, in seconds (undefined unless the goal was met). */
export function finishTime(result: MachineResult): number | undefined {
  return result.success ? result.steps[result.steps.length - 1]?.t : undefined;
}

/** What a solved run breaks of the rules, for the player; empty when it keeps them all. */
export function ruleProblems(rules: Rules | undefined, result: MachineResult, placed: number): string[] {
  if (!rules) return [];
  const out: string[] = [];
  if (rules.maxParts !== undefined && placed > rules.maxParts) out.push(`You used ${placed} parts; this challenge allows ${rules.maxParts}.`);
  const t = finishTime(result);
  if (rules.minSeconds !== undefined && t !== undefined && t < rules.minSeconds) out.push(`It finished at ${t.toFixed(1)} s; this challenge wants ${rules.minSeconds} s or longer.`);
  return out;
}

/** The rules in a few words, for the panel. */
export function rulesLine(rules: Rules | undefined): string | null {
  if (!rules) return null;
  const bits: string[] = [];
  if (rules.maxParts !== undefined) bits.push(`at most ${rules.maxParts} part${rules.maxParts > 1 ? 's' : ''}`);
  if (rules.minSeconds !== undefined) bits.push(`finish at ${rules.minSeconds} s or later`);
  return bits.length ? `Challenge: ${bits.join(', ')}.` : null;
}
