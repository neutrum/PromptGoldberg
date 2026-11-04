/**
 * Placing parts by hand: a part dropped on a column lands on the ground (the floor, a bank, the
 * bottom of a ditch) or on the highest platform under the cursor, and cannot go where another
 * part already stands. A platform is a shelf on posts: it goes at whatever height the player
 * chooses, so parts can be stood on it. Coaster track stands on posts at a chosen height too, but
 * nothing stands in its cells.
 */
import { footprint } from './kit';
import { GRID, type Part, type PartKind, type Terrain } from './schema';

/** Parts the player puts at a height of their choosing, on their own posts: shelves and coaster track. */
export const onPosts = (kind: PartKind) => kind === 'platform' || kind === 'track' || kind === 'curve' || kind === 'descent' || kind === 'ascent';
import { groundAt } from './terrain';

/** Height (in cells) a part placed at column (x, z) rests at: the ground, or the top of the highest platform there. */
export function restingHeight(parts: Part[], x: number, z: number, ignoreId?: string, terrain?: Terrain[]): number {
  let y = groundAt(terrain, x, z);
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

/** A part is "supported" when it stands where a hand-placed part would land: on the ground or on a platform. Shelves stand on their own posts. */
export function isSupported(parts: Part[], part: Part, terrain?: Terrain[]): boolean {
  return part.kind === 'ball' || onPosts(part.kind) || part.y === restingHeight(parts, part.x, part.z, part.id, terrain);
}

/** The platforms a part stands on (its own height, covering its cell). */
export function supportsOf(parts: Part[], part: Part): Part[] {
  if (part.kind === 'platform' || part.y <= 0) return [];
  return parts.filter((p) => p.kind === 'platform' && p.id !== part.id && p.y === part.y && footprint(p).some((c) => c.x === part.x && c.z === part.z));
}

/**
 * Where a hand-placed part lands at column (x, z), or null when something is in the way. A platform
 * goes at `y` (default: where it would rest), so shelves can be put up at any height.
 */
export function dropAt(parts: Part[], part: Part, x: number, z: number, opts: { y?: number; terrain?: Terrain[] } = {}): Part | null {
  const shelf = part.kind === 'platform';
  const rest = restingHeight(parts, x, z, part.id, opts.terrain);
  const y = onPosts(part.kind) ? Math.max(groundAt(opts.terrain, x, z), Math.min(GRID.y - 1, opts.y ?? rest)) : rest;
  const placed: Part = { ...part, x, y, z, dx: undefined, dz: undefined };
  const others = parts.filter((p) => p.id !== part.id);
  // A shelf may share cells with what stands on it; anything else needs its cells free.
  if (!shelf && footprint(placed).some((c) => cellTaken(others, c.x, y, c.z))) return null;
  return placed;
}
