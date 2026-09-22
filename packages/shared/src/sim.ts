import { EventTracker, type SimEvent, type Trace } from './events';
import { ACTIVE, MERGED, PENDING, applyLaunch, computeTiming, initState, type SimState } from './init';
import type { SystemSpec } from './schema';
import { G } from './units';

export interface SimOptions {
  /** Record position frames for playback. Off for optimizer runs. */
  record?: boolean;
}

export interface SimResult {
  ids: string[];
  duration: number;
  dt: number;
  steps: number;
  substeps: number;
  frameCount: number;
  /** Per frame: [t, x0, y0, z0, x1, ...]; NaN positions for merged bodies. */
  frames: Float32Array | null;
  frameStride: number;
  events: SimEvent[];
  trace: Trace;
  /** Final mutable state (not serialisable; strip before postMessage/JSON). */
  state: SimState;
}

const SOFTENING2 = 1e-14;
/** Fraction of the shortest dynamical timescale a substep may span. */
const ETA = 0.05;
const MAX_SUBSTEPS = 256;

function accelerations(s: SimState, acc: Float64Array): void {
  const n = s.ids.length;
  const { pos, mass, status } = s;
  acc.fill(0);
  for (let i = 0; i < n; i++) {
    if (status[i] !== ACTIVE) continue;
    for (let j = i + 1; j < n; j++) {
      if (status[j] !== ACTIVE) continue;
      if (mass[i] === 0 && mass[j] === 0) continue;
      const dx = pos[3 * j] - pos[3 * i], dy = pos[3 * j + 1] - pos[3 * i + 1], dz = pos[3 * j + 2] - pos[3 * i + 2];
      const r2 = dx * dx + dy * dy + dz * dz + SOFTENING2;
      const inv = G / (r2 * Math.sqrt(r2));
      const fi = inv * mass[j], fj = inv * mass[i];
      acc[3 * i] += fi * dx; acc[3 * i + 1] += fi * dy; acc[3 * i + 2] += fi * dz;
      acc[3 * j] -= fj * dx; acc[3 * j + 1] -= fj * dy; acc[3 * j + 2] -= fj * dz;
    }
  }
  for (let i = 0; i < n; i++) {
    if (s.fixed[i]) acc[3 * i] = acc[3 * i + 1] = acc[3 * i + 2] = 0;
  }
}

/** Bumpers and portals act on contact, so fast bodies must not skip past them within one substep. */
const hasSurface = (s: SimState, i: number) => s.bounce[i] > 0 || s.link[i] >= 0;

/** Shortest of free-fall and crossing timescales over interacting pairs. */
function shortestTimescale(s: SimState): number {
  const n = s.ids.length;
  const { pos, vel, mass, radius, status } = s;
  let tau = Infinity;
  for (let i = 0; i < n; i++) {
    if (status[i] !== ACTIVE) continue;
    for (let j = i + 1; j < n; j++) {
      if (status[j] !== ACTIVE) continue;
      const m = mass[i] + mass[j];
      const surface = hasSurface(s, i) || hasSurface(s, j);
      if (m === 0 && !surface) continue;
      const dx = pos[3 * j] - pos[3 * i], dy = pos[3 * j + 1] - pos[3 * i + 1], dz = pos[3 * j + 2] - pos[3 * i + 2];
      const vx = vel[3 * j] - vel[3 * i], vy = vel[3 * j + 1] - vel[3 * i + 1], vz = vel[3 * j + 2] - vel[3 * i + 2];
      const r2 = dx * dx + dy * dy + dz * dz;
      const r = Math.sqrt(r2);
      const freefall = m > 0 ? Math.sqrt((r2 * r) / (G * m)) : Infinity;
      // Crossing time only matters while the pair is closing in; near a bumper or portal it is
      // the time to reach its surface, so the contact is not stepped over.
      const closing = dx * vx + dy * vy + dz * vz < 0;
      const v = Math.sqrt(vx * vx + vy * vy + vz * vz);
      const gap = surface ? Math.max(r - radius[i] - radius[j], 0.25 * (radius[i] + radius[j])) : r;
      const crossing = closing && v > 0 ? gap / v : Infinity;
      tau = Math.min(tau, freefall, crossing);
    }
  }
  return tau;
}

/**
 * Bounce `mover` off the bouncy `surface`: reflect their relative velocity about the contact
 * normal (the surface keeps its own motion) and push the mover back onto the surface.
 * Returns true when they were closing in, i.e. a real bounce happened.
 */
function bounceOff(s: SimState, mover: number, surface: number): boolean {
  const { pos, vel, radius } = s;
  let nx = pos[3 * mover] - pos[3 * surface], ny = pos[3 * mover + 1] - pos[3 * surface + 1], nz = pos[3 * mover + 2] - pos[3 * surface + 2];
  const d = Math.hypot(nx, ny, nz) || 1e-12;
  nx /= d; ny /= d; nz /= d;
  const rr = (radius[mover] + radius[surface]) * 1.0001;
  pos[3 * mover] = pos[3 * surface] + nx * rr;
  pos[3 * mover + 1] = pos[3 * surface + 1] + ny * rr;
  pos[3 * mover + 2] = pos[3 * surface + 2] + nz * rr;
  const vn = (vel[3 * mover] - vel[3 * surface]) * nx + (vel[3 * mover + 1] - vel[3 * surface + 1]) * ny + (vel[3 * mover + 2] - vel[3 * surface + 2]) * nz;
  if (vn >= 0) return false;
  const k = (1 + s.bounce[surface]) * vn;
  vel[3 * mover] -= k * nx; vel[3 * mover + 1] -= k * ny; vel[3 * mover + 2] -= k * nz;
  return true;
}

/**
 * Anything (except stars and other portals) that enters a portal comes out of its twin with the
 * same velocity relative to the portal, just outside its rim along the direction of travel.
 */
function resolveWarps(s: SimState, t: number, tracker: EventTracker): boolean {
  const n = s.ids.length;
  const { pos, vel, radius, status, link, types } = s;
  let warped = false;
  for (let p = 0; p < n; p++) {
    const q = link[p];
    if (q < 0 || status[p] !== ACTIVE || status[q] !== ACTIVE) continue;
    for (let i = 0; i < n; i++) {
      if (status[i] !== ACTIVE || link[i] >= 0 || types[i] === 'star' || s.fixed[i]) continue;
      const dx = pos[3 * i] - pos[3 * p], dy = pos[3 * i + 1] - pos[3 * p + 1], dz = pos[3 * i + 2] - pos[3 * p + 2];
      if (dx * dx + dy * dy + dz * dz > radius[p] * radius[p]) continue;
      // Velocity relative to the entry portal is kept; the exit direction follows it
      // (or points away from the portal centre if the body drifted in at zero relative speed).
      const rel = [vel[3 * i] - vel[3 * p], vel[3 * i + 1] - vel[3 * p + 1], vel[3 * i + 2] - vel[3 * p + 2]];
      const speed = Math.hypot(rel[0], rel[1], rel[2]);
      const dir = speed > 0 ? rel.map((c) => c / speed) : [dx, dy, dz].map((c) => c / (Math.hypot(dx, dy, dz) || 1));
      const out = radius[q] * 1.05 + radius[i];
      for (let k = 0; k < 3; k++) {
        pos[3 * i + k] = pos[3 * q + k] + dir[k] * out;
        vel[3 * i + k] = vel[3 * q + k] + rel[k];
      }
      tracker.onWarp(t, i, p, q);
      warped = true;
    }
  }
  return warped;
}

/** Merge touching bodies, conserving mass and momentum; bounce off bouncy ones. Returns true if anything changed. */
function resolveCollisions(s: SimState, t: number, tracker: EventTracker): boolean {
  const n = s.ids.length;
  const { pos, vel, mass, radius, status } = s;
  let merged = false;
  for (let i = 0; i < n; i++) {
    if (status[i] !== ACTIVE) continue;
    for (let j = i + 1; j < n; j++) {
      if (status[j] !== ACTIVE) continue;
      // Portals are doorways: they neither merge nor bounce (see resolveWarps).
      if (s.link[i] >= 0 || s.link[j] >= 0) continue;
      const dx = pos[3 * j] - pos[3 * i], dy = pos[3 * j + 1] - pos[3 * i + 1], dz = pos[3 * j + 2] - pos[3 * i + 2];
      const rr = radius[i] + radius[j];
      if (dx * dx + dy * dy + dz * dz > rr * rr) continue;
      if (s.bounce[i] > 0 || s.bounce[j] > 0) {
        // The bouncy one is the surface; if both are, the lighter (or unpinned) one moves.
        const surface = s.bounce[j] > 0 && (s.bounce[i] === 0 || s.fixed[j] || (!s.fixed[i] && mass[j] >= mass[i])) ? j : i;
        const mover = surface === i ? j : i;
        if (!s.fixed[mover] && bounceOff(s, mover, surface)) tracker.onBounce(t, mover, surface);
        merged = true;
        continue;
      }
      const [keep, lose] = mass[i] >= mass[j] ? [i, j] : [j, i];
      const m = mass[keep] + mass[lose];
      for (let k = 0; k < 3; k++) {
        if (m > 0) {
          pos[3 * keep + k] = (mass[keep] * pos[3 * keep + k] + mass[lose] * pos[3 * lose + k]) / m;
          vel[3 * keep + k] = (mass[keep] * vel[3 * keep + k] + mass[lose] * vel[3 * lose + k]) / m;
        }
      }
      mass[keep] = m;
      radius[keep] = Math.cbrt(radius[keep] ** 3 + radius[lose] ** 3);
      status[lose] = MERGED;
      tracker.onMerge(t, s, keep, lose);
      merged = true;
      if (lose === i) break;
    }
  }
  return merged;
}

function writeFrame(s: SimState, frames: Float32Array, frame: number, t: number): void {
  const n = s.ids.length;
  const stride = 1 + 3 * n;
  const o = frame * stride;
  frames[o] = t;
  for (let i = 0; i < n; i++) {
    let src = i;
    if (s.status[i] === PENDING) src = s.reference[i];
    if (s.status[i] === MERGED || src < 0) {
      frames[o + 1 + 3 * i] = frames[o + 2 + 3 * i] = frames[o + 3 + 3 * i] = NaN;
      continue;
    }
    frames[o + 1 + 3 * i] = s.pos[3 * src];
    frames[o + 2 + 3 * i] = s.pos[3 * src + 1];
    frames[o + 3 + 3 * i] = s.pos[3 * src + 2];
  }
}

/**
 * Deterministic N-body run: kick-drift-kick leapfrog on a fixed step grid, with
 * automatic substeps during close encounters. Pure function of the spec.
 */
export function simulate(spec: SystemSpec, opts: SimOptions = {}): SimResult {
  const record = opts.record ?? true;
  const timing = computeTiming(spec);
  const { dt, steps, sampleEvery, frameCount } = timing;
  const s = initState(spec);
  const n = s.ids.length;
  const tracker = new EventTracker(s, spec.sim.duration);
  const acc = new Float64Array(3 * n);
  const stride = 1 + 3 * n;
  const frames = record ? new Float32Array(frameCount * stride) : null;
  const launches = [...s.launches].sort((a, b) => a.time - b.time);
  let nextLaunch = 0;
  let substeps = 0;

  const launchDue = (t: number) => {
    let any = false;
    while (nextLaunch < launches.length && launches[nextLaunch].time <= t + dt * 1e-9) {
      const l = launches[nextLaunch++];
      if (s.status[l.from] !== ACTIVE) continue;
      applyLaunch(s, l);
      tracker.onLaunch(t, l.index);
      any = true;
    }
    return any;
  };

  launchDue(0);
  resolveCollisions(s, 0, tracker);
  tracker.observe(0, s);
  if (frames) writeFrame(s, frames, 0, 0);
  accelerations(s, acc);

  for (let step = 1; step <= steps; step++) {
    const t0 = (step - 1) * dt;
    const tau = shortestTimescale(s);
    const count = Math.min(MAX_SUBSTEPS, Math.max(1, Math.ceil(dt / (ETA * tau))));
    const h = dt / count;
    for (let sub = 0; sub < count; sub++) {
      const { pos, vel } = s;
      for (let k = 0; k < 3 * n; k++) vel[k] += 0.5 * h * acc[k];
      for (let k = 0; k < 3 * n; k++) pos[k] += h * vel[k];
      accelerations(s, acc);
      for (let k = 0; k < 3 * n; k++) vel[k] += 0.5 * h * acc[k];
      const t = t0 + (sub + 1) * h;
      const touched = resolveCollisions(s, t, tracker);
      if (resolveWarps(s, t, tracker) || touched) accelerations(s, acc);
      tracker.observe(t, s);
    }
    substeps += count;
    const t = step * dt;
    if (launchDue(t)) accelerations(s, acc);
    if (frames && step % sampleEvery === 0) writeFrame(s, frames, step / sampleEvery, t);
  }

  const { trace, events } = tracker.finish(steps * dt, s);
  return {
    ids: s.ids, duration: steps * dt, dt, steps, substeps,
    frameCount, frames, frameStride: stride, events, trace, state: s,
  };
}
