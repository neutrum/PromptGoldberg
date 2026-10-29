import { z } from 'zod';

/** Side of one grid cell in metres. Parts snap to cells; the optimizer nudges within them. */
export const CELL = 0.5;
/** Stage size in cells (x and z are horizontal, y is up). */
export const GRID = { x: 24, y: 16, z: 24 } as const;
/** How far the ground can be dug below the floor and raised above it, in cells. */
export const TERRAIN_MIN = -2;
export const TERRAIN_MAX = 3;

/** A rectangle of ground at another height: a ditch or river (negative), a bank or hill (positive). */
export const Terrain = z.object({
  name: z.string().optional().describe('what it is, in the player\'s words: "river", "moat", "pit", "hill", "bank"'),
  x: z.number().int().min(0).max(GRID.x - 1).describe('west-most cell'),
  z: z.number().int().min(0).max(GRID.z - 1).describe('north-most cell'),
  w: z.number().int().min(1).max(GRID.x).describe('cells along x'),
  d: z.number().int().min(1).max(GRID.z).describe('cells along z'),
  h: z.number().int().min(TERRAIN_MIN).max(TERRAIN_MAX).describe('ground height in cells: negative digs a ditch, river or pit below the floor; positive raises a bank or hill'),
});
export type Terrain = z.infer<typeof Terrain>;

export const PartKind = z.enum([
  'ball', 'ramp', 'platform', 'wall', 'dominoes', 'seesaw', 'fan', 'trampoline', 'cannon', 'bucket', 'bell',
]);
export type PartKind = z.infer<typeof PartKind>;

/** Cosmetic models only; the kit continues to define collision and behavior. */
export const LOOK_KINDS = ['ball', 'fan', 'bell', 'wall', 'dominoes'] as const;
export const LookKind = z.enum(LOOK_KINDS);
export type LookKind = z.infer<typeof LookKind>;
export const LookRef = z.object({ assetId: z.string().uuid() });

/** Which way a part faces, degrees clockwise seen from above: 0 = +x, 90 = +z, 180 = -x, 270 = -z. */
export const Yaw = z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]);
export type Yaw = z.infer<typeof Yaw>;

export const Part = z.object({
  id: z.string().regex(/^[a-z0-9_-]+$/i).describe('short unique id'),
  kind: PartKind,
  label: z.string().max(40).optional().describe('player-facing name, e.g. pizza, oven, castle wall; the kind still defines its physics'),
  x: z.number().int().min(0).max(GRID.x - 1).describe('cell along x (0 = west edge)'),
  y: z.number().int().min(TERRAIN_MIN).max(GRID.y - 1).describe('height of the part\'s base in cells (0 = flat floor; on raised ground the ground\'s h, in a ditch its negative h)'),
  z: z.number().int().min(0).max(GRID.z - 1).describe('cell along z (0 = north edge)'),
  yaw: Yaw.default(0).describe('facing: 0 = +x, 90 = +z, 180 = -x, 270 = -z. A ramp slopes DOWN toward its facing; fans blow and cannons fire toward it; dominoes and platforms extend toward it'),
  length: z.number().int().min(1).max(8).optional().describe('platforms: cells long (default 3); dominoes: how many (default 5)'),
  color: z.string().optional().describe('hex colour'),
  look: LookRef.optional().describe('Reserved for a player-applied appearance; never invent asset IDs'),
  /** Scenery: part of the level (an obstacle wall, a ledge), never handed to the player. Walls and platforms only. */
  fixed: z.boolean().optional().describe('scenery: a wall or shelf that is part of the level and stays on the stage; the player has to get past or use it'),
  /** Fine offsets within the cell, set by the optimizer (fractions of a cell). */
  dx: z.number().min(-0.5).max(0.5).optional(),
  dz: z.number().min(-0.5).max(0.5).optional(),
});
export type Part = z.infer<typeof Part>;

/** An extra part for the player's bin that the designer's own route does not use: a red herring, or another way. */
export const Spare = z.object({
  kind: PartKind.exclude(['ball']),
  length: z.number().int().min(1).max(8).optional().describe('platforms: cells long; dominoes: how many'),
});
export type Spare = z.infer<typeof Spare>;

export const BucketGoal = z.object({ type: z.literal('bucket'), part: z.string().describe('id of the bucket the ball must land in') });
export const BellGoal = z.object({
  type: z.literal('bell'), part: z.string().describe('id of the bell'),
  times: z.number().int().min(1).max(3).default(1).describe('how many rings'),
});
export const ToppleGoal = z.object({ type: z.literal('topple'), part: z.string().describe('id of a dominoes row that must fall over completely') });
export const TouchGoal = z.object({ type: z.literal('touch'), part: z.string().describe('id of any part the ball must touch or pass through (fan, cannon, trampoline, seesaw, ramp)') });

export const MachineGoal = z.discriminatedUnion('type', [BucketGoal, BellGoal, ToppleGoal, TouchGoal]);
export type MachineGoal = z.infer<typeof MachineGoal>;

/** A challenge on top of the goal: build it with few parts, or make the run last. */
export const Rules = z.object({
  maxParts: z.number().int().min(1).max(8).optional().describe('the player may place at most this many parts'),
  minSeconds: z.number().min(1).max(14).optional().describe('the last goal step must happen this many seconds in or later'),
});
export type Rules = z.infer<typeof Rules>;

export const MachineSpec = z.object({
  title: z.string(),
  caption: z.string().optional().describe('one sentence for players: what should happen, no numbers'),
  closest: z.string().optional().describe('only when the request could not be built as asked: one honest sentence for the player saying what was built instead'),
  terrain: z.array(Terrain).max(6).optional().describe('the shape of the ground: ditches, rivers, pits, banks and hills the route has to deal with; leave out for flat ground'),
  parts: z.array(Part).min(1).max(40),
  spares: z.array(Spare).max(4).optional().describe('2 or 3 extra parts for the player\'s bin that your route does not need, so there is more than one way and the player has to think'),
  goal: z.array(MachineGoal).min(1).max(4).describe('ordered events; the machine works when all happen in order'),
  duration: z.number().min(4).max(30).default(15).describe('seconds to simulate'),
  rules: Rules.optional().describe('challenge rules, set by the game, not the designer'),
});
export type MachineSpec = z.infer<typeof MachineSpec>;
export type MachineSpecInput = z.input<typeof MachineSpec>;

export interface SpecIssue {
  path: string;
  message: string;
}

export interface CheckOptions {
  /** Accept goals that name parts which are not there (a fix-it puzzle with its part pulled out). */
  allowMissingGoalParts?: boolean;
}

/** What zod cannot check: ids, references, exactly one ball. */
export function checkMachine(spec: MachineSpec, opts: CheckOptions = {}): SpecIssue[] {
  const issues: SpecIssue[] = [];
  const ids = new Set<string>();
  spec.parts.forEach((p, i) => {
    if (ids.has(p.id)) issues.push({ path: `parts.${i}.id`, message: `duplicate id "${p.id}"` });
    ids.add(p.id);
  });
  const balls = spec.parts.filter((p) => p.kind === 'ball');
  if (balls.length !== 1) issues.push({ path: 'parts', message: `exactly one ball is needed (found ${balls.length})` });
  // Two parts in one cell sit inside each other; only a platform may share a cell with what stands on it.
  const cells = new Map<string, string>();
  spec.parts.forEach((p, i) => {
    if (p.kind === 'platform') return;
    const key = `${p.x},${p.y},${p.z}`;
    const other = cells.get(key);
    if (other) issues.push({ path: `parts.${i}`, message: `"${p.id}" is in the same cell as "${other}"; give every part its own cell` });
    else cells.set(key, p.id);
  });
  spec.parts.forEach((p, i) => {
    if (p.look && !(LOOK_KINDS as readonly string[]).includes(p.kind)) issues.push({ path: `parts.${i}.look`, message: `custom looks are not supported on ${p.kind}` });
    if (p.fixed && p.kind !== 'wall' && p.kind !== 'platform') issues.push({ path: `parts.${i}.fixed`, message: `"${p.id}" is a ${p.kind}; only walls and platforms can be fixed scenery` });
  });
  const byId = new Map(spec.parts.map((p) => [p.id, p]));
  spec.goal.forEach((g, i) => {
    const part = byId.get(g.part);
    if (!part) {
      if (!opts.allowMissingGoalParts) issues.push({ path: `goal.${i}.part`, message: `unknown part "${g.part}"` });
      return;
    }
    const want: Record<MachineGoal['type'], PartKind[] | null> = { bucket: ['bucket'], bell: ['bell'], topple: ['dominoes'], touch: null };
    const kinds = want[g.type];
    if (kinds && !kinds.includes(part.kind)) issues.push({ path: `goal.${i}.part`, message: `"${g.part}" is a ${part.kind}, but a ${g.type} goal needs a ${kinds.join('/')}` });
    if (g.type === 'touch' && part.kind === 'ball') issues.push({ path: `goal.${i}.part`, message: 'the ball cannot touch itself' });
  });
  return issues;
}

export type ParseResult = { ok: true; spec: MachineSpec } | { ok: false; issues: SpecIssue[] };

export function parseMachine(input: unknown, opts: CheckOptions = {}): ParseResult {
  const r = MachineSpec.safeParse(input);
  if (!r.success) return { ok: false, issues: r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) };
  const issues = checkMachine(r.data, opts);
  return issues.length ? { ok: false, issues } : { ok: true, spec: r.data };
}
