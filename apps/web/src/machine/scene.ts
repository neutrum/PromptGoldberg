/**
 * Changing the level in words: "build a fence around the tomb", "put three rocks next to the
 * ball", "a wall between the fan and the cave". What it builds is scenery, part of the level the
 * ball has to deal with (fixed, with honest colliders), never a mechanism from the tray.
 */
import { footprint, groundAt, inStage, type ObstacleProp, type Part, type Stage, type Terrain, type Yaw } from '@og/machine';
import { cellsAround, yawToward } from './build';

export type SceneMove = { parts: Part[]; what: string } | { error: string };

const THINGS: [RegExp, ObstacleProp | 'wall', string][] = [
  [/\b(fences?|fencing|pickets?|railings?|palisades?)\b/, 'fence', 'fence'],
  [/\b(walls?|barriers?|barricades?)\b/, 'wall', 'wall'],
  [/\b(rocks?|boulders?|stones?)\b/, 'rock', 'rock'],
  [/\b(trees?|pines?)\b/, 'tree', 'tree'],
  [/\b(crates?|boxes|barrels?)\b/, 'crate', 'crate'],
  [/\b(columns?|pillars?|pillar)\b/, 'column', 'column'],
  [/\b(stumps?|logs?)\b/, 'stump', 'stump'],
  [/\b(cact(?:us|i))\b/, 'cactus', 'cactus'],
  [/\b(crystals?|gems?)\b/, 'crystal', 'crystal'],
];
const COUNT: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, some: 3, few: 3, several: 4 };
const key = (x: number, z: number) => `${x},${z}`;

/** The board thing a phrase names (labels, kinds, obstacles, the landmark), or null. */
function named(phrase: string, parts: Part[]): Part | null {
  const words = phrase.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w && !/^(the|a|an|my|of)$/.test(w));
  let best: Part | null = null, top = 0;
  for (const p of parts) {
    const names = [p.label, p.kind, p.prop, p.kind === 'ball' ? 'ball marble start' : '', p.kind === 'bucket' || p.kind === 'bell' ? 'goal target finish' : ''].join(' ').toLowerCase().split(/[\s-]+/);
    const s = words.filter((w) => names.some((n) => n === w || n === w.replace(/s$/, '') || (w.length > 3 && n.startsWith(w)))).length;
    // The goal wins ties: "the tomb" is more often the target than an obstacle called tomb.
    const score = s + (s && (p.kind === 'bucket' || p.kind === 'bell') ? 0.5 : 0);
    if (score > top) { best = p; top = score; }
  }
  return best;
}

/**
 * Read one change to the level. `parts` is everything on the board (the player's parts too, so
 * nothing lands on them). Null when the text names no scenery, so the AI can take it instead.
 */
export function readSceneMove(input: string, ctx: { parts: Part[]; stage: Stage; terrain?: Terrain[] }): SceneMove | null {
  const text = input.toLowerCase().trim().replace(/[.!?]+$/, '');
  const thing = THINGS.find(([re]) => re.test(text));
  if (!thing) return null;
  const [, prop, what] = thing;
  const busy = new Set(ctx.parts.flatMap((p) => footprint(p).map((c) => key(c.x, c.z))));
  const open = (x: number, z: number) => inStage(ctx.stage, x, z) && !busy.has(key(x, z)) && groundAt(ctx.terrain, x, z) >= -0;
  let n = 0;
  const make = (x: number, z: number, yaw: Yaw): Part => {
    busy.add(key(x, z));
    n++;
    return { id: `scene-${what}-${Date.now() % 100000}-${n}`, kind: 'wall', x, y: groundAt(ctx.terrain, x, z), z, yaw, fixed: true, ...(prop === 'wall' ? {} : { prop }) };
  };
  const rel = /\b(around|round|surrounding|next to|beside|by|near|in front of|before|behind|between)\s+(?:the\s+)?([a-z][a-z -]*?)(?:\s+and\s+(?:the\s+)?([a-z][a-z -]*?))?$/.exec(text);
  if (!rel) return { error: `Say where the ${what} goes: around, next to, in front of or between things on the board.` };
  const target = named(rel[2], ctx.parts);
  if (!target) return { error: `I can't find "${rel[2]}" on the board.` };
  const cells = footprint(target);
  const amount = COUNT[/\b(a|an|one|two|three|four|five|six|some|few|several)\b/.exec(text)?.[1] ?? ''] ?? (/s\b/.test(text.split(' ').find((w) => thing[0].test(w)) ?? '') ? 3 : 1);
  const out: Part[] = [];
  if (/^(around|round|surrounding)$/.test(rel[1])) {
    // A ring one cell out round the thing's footprint; fences and walls run along each side.
    const xs = cells.map((c) => c.x), zs = cells.map((c) => c.z);
    const x0 = Math.min(...xs) - 1, x1 = Math.max(...xs) + 1, z0 = Math.min(...zs) - 1, z1 = Math.max(...zs) + 1;
    const spacing = prop === 'fence' || prop === 'wall' ? 1 : 2;
    for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
      const edge = x === x0 || x === x1 || z === z0 || z === z1;
      if (!edge || !open(x, z) || ((x + z) % spacing && spacing > 1)) continue;
      out.push(make(x, z, (z === z0 || z === z1) && x !== x0 && x !== x1 ? 90 : 0));
    }
  } else if (rel[1] === 'between') {
    const other = rel[3] ? named(rel[3], ctx.parts) : null;
    if (!other) return { error: `Between the ${target.label ?? target.kind} and what? Say "between the X and the Y".` };
    // Across the middle of the line from one to the other, three cells wide.
    const mx = Math.round((target.x + other.x) / 2), mz = Math.round((target.z + other.z) / 2);
    const along = Math.abs(other.x - target.x) >= Math.abs(other.z - target.z);
    for (const k of [0, -1, 1, -2, 2]) {
      if (out.length >= Math.max(3, amount)) break;
      const x = along ? mx : mx + k, z = along ? mz + k : mz;
      if (open(x, z)) out.push(make(x, z, along ? 0 : 90));
    }
  } else {
    // Next to, in front of or behind: the nearest free cells, on the ball's side for "in front of".
    const ball = ctx.parts.find((p) => p.kind === 'ball');
    const side = /^(in front of|before)$/.test(rel[1]) ? ball : rel[1] === 'behind' && ball ? { x: 2 * target.x - ball.x, z: 2 * target.z - ball.z } : undefined;
    const facing = side ? yawToward(target, side) : 0;
    const wallish = prop === 'fence' || prop === 'wall';
    for (const c of cellsAround({ x: cells[0].x, z: cells[0].z }, true, side)) {
      if (out.length >= (wallish ? Math.max(3, amount) : amount)) break;
      if (cells.some((d) => d.x === c.x && d.z === c.z) || !open(c.x, c.z)) continue;
      out.push(make(c.x, c.z, wallish ? (((facing / 90) % 2) ? 90 : 0) as Yaw : 0));
    }
  }
  if (!out.length) return { error: `There is no free ground ${rel[1]} the ${target.label ?? target.kind} for a ${what}.` };
  return { parts: out, what: `${out.length > 1 ? `${out.length} ` : 'A '}${what}${out.length > 1 && !/s$/.test(what) && what !== 'fence' ? 's' : ''}${what === 'fence' && out.length > 1 ? ' panels' : ''} ${rel[1]} the ${target.label ?? target.prop ?? target.kind}` };
}
