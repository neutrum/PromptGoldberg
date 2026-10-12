/**
 * Placing parts by hand: a part dropped on a column lands on the floor or on the highest platform
 * under the cursor, and cannot go where another part already stands. A platform is a shelf on
 * posts: it goes at whatever height the player chooses, so parts can be stood on it.
 */
import { footprint } from './kit';
import { GRID, type Part } from './schema';

/** Height (in cells) a part placed at column (x, z) rests at: the floor, or the top of the highest platform there. */
export function restingHeight(parts: Part[], x: number, z: number, ignoreId?: string): number {
  let y = 0;
  for (const p of parts) {
    if (p.kind !== 'platform' || p.id === ignoreId) continue;
    if (p.y > y && footprint(p).some((c) => c.x === x && c.z === z)) y = p.y;
  }
  return y;
}

/** True when a part other than a platform already stands in that cell at that height. */
export function cellTaken(parts: Part[], x: number, y: number, z: number, ignoreId?: string): boolean {
  return parts.some((p) => p.kind !== 'platform' && p.id !== ignoreId && p.y === y && footprint(p).some((c) => c.x === x && c.z === z));
}

/** A part is "supported" when it stands where a hand-placed part would land: on the floor or on a platform. Shelves stand on their own posts. */
export function isSupported(parts: Part[], part: Part): boolean {
  return part.kind === 'ball' || part.kind === 'platform' || part.y === restingHeight(parts, part.x, part.z, part.id);
}

/** The platforms a part stands on (its own height, covering its cell). */
export function supportsOf(parts: Part[], part: Part): Part[] {
  if (part.kind === 'platform' || part.y === 0) return [];
  return parts.filter((p) => p.kind === 'platform' && p.id !== part.id && p.y === part.y && footprint(p).some((c) => c.x === part.x && c.z === part.z));
}

/**
 * Where a hand-placed part lands at column (x, z), or null when something is in the way. A platform
 * goes at `y` (default: where it would rest), so shelves can be put up at any height.
 */
export function dropAt(parts: Part[], part: Part, x: number, z: number, opts: { y?: number } = {}): Part | null {
  const shelf = part.kind === 'platform';
  const y = shelf ? Math.max(0, Math.min(GRID.y - 1, opts.y ?? restingHeight(parts, x, z, part.id))) : restingHeight(parts, x, z, part.id);
  const placed: Part = { ...part, x, y, z, dx: undefined, dz: undefined };
  const others = parts.filter((p) => p.id !== part.id);
  // A shelf may share cells with what stands on it; anything else needs its cells free.
  if (!shelf && footprint(placed).some((c) => cellTaken(others, c.x, y, c.z))) return null;
  return placed;
}
