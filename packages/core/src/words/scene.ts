/**
 * Changing the level in words: "build a fence around the tomb", "put three rocks next to the
 * ball", "a wall between the fan and the cave". What it builds is scenery, part of the level the
 * ball has to deal with (fixed, with honest colliders), never a mechanism from the tray.
 */
import { footprint } from '../kit';
import { libraryFromWords, type Hero, type ObstacleProp } from '../landscape';
import { partNames, partsNamed } from '../names';
import { inStage, type Part, type Stage, type Terrain, type Yaw } from '../schema';
import { groundAt } from '../terrain';
import { cellsAround, yawToward } from './build';

export type SceneMove = { parts: Part[]; what: string } | { remove: string[]; what: string } | { error: string };
const REMOVE = /^(?:please\s+)?(?:remove|delete|take away|take out|get rid of|clear away|destroy|knock down|demolish|tear down)\s+(?:all\s+)?(?:of\s+)?(?:the\s+)?(.+)$/;

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
/** The worlds' centrepieces, which have their own shapes and models: a plain "ship" or "dragon" is one of these. */
const HERO_WORDS: [RegExp, Hero][] = [
  [/\b(dragons?)\b/, 'dragon'], [/\b(castles?)\b/, 'castle'], [/\b(ships?|boats?)\b/, 'ship'], [/\b(robots?)\b/, 'robot'],
  [/\b(rockets?|space ?ships?)\b/, 'rocket'], [/\b(windmills?)\b/, 'windmill'], [/\b(teapots?)\b/, 'teapot'],
];
const RELATION =/\b(?:around|round|surrounding|next to|beside|by|near|in front of|before|behind|between|at|from|to|towards?|along|across|through|over|onto|on|into|in)\b/;
/** Where a clause starts that says more about the thing: "a road that connects the start with house #1". */
const CLAUSE = /\b(?:that|which|with|and|connect\w*|link\w*|join\w*|leading|going|running)\b/;
const SURFACE = /\b(?:roads?|streets?|paths?|pathways?|pavements?|sidewalks?|lanes?|driveways?|carpets?|rugs?|lawns?|parking|tracks?|floors?)\b/;
const PLACING = /^(?:please\s+)?(?:(?:put|place|add|build|plant|set|stand|erect|raise|drop|bring|create|surround|fence|wall)\b|(?:make\s+)?(?:a|an|one|two|three|four|five|six|some|few|several)\s)/;
const COUNT: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, some: 3, few: 3, several: 4 };
const key = (x: number, z: number) => `${x},${z}`;

/** The board thing a phrase names (labels, kinds, obstacles, the landmark), or null. */
function named(phrase: string, parts: Part[]): Part | null {
  // A numbered name ("train station #2", from a click on the board) is that one exactly.
  const exact = partsNamed(phrase, parts)[0];
  if (exact) return exact;
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
  const gone = REMOVE.exec(text);
  if (gone) return removeScenery(gone[1], /\ball\b/.test(text), ctx.parts);
  // What to build is named before the place it goes: "a fence around the station" builds a fence, not a station.
  const head = text.split(RELATION)[0].split(CLAUSE)[0];
  // Something flat on the ground (a road, a carpet) is the AI's: it lies on the ground, it is no obstacle.
  if (SURFACE.test(head)) return null;
  // A named thing from the library (a statue, a station) stands on the board as one composed obstacle.
  // Only words that put something somewhere build it: "make the castle tower taller" goes to the AI instead.
  if (!PLACING.test(head)) return null;
  const item = libraryFromWords(head);
  if (item) return placeItem(text, item.name, (x, y, z, yaw) => ({ id: `scene-${item.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now() % 100000}`, kind: 'wall', x, y, z, yaw, fixed: true, prop: 'landmark', build: item.shapes, label: item.name }), ctx);
  const hero = HERO_WORDS.find(([re]) => re.test(head))?.[1];
  if (hero) return placeItem(text, hero, (x, y, z, yaw) => ({ id: `scene-${hero}-${Date.now() % 100000}`, kind: 'wall', x, y, z, yaw, fixed: true, prop: hero }), ctx);
  const thing = THINGS.find(([re]) => re.test(head));
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
  const rel = /\b(around|round|surrounding|next to|beside|by|near|in front of|before|behind|between)\s+(?:the\s+)?([a-z][a-z0-9# -]*?)(?:\s+and\s+(?:the\s+)?([a-z][a-z0-9# -]*?))?$/.exec(text);
  // No place said: next to the middle of the way from the ball to the goal, where it matters.
  const target = rel ? named(rel[2], ctx.parts) : ({ id: '', kind: 'wall', y: 0, yaw: 0, ...midRoute(ctx) } as Part);
  if (!target) return { error: `I can't find "${rel![2]}" on the board.` };
  const how = rel?.[1] ?? 'near';
  const cells = footprint(target);
  const amount = COUNT[/\b(a|an|one|two|three|four|five|six|some|few|several)\b/.exec(text)?.[1] ?? ''] ?? (/s\b/.test(text.split(' ').find((w) => thing[0].test(w)) ?? '') ? 3 : 1);
  const out: Part[] = [];
  if (/^(around|round|surrounding)$/.test(how)) {
    // A ring one cell out round the thing's footprint; fences and walls run along each side.
    const xs = cells.map((c) => c.x), zs = cells.map((c) => c.z);
    const x0 = Math.min(...xs) - 1, x1 = Math.max(...xs) + 1, z0 = Math.min(...zs) - 1, z1 = Math.max(...zs) + 1;
    const spacing = prop === 'fence' || prop === 'wall' ? 1 : 2;
    for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
      const edge = x === x0 || x === x1 || z === z0 || z === z1;
      if (!edge || !open(x, z) || ((x + z) % spacing && spacing > 1)) continue;
      out.push(make(x, z, (z === z0 || z === z1) && x !== x0 && x !== x1 ? 90 : 0));
    }
  } else if (how === 'between') {
    const other = rel?.[3] ? named(rel[3], ctx.parts) : null;
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
    const side = /^(in front of|before)$/.test(how) ? ball : how === 'behind' && ball ? { x: 2 * target.x - ball.x, z: 2 * target.z - ball.z } : undefined;
    const facing = side ? yawToward(target, side) : 0;
    const wallish = prop === 'fence' || prop === 'wall';
    for (const c of cellsAround({ x: cells[0].x, z: cells[0].z }, true, side)) {
      if (out.length >= (wallish ? Math.max(3, amount) : amount)) break;
      if (cells.some((d) => d.x === c.x && d.z === c.z) || !open(c.x, c.z)) continue;
      out.push(make(c.x, c.z, wallish ? (((facing / 90) % 2) ? 90 : 0) as Yaw : 0));
    }
  }
  const where = rel ? `${how} the ${target.label ?? target.prop ?? target.kind}` : 'on the way to the goal';
  if (!out.length) return { error: `There is no free ground ${where} for a ${what}.` };
  return { parts: out, what: `${out.length > 1 ? `${out.length} ` : 'A '}${what}${out.length > 1 && !/s$/.test(what) && what !== 'fence' ? 's' : ''}${what === 'fence' && out.length > 1 ? ' panels' : ''} ${where}` };
}

/** Halfway between the ball and the goal: where a thing named with no place goes, in the picture and in play. */
function midRoute(ctx: { parts: Part[]; stage: Stage }) {
  const ball = ctx.parts.find((p) => p.kind === 'ball'), goal = ctx.parts.find((p) => p.kind === 'bucket' || p.kind === 'bell');
  return ball && goal ? { x: Math.round((ball.x + goal.x) / 2), z: Math.round((ball.z + goal.z) / 2) } : { x: Math.floor(ctx.stage.x / 2), z: Math.floor(ctx.stage.z / 2) };
}

/** A composed thing (a library thing, a centrepiece) beside the thing named, in the nearest spot its whole footprint fits. */
function placeItem(text: string, name: string, make: (x: number, y: number, z: number, yaw: Yaw) => Part, ctx: { parts: Part[]; stage: Stage; terrain?: Terrain[] }): SceneMove {
  const rel = /\b(next to|beside|by|near|in front of|behind|around|at)\s+(?:the\s+)?([a-z][a-z0-9# -]*?)$/.exec(text);
  const target = rel ? named(rel[2], ctx.parts) : null;
  if (rel && !target) return { error: `I can't find "${rel[2]}" on the board.` };
  const busy = new Set(ctx.parts.flatMap((p) => footprint(p).map((c) => key(c.x, c.z))));
  // Beside the thing named, else on the way from the ball to the goal; the nearest spot first.
  const from = target ? footprint(target)[0] : midRoute(ctx);
  // Big things (a ship, a castle) may need to look further out, and either way round.
  for (const c of cellsAround(from, !!target, undefined, 8)) for (const yaw of [0, 90] as Yaw[]) {
    const part = make(c.x, groundAt(ctx.terrain, c.x, c.z), c.z, yaw);
    if (footprint(part).every((f) => inStage(ctx.stage, f.x, f.z) && !busy.has(key(f.x, f.z)) && groundAt(ctx.terrain, f.x, f.z) === part.y)) {
      return { parts: [part], what: `The ${name}${target ? ` ${rel![1]} the ${target.label ?? target.prop ?? target.kind}` : ' on the way to the goal'}` };
    }
  }
  return { error: `There is no room on the board for the ${name}${target ? ` near the ${target.label ?? target.kind}` : ''}.` };
}

/**
 * Take scenery off the board: the level's obstacles, the fences and walls it was given, a
 * landmark. Never the ball, the goal or the ground they stand on. A numbered name ("rock #2", from
 * a click) is that one; a plain name is every one of it when there is only one or it says so.
 */
function removeScenery(phrase: string, all: boolean, parts: Part[]): SceneMove {
  const scenery = parts.filter((p) => p.fixed && p.kind === 'wall');
  const names = partNames(parts);
  const exact = partsNamed(phrase, parts);
  if (exact.length) {
    const ok = exact.filter((p) => scenery.includes(p));
    if (!ok.length) return { error: `The ${names.get(exact[0].id)} is not scenery: the ball, the goal and your own parts stay (take your parts back in the 🔧 Build box).` };
    return { remove: ok.map((p) => p.id), what: ok.map((p) => `The ${names.get(p.id)}`).join(', ').replace(/, (?=[^,]*$)/, ' and ') };
  }
  const best = named(phrase, scenery);
  if (!best) return { error: named(phrase, parts) ? `The ${phrase} is not scenery: the ball, the goal and your own parts stay.` : `I can't find "${phrase}" on the board.` };
  const baseOf = (p: Part) => (names.get(p.id) ?? '').replace(/ #\d+$/, '');
  const base = baseOf(best);
  const same = scenery.filter((p) => baseOf(p) === base);
  const last = phrase.trim().split(/\s+/).at(-1) ?? '';
  const plural = all || (last.endsWith('s') && !base.endsWith(last));
  if (same.length > 1 && !plural && base !== 'fence') return { error: `There are ${same.length} of the ${base}: click one to name it (${base} #2), or say "remove all the ${base}s".` };
  return { remove: same.map((p) => p.id), what: same.length > 1 ? `${same.length} ${base}${base === 'fence' ? ' panels' : 's'}` : `The ${base}` };
}
