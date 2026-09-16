import { pairKey, type Trace } from '../events';
import { evaluateGoal, type GoalResult } from '../goal';
import { optimize } from '../optimizer';
import type { BodySpec, GoalEvent, SystemSpec } from '../schema';
import { simulate, type SimResult } from '../sim';
import { DEG, G, orbitalPeriod } from '../units';
import { Level, checkShot, parseLevel, shotSpec, type Control } from './level';

/**
 * Seeded procedural levels for Daily and Endless modes. Pure TS, no Node APIs.
 *
 * Levels are built "shot first": pick a launch (the solution), fly it, then place each
 * goal body on the probe's path (orbit phase) and refine the placement with the
 * optimizer. The result is verified, checked for a missing start and a random-play
 * success rate that tightens with difficulty, and re-rolled from a derived seed otherwise.
 */

export interface GenerateOptions {
  /** Safety net only; generation is budgeted by attempt count for determinism. Default 6000. */
  timeLimitMs?: number;
  onProgress?: (p: { attempt: number; evals: number }) => void;
}

export interface GenerateResult {
  level: Level;
  attempts: number;
  evals: number;
}

// ---------------------------------------------------------------- randomness

export function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stable 32-bit hash of a list of integers. */
function mix(...xs: number[]): number {
  let h = 0x9e3779b9;
  for (const x of xs) {
    h = Math.imul(h ^ (x | 0), 0x85ebca6b);
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
  }
  return h >>> 0;
}

class Rng {
  private r: () => number;
  constructor(seed: number) { this.r = mulberry32(seed); }
  next(): number { return this.r(); }
  range(a: number, b: number): number { return a + (b - a) * this.r(); }
  logRange(a: number, b: number): number { return Math.exp(this.range(Math.log(a), Math.log(b))); }
  int(a: number, b: number): number { return a + Math.floor(this.r() * (b - a + 1)); }
  pick<T>(xs: readonly T[]): T { return xs[Math.floor(this.r() * xs.length)]; }
  chance(p: number): boolean { return this.r() < p; }
}

/** UTC calendar date -> stable 32-bit seed (same for every player that day). */
export function dailySeed(date: Date): number {
  const key = `${date.getUTCFullYear()}-${date.getUTCMonth() + 1}-${date.getUTCDate()}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 0x01000193);
  return mix(h, 0x0da11);
}

/** Endless stage (1-based) -> difficulty 1..10; reaches 10 at stage 15. */
export function endlessDifficulty(stage: number): number {
  const s = Math.max(1, Math.floor(stage));
  return Math.min(10, Math.max(1, Math.round(1 + (s - 1) * 0.65)));
}

// ---------------------------------------------------------------- flavour

const SYLLABLES = ['ka', 've', 'lo', 'ri', 'tha', 'mor', 'sen', 'qui', 'ax', 'el', 'dra', 'nu', 'os', 'vel', 'kes',
  'sa', 'or', 'zar', 'ly', 'bri', 'ta', 'mi', 'gor', 'an', 'dus', 'phe', 'ra', 'cy', 'on', 'ix', 'ter', 'ul', 'no',
  'va', 'ze', 'ish', 'per', 'hal', 'ce', 'tor', 'um', 'wen', 'ja', 'ro'];
const STAR_COLORS: [number, string][] = [[0.8, '#ffb070'], [1.1, '#ffd27a'], [1.4, '#fff1c4'], [Infinity, '#cfe2ff']];
const ROCKY_COLORS = ['#c9a27a', '#b5654a', '#8fb3c9', '#d8c9a3', '#7fae8a', '#5fa8ff', '#d98b6a'];
const GIANT_COLORS = ['#e0a86a', '#d9b38c', '#c98f6b', '#9fe3e8', '#7f9fe8', '#e8c77f', '#b89be8'];
const MOON_COLORS = ['#bdb7ad', '#a8a29a', '#d6d0c4', '#c4b59a'];
const PROBE_NAMES = ['Lark', 'Wren', 'Skiff', 'Moth', 'Kite', 'Finch', 'Spark', 'Dart', 'Pip', 'Ember'];

function makeNamer(rng: Rng) {
  const used = new Set<string>(['probe']);
  return (): string => {
    for (let k = 0; ; k++) {
      const n = rng.chance(0.65) ? 2 : 3;
      let s = '';
      for (let i = 0; i < n; i++) s += rng.pick(SYLLABLES);
      if ((s.length < 4 || s.length > 8) && k < 20) continue;
      if (used.has(s)) continue;
      used.add(s);
      return s[0].toUpperCase() + s.slice(1);
    }
  };
}

// ---------------------------------------------------------------- templates

type Step =
  | { kind: 'flyby'; dynamic: boolean }
  | { kind: 'collide' }
  | { kind: 'moon' }
  | { kind: 'escape' };

interface Template { steps: Step[]; timing: boolean }

function chooseTemplate(d: number, rng: Rng): Template {
  const fly = (dynamic: boolean): Step => ({ kind: 'flyby', dynamic });
  if (d <= 2) return { steps: [fly(false)], timing: false };
  if (d <= 4) return { steps: [rng.chance(0.45) ? { kind: 'collide' } : fly(false)], timing: true };
  if (d <= 6) return { steps: [fly(false), fly(true)], timing: true };
  if (d <= 8) return { steps: [fly(false), rng.chance(0.5) ? { kind: 'escape' } : { kind: 'moon' }], timing: true };
  const last: Step = rng.pick<Step>([{ kind: 'escape' }, fly(true), { kind: 'moon' }]);
  return { steps: [fly(false), fly(true), last], timing: true };
}

// ---------------------------------------------------------------- system

interface PlanetDraft { body: BodySpec; a: number; giant: boolean; moon?: BodySpec; moonR?: number }

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const round = (x: number, digits: number) => Math.round(x * 10 ** digits) / 10 ** digits;
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

function hohmannTime(r1: number, r2: number, M: number): number {
  return Math.PI * Math.sqrt(((r1 + r2) / 2) ** 3 / (G * M));
}

interface Attempt {
  level: Level;
  evals: number;
  rate: number;
  maxRate: number;
  /** Fraction of small control nudges around the solution that still solve. */
  robustness: number;
}

type Fail = { fail: string; evals: number };

const SAMPLES = 40;
const FRAMES = 2000;

/**
 * Round a step count up so computeTiming keeps it exactly (a multiple of its sample stride):
 * with a fixed power-of-two dt, runs of different lengths then share the same trajectory.
 */
function stepsFor(k: number): number {
  for (let se = Math.max(1, Math.floor(k / FRAMES)); k % se !== 0; se = Math.max(1, Math.floor(k / FRAMES))) {
    k = Math.ceil(k / se) * se;
  }
  return k;
}

/** One generation attempt; deterministic in its seed. */
function attempt(seed: number, difficulty: number, deadline: number): Attempt | Fail {
  const rng = new Rng(seed);
  const td = (difficulty - 1) / 9;
  const name = makeNamer(rng);
  const tpl = chooseTemplate(difficulty, rng);
  const hasEscape = tpl.steps.some((s) => s.kind === 'escape');
  const hasMoon = tpl.steps.some((s) => s.kind === 'moon');
  const nFly = tpl.steps.filter((s) => s.kind === 'flyby').length;
  let evals = 0;

  // --- star
  const M = round(rng.logRange(0.6, 1.8), 2);
  const starName = name();
  const star: BodySpec = {
    id: starName.toLowerCase(), name: starName, type: 'star', mass: M,
    radius: round(0.00465 * M ** 0.8, 5),
    color: STAR_COLORS.find(([m]) => M < m)![1],
    placement: { kind: 'free', position: [0, 0, 0], velocity: [0, 0, 0] },
  };

  // --- planets
  const minPlanets = Math.max(2, nFly + 1 + (tpl.steps.length > 1 ? 1 : 0));
  const maxA = hasEscape ? 7 : 14;
  const want = rng.int(minPlanets, Math.max(minPlanets, difficulty <= 2 ? 4 : 5));
  const radii: number[] = [];
  let a = rng.range(0.7, 1.2);
  const ratioHi = hasEscape ? 1.9 : 2.2;
  while (radii.length < want && a <= maxA) {
    radii.push(round(a, 2));
    a *= rng.range(1.5, ratioHi);
  }
  if (radii.length < minPlanets) return { fail: 'too few planets', evals };
  const n = radii.length;

  const drafts: PlanetDraft[] = radii.map((r) => {
    const giant = r > 1.8 && rng.chance(0.7);
    return { a: r, giant, body: null as unknown as BodySpec };
  });

  // --- roles: S (source), A (first target)
  let S: number, A: number;
  const first = tpl.steps[0];
  if (difficulty <= 2 || (first.kind === 'flyby' && tpl.steps.length === 1)) {
    S = rng.int(0, n - 1);
    A = S === 0 ? 1 : S === n - 1 ? n - 2 : S + (rng.chance(0.6) ? 1 : -1);
  } else if (hasEscape && tpl.steps.length === 2) {
    A = n - 1;
    S = rng.int(0, Math.min(1, n - 2));
    drafts[A].giant = true;
  } else {
    S = rng.int(0, Math.min(1, n - 2));
    const hi = tpl.steps[1]?.kind === 'flyby' ? Math.max(S + 1, n - 2) : n - 1;
    A = rng.int(S + 1, hi);
    if (first.kind === 'collide' || tpl.steps[1]?.kind === 'moon' || tpl.steps.length > 1) drafts[A].giant = true;
  }
  if (tpl.steps[1]?.kind === 'moon' && drafts[A].a < 3) return { fail: 'moon host too close', evals };
  drafts[S].giant = drafts[S].giant && rng.chance(0.3);

  const bodies: BodySpec[] = [star];
  let decorativeMoons = hasMoon ? 1 : 0; // moons shrink dt, so keep them few
  drafts.forEach((p, i) => {
    const pname = name();
    const mass = p.giant ? rng.logRange(3e-4, 2e-3) : rng.logRange(1e-6, 2e-5);
    p.body = {
      id: pname.toLowerCase(), name: pname, type: 'planet',
      mass: Number(mass.toPrecision(3)),
      radius: Number((p.giant ? 7e-4 * Math.cbrt(mass / 1e-3) : 5e-5 * Math.cbrt(mass / 3e-6)).toPrecision(3)),
      color: rng.pick(p.giant ? GIANT_COLORS : ROCKY_COLORS),
      placement: {
        kind: 'orbit', parent: star.id, a: p.a, e: 0, phase: round(rng.range(0, 360), 1),
        argPeriapsis: 0, inclination: 0, retrograde: false,
      },
    };
    bodies.push(p.body);
    const moonHost = p.giant && p.a >= 3 && i !== S;
    const needMoon = moonHost && (hasMoon && (i === A || tpl.steps.length === 3));
    if (needMoon || (moonHost && decorativeMoons < 1 && rng.chance(0.3))) {
      if (!needMoon) decorativeMoons++;
      const hill = p.a * Math.cbrt(p.body.mass / (3 * M));
      const r = round(rng.range(0.25, 0.32) * hill, 4);
      if (r < 25 * p.body.radius) return;
      const mname = name();
      p.moonR = r;
      p.moon = {
        id: mname.toLowerCase(), name: mname, type: 'moon',
        mass: Number(rng.logRange(3e-8, 3e-7).toPrecision(3)),
        radius: Number(rng.range(1.5e-4, 2.5e-4).toPrecision(3)),
        color: rng.pick(MOON_COLORS),
        placement: {
          kind: 'orbit', parent: p.body.id, a: r, e: 0, phase: round(rng.range(0, 360), 1),
          argPeriapsis: 0, inclination: 0, retrograde: false,
        },
      };
      bodies.push(p.moon);
    }
  });
  if (tpl.steps[1]?.kind === 'moon' && !drafts[A].moon) return { fail: 'no moon on host', evals };

  const src = drafts[S], tgt = drafts[A];
  const probeName = rng.pick(PROBE_NAMES);

  // --- controls (Hohmann toward A)
  const vc = Math.sqrt((G * M) / src.a);
  const outward = tgt.a > src.a;
  const vH = vc * Math.abs(Math.sqrt((2 * tgt.a) / (src.a + tgt.a)) - 1);
  const aimC = outward ? 0 : 180;
  const aimW = Math.round(lerp(30, 60, td));
  let pLo = round(vH * lerp(0.75, 0.55, td), 2);
  let pHi = round(vH * lerp(1.6, 2.1, td), 2);
  if (hasEscape) pHi = Math.min(pHi, round(0.95 * (Math.SQRT2 - 1) * vc, 2));
  pLo = Math.max(0.05, pLo);
  if (pHi < vH * 1.3) return { fail: 'power window closed', evals };
  const Psrc = orbitalPeriod(src.a, M);
  const tMax = tpl.timing ? round(rng.range(0.5, 1.0) * clamp(Psrc, 0.6, 2), 2) : 0;

  // Chains aim past A so the path keeps going toward the next orbit after the flyby.
  const beyond = tpl.steps[1]?.kind === 'flyby' && outward ? drafts[Math.min(n - 1, A + tpl.steps.length - 1)] : tgt;
  const vReach = vc * Math.abs(Math.sqrt((2 * beyond.a) / (src.a + beyond.a)) - 1);
  const speedGuess = beyond === tgt ? vH * rng.range(1.08, 1.4) : vReach * rng.range(0.95, 1.15);
  if (!hasEscape) pHi = Math.max(pHi, round(speedGuess * 1.25, 2));
  const solution = {
    angle: round(aimC + rng.range(-0.4, 0.4) * aimW, 1),
    speed: round(clamp(speedGuess, pLo, pHi), 3),
    time: tpl.timing ? round(rng.range(0.15, 0.85) * tMax, 3) : 0,
  };
  const probe: BodySpec = {
    id: 'probe', name: probeName, type: 'probe', mass: 0, radius: 1e-6, color: '#ffffff',
    placement: { kind: 'launch', from: src.body.id, speed: solution.speed, angle: solution.angle, elevation: 0, time: solution.time },
  };
  bodies.push(probe);

  const controls: Control[] = [
    { path: 'bodies.probe.placement.angle', label: 'Aim', min: aimC - aimW, max: aimC + aimW },
    { path: 'bodies.probe.placement.speed', label: 'Power', min: pLo, max: pHi },
  ];
  if (tpl.timing) controls.push({ path: 'bodies.probe.placement.time', label: 'Launch time', min: 0, max: tMax });
  const solValues = [solution.angle, solution.speed, ...(tpl.timing ? [solution.time] : [])];

  // --- timing: fixed power-of-two dt so shorter durations replay the same trajectory
  let shortest = Infinity;
  for (const p of drafts) {
    shortest = Math.min(shortest, orbitalPeriod(p.a, M + p.body.mass));
    if (p.moon) shortest = Math.min(shortest, orbitalPeriod(p.moonR!, p.body.mass + p.moon.mass));
  }
  const dt = 2 ** Math.floor(Math.log2(shortest / 200));
  const aOut = drafts[n - 1].a;
  let designD = tMax + 2 * hohmannTime(src.a, tgt.a, M);
  const others = drafts.filter((_, i) => i !== S && i !== A).map((p) => hohmannTime(tgt.a, p.a, M));
  if (nFly > 1) designD += (nFly - 1) * 1.3 * Math.max(...others, 0);
  if (hasEscape) designD += 1.2 * hohmannTime(aOut, 3 * aOut, M);
  const kDesign = stepsFor(Math.min(19000, Math.ceil(Math.min(designD, 10) / dt)));

  // Later flybys get more slack: errors grow along a chain.
  const flybyMax = (p: PlanetDraft, later: boolean) =>
    Math.max(0.05, round((later ? 0.4 : lerp(0.4, 0.2, td)) * (p.giant ? 1 : 0.7), 2));

  let spec: SystemSpec = {
    title: 'draft', description: '', bodies, goal: [], tunables: [],
    sim: { duration: kDesign * dt, dt, samples: 20000 },
  };

  const run = (s: SystemSpec, record: boolean): SimResult => {
    evals++;
    return simulate(s, { record });
  };
  const timeLeft = () => Math.max(1, deadline - Date.now());

  /** First time after `after` the probe crosses distance R from body `ref` (`dir` 1 = outward only). */
  const crossing = (res: SimResult, ref: string, R: number, after: number, dir: 0 | 1) => {
    const frames = res.frames!;
    const st = res.frameStride;
    const pi = res.ids.indexOf('probe'), ri = res.ids.indexOf(ref);
    const rel = (f: number) => {
      const o = f * st;
      return [frames[o + 1 + 3 * pi] - frames[o + 1 + 3 * ri], frames[o + 2 + 3 * pi] - frames[o + 2 + 3 * ri]];
    };
    let prev = rel(0);
    for (let f = 1; f < res.frameCount; f++) {
      const cur = rel(f);
      const t = frames[f * st];
      if (t > after) {
        const d0 = Math.hypot(prev[0], prev[1]) - R, d1 = Math.hypot(cur[0], cur[1]) - R;
        if (d0 <= 0 !== d1 <= 0 && Number.isFinite(d0) && Number.isFinite(d1) && (dir === 0 || d0 <= 0)) {
          const u = d0 / (d0 - d1);
          const t0 = frames[(f - 1) * st];
          return { t: t0 + u * (t - t0), theta: Math.atan2(prev[1] + u * (cur[1] - prev[1]), prev[0] + u * (cur[0] - prev[0])) / DEG };
        }
      }
      prev = cur;
    }
    return null;
  };

  /** Optimise one body's phase so the partial goal succeeds. */
  const refine = (bodyId: string, phase: number, half: number, goal: GoalEvent[], budget: number, salt: number) => {
    const s: SystemSpec = JSON.parse(JSON.stringify(spec));
    const path = `bodies.${bodyId}.placement.phase`;
    const b = s.bodies.find((x) => x.id === bodyId)!;
    if (b.placement.kind === 'orbit') b.placement.phase = phase;
    s.goal = goal;
    s.sim.samples = FRAMES;
    s.tunables = [{ path, min: phase - half, max: phase + half }];
    const res = optimize(s, { budget, seed: mix(seed, salt), timeLimitMs: timeLeft() });
    evals += res.evals;
    return { phase: res.values[0], result: res.result, solved: res.solved };
  };

  const setPhase = (id: string, phase: number) => {
    const b = spec.bodies.find((x) => x.id === id)!;
    if (b.placement.kind === 'orbit') b.placement.phase = phase;
  };

  // --- place goal bodies along the solution trajectory
  const goal: GoalEvent[] = [];
  const used = new Set<number>([S]);
  let after = 0;
  let lastFlyby: PlanetDraft | null = null;

  /**
   * Put `bodyId` (orbit radius `orbitA`, base phase = on the path) near the path so the probe
   * passes about 0.45 * cap from it. Scans offsets on both sides so gravitational focusing does
   * not leave a razor-thin pass, then falls back to the optimizer.
   */
  const placeFlyby = (bodyId: string, base: number, orbitA: number, cap: number, maxD: number, tail: GoalEvent[], si: number) => {
    const g: GoalEvent = { type: 'flyby', body: 'probe', target: bodyId, maxDistance: maxD };
    const dStar = 0.45 * cap;
    const scanGoal: GoalEvent[] = [...goal, { ...g, maxDistance: 0.8 * cap }, ...tail];
    const sign = rng.chance(0.5) ? 1 : -1;
    let solved: { phase: number; result: GoalResult } | null = null;
    let bestCost = Infinity;
    for (const sg of [sign, -sign]) {
      for (const f of [0.3, 0.6, 1, 1.6, 2.5]) {
        if (bestCost < 0.35) break;
        const phase = base + (sg * f * cap) / orbitA / DEG;
        const s2: SystemSpec = JSON.parse(JSON.stringify(spec));
        const b = s2.bodies.find((x) => x.id === bodyId)!;
        if (b.placement.kind === 'orbit') b.placement.phase = phase;
        s2.sim.samples = FRAMES;
        const trace = run(s2, false).trace;
        const result = evaluateGoal(scanGoal, trace);
        if (!result.success) continue;
        const ev = result.events[si];
        const d = trace.pairs[pairKey('probe', bodyId)]?.approaches.find((x) => x.t === ev.t)?.d ?? 0;
        const tEnd = result.events[result.events.length - 1].t!;
        const cost = Math.abs(Math.log(Math.max(d, 1e-6) / dStar)) + (tail.length ? tEnd / spec.sim.duration : 0);
        if (cost < bestCost) { bestCost = cost; solved = { phase, result }; }
      }
    }
    const tight: GoalEvent = { ...g, maxDistance: 0.6 * cap };
    for (const sg of solved ? [] : [sign, -sign]) {
      const phase = base + (sg * dStar) / orbitA / DEG;
      const half = ((2.5 * cap) / orbitA / DEG) + 1;
      const r = refine(bodyId, phase, half, [...goal, tight, ...tail], tail.length ? 45 : 30, 300 + si * 7 + sg);
      if (r.solved) { solved = r; break; }
    }
    if (!solved) return null;
    setPhase(bodyId, solved.phase);
    goal.push(g, ...tail);
    return solved.result.events[si].t!;
  };

  for (let si = 0; si < tpl.steps.length; si++) {
    const step = tpl.steps[si];
    const next = tpl.steps[si + 1];
    if (Date.now() > deadline) return { fail: 'timeout', evals };
    if (step.kind === 'escape') continue; // folded into the preceding flyby's placement

    const rec = run(spec, true);
    if (si === 0) after = rec.trace.launches.probe ?? solution.time;

    if (step.kind === 'moon') {
      // Moon collisions proved far too thin to hit with sliders; skim the moon instead.
      const host = lastFlyby!;
      const moon = host.moon!;
      const cr = crossing(rec, host.body.id, host.moonR!, after, 1);
      if (!cr) return { fail: 'no moon crossing', evals };
      const Pm = orbitalPeriod(host.moonR!, host.body.mass + moon.mass);
      const maxD = Math.max(0.015, round(Math.min(0.05, 0.6 * host.moonR!), 3));
      const t = placeFlyby(moon.id, cr.theta - (360 * cr.t) / Pm, host.moonR!, maxD, maxD, [], si);
      if (t === null) return { fail: 'moon placement', evals };
      after = t;
      continue;
    }

    // flyby / collide: choose the target planet and where it crosses the path
    let target: PlanetDraft;
    let cr: { t: number; theta: number } | null = null;
    if (step.kind === 'flyby' && step.dynamic) {
      let best: { p: PlanetDraft; c: { t: number; theta: number } } | null = null;
      drafts.forEach((p, i) => {
        if (used.has(i)) return;
        if (next?.kind === 'moon' && !p.moon) return;
        if (next?.kind === 'escape' && p.body.mass < 1e-4) return;
        const c = crossing(rec, star.id, p.a, after + 0.05, 0);
        if (c && (!best || c.t < best.c.t)) best = { p, c };
      });
      if (!best) return { fail: `no dynamic target ${si}`, evals };
      target = (best as { p: PlanetDraft }).p;
      cr = (best as { c: { t: number; theta: number } }).c;
    } else {
      target = tgt;
      cr = crossing(rec, star.id, tgt.a, after, 0);
      if (!cr) return { fail: 'no crossing', evals };
    }
    used.add(drafts.indexOf(target));
    const P = orbitalPeriod(target.a, M + target.body.mass);
    const base = cr.theta - (360 * cr.t) / P;

    if (step.kind === 'collide') {
      const g: GoalEvent = { type: 'collision', a: 'probe', b: target.body.id };
      const r = refine(target.body.id, base, 0.3 / target.a + 0.5, [...goal, g], 50, 200 + si);
      if (!r.solved) return { fail: 'collide refine', evals };
      setPhase(target.body.id, r.phase);
      goal.push(g);
      after = r.result.events[si].t!;
      continue;
    }

    let maxD = flybyMax(target, goal.length > 0);
    if (next?.kind === 'moon') {
      if (target.moonR! < 0.03) return { fail: 'moon orbit too tight', evals };
      maxD = round(Math.min(maxD, Math.max(0.05, 1.2 * target.moonR!)), 3);
    }
    const tail: GoalEvent[] = next?.kind === 'escape' ? [{ type: 'escape', body: 'probe' }] : [];
    const cap = next?.kind === 'moon' ? Math.min(maxD, target.moonR!) : maxD;
    const t = placeFlyby(target.body.id, base, target.a, cap, maxD, tail, si);
    if (t === null) return { fail: tail.length ? 'escape placement' : 'flyby placement', evals };
    after = t;
    lastFlyby = target;
    if (tail.length) si++;
  }

  // --- verify the whole chain on the design duration
  const designLevel = (s: SystemSpec): Level => ({
    id: 'draft', title: 'draft', briefing: '', spec: s, player: 'probe', controls, par: 3,
  });
  spec.goal = goal;
  spec.sim.samples = FRAMES;
  let check = checkShot(designLevel(spec), solValues);
  evals++;
  if (!check.goal.success) return { fail: 'chain verify', evals };
  const tLast = check.goal.events[check.goal.events.length - 1].t!;

  // --- shorten the run: same dt, fewer steps (trajectory prefix is identical)
  const margin = hasEscape ? Math.max(0.6, 0.4 * tLast) : Math.max(0.3, 0.2 * tLast);
  let k = Math.max(200, Math.ceil((tLast + margin) / dt));
  k = Math.min(stepsFor(k), kDesign);
  spec.sim = { duration: k * dt, dt, samples: FRAMES };
  const solTrace = run(shotSpec(designLevel(spec), solValues), false).trace;
  if (!evaluateGoal(goal, solTrace).success) return { fail: 'short verify', evals };

  // --- traces for start candidates, robustness nudges and random play (goal-independent)
  const traceOf = (vals: number[]) => run(shotSpec(designLevel(spec), vals), false).trace;
  const startCandidates = [
    [aimC, round((pLo + pHi) / 2, 2), 0],
    [aimC + Math.round(aimW / 2), round(lerp(pLo, pHi, 0.3), 2), round(tMax / 2, 2)],
    [aimC - Math.round(aimW / 2), round(lerp(pLo, pHi, 0.7), 2), tMax],
    [aimC - aimW, pLo, 0],
  ].map((c) => c.slice(0, controls.length));
  const startTraces = startCandidates.map(traceOf);

  const nudge = lerp(0.005, 0.0025, td);
  const nudgeTraces: Trace[] = [];
  controls.forEach((c, i) => {
    for (const sg of [-1, 1]) {
      const vals = [...solValues];
      vals[i] += sg * nudge * (c.max - c.min);
      nudgeTraces.push(traceOf(vals));
    }
  });

  const srng = new Rng(mix(seed, 0x5a3));
  const sampleTraces: Trace[] = [];
  for (let i = 0; i < SAMPLES; i++) sampleTraces.push(traceOf(controls.map((c) => c.min + srng.next() * (c.max - c.min))));
  const maxRate = lerp(0.4, 0.08, td);

  // --- goal variants: as designed, relaxed (fragile chains), tightened (too easy)
  const solResult = evaluateGoal(goal, solTrace);
  const relaxed = goal.map((g, i): GoalEvent => {
    if (g.type === 'flyby' && i > 0) {
      const t = bodies.find((b) => b.id === g.target);
      if (t?.type === 'planet') return { ...g, maxDistance: Math.max(g.maxDistance, t.mass > 1e-4 ? 0.4 : 0.3) };
    }
    return g;
  });
  const tightened = goal.map((g, i): GoalEvent => {
    if (g.type !== 'flyby') return g;
    const ap = solTrace.pairs[pairKey('probe', g.target)]?.approaches.find((x) => x.t === solResult.events[i].t);
    if (!ap) return g;
    return { ...g, maxDistance: Math.min(g.maxDistance, Math.max(0.03, Math.ceil(ap.d * 1.3 * 100) / 100)) };
  });

  const succeeds = (g: GoalEvent[], tr: Trace) => evaluateGoal(g, tr).success;
  let chosen: { goal: GoalEvent[]; rate: number; robustness: number; start: number[] } | null = null;
  const score = (c: NonNullable<typeof chosen>) => Math.max(0, MIN_ROBUSTNESS - c.robustness) * 10 + Math.max(0, c.rate - maxRate);
  for (const g of [goal, relaxed, tightened]) {
    if (!succeeds(g, solTrace)) continue;
    const si = startTraces.findIndex((tr) => !succeeds(g, tr));
    if (si < 0) continue;
    const c = {
      goal: g,
      start: startCandidates[si],
      rate: sampleTraces.filter((tr) => succeeds(g, tr)).length / SAMPLES,
      robustness: nudgeTraces.filter((tr) => succeeds(g, tr)).length / nudgeTraces.length,
    };
    if (!chosen || score(c) < score(chosen)) chosen = c;
    if (score(c) === 0) break;
  }
  if (!chosen) return { fail: 'start solves', evals };

  goal.splice(0, goal.length, ...chosen.goal);
  const { rate, robustness, start } = chosen;

  // --- words
  const tName = tgt.body.name;
  const lastGoal = goal[goal.length - 1];
  const nameOf = (id: string) => bodies.find((b) => b.id === id)?.name ?? id;
  const hero = lastGoal.type === 'flyby' ? nameOf(lastGoal.target) : lastGoal.type === 'collision' ? nameOf(lastGoal.b) : tName;
  const titleRng = new Rng(mix(seed, 0x717));
  const title = titleRng.pick([
    `The ${hero} Gambit`, `${hero} Slingshot`, `Road to ${hero}`, `The ${hero} Run`, `${hero} Rendezvous`,
    `Kiss of ${hero}`, `${hero} or Bust`, `The ${hero} Thread`, `Chasing ${hero}`,
  ]);
  const phrases = goal.map((g, i) => {
    const lead = i === 0 ? '' : 'then ';
    switch (g.type) {
      case 'flyby': return `${lead}pass within ${g.maxDistance} AU of ${nameOf(g.target)}`;
      case 'collision': return `${lead}crash into ${nameOf(g.b)}`;
      case 'escape': return `${lead}break free of ${star.name}`;
      default: return '';
    }
  });
  const briefing = `Launch ${probeName} from ${src.body.name}, ${phrases.join(', ')}.`;
  const firstTip = outward
    ? `Aim near 0° to leave along ${src.body.name}'s orbit, and give just enough Power to reach ${tName}.`
    : `Aim near 180° to shed speed and fall inward toward ${tName}.`;
  const tip = tpl.steps.some((s) => s.kind === 'escape')
    ? `Pass behind ${lastFlyby?.body.name ?? tName} as it moves: the flyby steals its orbital speed and flings you out.`
    : hasMoon
      ? `Pass close to ${lastFlyby?.body.name ?? tName}: its moon ${lastFlyby?.moon?.name ?? ''} circles only ${round(lastFlyby?.moonR ?? 0, 2)} AU out, so the bend carries you right past it.`
      : tpl.timing
        ? `${firstTip} Launch time changes where ${tName} will be when you arrive.`
        : firstTip;

  spec = { ...spec, title, description: briefing, goal };
  bodies.forEach((b) => {
    if (b.id !== 'probe' || b.placement.kind !== 'launch') return;
    b.placement.angle = start![0];
    b.placement.speed = start![1];
    if (tpl.timing) b.placement.time = start![2];
  });

  const level: Level = {
    id: `proc-${seed.toString(16)}-d${difficulty}`,
    title,
    briefing,
    spec,
    player: 'probe',
    controls,
    par: clamp(2 + Math.floor((difficulty - 1) / 3), 2, 5),
    solution: { values: solValues, pieces: [] },
    tip,
  };
  const parsed = parseLevel(level);
  if (!parsed.ok) return { fail: `invalid: ${parsed.issues.join('; ')}`, evals };
  check = checkShot(parsed.level, solValues);
  evals++;
  if (!check.goal.success) return { fail: 'final verify', evals };
  return { level: parsed.level, evals, rate, maxRate, robustness };
}

/** Attempts that may be rejected for being too easy or fragile before settling for the best. */
const BAND_ATTEMPTS = 12;
/** Attempts before falling back to easier templates when nothing solvable was found. */
const MAX_ATTEMPTS = 30;
const MIN_ROBUSTNESS = 1 / 3;

/** Lower is better: robustness shortfall first, then how far above the easy band. */
const fallbackScore = (r: Attempt) => Math.max(0, MIN_ROBUSTNESS - r.robustness) * 10 + Math.max(0, r.rate - r.maxRate);

/**
 * Deterministic level for (seed, difficulty 1..10). Re-rolls with derived sub-seeds until a
 * level is solvable, starts on a miss, holds up to small control nudges and is not too easy
 * for random play. Budgeted by attempt count (deterministic); after BAND_ATTEMPTS it returns
 * the best solvable level found. The time limit is only a safety net.
 */
export function generateLevel(seed: number, difficulty: number, opts: GenerateOptions = {}): GenerateResult {
  const d = clamp(Math.round(difficulty), 1, 10);
  const deadline = Date.now() + (opts.timeLimitMs ?? 6000);
  let evals = 0;
  let best: Attempt | null = null;
  let attempts = 0;
  const finish = (r: Attempt): GenerateResult => {
    r.level.id = `proc-${(seed >>> 0).toString(36)}-${d}`;
    return { level: r.level, attempts, evals };
  };
  for (let i = 0; i < MAX_ATTEMPTS + 40; i++) {
    const late = i >= BAND_ATTEMPTS || Date.now() > deadline;
    if (late && best) break;
    // Nothing solvable yet: past the budget, step down to easier templates (always returns).
    const stepDown = i >= MAX_ATTEMPTS || Date.now() > deadline;
    const dd = stepDown ? Math.max(1, d - 1 - Math.floor(Math.max(0, i - MAX_ATTEMPTS) / 3)) : d;
    attempts++;
    const r = attempt(mix(seed >>> 0, d, i), dd, Math.max(deadline, Date.now() + (stepDown ? 2000 : 0)));
    evals += r.evals;
    opts.onProgress?.({ attempt: attempts, evals });
    if ('fail' in r) continue;
    if (r.rate <= r.maxRate && r.robustness >= MIN_ROBUSTNESS) return finish(r);
    if (!best || fallbackScore(r) < fallbackScore(best)) best = r;
  }
  if (!best) throw new Error(`procgen: no level for seed ${seed} difficulty ${d}`);
  return finish(best);
}
