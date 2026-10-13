/**
 * The shape of the ground: rectangles of raised or sunken floor (a bank, a hill, a ditch, a river,
 * a pit). Scenery like the fixed walls: part of the level, never in the player's bin. Flat ground
 * is the absence of terrain, so a machine without any plays exactly as before.
 */
import { CELL, GRID, type Terrain } from './schema';

/** The ground height (cells) at a column; later blocks cover earlier ones. Flat ground is 0. */
export function groundAt(terrain: Terrain[] | undefined, x: number, z: number): number {
  let h = 0;
  for (const t of terrain ?? []) if (x >= t.x && x < t.x + t.w && z >= t.z && z < t.z + t.d) h = t.h;
  return h;
}

/** The lowest ground on the stage (0 when nothing is dug). */
export function lowestGround(terrain: Terrain[] | undefined): number {
  let low = 0;
  for (const t of terrain ?? []) low = Math.min(low, t.h);
  return low;
}

/** A rectangle of columns sharing one ground height: what the sim and the renderer build from. */
export interface GroundRun {
  x0: number;
  z0: number;
  w: number;
  d: number;
  h: number;
}

/**
 * The ground as rectangles of equal height, merged from the column map so overlapping blocks come
 * out right. Only columns whose height differs from `base` (default: the lowest ground) are returned;
 * the rest is the base slab.
 */
export function groundRuns(terrain: Terrain[] | undefined, base = lowestGround(terrain)): GroundRun[] {
  if (!terrain?.length) return [];
  const rows: GroundRun[] = [];
  for (let z = 0; z < GRID.z; z++) {
    let x = 0;
    while (x < GRID.x) {
      const h = groundAt(terrain, x, z);
      let x1 = x + 1;
      while (x1 < GRID.x && groundAt(terrain, x1, z) === h) x1++;
      if (h !== base) rows.push({ x0: x, z0: z, w: x1 - x, d: 1, h });
      x = x1;
    }
  }
  // Join identical runs on neighbouring rows into one rectangle.
  const runs: GroundRun[] = [];
  for (const r of rows) {
    const prev = runs.find((q) => q.x0 === r.x0 && q.w === r.w && q.h === r.h && q.z0 + q.d === r.z0);
    if (prev) prev.d += 1;
    else runs.push({ ...r });
  }
  return runs;
}

/** Terrain blocks whose columns overlap the box, and whose ground differs from flat. */
export function terrainInBox(terrain: Terrain[] | undefined, x0: number, x1: number, z0: number, z1: number): Terrain[] {
  return (terrain ?? []).filter((t) => t.h !== 0 && t.x <= x1 && t.x + t.w - 1 >= x0 && t.z <= z1 && t.z + t.d - 1 >= z0);
}

/** Words that make a sunken block read as water when drawn. */
export const WATER_WORDS = /\b(river|water|moat|lake|sea|pond|stream|canal|brook|lava)\b/i;

/** The world-space top of a run, in metres. */
export const groundTop = (h: number) => h * CELL;
