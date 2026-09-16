import { ACTIVE, type SimState } from './init';
import type { BodyType } from './schema';
import { G } from './units';

export type SimEventType = 'launch' | 'flyby' | 'capture' | 'collision' | 'escape' | 'eclipse';

/** A human-meaningful moment in a run, shown on the timeline and fed to explanations. */
export interface SimEvent {
  type: SimEventType;
  t: number;
  bodies: string[];
  details: Record<string, number>;
}

/** Local minimum of the distance between two bodies. `energy` is the two-body specific orbital energy. */
export interface Approach {
  t: number;
  d: number;
  energy: number;
}

/** A span where two bodies were gravitationally bound inside the larger sphere of influence. */
export interface BoundInterval {
  start: number;
  end: number;
  open: boolean;
  initial: boolean;
  period: number;
}

export interface PairTrace {
  a: string;
  b: string;
  approaches: Approach[];
  bound: BoundInterval[];
}

export interface EclipseTrace {
  source: string;
  occluder: string;
  observer: string;
  starts: number[];
  /** Local minima of angular separation / (sum of angular radii); < 1 means eclipse. */
  minima: { t: number; ratio: number }[];
}

export interface CollisionRecord {
  t: number;
  survivor: string;
  absorbed: string;
  /** Original bodies merged into each side before this collision. */
  groupA: string[];
  groupB: string[];
}

export interface BodyInfo {
  type: BodyType;
  mass: number;
  radius: number;
  influence: number;
}

/** Everything the goal checker, optimizer and explanations need, JSON-serialisable. */
export interface Trace {
  duration: number;
  escapeRadius: number;
  bodies: Record<string, BodyInfo>;
  pairs: Record<string, PairTrace>;
  eclipses: Record<string, EclipseTrace>;
  /** Specific energy relative to the system barycentre, normalised by G·M/escapeRadius; sampled. */
  energy: Record<string, { t: number; e: number; d: number }[]>;
  collisions: CollisionRecord[];
  escapes: Record<string, number>;
  launches: Record<string, number>;
}

export const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
export const eclipseKey = (source: string, occluder: string, observer: string) => `${source}|${occluder}|${observer}`;

/** Ids of bodies the player drops into a level (see pieceBody in game/level.ts). */
const PIECE_ID = /^piece\d+$/;

const MAX_LIST = 4000;
const ENERGY_SAMPLES = 400;
const MAX_ECLIPSE_EVENTS_PER_TRIPLE = 12;

export class EventTracker {
  private n: number;
  private ids: string[];
  private pairs: PairTrace[] = [];
  private pairIndex: Int32Array;
  private prevD: Float64Array;
  private prevE: Float64Array;
  private prevT: Float64Array;
  private falling: Uint8Array;
  private boundStart: Float64Array;
  private boundMinE: Float64Array;
  private boundInitial: Uint8Array;

  private triples: { s: number; c: number; o: number; trace: EclipseTrace }[] = [];
  private tripleIn: Uint8Array;
  private triplePrev: Float64Array;
  private tripleFalling: Uint8Array;
  private triplePrevT: Float64Array;
  private tripleQ: Float64Array;
  private tripleFront: Uint8Array;
  private q = new Float64Array(3);

  private groups: string[][];
  private trace: Trace;
  private nextEnergyT = 0;
  private energyEvery: number;
  private started = false;

  constructor(s: SimState, duration: number) {
    const n = (this.n = s.ids.length);
    this.ids = s.ids;
    this.groups = s.ids.map((id) => [id]);
    this.energyEvery = duration / ENERGY_SAMPLES;

    this.pairIndex = new Int32Array(n * n).fill(-1);
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        this.pairIndex[i * n + j] = this.pairs.length;
        this.pairs.push({ a: s.ids[i], b: s.ids[j], approaches: [], bound: [] });
      }
    }
    const P = this.pairs.length;
    this.prevD = new Float64Array(P).fill(NaN);
    this.prevE = new Float64Array(P);
    this.prevT = new Float64Array(P);
    this.falling = new Uint8Array(P);
    this.boundStart = new Float64Array(P).fill(NaN);
    this.boundMinE = new Float64Array(P);
    this.boundInitial = new Uint8Array(P);

    for (let src = 0; src < n; src++) {
      if (s.types[src] !== 'star') continue;
      for (let c = 0; c < n; c++) {
        if (c === src) continue;
        for (let o = 0; o < n; o++) {
          if (o === src || o === c || s.types[o] === 'star') continue;
          this.triples.push({
            s: src, c, o,
            trace: { source: s.ids[src], occluder: s.ids[c], observer: s.ids[o], starts: [], minima: [] },
          });
        }
      }
    }
    this.tripleIn = new Uint8Array(this.triples.length);
    this.triplePrev = new Float64Array(this.triples.length).fill(NaN);
    this.tripleFalling = new Uint8Array(this.triples.length);
    this.triplePrevT = new Float64Array(this.triples.length);
    this.tripleQ = new Float64Array(3 * this.triples.length);
    this.tripleFront = new Uint8Array(this.triples.length);

    // Escape radius: 3x the extent of the initial massive system. Player-placed pieces
    // (game/level.ts pieceBody ids) are left out so where a piece goes never moves the goal line.
    const com = centreOfMass(s);
    let extent = 0;
    for (let i = 0; i < n; i++) {
      if (s.status[i] !== ACTIVE || s.mass[i] <= 0 || PIECE_ID.test(s.ids[i])) continue;
      extent = Math.max(extent, Math.hypot(s.pos[3 * i] - com.x, s.pos[3 * i + 1] - com.y, s.pos[3 * i + 2] - com.z));
    }

    const bodies: Record<string, BodyInfo> = {};
    s.ids.forEach((id, i) => {
      bodies[id] = { type: s.types[i], mass: s.mass[i], radius: s.radius[i], influence: s.influence[i] };
    });
    this.trace = {
      duration,
      escapeRadius: Math.max(3 * extent, 1),
      bodies,
      pairs: {},
      eclipses: {},
      energy: Object.fromEntries(s.ids.map((id) => [id, []])),
      collisions: [],
      escapes: {},
      launches: {},
    };
  }

  onLaunch(t: number, index: number): void {
    this.trace.launches[this.ids[index]] = t;
  }

  onMerge(t: number, s: SimState, survivor: number, absorbed: number): void {
    this.trace.collisions.push({
      t,
      survivor: this.ids[survivor],
      absorbed: this.ids[absorbed],
      groupA: [...this.groups[survivor]],
      groupB: [...this.groups[absorbed]],
    });
    this.groups[survivor].push(...this.groups[absorbed]);
    for (let k = 0; k < this.n; k++) {
      if (k === absorbed) continue;
      const p = this.pairOf(absorbed, k);
      this.closeBound(p, t, false);
      this.prevD[p] = NaN;
    }
    this.trace.bodies[this.ids[survivor]].mass = s.mass[survivor];
    this.trace.bodies[this.ids[survivor]].radius = s.radius[survivor];
  }

  private pairOf(i: number, j: number): number {
    return i < j ? this.pairIndex[i * this.n + j] : this.pairIndex[j * this.n + i];
  }

  private closeBound(p: number, t: number, open: boolean): void {
    if (Number.isNaN(this.boundStart[p])) return;
    const bound = this.pairs[p].bound;
    const energy = this.boundMinE[p];
    const i = this.ids.indexOf(this.pairs[p].a), j = this.ids.indexOf(this.pairs[p].b);
    const mu = G * (this.trace.bodies[this.ids[i]].mass + this.trace.bodies[this.ids[j]].mass);
    const a = -mu / (2 * energy);
    if (bound.length < MAX_LIST) {
      bound.push({
        start: this.boundStart[p],
        end: t,
        open,
        initial: this.boundInitial[p] === 1,
        period: a > 0 ? 2 * Math.PI * Math.sqrt((a * a * a) / mu) : Infinity,
      });
    }
    this.boundStart[p] = NaN;
  }

  observe(t: number, s: SimState): void {
    const n = this.n;
    const { pos, vel, mass, status, influence } = s;
    const first = !this.started;
    this.started = true;

    for (let i = 0; i < n; i++) {
      if (status[i] !== ACTIVE) continue;
      for (let j = i + 1; j < n; j++) {
        if (status[j] !== ACTIVE) continue;
        const p = this.pairIndex[i * n + j];
        const dx = pos[3 * j] - pos[3 * i], dy = pos[3 * j + 1] - pos[3 * i + 1], dz = pos[3 * j + 2] - pos[3 * i + 2];
        const vx = vel[3 * j] - vel[3 * i], vy = vel[3 * j + 1] - vel[3 * i + 1], vz = vel[3 * j + 2] - vel[3 * i + 2];
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        const mu = G * (mass[i] + mass[j]);
        const energy = 0.5 * (vx * vx + vy * vy + vz * vz) - (d > 0 ? mu / d : 0);

        const prev = this.prevD[p];
        if (!Number.isNaN(prev)) {
          if (d > prev && this.falling[p]) {
            const list = this.pairs[p].approaches;
            if (list.length < MAX_LIST) list.push({ t: this.prevT[p], d: prev, energy: this.prevE[p] });
          }
          this.falling[p] = d < prev ? 1 : 0;
        }
        this.prevD[p] = d;
        this.prevE[p] = energy;
        this.prevT[p] = t;

        const bound = energy < 0 && d < Math.max(influence[i], influence[j]);
        if (bound) {
          if (Number.isNaN(this.boundStart[p])) {
            this.boundStart[p] = t;
            this.boundMinE[p] = energy;
            this.boundInitial[p] = first ? 1 : 0;
          } else if (energy < this.boundMinE[p]) {
            this.boundMinE[p] = energy;
          }
        } else if (!Number.isNaN(this.boundStart[p])) {
          this.closeBound(p, t, false);
        }
      }
    }

    const q = this.q;
    for (let k = 0; k < this.triples.length; k++) {
      const tr = this.triples[k];
      if (status[tr.s] !== ACTIVE || status[tr.c] !== ACTIVE || status[tr.o] !== ACTIVE) continue;
      const alpha = skyOffset(s, tr.s, tr.c, tr.o, q);
      const o = 3 * k;
      const endRatio = alpha > 0 ? Math.hypot(q[0], q[1], q[2]) / alpha : Infinity;
      // Sweep from the previous sky offset so transits shorter than a step are not missed.
      let ratio = endRatio;
      if (alpha > 0 && this.tripleFront[k]) {
        ratio = segmentDistance(this.tripleQ[o], this.tripleQ[o + 1], this.tripleQ[o + 2], q[0], q[1], q[2]) / alpha;
      }
      if (ratio < 1 && !this.tripleIn[k]) tr.trace.starts.push(t);
      this.tripleIn[k] = endRatio < 1 ? 1 : 0;
      this.tripleFront[k] = alpha > 0 ? 1 : 0;
      this.tripleQ[o] = q[0];
      this.tripleQ[o + 1] = q[1];
      this.tripleQ[o + 2] = q[2];

      const prev = this.triplePrev[k];
      if (Number.isFinite(prev) && Number.isFinite(ratio)) {
        if (ratio > prev && this.tripleFalling[k] && tr.trace.minima.length < MAX_LIST) {
          tr.trace.minima.push({ t: this.triplePrevT[k], ratio: prev });
        }
        this.tripleFalling[k] = ratio < prev ? 1 : 0;
      } else {
        this.tripleFalling[k] = 0;
      }
      this.triplePrev[k] = ratio;
      this.triplePrevT[k] = t;
    }

    const com = centreOfMass(s);
    const sampleEnergy = t >= this.nextEnergyT;
    if (sampleEnergy) this.nextEnergyT = t + this.energyEvery;
    const scale = (G * com.m) / this.trace.escapeRadius;
    for (let i = 0; i < n; i++) {
      if (status[i] !== ACTIVE || s.types[i] === 'star') continue;
      const id = this.ids[i];
      const rx = pos[3 * i] - com.x, ry = pos[3 * i + 1] - com.y, rz = pos[3 * i + 2] - com.z;
      const vx = vel[3 * i] - com.vx, vy = vel[3 * i + 1] - com.vy, vz = vel[3 * i + 2] - com.vz;
      const d = Math.sqrt(rx * rx + ry * ry + rz * rz);
      const e = 0.5 * (vx * vx + vy * vy + vz * vz) - (G * com.m) / Math.max(d, 1e-9);
      if (sampleEnergy) this.trace.energy[id].push({ t, e: e / scale, d });
      if (e > 0 && d > this.trace.escapeRadius && this.trace.escapes[id] === undefined) {
        this.trace.escapes[id] = t;
      }
    }
  }

  finish(t: number, s: SimState): { trace: Trace; events: SimEvent[] } {
    for (let p = 0; p < this.pairs.length; p++) {
      this.closeBound(p, t, true);
      if (this.falling[p] && !Number.isNaN(this.prevD[p]) && this.pairs[p].approaches.length < MAX_LIST) {
        this.pairs[p].approaches.push({ t: this.prevT[p], d: this.prevD[p], energy: this.prevE[p] });
      }
    }
    for (const pair of this.pairs) {
      if (pair.approaches.length || pair.bound.length) this.trace.pairs[pairKey(pair.a, pair.b)] = pair;
    }
    for (const tr of this.triples) {
      if (tr.trace.starts.length || tr.trace.minima.length) {
        this.trace.eclipses[eclipseKey(tr.trace.source, tr.trace.occluder, tr.trace.observer)] = tr.trace;
      }
    }
    return { trace: this.trace, events: buildEvents(this.trace) };
  }
}

function centreOfMass(s: SimState) {
  let m = 0, x = 0, y = 0, z = 0, vx = 0, vy = 0, vz = 0;
  for (let i = 0; i < s.ids.length; i++) {
    if (s.status[i] !== ACTIVE) continue;
    const mi = s.mass[i];
    m += mi;
    x += mi * s.pos[3 * i]; y += mi * s.pos[3 * i + 1]; z += mi * s.pos[3 * i + 2];
    vx += mi * s.vel[3 * i]; vy += mi * s.vel[3 * i + 1]; vz += mi * s.vel[3 * i + 2];
  }
  if (m <= 0) return { m: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 };
  return { m, x: x / m, y: y / m, z: z / m, vx: vx / m, vy: vy / m, vz: vz / m };
}

/**
 * Angular offset of the occluder from the source as seen by the observer, written to `out`
 * as a difference of unit vectors (small-angle approximation). Returns the sum of the two
 * angular radii, or -1 when the occluder is not between observer and source.
 */
export function skyOffset(s: SimState, src: number, occ: number, obs: number, out: Float64Array): number {
  const p = s.pos;
  const ux = p[3 * src] - p[3 * obs], uy = p[3 * src + 1] - p[3 * obs + 1], uz = p[3 * src + 2] - p[3 * obs + 2];
  const wx = p[3 * occ] - p[3 * obs], wy = p[3 * occ + 1] - p[3 * obs + 1], wz = p[3 * occ + 2] - p[3 * obs + 2];
  const du = Math.sqrt(ux * ux + uy * uy + uz * uz);
  const dw = Math.sqrt(wx * wx + wy * wy + wz * wz);
  if (dw >= du || dw === 0 || ux * wx + uy * wy + uz * wz <= 0) return -1;
  out[0] = wx / dw - ux / du;
  out[1] = wy / dw - uy / du;
  out[2] = wz / dw - uz / du;
  return Math.asin(Math.min(1, s.radius[src] / du)) + Math.asin(Math.min(1, s.radius[occ] / dw));
}

/** Distance from the origin to the segment a-b. */
function segmentDistance(ax: number, ay: number, az: number, bx: number, by: number, bz: number): number {
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  const len2 = dx * dx + dy * dy + dz * dz;
  const u = len2 > 0 ? Math.min(1, Math.max(0, -(ax * dx + ay * dy + az * dz) / len2)) : 0;
  return Math.hypot(ax + u * dx, ay + u * dy, az + u * dz);
}

/** Goal-independent event log derived from the trace. */
function buildEvents(trace: Trace): SimEvent[] {
  const events: SimEvent[] = [];
  const info = trace.bodies;

  for (const [id, t] of Object.entries(trace.launches)) {
    events.push({ type: 'launch', t, bodies: [id], details: {} });
  }

  for (const pair of Object.values(trace.pairs)) {
    const A = info[pair.a], B = info[pair.b];
    if (A.type === 'star' || B.type === 'star') continue;
    const reach = 1.5 * Math.max(A.influence, B.influence);
    for (const ap of pair.approaches) {
      if (ap.energy >= 0 && ap.d < reach) {
        const [small, big] = A.mass <= B.mass ? [pair.a, pair.b] : [pair.b, pair.a];
        const mu = G * (A.mass + B.mass);
        events.push({
          type: 'flyby', t: ap.t, bodies: [small, big],
          details: { distance: ap.d, speed: Math.sqrt(2 * ap.energy + (2 * mu) / ap.d) },
        });
      }
    }
    for (const b of pair.bound) {
      const long = b.end - b.start >= b.period || (b.open && b.end - b.start >= 0.5 * b.period);
      if (!b.initial && long) {
        const [small, big] = A.mass <= B.mass ? [pair.a, pair.b] : [pair.b, pair.a];
        events.push({ type: 'capture', t: b.start, bodies: [small, big], details: { period: b.period, duration: b.end - b.start } });
      }
    }
  }

  for (const c of trace.collisions) {
    events.push({ type: 'collision', t: c.t, bodies: [c.absorbed, c.survivor], details: {} });
  }
  for (const [id, t] of Object.entries(trace.escapes)) {
    events.push({ type: 'escape', t, bodies: [id], details: {} });
  }
  for (const ec of Object.values(trace.eclipses)) {
    ec.starts.slice(0, MAX_ECLIPSE_EVENTS_PER_TRIPLE).forEach((t, k) => {
      events.push({
        type: 'eclipse', t, bodies: [ec.occluder, ec.source, ec.observer],
        details: { index: k + 1, total: ec.starts.length },
      });
    });
  }
  return events.sort((a, b) => a.t - b.t);
}
