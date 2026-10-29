/**
 * A level without a solution: the stage the AI's idea describes (where the ball starts, the goal,
 * the ground, the world, its landmark and obstacles) laid out with no physics and no route. The
 * player builds the way; the AI only solves it when the player asks. What it guarantees instead
 * is room to play: the start and the goal stand clear, and a floor path from where the ball comes
 * down to the goal is never blocked by an obstacle.
 */
import { deepen, RouteGraph, worldProps, type Difficulty, type RouteGraphInput } from './compile';
import { facing, footprint, KIT } from './kit';
import { mulberry32 } from './nudge';
import { CELL, GRID, inStage as onStage, TERRAIN_MIN, type MachineGoal, type MachineSpec, type Part, type Stage, type Terrain, type Yaw } from './schema';
import { groundAt } from './terrain';

export interface LevelOptions {
  seed?: number;
  stage?: Stage;
  difficulty?: Difficulty;
  /** Flat ground only (the mission said so). */
  flat?: boolean;
}

/** Share of the free board the world's obstacles cover, by difficulty. */
const FILL: Record<Difficulty, number> = { easy: 0.04, normal: 0.07, hard: 0.11 };

const key = (x: number, z: number) => `${x},${z}`;

/** Lay the level out. Never fails: every graph gives a playable stage. */
export function layoutLevel(input: RouteGraphInput, opts: LevelOptions = {}): MachineSpec {
  const graph = RouteGraph.parse(input);
  const S = opts.stage ?? { x: GRID.x, z: GRID.z };
  const rand = mulberry32(opts.seed ?? 1);
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)];
  const inStage = (x: number, z: number) => onStage(S, x, z);
  const names = graph.names ?? {};
  const id = (word: string | undefined, fallback: string) => (word ?? fallback).toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 16) || fallback;
  const parts: Part[] = [];
  const terrain: Terrain[] = [];
  const goal: MachineGoal[] = [];
  const fresh = (base: string) => { let out = base; for (let k = 2; parts.some((p) => p.id === out); k++) out = `${base}${k}`; return out; };

  // The start: the ball on a high shelf (or a hill) near one side, a ramp under it pointing into the board.
  const yaw: Yaw = rand() < 0.5 ? 0 : 180;
  const sx = yaw === 0 ? 1 + Math.floor(rand() * 2) : S.x - 2 - Math.floor(rand() * 2);
  const sz = rand() < 0.5 ? 2 + Math.floor(rand() * 3) : S.z - 3 - Math.floor(rand() * 3);
  const hill = !opts.flat && graph.start === 'hill';
  const shelfLen = 3 + Math.floor(rand() * 2);
  const f = facing(yaw);
  let height: number;
  if (hill) {
    height = 2 + Math.floor(rand() * 2);
    const x0 = yaw === 0 ? sx - 1 : sx - shelfLen;
    terrain.push({ name: names.ground ?? 'hill', x: Math.max(0, x0), z: Math.max(0, sz - 1), w: shelfLen + 2, d: 3, h: height });
    parts.push({ id: id(names.ball, 'ball'), kind: 'ball', x: sx, y: height + 1, z: sz, yaw: 0 });
    parts.push({ id: 'start-ramp', kind: 'ramp', x: sx, y: height, z: sz, yaw });
  } else {
    height = 3 + Math.floor(rand() * 2);
    parts.push({ id: id(names.ball, 'ball'), kind: 'ball', x: sx, y: height + 1, z: sz, yaw: 0 });
    parts.push({ id: 'start-ramp', kind: 'ramp', x: sx, y: height, z: sz, yaw });
    parts.push({ id: 'shelf', kind: 'platform', x: sx, y: height, z: sz, yaw, length: shelfLen, fixed: true });
  }
  // Where the ball comes down: just past the shelf's end.
  const drop = { x: sx + f[0] * (shelfLen + 1), z: sz + f[2] * (shelfLen + 1) };
  const startCells = new Set<string>();
  for (let k = -1; k <= shelfLen + 2; k++) for (const s of [-1, 0, 1]) {
    const x = sx + f[0] * k, z = sz + f[2] * k + s;
    startCells.add(key(x, z));
  }

  // The goal: far from the start, about the golden section of the board's diagonal, with room round it.
  const diag = Math.hypot(S.x, S.z);
  let best: { x: number; z: number; score: number } | null = null;
  for (let x = 2; x < S.x - 2; x++) for (let z = 2; z < S.z - 2; z++) {
    if (startCells.has(key(x, z))) continue;
    const d = Math.hypot(x - drop.x, z - drop.z);
    if (d < 8) continue;
    const score = -Math.abs(d - diag * 0.55) + rand() * 3;
    if (!best || score > best.score) best = { x, z, score };
  }
  const g = best ?? { x: S.x - 3, z: S.z - 3 };
  const target = fresh(id(names.target, graph.end === 'bucket' ? 'bucket' : 'bell'));
  const toward: Yaw = Math.abs(drop.x - g.x) >= Math.abs(drop.z - g.z) ? (drop.x < g.x ? 180 : 0) : (drop.z < g.z ? 270 : 90);
  if (graph.end === 'bucket') {
    // Sunk in a pit so a rolling ball can drop in as well as a flying one.
    const depth = opts.flat ? 0 : -1;
    if (depth < 0 && depth >= TERRAIN_MIN) terrain.push({ name: names.ground ?? 'pit', x: g.x, z: g.z, w: 1, d: 1, h: depth });
    parts.push({ id: target, kind: 'bucket', x: g.x, y: depth, z: g.z, yaw: 0 });
    goal.push({ type: 'bucket', part: target });
  } else if (graph.end === 'bell') {
    parts.push({ id: target, kind: 'bell', x: g.x, y: 0, z: g.z, yaw: 0 });
    goal.push({ type: 'bell', part: target, times: graph.rings });
  } else {
    // A row of dominoes leading away from where the ball comes from, the bell past its last one.
    const n = Math.min(graph.row ?? 5, 8);
    const away = ((toward + 180) % 360) as Yaw;
    const a = facing(away);
    const gap = KIT.domino.spacing / CELL;
    const reachCells = (n - 1) * gap + 1.08;
    const end = { x: g.x + Math.round(a[0] * reachCells), z: g.z + Math.round(a[2] * reachCells) };
    if (inStage(end.x, end.z)) {
      const row = fresh('row');
      parts.push({ id: row, kind: 'dominoes', x: g.x, y: 0, z: g.z, yaw: away, length: n });
      parts.push({ id: target, kind: 'bell', x: end.x, y: 0, z: end.z, yaw: 0 });
      goal.push({ type: 'topple', part: row }, { type: 'bell', part: target, times: graph.rings });
    } else {
      parts.push({ id: target, kind: 'bell', x: g.x, y: 0, z: g.z, yaw: 0 });
      goal.push({ type: 'bell', part: target, times: graph.rings });
    }
  }
  const goalCells = new Set<string>();
  for (const p of parts.slice(hill ? 2 : 3)) for (const c of footprint(p)) for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) goalCells.add(key(c.x + dx, c.z + dz));

  // Shaped ground between them: a river across the way, or a pit in the middle.
  if (!opts.flat && graph.ground === 'river') {
    const alongX = Math.abs(g.x - drop.x) >= Math.abs(g.z - drop.z);
    const mid = Math.round(alongX ? (g.x + drop.x) / 2 : (g.z + drop.z) / 2);
    const band: Terrain = alongX ? { name: names.ground ?? 'river', x: mid, z: 0, w: 2, d: S.z, h: -1 } : { name: names.ground ?? 'river', x: 0, z: mid, w: S.x, d: 2, h: -1 };
    const cells = (t: Terrain) => { const out: string[] = []; for (let x = t.x; x < t.x + t.w; x++) for (let z = t.z; z < t.z + t.d; z++) out.push(key(x, z)); return out; };
    if (!cells(band).some((c) => startCells.has(c) || goalCells.has(c))) terrain.push(band);
  } else if (!opts.flat && graph.ground === 'pit') {
    const px = Math.round((g.x + drop.x) / 2), pz = Math.round((g.z + drop.z) / 2);
    if (!startCells.has(key(px, pz)) && !goalCells.has(key(px, pz))) terrain.push({ name: names.ground ?? 'pit', x: px, z: pz, w: 2, d: 2, h: -1 });
  }

  // A clear floor path from where the ball comes down to the goal: obstacles never go on it or next to it.
  const floor = (x: number, z: number) => inStage(x, z) && groundAt(terrain, x, z) === 0;
  const path = new Set<string>();
  {
    const from = key(drop.x, drop.z), prev = new Map<string, string | null>([[from, null]]);
    const queue = [[drop.x, drop.z]];
    while (queue.length) {
      const [x, z] = queue.shift()!;
      if (Math.abs(x - g.x) + Math.abs(z - g.z) <= 1) {
        for (let k: string | null = key(x, z); k; k = prev.get(k) ?? null) path.add(k);
        break;
      }
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, nz = z + dz, k = key(nx, nz);
        if (prev.has(k) || !(floor(nx, nz) || groundAt(terrain, nx, nz) < 0)) continue;
        prev.set(k, key(x, z));
        queue.push([nx, nz]);
      }
    }
  }
  const keepClear = new Set([...startCells, ...goalCells]);
  for (const k of path) { const [x, z] = k.split(',').map(Number); for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) keepClear.add(key(x + dx, z + dz)); }
  const taken = () => new Set(parts.flatMap((p) => footprint(p).map((c) => key(c.x, c.z))));
  const free = (x: number, z: number, busy: Set<string>) => inStage(x, z) && !keepClear.has(key(x, z)) && !busy.has(key(x, z)) && groundAt(terrain, x, z) === 0;

  // The centrepiece in the biggest open area, near enough the middle to be seen.
  const landmark = graph.landscape?.landmark;
  const hero = landmark ? 'landmark' : graph.landscape?.hero;
  if (hero) {
    const busy = taken();
    let spot: { part: Part; score: number } | null = null;
    for (let x = 0; x < S.x; x++) for (let z = 0; z < S.z; z++) for (const turn of [0, 90, 180, 270] as Yaw[]) {
      const part: Part = { id: fresh(hero), kind: 'wall', x, y: 0, z, yaw: turn, fixed: true, prop: hero,
        ...(landmark ? { build: landmark.shapes, label: landmark.name } : hero === 'dragon' && graph.landscape ? { color: deepen(graph.landscape.accent) } : {}) };
      const cells = footprint(part);
      if (!cells.every((c) => free(c.x, c.z, busy))) continue;
      const cx = cells.reduce((a, c) => a + c.x, 0) / cells.length, cz = cells.reduce((a, c) => a + c.z, 0) / cells.length;
      const score = -Math.hypot(cx - S.x / 2, cz - S.z / 2) + rand() * 2;
      if (!spot || score > spot.score) spot = { part, score };
    }
    if (spot) parts.push(spot.part);
  }

  // The world's obstacles over the rest of the free board, no two side by side.
  const kinds = worldProps(graph.landscape).filter((k) => k !== 'hammer' && k !== 'wrench' && k !== 'screwdriver' && k !== 'pencil');
  const busy = taken();
  const cells: { x: number; z: number }[] = [];
  for (let x = 0; x < S.x; x++) for (let z = 0; z < S.z; z++) if (free(x, z, busy)) cells.push({ x, z });
  for (let i = cells.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [cells[i], cells[j]] = [cells[j], cells[i]]; }
  const want = Math.min(Math.round(FILL[opts.difficulty ?? 'normal'] * S.x * S.z), 30 - parts.length);
  const chosen: { x: number; z: number }[] = [];
  for (const c of cells) {
    if (chosen.length >= want) break;
    if (chosen.some((d) => Math.abs(d.x - c.x) <= 1 && Math.abs(d.z - c.z) <= 1)) continue;
    chosen.push(c);
  }
  chosen.forEach((c, i) => {
    const prop = kinds.length ? kinds[i % kinds.length] : pick(['rock', 'crate'] as const);
    parts.push({ id: fresh(`${prop}-f${i}`), kind: 'wall', x: c.x, y: 0, z: c.z, yaw: ([0, 90, 180, 270] as Yaw[])[i % 4], fixed: true, prop,
      ...(prop === 'tree' && graph.landscape ? { color: graph.landscape.foliage } : prop === 'rock' && graph.landscape ? { color: graph.landscape.rock } : prop === 'crystal' && graph.landscape ? { color: graph.landscape.accent } : {}) });
  });

  // The tray: one of each mechanism the idea names, a ramp, and the spares (at most six).
  const idea = graph.links.map((l) => l.via);
  const tray = [...idea, 'ramp' as const, ...(graph.spares ?? []).map((s) => s.kind)].slice(0, 6);
  return {
    title: graph.title,
    caption: graph.caption,
    closest: graph.closest,
    ...(opts.stage ? { stage: opts.stage } : {}),
    ...(graph.landscape ? { landscape: graph.landscape } : {}),
    ...(terrain.length ? { terrain } : {}),
    parts: parts.map((p) => ({ ...p, label: p.kind === 'ball' ? names.ball : p.kind === 'bucket' || p.kind === 'bell' ? names.target : p.prop && !p.label ? p.prop : p.label })),
    spares: tray.map((kind) => (kind === 'platform' ? { kind, length: 3 } : { kind })),
    par: idea.length + 1,
    goal,
    duration: 15,
  };
}
