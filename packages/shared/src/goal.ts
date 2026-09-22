import { eclipseKey, pairKey, type Trace } from './events';
import type { GoalEvent } from './schema';
import { G } from './units';

export interface GoalEventResult {
  index: number;
  satisfied: boolean;
  /** Time the event was matched. */
  t?: number;
  /** Progress toward this event in [0, 1). 1 when satisfied. */
  partial: number;
  /** Human-readable outcome, e.g. the closest miss. */
  note: string;
  /** Time of the closest miss, for highlighting. */
  missT?: number;
}

export interface GoalResult {
  success: boolean;
  satisfiedCount: number;
  /** satisfiedCount + partial progress of the first unmet event; higher is better. */
  score: number;
  /** Score normalised to [0, 1]. */
  progress: number;
  failedAt: number | null;
  events: GoalEventResult[];
}

type Match = { t: number; note: string } | { partial: number; note: string; missT?: number };

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const fmt = (x: number) => (Math.abs(x) >= 100 || Math.abs(x) < 0.01 ? x.toExponential(2) : x.toFixed(2));

/** Partial credit for being `ratio` times too far: 1 at ratio 1, 0 at 10^decades. */
const logCloseness = (ratio: number, decades: number) => clamp(1 - Math.log10(Math.max(ratio, 1)) / decades, 0, 1);

function matchFlyby(g: Extract<GoalEvent, { type: 'flyby' }>, trace: Trace, after: number): Match {
  const pair = trace.pairs[pairKey(g.body, g.target)];
  const approaches = (pair?.approaches ?? []).filter((a) => a.t >= after);
  const hit = approaches.find((a) => a.d <= g.maxDistance);
  if (hit) return { t: hit.t, note: `passed ${fmt(hit.d)} AU from ${g.target} at t=${fmt(hit.t)} yr` };
  if (!approaches.length) return { partial: 0, note: `${g.body} never approached ${g.target}` };
  const best = approaches.reduce((a, b) => (b.d < a.d ? b : a));
  return {
    partial: 0.99 * logCloseness(best.d / g.maxDistance, 3),
    missT: best.t,
    note: `closest approach to ${g.target} was ${fmt(best.d)} AU at t=${fmt(best.t)} yr (needed ≤ ${fmt(g.maxDistance)} AU)`,
  };
}

function matchCapture(g: Extract<GoalEvent, { type: 'capture' }>, trace: Trace, after: number): Match {
  const pair = trace.pairs[pairKey(g.body, g.target)];
  const intervals = (pair?.bound ?? []).filter((b) => !b.initial && b.end >= after);
  let bestBound = 0;
  for (const b of intervals) {
    const need = g.minDuration ?? b.period;
    const dur = b.end - b.start;
    if (dur >= need || (b.open && dur >= 0.5 * need)) {
      const t = Math.max(b.start, after);
      return { t, note: `${g.body} captured by ${g.target} at t=${fmt(b.start)} yr (orbit period ${fmt(b.period)} yr)` };
    }
    if (Number.isFinite(need)) bestBound = Math.max(bestBound, dur / need);
  }
  if (intervals.length) {
    return {
      partial: 0.5 + 0.49 * clamp(bestBound, 0, 1),
      missT: intervals[0].start,
      note: `${g.body} was briefly bound to ${g.target} at t=${fmt(intervals[0].start)} yr but escaped again`,
    };
  }
  const influence = trace.bodies[g.target]?.influence ?? Infinity;
  const approaches = (pair?.approaches ?? []).filter((a) => a.t >= after);
  if (!approaches.length) return { partial: 0, note: `${g.body} never approached ${g.target}` };
  const best = approaches.reduce((a, b) => (b.d < a.d ? b : a));
  if (Number.isFinite(influence) && best.d > influence) {
    return {
      partial: 0.25 * logCloseness(best.d / influence, 3),
      missT: best.t,
      note: `${g.body} came only within ${fmt(best.d)} AU of ${g.target} at t=${fmt(best.t)} yr; capture needs ≤ ${fmt(influence)} AU`,
    };
  }
  const inside = approaches.filter((a) => a.d <= influence);
  const minE = inside.reduce((m, a) => Math.min(m, a.energy), Infinity);
  const mu = G * ((trace.bodies[g.body]?.mass ?? 0) + (trace.bodies[g.target]?.mass ?? 0));
  const escapeScale = Number.isFinite(influence) ? mu / influence : 1;
  return {
    partial: 0.25 + 0.24 / (1 + Math.max(minE, 0) / escapeScale),
    missT: best.t,
    note: `${g.body} entered ${g.target}'s sphere of influence at t=${fmt(best.t)} yr but was moving too fast to be captured`,
  };
}

function matchCollision(g: Extract<GoalEvent, { type: 'collision' }>, trace: Trace, after: number): Match {
  const hit = trace.collisions.find((c) => c.t >= after &&
    ((c.groupA.includes(g.a) && c.groupB.includes(g.b)) || (c.groupA.includes(g.b) && c.groupB.includes(g.a))));
  if (hit) return { t: hit.t, note: `${g.a} and ${g.b} collided at t=${fmt(hit.t)} yr` };
  const pair = trace.pairs[pairKey(g.a, g.b)];
  const approaches = (pair?.approaches ?? []).filter((a) => a.t >= after);
  if (!approaches.length) return { partial: 0, note: `${g.a} and ${g.b} never approached each other` };
  const best = approaches.reduce((a, b) => (b.d < a.d ? b : a));
  const touch = (trace.bodies[g.a]?.radius ?? 0) + (trace.bodies[g.b]?.radius ?? 0);
  return {
    partial: 0.99 * logCloseness(best.d / touch, 5),
    missT: best.t,
    note: `${g.a} and ${g.b} missed by ${fmt(best.d)} AU at t=${fmt(best.t)} yr`,
  };
}

function matchEscape(g: Extract<GoalEvent, { type: 'escape' }>, trace: Trace, after: number): Match {
  const t = trace.escapes[g.body];
  if (t !== undefined && t >= after) return { t, note: `${g.body} escaped the system at t=${fmt(t)} yr` };
  const samples = (trace.energy[g.body] ?? []).filter((s) => s.t >= after);
  if (!samples.length) return { partial: 0, note: `${g.body} did not escape` };
  const best = samples.reduce((a, b) => (b.e > a.e ? b : a));
  return {
    partial: 0.99 * clamp(0.5 + 0.5 * Math.tanh(best.e), 0, 1),
    missT: best.t,
    note: best.e > 0
      ? `${g.body} was on an escape path but the run ended before it cleared ${fmt(trace.escapeRadius)} AU`
      : `${g.body} stayed bound to the system (best energy ${fmt(best.e)} at t=${fmt(best.t)} yr)`,
  };
}

function matchEclipse(g: Extract<GoalEvent, { type: 'eclipse' }>, trace: Trace, after: number): Match {
  const ec = trace.eclipses[eclipseKey(g.source, g.occluder, g.observer)];
  const starts = (ec?.starts ?? []).filter((t) => t >= after);
  if (g.period === undefined) {
    if (starts.length) return { t: starts[0], note: `${g.occluder} eclipsed ${g.source} from ${g.observer} at t=${fmt(starts[0])} yr` };
  } else if (starts.length >= 3) {
    const gaps = starts.slice(1).map((t, i) => t - starts[i]);
    const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    const err = Math.abs(mean - g.period) / g.period;
    if (err <= 0.15 && gaps.every((x) => Math.abs(x - g.period!) / g.period! <= 0.3)) {
      return { t: starts[2], note: `${g.occluder} eclipses ${g.source} every ${fmt(mean)} yr as seen from ${g.observer}` };
    }
    return {
      partial: 0.5 + 0.49 * clamp(1 - err, 0, 1),
      missT: starts[0],
      note: `eclipses repeat every ${fmt(mean)} yr, wanted ${fmt(g.period)} yr`,
    };
  } else if (starts.length) {
    return { partial: 0.4 + 0.05 * starts.length, missT: starts[0], note: `only ${starts.length} eclipse(s) happened; need a repeating pattern` };
  }
  const minima = (ec?.minima ?? []).filter((m) => m.t >= after);
  if (!minima.length) return { partial: 0, note: `${g.occluder} never lined up with ${g.source} from ${g.observer}` };
  const best = minima.reduce((a, b) => (b.ratio < a.ratio ? b : a));
  return {
    partial: 0.4 * logCloseness(best.ratio, 3),
    missT: best.t,
    note: `closest alignment of ${g.occluder} with ${g.source} was ${fmt(best.ratio)}x too wide at t=${fmt(best.t)} yr`,
  };
}

/** Partial credit from how close `body` came to `target`'s rim (radius `rim`). */
function nearMiss(body: string, target: string, rim: number, trace: Trace, after: number, what: string): Match {
  const approaches = (trace.pairs[pairKey(body, target)]?.approaches ?? []).filter((a) => a.t >= after);
  if (!approaches.length) return { partial: 0, note: `${body} never approached ${target}` };
  const best = approaches.reduce((a, b) => (b.d < a.d ? b : a));
  return {
    partial: 0.99 * logCloseness(best.d / Math.max(rim, 1e-9), 3),
    missT: best.t,
    note: `${body} missed ${what} ${target} by ${fmt(Math.max(0, best.d - rim))} AU at t=${fmt(best.t)} yr`,
  };
}

function matchWarp(g: Extract<GoalEvent, { type: 'warp' }>, trace: Trace, after: number): Match {
  const hit = trace.warps.find((w) => w.t >= after && w.body === g.body && w.from === g.portal);
  if (hit) return { t: hit.t, note: `${g.body} flew through ${g.portal} and came out of ${hit.to} at t=${fmt(hit.t)} yr` };
  const wrong = trace.warps.find((w) => w.t >= after && w.body === g.body);
  const rim = (trace.bodies[g.portal]?.radius ?? 0) + (trace.bodies[g.body]?.radius ?? 0);
  const miss = nearMiss(g.body, g.portal, rim, trace, after, 'the portal');
  return wrong ? { ...miss, note: `${g.body} went through ${wrong.from} instead of ${g.portal}` } : miss;
}

function matchBounce(g: Extract<GoalEvent, { type: 'bounce' }>, trace: Trace, after: number): Match {
  const hit = trace.bounces.find((b) => b.t >= after && b.body === g.body && b.target === g.target);
  if (hit) return { t: hit.t, note: `${g.body} bounced off ${g.target} at t=${fmt(hit.t)} yr` };
  const rim = (trace.bodies[g.target]?.radius ?? 0) + (trace.bodies[g.body]?.radius ?? 0);
  return nearMiss(g.body, g.target, rim, trace, after, 'the bumper');
}

function matchEvent(g: GoalEvent, trace: Trace, after: number): Match {
  switch (g.type) {
    case 'flyby': return matchFlyby(g, trace, after);
    case 'capture': return matchCapture(g, trace, after);
    case 'collision': return matchCollision(g, trace, after);
    case 'escape': return matchEscape(g, trace, after);
    case 'eclipse': return matchEclipse(g, trace, after);
    case 'warp': return matchWarp(g, trace, after);
    case 'bounce': return matchBounce(g, trace, after);
  }
}

/** Check an ordered goal: each event must happen no earlier than the previous one. */
export function evaluateGoal(goal: GoalEvent[], trace: Trace): GoalResult {
  const events: GoalEventResult[] = [];
  let after = 0;
  let failedAt: number | null = null;
  let partial = 0;
  goal.forEach((g, index) => {
    if (failedAt !== null) {
      events.push({ index, satisfied: false, partial: 0, note: 'not reached' });
      return;
    }
    const m = matchEvent(g, trace, after);
    if ('t' in m) {
      events.push({ index, satisfied: true, t: m.t, partial: 1, note: m.note });
      after = m.t;
    } else {
      failedAt = index;
      partial = m.partial;
      events.push({ index, satisfied: false, partial: m.partial, note: m.note, missT: m.missT });
    }
  });
  const satisfiedCount = failedAt ?? goal.length;
  const score = satisfiedCount + partial;
  return {
    success: failedAt === null,
    satisfiedCount,
    score,
    progress: goal.length ? score / goal.length : 1,
    failedAt,
    events,
  };
}
