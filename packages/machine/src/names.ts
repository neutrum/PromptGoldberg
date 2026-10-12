import { DOMINO_DEFAULT, PLATFORM_DEFAULT } from './kit';
import type { MachineSpec, Part } from './schema';

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
 * The parts an edit may not touch: the ball and every part the goal names. The player builds
 * the chain between them, so "move the ball above the bucket" would end the game, not play it.
 */
export function lockedParts(spec: MachineSpec): Set<string> {
  const ids = new Set<string>();
  for (const p of spec.parts) if (p.kind === 'ball') ids.add(p.id);
  for (const g of spec.goal) ids.add(g.part);
  return ids;
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
