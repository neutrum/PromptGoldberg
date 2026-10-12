import { DOMINO_DEFAULT, PLATFORM_DEFAULT } from './kit';
import { restingHeight } from './placement';
import type { MachineSpec, Part } from './schema';

/** How far apart (cells, |dx| + |dy| + |dz|) the ball and the farthest goal part must be: a level is a route, not a nudge. */
export const SPREAD_MIN = 10;
/** The farthest target is at least this far from the ball along x AND along z, so the route has to turn a corner. */
export const TURN_MIN = 4;

/** The distance from the ball to the farthest goal part, in cells along the axes. */
export function spread(spec: MachineSpec): number {
  const ball = spec.parts.find((p) => p.kind === 'ball');
  if (!ball) return 0;
  let best = 0;
  for (const g of spec.goal) {
    const p = spec.parts.find((q) => q.id === g.part);
    if (p) best = Math.max(best, Math.abs(p.x - ball.x) + Math.abs(p.y - ball.y) + Math.abs(p.z - ball.z));
  }
  return best;
}

/**
 * Why a design is not a level yet: the goal sits right next to the start, or a part floats where
 * no hand could put it. Empty when it is fine.
 */
export function layoutProblems(spec: MachineSpec): string[] {
  const problems: string[] = [];
  const d = spread(spec);
  const ball = spec.parts.find((p) => p.kind === 'ball');
  const target = farthestTarget(spec);
  if (d < SPREAD_MIN) {
    problems.push(`the farthest goal part is only ${d} cells from the ball (x ${ball?.x}, y ${ball?.y}, z ${ball?.z}); it must be at least ${SPREAD_MIN} cells away counting x, y and z, so the player has a route to build. Move the goal parts across the stage and add parts (shelves, a cannon, a fan, a second ramp) to carry the ball there`);
  }
  if (ball && target && (Math.abs(target.x - ball.x) < TURN_MIN || Math.abs(target.z - ball.z) < TURN_MIN)) {
    problems.push(`the farthest target "${target.id}" (x ${target.x}, z ${target.z}) is straight ahead of the ball (x ${ball.x}, z ${ball.z}): the route must turn a corner. Put it at least ${TURN_MIN} cells away along x AND ${TURN_MIN} along z, and turn the route with a cannon or fan facing 90 or 270, or a ramp and shelf running along z`);
  }
  for (const p of spec.parts) {
    if (p.kind === 'ball' || p.kind === 'platform') continue;
    const rest = restingHeight(spec.parts, p.x, p.z);
    if (p.y !== rest) problems.push(`"${p.id}" (${p.kind}) floats at y ${p.y}: nothing is under it at that height (it would rest at y ${rest}). Set its y to ${rest}, or add a platform whose cells include (${p.x}, ${p.z}) with y ${p.y}`);
  }
  if (!obstacles(spec).length) {
    const ball = spec.parts.find((p) => p.kind === 'ball');
    const target = farthestTarget(spec);
    problems.push(`no scenery in the way: add a wall with "fixed": true standing between the ball (x ${ball?.x}, z ${ball?.z}) and the farthest target (x ${target?.x}, z ${target?.z}), in the ball's path, so the route has to go over or around it`);
  }
  return problems;
}

/** The goal part farthest from the ball. */
export function farthestTarget(spec: MachineSpec): Part | undefined {
  const ball = spec.parts.find((p) => p.kind === 'ball');
  if (!ball) return undefined;
  let best: { p: Part; d: number } | null = null;
  for (const g of spec.goal) {
    const p = spec.parts.find((q) => q.id === g.part);
    if (!p) continue;
    const d = Math.abs(p.x - ball.x) + Math.abs(p.y - ball.y) + Math.abs(p.z - ball.z);
    if (!best || d > best.d) best = { p, d };
  }
  return best?.p;
}

/** Fixed walls standing in the box between the ball and the farthest target: what the route must get past. */
export function obstacles(spec: MachineSpec): Part[] {
  const ball = spec.parts.find((p) => p.kind === 'ball');
  const target = farthestTarget(spec);
  if (!ball || !target) return [];
  const x0 = Math.min(ball.x, target.x), x1 = Math.max(ball.x, target.x);
  const z0 = Math.min(ball.z, target.z), z1 = Math.max(ball.z, target.z);
  return spec.parts.filter((p) => p.fixed && p.kind === 'wall' && p.x >= x0 && p.x <= x1 && p.z >= z0 && p.z <= z1);
}

/** Kinds that are targets when the goal names them; while a design streams in, these are the parts safe to show. */
export const TARGET_KINDS: Part['kind'][] = ['ball', 'bucket', 'bell', 'dominoes'];

/** The ball and the targets: the goal parts that are a destination (bucket, bell, dominoes), not a touch on the way. */
export function targetParts(spec: MachineSpec): Set<string> {
  const ids = new Set<string>();
  for (const p of spec.parts) if (p.kind === 'ball') ids.add(p.id);
  for (const g of spec.goal) if (g.type !== 'touch') ids.add(g.part);
  return ids;
}

/**
 * Player-facing names: the kind, numbered in order of appearance when the machine has more than
 * one of it ("dominoes #2"). Ids are the AI's; these are what the player clicks and types.
 */
export function partNames(parts: Part[]): Map<string, string> {
  const total = new Map<string, number>();
  for (const p of parts) total.set(p.kind, (total.get(p.kind) ?? 0) + 1);
  const seen = new Map<string, number>();
  const names = new Map<string, string>();
  for (const p of parts) {
    const n = (seen.get(p.kind) ?? 0) + 1;
    seen.set(p.kind, n);
    names.set(p.id, (total.get(p.kind) ?? 1) > 1 ? `${p.kind} #${n}` : p.kind);
  }
  return names;
}

/**
 * The parts an edit may not touch: the ball and the targets. The player builds the route between
 * them, so "move the ball above the bucket" would end the game, not play it. A part the ball only
 * has to touch on the way (a seesaw, a cannon) is mechanism, and may move.
 */
export function lockedParts(spec: MachineSpec): Set<string> {
  return targetParts(spec);
}

const length = (p: Part) => p.length ?? (p.kind === 'dominoes' ? DOMINO_DEFAULT : p.kind === 'platform' ? PLATFORM_DEFAULT : undefined);

/** Where a part stands and faces, in cells; fine offsets (the optimizer's) do not count. */
export function samePlace(a: Part, b: Part): boolean {
  // Unparsed specs may leave yaw out; it means 0.
  return a.kind === b.kind && a.x === b.x && a.y === b.y && a.z === b.z && (a.yaw ?? 0) === (b.yaw ?? 0) && length(a) === length(b);
}

/**
 * Why an edited machine breaks the lock, one line per problem; empty when it is fair. Every
 * locked part must still be there unchanged, and every original goal step must still be in the
 * goal, in order (a bell may ring more times, never fewer; new steps may be added).
 */
export function lockProblems(original: MachineSpec, edited: MachineSpec): string[] {
  const problems: string[] = [];
  const names = partNames(original.parts);
  const now = new Map(edited.parts.map((p) => [p.id, p]));
  for (const id of lockedParts(original)) {
    const was = original.parts.find((p) => p.id === id);
    if (!was) continue;
    const where = `kind ${was.kind}, x ${was.x}, y ${was.y}, z ${was.z}, yaw ${was.yaw}${length(was) !== undefined ? `, length ${length(was)}` : ''}`;
    const part = now.get(id);
    if (!part) problems.push(`"${id}" (the ${names.get(id)}) is fixed but was removed: put it back exactly as it was (${where})`);
    else if (!samePlace(was, part)) problems.push(`"${id}" (the ${names.get(id)}) is fixed but was changed: keep it exactly as it was (${where})`);
  }
  let j = 0;
  for (const g of original.goal) {
    while (j < edited.goal.length && !(edited.goal[j].type === g.type && edited.goal[j].part === g.part)) j++;
    const step = edited.goal[j];
    if (!step) {
      problems.push(`goal step "${g.type} ${g.part}" was dropped: every original goal step stays, in the same order (new steps may be added)`);
      break;
    }
    if (g.type === 'bell' && step.type === 'bell' && step.times < g.times) problems.push(`the bell "${g.part}" rang ${g.times} time(s) before and may not ring fewer`);
    j++;
  }
  return problems;
}
