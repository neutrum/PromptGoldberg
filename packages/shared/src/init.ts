import type { BodySpec, BodyType, SystemSpec } from './schema';
import { placementRef } from './schema';
import { DEG, G, orbitalPeriod } from './units';

export const ACTIVE = 1;
export const PENDING = 0;
export const MERGED = 2;

export interface PendingLaunch {
  index: number;
  from: number;
  speed: number;
  angle: number;
  elevation: number;
  time: number;
}

/** Mutable N-body state. Vectors are packed xyz per body, indexed like spec.bodies. */
export interface SimState {
  ids: string[];
  types: BodyType[];
  mass: Float64Array;
  radius: Float64Array;
  pos: Float64Array;
  vel: Float64Array;
  status: Uint8Array;
  /** Index of the body each one is placed relative to (orbit parent or reference star), or -1. */
  reference: Int32Array;
  /** Hill-like sphere of influence, AU. Infinity for stars. */
  influence: Float64Array;
  launches: PendingLaunch[];
  /** 1 for bodies that never move (pinned in the barycentre frame). */
  fixed: Uint8Array;
  /** Restitution of a bouncy surface; 0 means touching bodies merge as usual. */
  bounce: Float64Array;
  /** Index of a portal's twin, or -1 for everything that is not a portal. */
  link: Int32Array;
}

export interface Timing {
  dt: number;
  steps: number;
  sampleEvery: number;
  frameCount: number;
}

/** Order bodies so every body comes after the body it is placed relative to. */
function placementOrder(spec: SystemSpec): number[] {
  const index = new Map(spec.bodies.map((b, i) => [b.id, i]));
  const order: number[] = [];
  const done = new Set<number>();
  const visit = (i: number, depth: number) => {
    if (done.has(i) || depth > spec.bodies.length) return;
    const ref = placementRef(spec.bodies[i]);
    const j = ref !== undefined ? index.get(ref) : undefined;
    if (j !== undefined) visit(j, depth + 1);
    done.add(i);
    order.push(i);
  };
  spec.bodies.forEach((_, i) => visit(i, 0));
  return order;
}

function heaviestStar(spec: SystemSpec, exclude: number): number {
  let best = -1;
  spec.bodies.forEach((b, i) => {
    if (i === exclude) return;
    if (best < 0 || (b.type === 'star' && spec.bodies[best].type !== 'star') ||
        (b.type === spec.bodies[best].type && b.mass > spec.bodies[best].mass)) best = i;
  });
  return best;
}

/** Rotate a perifocal-frame vector by argument of periapsis (about z) then inclination (about x). */
function orient(x: number, y: number, argp: number, inc: number): [number, number, number] {
  const cw = Math.cos(argp), sw = Math.sin(argp);
  const xr = x * cw - y * sw;
  const yr = x * sw + y * cw;
  const ci = Math.cos(inc), si = Math.sin(inc);
  return [xr, yr * ci, yr * si];
}

export function initState(spec: SystemSpec): SimState {
  const n = spec.bodies.length;
  const s: SimState = {
    ids: spec.bodies.map((b) => b.id),
    types: spec.bodies.map((b) => b.type),
    mass: new Float64Array(spec.bodies.map((b) => b.mass)),
    radius: new Float64Array(spec.bodies.map((b) => b.radius)),
    pos: new Float64Array(3 * n),
    vel: new Float64Array(3 * n),
    status: new Uint8Array(n),
    reference: new Int32Array(n).fill(-1),
    influence: new Float64Array(n),
    launches: [],
    fixed: new Uint8Array(spec.bodies.map((b) => (b.fixed ? 1 : 0))),
    bounce: new Float64Array(spec.bodies.map((b) => b.bounce ?? (b.type === 'bumper' ? 1 : 0))),
    link: new Int32Array(n).fill(-1),
  };
  const index = new Map(spec.bodies.map((b, i) => [b.id, i]));
  spec.bodies.forEach((b, i) => {
    if (b.type !== 'portal') return;
    s.link[i] = b.link !== undefined ? index.get(b.link) ?? -1 : -1;
    // Portals are doorways, not masses.
    s.mass[i] = 0;
  });

  for (const i of placementOrder(spec)) {
    const b: BodySpec = spec.bodies[i];
    const p = b.placement;
    if (p.kind === 'orbit') {
      const j = index.get(p.parent)!;
      s.reference[i] = j;
      const mu = G * (spec.bodies[j].mass + b.mass);
      const e = p.e;
      const nu = p.phase * DEG;
      const semiLatus = p.a * (1 - e * e);
      const r = semiLatus / (1 + e * Math.cos(nu));
      const vScale = Math.sqrt(mu / semiLatus) * (p.retrograde ? -1 : 1);
      const rp = orient(r * Math.cos(nu), r * Math.sin(nu), p.argPeriapsis * DEG, p.inclination * DEG);
      const vp = orient(-vScale * Math.sin(nu), vScale * (e + Math.cos(nu)), p.argPeriapsis * DEG, p.inclination * DEG);
      for (let k = 0; k < 3; k++) {
        s.pos[3 * i + k] = s.pos[3 * j + k] + rp[k];
        s.vel[3 * i + k] = s.vel[3 * j + k] + vp[k];
      }
      s.status[i] = ACTIVE;
    } else if (p.kind === 'free') {
      s.reference[i] = heaviestStar(spec, i);
      for (let k = 0; k < 3; k++) {
        s.pos[3 * i + k] = p.position[k];
        s.vel[3 * i + k] = p.velocity[k];
      }
      s.status[i] = ACTIVE;
    } else {
      const j = index.get(p.from)!;
      s.reference[i] = j;
      s.launches.push({ index: i, from: j, speed: p.speed, angle: p.angle, elevation: p.elevation, time: p.time });
      s.status[i] = PENDING;
    }
  }

  // Move to the barycentre frame of bodies present at t=0 so the system does not drift.
  let mTot = 0;
  const com = [0, 0, 0], vcom = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    if (s.status[i] !== ACTIVE) continue;
    mTot += s.mass[i];
    for (let k = 0; k < 3; k++) {
      com[k] += s.mass[i] * s.pos[3 * i + k];
      vcom[k] += s.mass[i] * s.vel[3 * i + k];
    }
  }
  if (mTot > 0) {
    for (let i = 0; i < n; i++) {
      if (s.status[i] !== ACTIVE) continue;
      for (let k = 0; k < 3; k++) {
        s.pos[3 * i + k] -= com[k] / mTot;
        s.vel[3 * i + k] -= vcom[k] / mTot;
      }
    }
  }

  for (let i = 0; i < n; i++) {
    if (s.fixed[i]) s.vel[3 * i] = s.vel[3 * i + 1] = s.vel[3 * i + 2] = 0;
  }

  for (let i = 0; i < n; i++) {
    if (s.types[i] === 'star') {
      s.influence[i] = Infinity;
      continue;
    }
    const b = spec.bodies[i];
    const ref = b.placement.kind === 'launch' ? s.reference[s.reference[i]] : s.reference[i];
    if (ref < 0) {
      s.influence[i] = Infinity;
      continue;
    }
    const refMass = spec.bodies[ref].mass;
    const dist = b.placement.kind === 'orbit'
      ? b.placement.a * (1 - b.placement.e)
      : Math.hypot(s.pos[3 * i] - s.pos[3 * ref], s.pos[3 * i + 1] - s.pos[3 * ref + 1], s.pos[3 * i + 2] - s.pos[3 * ref + 2]);
    s.influence[i] = refMass > 0 ? dist * Math.cbrt(b.mass / (3 * refMass)) : Infinity;
  }
  return s;
}

/**
 * Place a launched body. `speed` is the hyperbolic excess speed: the body starts a
 * short distance from its source with enough extra speed to climb out of its gravity.
 */
export function applyLaunch(s: SimState, l: PendingLaunch): void {
  const i = l.index, j = l.from;
  const ref = s.reference[j];
  const rel = [0, 0, 0], vrel = [0, 0, 0];
  for (let k = 0; k < 3; k++) {
    rel[k] = ref >= 0 ? s.pos[3 * j + k] - s.pos[3 * ref + k] : s.pos[3 * j + k];
    vrel[k] = ref >= 0 ? s.vel[3 * j + k] - s.vel[3 * ref + k] : s.vel[3 * j + k];
  }
  let pro = normalize(vrel);
  if (!pro) pro = [1, 0, 0];
  const dot = rel[0] * pro[0] + rel[1] * pro[1] + rel[2] * pro[2];
  let radial = normalize([rel[0] - dot * pro[0], rel[1] - dot * pro[1], rel[2] - dot * pro[2]]);
  if (!radial) radial = [-pro[1], pro[0], 0];
  const normal = cross(radial, pro);

  const th = l.angle * DEG, el = l.elevation * DEG;
  const dir = [0, 1, 2].map((k) =>
    Math.cos(el) * (Math.cos(th) * pro[k] + Math.sin(th) * radial[k]) + Math.sin(el) * normal[k]);

  const influence = Number.isFinite(s.influence[j]) ? s.influence[j] : 0;
  const d0 = Math.max(3 * s.radius[j], 0.25 * influence, 1e-6);
  const speed = Math.sqrt(l.speed * l.speed + (2 * G * s.mass[j]) / d0);
  for (let k = 0; k < 3; k++) {
    s.pos[3 * i + k] = s.pos[3 * j + k] + dir[k] * d0;
    s.vel[3 * i + k] = s.vel[3 * j + k] + dir[k] * speed;
  }
  s.status[i] = ACTIVE;
}

function normalize(v: number[]): [number, number, number] | null {
  const len = Math.hypot(v[0], v[1], v[2]);
  return len > 1e-15 ? [v[0] / len, v[1] / len, v[2] / len] : null;
}

function cross(a: number[], b: number[]): [number, number, number] {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

const MAX_STEPS = 400_000;

/** Timestep: 1/200 of the shortest periapsis timescale among orbiting bodies. */
export function computeTiming(spec: SystemSpec): Timing {
  const { duration, samples } = spec.sim;
  let dt = spec.sim.dt;
  if (dt === undefined) {
    const byId = new Map(spec.bodies.map((b) => [b.id, b]));
    let shortest = Infinity;
    for (const b of spec.bodies) {
      if (b.placement.kind !== 'orbit') continue;
      const parent = byId.get(b.placement.parent);
      if (!parent) continue;
      const P = orbitalPeriod(b.placement.a, parent.mass + b.mass);
      shortest = Math.min(shortest, P * Math.pow(1 - b.placement.e, 1.5));
    }
    dt = Number.isFinite(shortest) ? shortest / 200 : duration / 5000;
  }
  dt = Math.min(dt, duration / 200);
  let steps = Math.min(MAX_STEPS, Math.ceil(duration / dt));
  const sampleEvery = Math.max(1, Math.floor(steps / samples));
  // Round up to a whole number of sample intervals so the final state is recorded.
  steps = Math.ceil(steps / sampleEvery) * sampleEvery;
  dt = duration / steps;
  return { dt, steps, sampleEvery, frameCount: steps / sampleEvery + 1 };
}
