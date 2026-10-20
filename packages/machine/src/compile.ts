/**
 * Route graphs: a level as a story ("roll off the shelf, a cannon turns it south over the river,
 * land in the bucket") instead of coordinates. The AI writes the graph, which is a few hundred
 * tokens; the compiler lays it out by following the ball: it places one link, runs the physics,
 * reads where the ball really goes and puts the next part there. Every compiled level has been
 * run, so it is solvable by construction, and the same compiler builds levels with no AI at all.
 */
import { z } from 'zod';
import { evaluateMachine } from './goal';
import { facing, KIT } from './kit';
import { layoutProblems, obstacles, terrainInWay } from './names';
import { mulberry32 } from './nudge';
import { makeConnectPuzzle } from './puzzle';
import { CELL, GRID, Spare, TERRAIN_MIN, type MachineGoal, type MachineSpec, type Part, type Terrain, type Yaw } from './schema';
import { simulateSync, type MachineRun } from './sim';
import { groundAt } from './terrain';

export const LINK_KINDS = ['cannon', 'fan', 'trampoline', 'ramp'] as const;
export type LinkKind = (typeof LINK_KINDS)[number];

export const RouteLink = z.object({
  via: z.enum(LINK_KINDS).describe('cannon: catches the rolling ball and fires it 6 to 9 cells; fan: blows the rolling ball sideways; trampoline: bounces a falling ball up and on; ramp: a falling ball lands on it and rolls off the way it faces'),
  turn: z.enum(['left', 'right', 'straight']).default('straight').describe('which way the route bends at this link'),
});
export type RouteLink = z.infer<typeof RouteLink>;

const Name = z.string().max(24).optional();

export const RouteGraph = z.object({
  title: z.string().describe('2 to 5 playful words'),
  caption: z.string().optional().describe('one sentence for players: what should happen, no numbers'),
  closest: z.string().optional().describe('only when the mission could not be built as asked: one honest sentence saying what was built instead'),
  start: z.enum(['shelf', 'hill']).default('shelf').describe('the ball starts on a high shelf, or on top of a hill'),
  links: z.array(RouteLink).min(1).max(3).describe('what moves the ball on, in order; at least one turns left or right'),
  end: z.enum(['bucket', 'bell', 'dominoes']).describe('bucket: the ball lands in it; bell: the ball rings it; dominoes: the ball knocks a row over that rings a bell'),
  ground: z.enum(['river', 'pit', 'hill', 'auto']).default('auto').describe('the shaped ground in the way: a river under a cannon flight, a pit, a hill start'),
  names: z.object({ target: Name, scenery: Name, ground: Name, ball: Name }).partial().optional().describe('the mission\'s words for the target, the wall, the ground block and the ball'),
  spares: z.array(Spare).max(4).optional(),
});
export type RouteGraph = z.infer<typeof RouteGraph>;
export type RouteGraphInput = z.input<typeof RouteGraph>;

export interface CompileOptions {
  seed?: number;
  /** Layouts to try before giving up (default 24). */
  attempts?: number;
  /** Flat ground only (the mission said so). */
  flat?: boolean;
}

export interface CompileResult {
  spec: MachineSpec;
  /** Layouts tried, and simulations run. */
  tries: number;
  sims: number;
  /** Set when the graph's ending could not be built and another one stands in. */
  adapted?: RouteGraph['end'];
}

type Sample = { t: number; x: number; y: number; z: number };

/** The ball's path from a recorded run, in metres. */
function track(run: MachineRun): Sample[] {
  const ballId = run.spec.parts.find((p) => p.kind === 'ball')!.id;
  const k = run.dynamicIds.indexOf(ballId);
  const out: Sample[] = [];
  for (let f = 0; f < run.frameCount; f++) {
    const o = f * run.frameStride;
    const b = o + 1 + k * 7;
    out.push({ t: run.frames[o], x: run.frames[b], y: run.frames[b + 1], z: run.frames[b + 2] });
  }
  return out;
}

const cellOf = (v: number) => Math.floor(v / CELL);
const inStage = (x: number, z: number) => x >= 0 && x < GRID.x && z >= 0 && z < GRID.z;
const turnYaw = (yaw: Yaw, turn: RouteLink['turn']): Yaw => (turn === 'straight' ? yaw : (((yaw + (turn === 'right' ? 90 : 270)) % 360) as Yaw));

/** The first moment after `after` when the ball is down on the ground (not on a shelf or part), with its cell and heading. */
function arrival(samples: Sample[], terrain: Terrain[] | undefined, after: number, below = Infinity): { x: number; z: number; t: number; yaw: Yaw; moving: boolean } | null {
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    if (s.t <= after + 0.05) continue;
    const x = cellOf(s.x), z = cellOf(s.z);
    if (!inStage(x, z)) return null;
    // Ground at or above `below` (the hill the ball starts on) is not an arrival.
    if (groundAt(terrain, x, z) >= below || s.y - KIT.ballRadius > groundAt(terrain, x, z) * CELL + 0.05) continue;
    // Heading from the next third of a second of travel.
    const later = samples[Math.min(samples.length - 1, i + 20)];
    const vx = later.x - s.x, vz = later.z - s.z;
    const yaw: Yaw = Math.abs(vx) >= Math.abs(vz) ? (vx >= 0 ? 0 : 180) : (vz >= 0 ? 90 : 270);
    return { x, z, t: s.t, yaw, moving: Math.hypot(vx, vz) > 0.05 };
  }
  return null;
}

/**
 * Where a falling ball crosses `height` metres on its way down after `after`: the centre for a
 * bucket that catches it, as a cell plus fine offsets.
 */
function descent(samples: Sample[], after: number, height: number): { x: number; z: number; dx: number; dz: number } | null {
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1], b = samples[i];
    if (b.t <= after || !(a.y > height && b.y <= height)) continue;
    const k = (a.y - height) / (a.y - b.y);
    const px = (a.x + (b.x - a.x) * k) / CELL, pz = (a.z + (b.z - a.z) * k) / CELL;
    const x = Math.floor(px), z = Math.floor(pz);
    return { x, z, dx: Math.max(-0.5, Math.min(0.5, px - x - 0.5)), dz: Math.max(-0.5, Math.min(0.5, pz - z - 0.5)) };
  }
  return null;
}

/** Cells the ball passes through after `after`, in order, while it is on the ground. */
function groundPath(samples: Sample[], terrain: Terrain[] | undefined, after: number): { x: number; z: number; t: number; dx: number; dz: number }[] {
  const out: { x: number; z: number; t: number; dx: number; dz: number }[] = [];
  for (const s of samples) {
    if (s.t <= after) continue;
    const x = cellOf(s.x), z = cellOf(s.z);
    if (!inStage(x, z)) break;
    if (s.y - KIT.ballRadius > groundAt(terrain, x, z) * CELL + 0.05) continue;
    const last = out[out.length - 1];
    // Fine offsets: where in the cell the ball actually rolled, so a bell stands right in its way.
    if (!last || last.x !== x || last.z !== z) out.push({ x, z, t: s.t, dx: 0, dz: 0 });
    const cur = out[out.length - 1];
    cur.dx = Math.max(-0.4, Math.min(0.4, s.x / CELL - x - 0.5));
    cur.dz = Math.max(-0.4, Math.min(0.4, s.z / CELL - z - 0.5));
  }
  return out;
}

const step = (x: number, z: number, yaw: Yaw, n: number) => {
  const f = facing(yaw);
  return { x: x + f[0] * n, z: z + f[2] * n };
};

/**
 * Lay a route graph out on the stage. Tries random starts and spacings (seeded) until one runs end
 * to end and passes the level rules; null when none does.
 */
export function compileRoute(input: RouteGraphInput, opts: CompileOptions = {}): CompileResult | null {
  const graph = RouteGraph.parse(input);
  const rand = mulberry32(opts.seed ?? 1);
  const attempts = opts.attempts ?? 12;
  let sims = 0;
  const run = (spec: MachineSpec) => { sims++; return simulateSync(spec, { record: true }); };
  // A level must turn a corner: a graph that never turns gets its first link bent.
  const links = graph.links.some((l) => l.turn !== 'straight') ? graph.links : graph.links.map((l, i) => (i === 0 ? { ...l, turn: rand() < 0.5 ? 'left' : 'right' } as RouteLink : l));
  for (let tryNo = 1; tryNo <= attempts; tryNo++) {
    const spec = layOut(graph, links, rand, run, opts);
    if (spec) return { spec, tries: tryNo, sims };
  }
  // The ending the graph asked for never fits this route: build the nearest one that does, and say so.
  for (const end of ADAPT[graph.end]) {
    const adapted: RouteGraph = { ...graph, end, closest: graph.closest ?? ADAPT_NOTE[end] };
    for (let tryNo = 1; tryNo <= Math.ceil(attempts / 2); tryNo++) {
      const spec = layOut(adapted, links, rand, run, opts);
      if (spec) return { spec, tries: attempts + tryNo, sims, adapted: end };
    }
  }
  return null;
}

const ADAPT: Record<RouteGraph['end'], RouteGraph['end'][]> = { bucket: ['dominoes', 'bell'], bell: ['dominoes'], dominoes: ['bell'] };
const ADAPT_NOTE: Record<RouteGraph['end'], string> = {
  bucket: 'A bucket would not catch the ball on this route, so the finish is a bell to ring instead.',
  bell: 'The bell sits at the end of a row of dominoes: knock them over to ring it.',
  dominoes: 'The dominoes would not fall on this route, so the finish is a bell the ball rings itself.',
};

const why = (r: string) => { if (process.env.COMPILE_DEBUG) console.log('  layout:', r); return null; };

function layOut(graph: RouteGraph, links: RouteLink[], rand: () => number, run: (s: MachineSpec) => MachineRun, opts: CompileOptions): MachineSpec | null {
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)];
  const names = graph.names ?? {};
  const id = (word: string | undefined, fallback: string) => (word ?? fallback).toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 16) || fallback;
  // The first leg runs along x; which way the route turns decides which edge it starts near.
  const firstTurn = links.find((l) => l.turn !== 'straight')?.turn ?? 'right';
  let yaw: Yaw = rand() < 0.5 ? 0 : 180;
  const sx = yaw === 0 ? 1 + Math.floor(rand() * 3) : GRID.x - 2 - Math.floor(rand() * 3);
  const southward = turnYaw(yaw, firstTurn) === 90;
  const sz = southward ? 2 + Math.floor(rand() * 4) : GRID.z - 3 - Math.floor(rand() * 4);
  const hill = !opts.flat && (graph.start === 'hill' || (graph.ground === 'auto' && rand() < 0.25));
  const hillH = hill ? 2 + Math.floor(rand() * 2) : 0;
  const shelfLen = 4 + Math.floor(rand() * 3);
  const terrain: Terrain[] = [];
  const parts: Part[] = [];
  // Start: the ball above the high end of a ramp on a shelf (or on top of a hill), rolling along yaw.
  if (hill) {
    const len = shelfLen + 1;
    const x0 = yaw === 0 ? sx - 1 : sx - len + 2;
    terrain.push({ name: names.ground ?? 'hill', x: Math.max(0, x0), z: Math.max(0, sz - 1), w: len, d: 3, h: hillH });
    parts.push({ id: id(names.ball, 'ball'), kind: 'ball', x: sx, y: hillH + 1, z: sz, yaw: 0 });
    parts.push({ id: 'ramp', kind: 'ramp', x: sx, y: hillH, z: sz, yaw });
  } else {
    const h = 3 + Math.floor(rand() * 3);
    parts.push({ id: id(names.ball, 'ball'), kind: 'ball', x: sx, y: h + 1, z: sz, yaw: 0 });
    parts.push({ id: 'ramp', kind: 'ramp', x: sx, y: h, z: sz, yaw });
    parts.push({ id: 'shelf', kind: 'platform', x: sx, y: h, z: sz, yaw, length: shelfLen, fixed: true });
  }
  const ball = parts[0];
  const goal: MachineGoal[] = [];
  const spec = (): MachineSpec => ({ title: graph.title, caption: graph.caption, closest: graph.closest, terrain: terrain.length ? [...terrain] : undefined, parts: [...parts], goal: [...goal], duration: 15 });

  let samples = track(run(spec()));
  let after = 0;
  let flying = true; // The ball comes off the start by dropping to the ground.
  let landed = arrival(samples, spec().terrain, after, hill ? hillH : Infinity);
  if (!landed) return why('start never lands');
  let turnAt: { x: number; z: number; inYaw: Yaw } | null = null;
  let flight: { from: { x: number; z: number }; to: { x: number; z: number }; yaw: Yaw } | null = null;

  for (const [n, link] of links.entries()) {
    const out = turnYaw(landed.yaw, link.turn);
    const pid = links.filter((l, i) => l.via === link.via && i <= n).length > 1 ? `${link.via}${n + 1}` : link.via;
    const candidates: Part[] = [];
    /** Scenery that goes with a candidate (the wall a fan link blows the ball off). */
    const withWall = new Map<Part, Part>();
    const g = (x: number, z: number) => groundAt(spec().terrain, x, z);
    if (link.via === 'cannon') {
      // First link: up on the end of the start shelf, so the shot comes down steeply from high up.
      const shelf = parts.find((p) => p.id === 'shelf');
      if (n === 0 && shelf && graph.end === 'bucket') {
        for (const back of [0, 1]) { const c = step(shelf.x, shelf.z, shelf.yaw, (shelf.length ?? 3) - 1 - back); candidates.push({ id: pid, kind: 'cannon', x: c.x, y: shelf.y, z: c.z, yaw: out }); }
      }
      // Or on the edge of the hill the ball starts on.
      if (n === 0 && hill && graph.end === 'bucket') {
        const t = terrain[0];
        const edge = yaw === 0 ? t.x + t.w - 1 : t.x;
        for (const back of [0, 1]) { const x = edge - (yaw === 0 ? back : -back); candidates.push({ id: pid, kind: 'cannon', x, y: hillH, z: sz, yaw: out }); }
      }
      // In the path of the rolling ball, a cell or few ahead so it arrives steady.
      for (const k of [2, 1, 3, 4]) { const c = step(landed.x, landed.z, landed.yaw, k); candidates.push({ id: pid, kind: 'cannon', x: c.x, y: g(c.x, c.z), z: c.z, yaw: out }); }
    } else if (link.via === 'fan') {
      // A fan alone only bends a rolling ball a little. A fixed wall across the path stops it, and
      // the fan beside the wall, on the far side from where the ball should go, blows it round the corner.
      const away = ((out + 180) % 360) as Yaw;
      if (link.turn !== 'straight') {
        for (const k of [3, 4, 2, 5]) for (const back of [1, 2]) {
          const w = step(landed.x, landed.z, landed.yaw, k);
          const c = step(w.x, w.z, landed.yaw, -back);
          const f = step(c.x, c.z, away, 1);
          const fan: Part = { id: pid, kind: 'fan', x: f.x, y: g(f.x, f.z), z: f.z, yaw: out };
          candidates.push(fan);
          withWall.set(fan, { id: id(names.scenery, 'wall'), kind: 'wall', x: w.x, y: g(w.x, w.z), z: w.z, yaw: landed.yaw, fixed: true });
        }
      } else {
        for (const k of [1, 2, 0, 3]) { const c = step(landed.x, landed.z, landed.yaw, k); const f = step(c.x, c.z, turnYaw(landed.yaw, 'right'), 1); candidates.push({ id: pid, kind: 'fan', x: f.x, y: g(f.x, f.z), z: f.z, yaw: landed.yaw }); }
      }
    } else if (link.via === 'trampoline') {
      if (!flying) return why('trampoline on a rolling ball');
      for (const k of [0, 1, -1]) { const c = step(landed.x, landed.z, landed.yaw, k); candidates.push({ id: pid, kind: 'trampoline', x: c.x, y: g(c.x, c.z), z: c.z, yaw: 0 }); }
    } else {
      if (!flying) return why('ramp under a rolling ball');
      // The high end right where the ball comes down through the ramp's top, then the cells around.
      const d = descent(samples, after + 0.1, g(landed.x, landed.z) * CELL + KIT.rampHeight + KIT.ballRadius);
      if (d) for (const k of [0, -1]) { const c = step(d.x, d.z, landed.yaw, k); candidates.push({ id: pid, kind: 'ramp', x: c.x, y: g(c.x, c.z), z: c.z, yaw: out, ...(k === 0 ? { dx: d.dx, dz: d.dz } : {}) }); }
      for (const k of [0, 1, -1]) { const c = step(landed.x, landed.z, landed.yaw, k); candidates.push({ id: pid, kind: 'ramp', x: c.x, y: g(c.x, c.z), z: c.z, yaw: out }); }
      // The ball comes in fast: a fixed wall just past the ramp takes the speed out, and the slope sends it on.
      if (link.turn !== 'straight') for (const base of [...candidates]) {
        const w = step(base.x, base.z, landed.yaw, 1);
        const backed: Part = { ...base };
        candidates.push(backed);
        withWall.set(backed, { id: id(names.scenery, 'wall'), kind: 'wall', x: w.x, y: g(w.x, w.z), z: w.z, yaw: landed.yaw, fixed: true });
      }
    }
    let placed = false;
    for (const c of candidates) {
      if (!inStage(c.x, c.z) || parts.some((p) => p.x === c.x && p.z === c.z && p.y === c.y && p.kind !== 'platform')) continue;
      const wall = withWall.get(c);
      if (wall && (!inStage(wall.x, wall.z) || parts.some((p) => p.x === wall.x && p.z === wall.z && p.kind !== 'platform'))) continue;
      parts.push(c);
      if (wall) parts.push(wall);
      goal.push({ type: 'touch', part: c.id });
      const r = run(spec());
      const touched = r.events.find((e) => (e.type === 'touch' || e.type === 'fired' || e.type === 'bounce') && 'part' in e && e.part === c.id);
      // A fan's ball is already on the ground: read its heading once the air has turned it.
      const next = touched ? arrival(track(r), spec().terrain, touched.t + (c.kind === 'fan' ? 0.7 : 0.15)) : null;
      // The link must send the ball on, the way the graph says.
      const ok = next && (link.turn === 'straight' || c.kind === 'trampoline' || next.yaw === out || c.kind === 'fan');
      if (touched && next && ok) {
        if (link.turn !== 'straight' && !wall) turnAt ??= { x: c.x, z: c.z, inYaw: landed.yaw };
        if (c.kind === 'cannon') flight = { from: { x: c.x, z: c.z }, to: { x: next.x, z: next.z }, yaw: c.yaw };
        samples = track(r);
        after = touched.t;
        flying = c.kind === 'cannon' || c.kind === 'trampoline';
        landed = next;
        placed = true;
        break;
      }
      if (wall) parts.pop();
      parts.pop();
      goal.pop();
    }
    if (!placed) return why(`no place for ${link.via} (arrived ${landed.x},${landed.z} yaw ${landed.yaw} moving ${landed.moving})`);
  }

  // The end: a bucket where a flying ball lands (or in a pit on a rolling ball's path), a bell or a row of dominoes on its path.
  const target = id(names.target, graph.end === 'bucket' ? 'bucket' : 'bell');
  const path = groundPath(samples, spec().terrain, landed.t - 0.01);
  const endTries: (() => void)[] = [];
  const pushEnd = (ps: Part[], gs: MachineGoal[], ground?: Terrain) => endTries.push(() => { parts.push(...ps); goal.push(...gs); if (ground) terrain.push(ground); });
  if (graph.end === 'bucket') {
    if (flying) {
      // Where it comes down, a little either way.
      const y0 = groundAt(spec().terrain, landed.x, landed.z);
      const d0 = descent(samples, after + 0.1, y0 * CELL + KIT.bucket.height + KIT.ballRadius);
      if (d0) pushEnd([{ id: target, kind: 'bucket', x: d0.x, y: groundAt(spec().terrain, d0.x, d0.z), z: d0.z, yaw: 0, dx: d0.dx, dz: d0.dz }], [{ type: 'bucket', part: target }]);
      for (const k of [0, 1, -1, 2]) for (const side of [0, 1, -1]) {
        const a = step(landed.x, landed.z, landed.yaw, k); const c = step(a.x, a.z, turnYaw(landed.yaw, 'right'), side);
        pushEnd([{ id: target, kind: 'bucket', x: c.x, y: groundAt(spec().terrain, c.x, c.z), z: c.z, yaw: 0 }], [{ type: 'bucket', part: target }]);
      }
      // A cannon shot peaks about a cell up, below a bucket's rim: the bucket sits sunk in a pit,
      // centred where the ball comes down through the rim's height.
      const y = groundAt(spec().terrain, landed.x, landed.z);
      for (const depth of [1, 2]) {
        const d = descent(samples, after + 0.1, (y - depth) * CELL + KIT.bucket.height + KIT.ballRadius);
        if (!d) continue;
        const sunk = y - depth;
        if (sunk < TERRAIN_MIN) continue;
        pushEnd([{ id: target, kind: 'bucket', x: d.x, y: sunk, z: d.z, yaw: 0, dx: d.dx, dz: d.dz }], [{ type: 'bucket', part: target }], { name: names.ground ?? 'pit', x: d.x, z: d.z, w: 1, d: 1, h: sunk });
      }
    }
    else if (!opts.flat) for (const c of path.slice(2, 6)) pushEnd([{ id: target, kind: 'bucket', x: c.x, y: -2, z: c.z, yaw: 0 }], [{ type: 'bucket', part: target }], { name: names.ground ?? 'pit', x: c.x, z: c.z, w: 1, d: 1, h: -2 });
  } else if (graph.end === 'bell') {
    for (const c of path.slice(1, 6)) for (const fine of [true, false]) pushEnd([{ id: target, kind: 'bell', x: c.x, y: groundAt(spec().terrain, c.x, c.z), z: c.z, yaw: 0, ...(fine ? { dx: c.dx, dz: c.dz } : {}) }], [{ type: 'bell', part: target, times: 1 }]);
  } else {
    for (const c of path.slice(1, 4)) {
      const d = landed.yaw;
      const bell = step(c.x, c.z, d, 3);
      const y = groundAt(spec().terrain, c.x, c.z);
      pushEnd([{ id: 'row', kind: 'dominoes', x: c.x, y, z: c.z, yaw: d, length: 5 }, { id: target, kind: 'bell', x: bell.x, y, z: bell.z, yaw: 0 }], [{ type: 'topple', part: 'row' }, { type: 'bell', part: target, times: 1 }]);
    }
  }
  let done: MachineSpec | null = null;
  for (const tryEnd of endTries) {
    const keep = { parts: parts.length, goal: goal.length, terrain: terrain.length };
    tryEnd();
    const s = spec();
    if (s.parts.every((p) => inStage(p.x, p.z)) && evaluateMachine(s.goal, run(s)).success) { done = s; break; }
    parts.length = keep.parts; goal.length = keep.goal; terrain.length = keep.terrain;
  }
  if (!done) return why(`no end ${graph.end} fits (${endTries.length} tried, flying ${flying}, path ${path.length})`);

  // Scenery: a river under the cannon's flight, and a wall straight ahead where the route turns,
  // so the turn is needed. Each is kept only if the level still works with it.
  const keepIf = (add: () => void, undo: () => void) => {
    add();
    const s = spec();
    if (evaluateMachine(s.goal, run(s)).success) { done = s; return true; }
    undo();
    return false;
  };
  if (flight && !opts.flat && graph.ground !== 'pit' && graph.ground !== 'hill') {
    const f = flight;
    const along = f.yaw === 90 || f.yaw === 270;
    const mid = along ? Math.round((f.from.z + f.to.z) / 2) : Math.round((f.from.x + f.to.x) / 2);
    const river: Terrain = along
      ? { name: names.ground ?? 'river', x: 0, z: mid - 1, w: GRID.x, d: 2, h: -1 }
      : { name: names.ground ?? 'river', x: mid - 1, z: 0, w: 2, d: GRID.z, h: -1 };
    // The river must not run under the start or the target.
    if (!parts.some((p) => groundAt([river], p.x, p.z) < 0)) keepIf(() => terrain.push(river), () => terrain.pop());
  }
  if (turnAt) {
    for (const k of [2, 3, 1]) {
      const w = step(turnAt.x, turnAt.z, turnAt.inYaw, k);
      if (!inStage(w.x, w.z) || parts.some((p) => p.x === w.x && p.z === w.z)) continue;
      const wall: Part = { id: id(names.scenery, 'wall'), kind: 'wall', x: w.x, y: groundAt(spec().terrain, w.x, w.z), z: w.z, yaw: turnAt.inYaw, fixed: true };
      if (keepIf(() => parts.push(wall), () => parts.pop())) break;
    }
  }
  // Shaped ground somewhere when nothing else shaped it: a pond off the route, inside the box.
  if (!opts.flat && !terrain.some((t) => t.h !== 0)) {
    const target0 = parts.find((p) => p.id === target)!;
    const visited = new Set(track(run(spec())).map((s) => `${cellOf(s.x)},${cellOf(s.z)}`));
    // Near the route: the box between the start and the target, plus a margin.
    const x0 = Math.max(0, Math.min(ball.x, target0.x) - 3), x1 = Math.min(GRID.x - 2, Math.max(ball.x, target0.x) + 3);
    const z0 = Math.max(0, Math.min(ball.z, target0.z) - 3), z1 = Math.min(GRID.z - 2, Math.max(ball.z, target0.z) + 3);
    const spots: { x: number; z: number }[] = [];
    for (let x = x0; x < x1; x++) for (let z = z0; z < z1; z++) {
      const cells = [[x, z], [x + 1, z], [x, z + 1], [x + 1, z + 1]];
      if (cells.every(([a, b]) => !visited.has(`${a},${b}`) && !parts.some((p) => p.x === a && p.z === b))) spots.push({ x, z });
    }
    if (spots.length) {
      const s = pick(spots);
      keepIf(() => terrain.push({ name: names.ground ?? 'pond', x: s.x, z: s.z, w: 2, d: 2, h: -1 }), () => terrain.pop());
    }
  }
  // Nothing in the way yet (flat ground, a wall outside the box): a wall inside the box, off the route.
  if (!obstacles(spec()).length && !terrainInWay(spec()).length) {
    const target0 = parts.find((p) => p.id === target)!;
    const visited = new Set(track(run(spec())).map((s) => `${cellOf(s.x)},${cellOf(s.z)}`));
    const spots: { x: number; z: number }[] = [];
    for (let x = Math.min(ball.x, target0.x); x <= Math.max(ball.x, target0.x); x++) for (let z = Math.min(ball.z, target0.z); z <= Math.max(ball.z, target0.z); z++) {
      if (!visited.has(`${x},${z}`) && !parts.some((p) => p.x === x && p.z === z)) spots.push({ x, z });
    }
    for (let k = 0; k < 4 && spots.length; k++) {
      const at = spots.splice(Math.floor(rand() * spots.length), 1)[0];
      const wall: Part = { id: id(names.scenery, 'wall') + (parts.some((p) => p.kind === 'wall') ? '2' : ''), kind: 'wall', x: at.x, y: groundAt(spec().terrain, at.x, at.z), z: at.z, yaw: 0, fixed: true };
      if (keepIf(() => parts.push(wall), () => parts.pop())) break;
    }
  }
  const final = done as MachineSpec;
  const withSpares: MachineSpec = { ...final, spares: graph.spares?.length ? graph.spares : defaultSpares(final, pick) };
  const lp = layoutProblems(withSpares, { flat: opts.flat });
  if (lp.length) return why(lp[0].slice(0, 140));
  // A level needs something to build: without the route it must fail.
  if (!makeConnectPuzzle(withSpares)) return why('no connect puzzle');
  return withSpares;
}

/** Two spares the route does not use, so the bin has a decoy and another way. */
function defaultSpares(spec: MachineSpec, pick: <T>(xs: readonly T[]) => T): MachineSpec['spares'] {
  const used = new Set(spec.parts.map((p) => p.kind));
  const pool = (['trampoline', 'fan', 'ramp', 'platform', 'wall', 'cannon'] as const).filter((k) => !used.has(k) || k === 'ramp' || k === 'platform');
  const a = pick(pool);
  const b = pick(pool.filter((k) => k !== a));
  return [a, b].map((kind) => (kind === 'platform' ? { kind, length: 3 } : { kind }));
}
