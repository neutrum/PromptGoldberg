// Tools for build-a-piece levels, shared by solve-level.ts: random placement sampling,
// robustness around a placement, layout sanity checks and a search for piece placements.
import { anchorBody, checkShot, shotSpec, simulate, type Level, type Piece, type PieceKind } from '../src';
import type { BodySpec } from '../src/schema';

export type Rng = () => number;

export function makeRng(seed: number): Rng {
  let s = (Math.floor(seed) % 2147483646) + 1;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

const norm360 = (a: number) => ((a % 360) + 360) % 360;
const round = (p: Piece): Piece => ({ kind: p.kind, r: Number(p.r.toFixed(4)), angle: Number(norm360(p.angle).toFixed(2)) });

/** Distance of a body from the anchor star at t=0 (orbit apoapsis for orbits around it). */
function bodyReach(level: Level, b: BodySpec): number {
  const anchor = anchorBody(level.spec);
  const p = b.placement;
  if (b.id === anchor.id) return 0;
  if (p.kind === 'orbit') {
    const parent = level.spec.bodies.find((x) => x.id === p.parent);
    const up = parent ? bodyReach(level, parent) : 0;
    return up + p.a * (1 + p.e);
  }
  if (p.kind === 'free') return Math.hypot(...p.position);
  return 0;
}

/** Radius of the system (farthest non-player body from the anchor at t=0), AU. */
export function systemRadius(level: Level): number {
  return Math.max(...level.spec.bodies.filter((b) => b.id !== level.player).map((b) => bodyReach(level, b)), 0.5);
}

/** Layout problems that would make a placement look wrong or be hard to click. */
export function layoutIssues(level: Level, pieces: Piece[]): string[] {
  const issues: string[] = [];
  const anchor = anchorBody(level.spec);
  const R = systemRadius(level);
  const orbits = level.spec.bodies.filter((b) => b.placement.kind === 'orbit' && b.placement.parent === anchor.id && b.id !== level.player);
  pieces.forEach((p, i) => {
    if (p.r < 0.2) issues.push(`piece ${i + 1} is inside 0.2 AU of the star`);
    if (p.r > 1.5 * R) issues.push(`piece ${i + 1} (r=${p.r.toFixed(2)}) is outside 1.5x the system radius ${R.toFixed(2)}`);
    for (const b of orbits) {
      const a = b.placement.kind === 'orbit' ? b.placement.a : 0;
      if (Math.abs(a - p.r) < 0.05 * p.r) issues.push(`piece ${i + 1} (r=${p.r.toFixed(2)}) sits on ${b.name}'s orbit (a=${a})`);
    }
  });
  return issues;
}

/**
 * How far placed pieces knock the level's own bodies off their orbits: for each body orbiting the anchor
 * (not the player or a piece), the largest relative change of its distance from the anchor over the run.
 */
export function disturbance(level: Level, values: number[], pieces: Piece[]): Record<string, number> {
  const anchor = anchorBody(level.spec);
  const spec = shotSpec(level, values, pieces);
  spec.sim.samples = 200;
  const run = simulate(spec, { record: true });
  const ai = run.ids.indexOf(anchor.id);
  const out: Record<string, number> = {};
  for (const b of level.spec.bodies) {
    if (b.id === level.player || b.placement.kind !== 'orbit' || b.placement.parent !== anchor.id) continue;
    const i = run.ids.indexOf(b.id);
    const a = b.placement.a;
    let worst = 0;
    for (let f = 0; f < run.frameCount; f++) {
      const o = f * run.frameStride;
      const x = run.frames![o + 1 + 3 * i] - run.frames![o + 1 + 3 * ai], y = run.frames![o + 2 + 3 * i] - run.frames![o + 2 + 3 * ai];
      if (Number.isNaN(x)) continue;
      worst = Math.max(worst, Math.abs(Math.hypot(x, y) - a) / a);
    }
    out[b.id] = Number(worst.toFixed(3));
  }
  return out;
}

const kindsOf = (level: Level): PieceKind[] => level.pieces?.kinds ?? ['giant'];

/** Random placements of `count` pieces over r in [0.3R, 1.5R], any angle; returns the success rate. */
export function placementRate(level: Level, values: number[], count: number, samples: number, rng: Rng): number {
  const R = systemRadius(level);
  const kinds = kindsOf(level);
  let hits = 0;
  for (let k = 0; k < samples; k++) {
    const pieces = Array.from({ length: count }, () => ({
      kind: kinds[Math.floor(rng() * kinds.length)],
      r: R * (0.3 + 1.2 * rng()),
      angle: 360 * rng(),
    }));
    if (checkShot(level, values, pieces).goal.success) hits++;
  }
  return hits / samples;
}

/** Share of random nudges (each piece r by up to +-dr, angle by up to +-da degrees) that still succeed. */
export function robustness(level: Level, values: number[], pieces: Piece[], samples: number, rng: Rng, dr = 0.03, da = 3): number {
  let ok = 0;
  for (let k = 0; k < samples; k++) {
    const nudged = pieces.map((p) => ({ ...p, r: p.r * (1 + (2 * rng() - 1) * dr), angle: p.angle + (2 * rng() - 1) * da }));
    if (checkShot(level, values, nudged).goal.success) ok++;
  }
  return ok / samples;
}

export interface PieceSearchOptions {
  count: number;
  rng: Rng;
  /** Radial and angular grid for one piece. */
  gridR?: number;
  gridAngle?: number;
  /** Random combinations tried for 2+ pieces. */
  restarts?: number;
  log?: (msg: string) => void;
}

export interface PieceSearchResult {
  pieces: Piece[];
  score: number;
  success: boolean;
  robustness: number;
  evals: number;
}

/**
 * Find piece placements for fixed control values: a grid (one piece) or random combinations
 * (more pieces) scored by goal progress, then local refinement, preferring placements whose
 * neighbours also succeed and which pass layoutIssues.
 */
export function searchPieces(level: Level, values: number[], opts: PieceSearchOptions): PieceSearchResult {
  const { count, rng } = opts;
  const log = opts.log ?? (() => {});
  const R = systemRadius(level);
  const kinds = kindsOf(level);
  let evals = 0;
  const score = (pieces: Piece[]) => {
    evals++;
    const g = checkShot(level, values, pieces).goal;
    return layoutIssues(level, pieces).length ? Math.min(g.score, level.spec.goal.length - 0.5) : g.score;
  };
  const full = level.spec.goal.length;

  type Cand = { pieces: Piece[]; score: number };
  const cands: Cand[] = [];
  const nr = opts.gridR ?? 36, na = opts.gridAngle ?? 72;
  const radius = (i: number) => R * (0.3 + (1.2 * (i + 0.5)) / nr);
  if (count === 1) {
    for (const kind of kinds) {
      for (let i = 0; i < nr; i++) {
        for (let j = 0; j < na; j++) {
          const pieces = [{ kind, r: radius(i), angle: (360 * j) / na }];
          cands.push({ pieces, score: score(pieces) });
        }
      }
    }
  } else {
    const restarts = opts.restarts ?? 3000;
    for (let k = 0; k < restarts; k++) {
      const pieces = Array.from({ length: count }, () => ({
        kind: kinds[Math.floor(rng() * kinds.length)], r: R * (0.3 + 1.2 * rng()), angle: 360 * rng(),
      }));
      cands.push({ pieces, score: score(pieces) });
    }
  }
  cands.sort((a, b) => b.score - a.score);
  const hitsInGrid = cands.filter((c) => c.score >= full).length;
  log(`scan: ${cands.length} placements, ${hitsInGrid} succeed, best score ${cands[0].score.toFixed(3)}`);

  // Local refinement of the best distinct candidates: shrinking random steps, one piece at a time.
  const refine = (start: Cand): Cand => {
    let cur = start;
    let stepR = 0.08 * R, stepA = 12;
    for (let it = 0; it < 120 && stepA > 0.5; it++) {
      const pieces = cur.pieces.map((p) => ({ ...p }));
      const m = Math.floor(rng() * pieces.length);
      pieces[m].r = Math.max(0.2, pieces[m].r + (2 * rng() - 1) * stepR);
      pieces[m].angle += (2 * rng() - 1) * stepA;
      if (kinds.length > 1 && rng() < 0.1) pieces[m].kind = kinds[Math.floor(rng() * kinds.length)];
      const s = score(pieces);
      if (s > cur.score) {
        cur = { pieces, score: s };
      } else if (it % 10 === 9) {
        stepR *= 0.7;
        stepA *= 0.7;
      }
      if (cur.score >= full) break;
    }
    return cur;
  };

  const seeds: Cand[] = [];
  for (const c of cands) {
    if (seeds.length >= 12) break;
    const far = seeds.every((s) => s.pieces.some((p, i) => Math.abs(p.r - c.pieces[i].r) > 0.1 * R || Math.abs(norm360(p.angle - c.pieces[i].angle + 180) - 180) > 15));
    if (far) seeds.push(c);
  }
  const successes: Cand[] = cands.filter((c) => c.score >= full).slice(0, 40);
  for (const s of seeds) {
    const r = s.score >= full ? s : refine(s);
    if (r.score >= full && !successes.includes(r)) successes.push(r);
  }
  if (!successes.length) {
    const best = seeds[0] ?? cands[0];
    log(`no placement found; best score ${best.score.toFixed(3)}`);
    return { pieces: best.pieces.map(round), score: best.score, success: false, robustness: 0, evals };
  }

  // Pick the most robust success, then nudge it toward the middle of its success region.
  let best: PieceSearchResult | null = null;
  for (const c of successes) {
    const rb = robustness(level, values, c.pieces, 16, rng);
    evals += 16;
    if (!best || rb > best.robustness) best = { pieces: c.pieces, score: c.score, success: true, robustness: rb, evals };
  }
  const centre = best!.pieces.map((p) => ({ ...p }));
  for (let m = 0; m < centre.length; m++) {
    const okR: number[] = [], okA: number[] = [];
    for (let k = -4; k <= 4; k++) {
      const pr = centre.map((p, i) => (i === m ? { ...p, r: p.r * (1 + 0.015 * k) } : p));
      if (checkShot(level, values, pr).goal.success) okR.push(pr[m].r);
      const pa = centre.map((p, i) => (i === m ? { ...p, angle: p.angle + 1.5 * k } : p));
      if (checkShot(level, values, pa).goal.success) okA.push(pa[m].angle);
      evals += 2;
    }
    if (okR.length) centre[m].r = okR.reduce((a, b) => a + b, 0) / okR.length;
    if (okA.length) centre[m].angle = okA.reduce((a, b) => a + b, 0) / okA.length;
  }
  if (checkShot(level, values, centre).goal.success && !layoutIssues(level, centre).length) {
    const rb = robustness(level, values, centre, 24, rng);
    evals += 24;
    if (rb >= best!.robustness) best = { pieces: centre, score: full, success: true, robustness: rb, evals };
  }
  best!.pieces = best!.pieces.map(round);
  best!.evals = evals;
  return best!;
}
