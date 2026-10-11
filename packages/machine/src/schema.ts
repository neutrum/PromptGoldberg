import { z } from 'zod';

/** Side of one grid cell in metres. Parts snap to cells; the optimizer nudges within them. */
export const CELL = 0.5;
/** Stage size in cells (x and z are horizontal, y is up). */
export const GRID = { x: 24, y: 16, z: 24 } as const;

export const PartKind = z.enum([
  'ball', 'ramp', 'platform', 'wall', 'dominoes', 'seesaw', 'fan', 'trampoline', 'cannon', 'bucket', 'bell',
]);
export type PartKind = z.infer<typeof PartKind>;

/** Which way a part faces, degrees clockwise seen from above: 0 = +x, 90 = +z, 180 = -x, 270 = -z. */
export const Yaw = z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]);
export type Yaw = z.infer<typeof Yaw>;

export const Part = z.object({
  id: z.string().regex(/^[a-z0-9_-]+$/i).describe('short unique id'),
  kind: PartKind,
  x: z.number().int().min(0).max(GRID.x - 1).describe('cell along x (0 = west edge)'),
  y: z.number().int().min(0).max(GRID.y - 1).describe('height of the part\'s base in cells (0 = floor)'),
  z: z.number().int().min(0).max(GRID.z - 1).describe('cell along z (0 = north edge)'),
  yaw: Yaw.default(0).describe('facing: 0 = +x, 90 = +z, 180 = -x, 270 = -z. A ramp slopes DOWN toward its facing; fans blow and cannons fire toward it; dominoes and platforms extend toward it'),
  length: z.number().int().min(1).max(8).optional().describe('platforms: cells long (default 3); dominoes: how many (default 5)'),
  color: z.string().optional().describe('hex colour'),
  /** Fine offsets within the cell, set by the optimizer (fractions of a cell). */
  dx: z.number().min(-0.5).max(0.5).optional(),
  dz: z.number().min(-0.5).max(0.5).optional(),
});
export type Part = z.infer<typeof Part>;

export const BucketGoal = z.object({ type: z.literal('bucket'), part: z.string().describe('id of the bucket the ball must land in') });
export const BellGoal = z.object({
  type: z.literal('bell'), part: z.string().describe('id of the bell'),
  times: z.number().int().min(1).max(3).default(1).describe('how many rings'),
});
export const ToppleGoal = z.object({ type: z.literal('topple'), part: z.string().describe('id of a dominoes row that must fall over completely') });
export const TouchGoal = z.object({ type: z.literal('touch'), part: z.string().describe('id of any part the ball must touch or pass through (fan, cannon, trampoline, seesaw, ramp)') });

export const MachineGoal = z.discriminatedUnion('type', [BucketGoal, BellGoal, ToppleGoal, TouchGoal]);
export type MachineGoal = z.infer<typeof MachineGoal>;

export const MachineSpec = z.object({
  title: z.string(),
  caption: z.string().optional().describe('one sentence for players: what should happen, no numbers'),
  parts: z.array(Part).min(1).max(40),
  goal: z.array(MachineGoal).min(1).max(4).describe('ordered events; the machine works when all happen in order'),
  duration: z.number().min(4).max(30).default(15).describe('seconds to simulate'),
});
export type MachineSpec = z.infer<typeof MachineSpec>;
export type MachineSpecInput = z.input<typeof MachineSpec>;

export interface SpecIssue {
  path: string;
  message: string;
}

/** What zod cannot check: ids, references, exactly one ball. */
export function checkMachine(spec: MachineSpec): SpecIssue[] {
  const issues: SpecIssue[] = [];
  const ids = new Set<string>();
  spec.parts.forEach((p, i) => {
    if (ids.has(p.id)) issues.push({ path: `parts.${i}.id`, message: `duplicate id "${p.id}"` });
    ids.add(p.id);
  });
  const balls = spec.parts.filter((p) => p.kind === 'ball');
  if (balls.length !== 1) issues.push({ path: 'parts', message: `exactly one ball is needed (found ${balls.length})` });
  const byId = new Map(spec.parts.map((p) => [p.id, p]));
  spec.goal.forEach((g, i) => {
    const part = byId.get(g.part);
    if (!part) {
      issues.push({ path: `goal.${i}.part`, message: `unknown part "${g.part}"` });
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

export function parseMachine(input: unknown): ParseResult {
  const r = MachineSpec.safeParse(input);
  if (!r.success) return { ok: false, issues: r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) };
  const issues = checkMachine(r.data);
  return issues.length ? { ok: false, issues } : { ok: true, spec: r.data };
}
