import type { CoachRequest, Control, GoalEvent, Level, SimEvent } from '@og/shared';
import type { LlmBackend } from './llm/client';

const COACH_MODEL = () => process.env.CLAUDE_COACH_MODEL ?? 'claude-sonnet-5';

function nameOf(level: Level, id: string): string {
  if (id === level.player) return 'your ' + (level.spec.bodies.find((b) => b.id === id)?.type ?? 'probe');
  return level.spec.bodies.find((b) => b.id === id)?.name ?? id;
}

/** A goal step in game words, e.g. "swing past Jove". */
export function describeStep(level: Level, g: GoalEvent): string {
  const n = (id: string) => nameOf(level, id);
  switch (g.type) {
    case 'flyby': return `swing past ${n(g.target)}`;
    case 'capture': return `get ${n(g.body)} captured by ${n(g.target)}`;
    case 'collision': return g.a === level.player || g.b === level.player
      ? `hit ${n(g.a === level.player ? g.b : g.a)}`
      : `make ${n(g.a)} crash into ${n(g.b)}`;
    case 'escape': return `fling ${n(g.body)} out of the system`;
    case 'eclipse': return `line ${n(g.occluder)} up in front of ${n(g.source)}`;
    case 'warp': return `fly into the portal ${n(g.portal)}`;
    case 'bounce': return `bounce off ${n(g.target)}`;
  }
}

function amount(frac: number): string {
  const a = Math.abs(frac);
  return a < 0.08 ? 'a touch' : a < 0.25 ? 'a bit' : 'a lot';
}

/** Directional advice for one control, never with numbers. */
export function controlAdvice(c: Control, value: number, target: number): string | null {
  const span = c.max - c.min;
  const frac = (target - value) / span;
  if (Math.abs(frac) < 0.02) return null;
  const up = frac > 0;
  const how = amount(frac);
  const key = c.path.split('.').pop()!;
  switch (key) {
    case 'speed': return up ? `give it ${how} more power` : `ease off the power ${how}`;
    case 'angle': {
      // angle 0 = prograde, 90 = outward: increasing it turns outward while cos(angle) > 0.
      const outward = up === Math.cos((value * Math.PI) / 180) >= 0;
      return `aim ${how} further ${outward ? 'outward' : 'inward'}`;
    }
    case 'time': return up ? `launch ${how} later` : `launch ${how} earlier`;
    case 'elevation': return up ? `tilt ${how} higher` : `tilt ${how} lower`;
    case 'phase': return up ? `start it ${how} further along its orbit` : `start it ${how} further back in its orbit`;
    case 'a': return up ? `make the orbit ${how} wider` : `make the orbit ${how} tighter`;
    case 'e': return up ? `stretch the orbit ${how} more` : `make the orbit ${how} rounder`;
    default: return `${up ? 'raise' : 'lower'} ${c.label} ${how}`;
  }
}

/** The one or two controls furthest from the known solution, as advice. */
export function directionalHint(level: Level, values: number[]): string | null {
  const sol = level.solution?.values;
  if (!sol || sol.length !== level.controls.length) return null;
  const ranked = level.controls
    .map((c, i) => ({ c, i, frac: Math.abs((sol[i] - (values[i] ?? sol[i])) / (c.max - c.min)) }))
    .filter((x) => x.frac >= 0.02)
    .sort((a, b) => b.frac - a.frac);
  const tips = ranked.slice(0, 2)
    .filter((x, k) => k === 0 || x.frac >= 0.5 * ranked[0].frac)
    .map((x) => controlAdvice(x.c, values[x.i], sol[x.i]))
    .filter((t): t is string => !!t);
  if (!tips.length) return null;
  return tips.join(' and ');
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function closestApproach(events: SimEvent[], a: string, b: string): number | undefined {
  const d = events
    .filter((e) => e.type === 'flyby' && e.bodies.includes(a) && e.bodies.includes(b))
    .map((e) => e.details.distance)
    .filter((x) => Number.isFinite(x));
  return d.length ? Math.min(...d) : undefined;
}

/** Deterministic coaching tip: which step failed, how close it was, and which way to adjust. */
export function deterministicTip(req: CoachRequest): string {
  const { level, goal, values } = req;
  if (goal.success) {
    return req.shots <= level.par
      ? 'Perfect run! That chain went off without a hitch.'
      : `Cleared! Try it again in ${level.par} shots or fewer for three stars.`;
  }
  const idx = goal.failedAt ?? 0;
  const step = level.spec.goal[idx];
  const total = level.spec.goal.length;
  const result = goal.events[idx];
  const stepText = step ? describeStep(level, step) : 'reach the goal';
  const where = total > 1 ? `Step ${idx + 1} of ${total}` : 'The goal';
  const partial = result?.partial ?? 0;
  const closeness = partial >= 0.85 ? 'so close' : partial >= 0.5 ? 'getting closer' : partial > 0.1 ? 'still a long way off' : 'not close yet';

  let first = `${where} (${stepText}) missed, ${closeness}.`;
  if (idx > 0) first = `Nice, ${idx === 1 ? 'the first step worked' : `${idx} steps worked`}! ${first}`;
  if (step && step.type === 'flyby' && partial > 0 && partial < 0.5) {
    const d = closestApproach(req.events, step.body, step.target);
    if (d !== undefined && d > step.maxDistance * 3) first = `${where} (${stepText}) missed: you stayed about ${Math.round(d / step.maxDistance)} times too far away.`;
  }

  const hint = directionalHint(level, values);
  if (hint) return `${first} Try to ${hint}.`;
  if (level.solution?.pieces.length && !req.pieces.length) return `${first} Try placing a planet to bend the path.`;
  if (level.tip) return `${first} ${capitalize(level.tip)}`;
  const generic = step?.type === 'flyby' || step?.type === 'collision'
    ? 'Targets keep moving, so aim where they will be when you arrive.'
    : 'Small changes to timing make big differences.';
  return `${first} ${generic}`;
}

const COACH_SYSTEM = `You are the friendly coach in Orbital Goldberg, a gravity puzzle game where the player launches a probe through a star system to set off a chain of events.
Rewrite the coaching hint you are given as one or two short, vivid, encouraging sentences (max 40 words) addressed to the player.
Keep the direction of the advice exactly as given. Never invent numbers, never mention AU, years or internal ids. Reply with the tip text only.`;

/** Rephrase the deterministic tip with the LLM; any failure or slowness falls back to the deterministic tip. */
export async function coachTip(req: CoachRequest, llm: LlmBackend | null, opts: { timeoutMs?: number; useLlm?: boolean } = {}): Promise<{ tip: string; source: 'llm' | 'rules' }> {
  const base = deterministicTip(req);
  if (!llm || opts.useLlm === false) return { tip: base, source: 'rules' };

  const { level, goal } = req;
  const failed = goal.failedAt;
  const context = [
    `Level: ${level.title}. ${level.briefing}`,
    `Goal steps: ${level.spec.goal.map((g, i) => `${i + 1}. ${describeStep(level, g)}`).join('; ')}`,
    `Shots taken: ${req.shots}`,
    failed === null ? 'Result: cleared.' : `Failed at step ${failed + 1}: ${goal.events[failed]?.note ?? ''}`,
    `Hint to convey: ${base}`,
  ].join('\n');

  let timer: NodeJS.Timeout | undefined;
  try {
    const reply = await Promise.race([
      // No thinking: it would eat the small token budget and delay a tip the player is waiting for.
      llm.complete({ system: COACH_SYSTEM, prompt: context, maxTokens: 120, model: COACH_MODEL(), thinking: 'off' }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('coach timeout')), opts.timeoutMs ?? 8000);
      }),
    ]);
    const tip = reply.text.trim().replace(/^["'“]+|["'”]+$/g, '').replace(/\s+/g, ' ');
    if (tip.length < 8 || tip.length > 320) return { tip: base, source: 'rules' };
    return { tip, source: 'llm' };
  } catch {
    return { tip: base, source: 'rules' };
  } finally {
    clearTimeout(timer);
  }
}
