import type { GoalEvent, GoalResult, Level, SimEvent } from '@og/shared';
import { formatDistance, formatTime } from '../format';

/** The body a goal step is "about", which gets the checkpoint ring. */
export function goalTarget(g: GoalEvent, player: string): string | null {
  switch (g.type) {
    case 'flyby':
    case 'capture': return g.body === player ? g.target : g.body;
    case 'collision': return g.a === player ? g.b : g.a;
    case 'escape': return null;
    case 'eclipse': return g.occluder;
  }
}

export const GOAL_ICON: Record<GoalEvent['type'], string> = {
  flyby: '↪', capture: '◎', collision: '💥', escape: '🚀', eclipse: '◐',
};

export function goalShort(g: GoalEvent, player: string, n: (id: string) => string): string {
  switch (g.type) {
    case 'flyby': return g.body === player ? `Skim ${n(g.target)}` : `${n(g.body)} skims ${n(g.target)}`;
    case 'capture': return g.body === player ? `Orbit ${n(g.target)}` : `${n(g.target)} captures ${n(g.body)}`;
    case 'collision': return g.a === player || g.b === player ? `Hit ${n(g.a === player ? g.b : g.a)}` : `${n(g.a)} hits ${n(g.b)}`;
    case 'escape': return g.body === player ? 'Escape the system' : `${n(g.body)} escapes`;
    case 'eclipse': return `${n(g.occluder)} eclipses ${n(g.source)}`;
  }
}

const DIRECTIONS: Record<string, [string, string]> = {
  Power: ['a little less power', 'a little more power'],
  Aim: ['aiming more inward (toward the star)', 'aiming more outward'],
  'Launch time': ['launching earlier', 'launching later'],
  Tilt: ['tilting down', 'tilting up'],
};

/** Local, instant nudge from the known solution: the control furthest off, never exact numbers. */
export function directionalHint(level: Level, values: number[]): string | null {
  const sol = level.solution?.values;
  if (!sol) return null;
  let worst = -1, worstDiff = 0;
  level.controls.forEach((c, i) => {
    const d = (sol[i] - values[i]) / (c.max - c.min);
    if (Math.abs(d) > Math.abs(worstDiff)) { worst = i; worstDiff = d; }
  });
  if (worst < 0 || Math.abs(worstDiff) < 0.015) return 'You are very close. Tiny adjustments only.';
  const c = level.controls[worst];
  const [less, more] = DIRECTIONS[c.label] ?? [`lowering ${c.label}`, `raising ${c.label}`];
  const size = Math.abs(worstDiff) > 0.2 ? 'Try ' : 'Try just ';
  return `${size}${worstDiff > 0 ? more : less}.`;
}

function withNames(text: string, names: Map<string, string>): string {
  let out = text;
  for (const [id, name] of names) out = out.replace(new RegExp(`\\b${id}\\b`, 'g'), name);
  return out
    .replace(/t=([\d.e+-]+) yr/g, (_, t) => `at ${formatTime(Number(t))}`)
    .replace(/at at /g, 'at ')
    .replace(/([\d.]+(?:e[+-]?\d+)?) AU/g, (_, d) => formatDistance(Number(d)));
}

/** One-line human summary of how a shot went. */
export function missSummary(level: Level, goal: GoalResult, names: Map<string, string>): string {
  if (goal.success) return 'Chain complete!';
  const i = goal.failedAt ?? 0;
  const g = level.spec.goal[i];
  const r = goal.events[i];
  const step = level.spec.goal.length > 1 ? `Step ${i + 1} missed: ` : 'Missed: ';
  const m = r.note.match(/closest approach to (\S+) was ([\d.e+-]+) AU at t=[\d.e+-]+ yr \(needed ≤ ([\d.e+-]+) AU\)/);
  if (m) return `${step}closest pass to ${names.get(m[1]) ?? m[1]} was ${formatDistance(Number(m[2]))}, needed ${formatDistance(Number(m[3]))}.`;
  if (/never approached/.test(r.note)) return `${step}never got near ${names.get(goalTarget(g, level.player) ?? '') ?? 'the target'}.`;
  const n = (id: string) => names.get(id) ?? id;
  if (g.type === 'escape') {
    return /escape path/.test(r.note)
      ? `${step}${n(g.body)} was on its way out but time ran out. Leave sooner or faster.`
      : `${step}${n(g.body)} never reached escape speed. It needs a bigger kick.`;
  }
  if (g.type === 'capture') {
    if (/briefly bound/.test(r.note)) return `${step}${n(g.body)} was caught by ${n(g.target)} but slipped away again. So close!`;
    if (/too fast/.test(r.note)) return `${step}${n(g.body)} reached ${n(g.target)} but was moving too fast to be caught.`;
    const cm = r.note.match(/came only within ([\d.e+-]+) AU/);
    if (cm) return `${step}${n(g.body)} came within ${formatDistance(Number(cm[1]))} of ${n(g.target)}, not close enough to be caught.`;
  }
  if (g.type === 'collision') {
    const hm = r.note.match(/missed by ([\d.e+-]+) AU/);
    if (hm) return `${step}${n(g.a)} missed ${n(g.b)} by ${formatDistance(Number(hm[1]))}.`;
  }
  if (g.type === 'eclipse' && /never lined up|closest alignment/.test(r.note)) return `${step}${n(g.occluder)} never lined up in front of ${n(g.source)}.`;
  return step + withNames(r.note, names);
}

export function playerFate(level: Level, events: SimEvent[], names: Map<string, string>): string | null {
  const crash = events.find((e) => e.type === 'collision' && e.bodies.includes(level.player));
  if (crash) {
    const other = crash.bodies.find((b) => b !== level.player);
    return `It crashed into ${other ? names.get(other) ?? other : 'something'}.`;
  }
  if (events.some((e) => e.type === 'escape' && e.bodies[0] === level.player)) return 'It flew out of the system.';
  return null;
}
