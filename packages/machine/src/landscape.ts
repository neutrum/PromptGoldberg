/**
 * The world around the board: forests, hills, mountains and lakes in the player's words ("forests
 * and hills in British Columbia"), a giant workbench for a miniature machine, crystal caves, candy
 * lands. Looks only: nothing here has a collider, nothing stands on a cell of the board, and the
 * simulation never reads it. Shaped ground the ball has to deal with stays `terrain`, and what
 * stands in its way on the board are fixed obstacle props (rocks, tools) with their own colliders.
 */
import { z } from 'zod';

export const LANDSCAPE_FEATURES = [
  // Nature
  'conifers', 'broadleaf', 'birches', 'palms', 'cacti', 'bushes', 'flowers', 'mushrooms', 'reeds',
  'rocks', 'boulders', 'hills', 'mountains', 'lake', 'snowdrifts',
  // Fantasy and built things
  'crystals', 'columns', 'statues', 'houses', 'lanterns', 'candy', 'coral', 'cogs', 'ice_spikes', 'craters',
  // Giant everyday things, for a miniature machine in a real-size room
  'tools', 'wrenches', 'pencils', 'screws', 'nuts', 'mugs', 'books', 'lamp', 'pegboard',
] as const;
export type LandscapeFeature = (typeof LANDSCAPE_FEATURES)[number];

/** Small fixed obstacles on the board, each with its own collider and drawn exactly as it collides. */
export const OBSTACLE_PROPS = [
  'rock', 'crate', 'tree', 'cactus', 'stump', 'crystal', 'column',
  'nut', 'bolt', 'tape', 'spool', 'hammer', 'wrench', 'screwdriver', 'pencil',
] as const;
/** One big low-poly landmark lying on the board: the world's centrepiece, solid where the ball can reach. */
export const HEROES = ['dragon', 'castle', 'ship', 'robot', 'rocket', 'windmill', 'teapot'] as const;
export type Hero = (typeof HEROES)[number];
/** Everything a fixed wall can be instead of a wall. */
export const ObstacleProp = z.enum([...OBSTACLE_PROPS, ...HEROES]);
export type ObstacleProp = z.infer<typeof ObstacleProp>;
/** How much bigger than their modelled size the landmarks stand, so they read from the default camera. */
export const HERO_SCALE = 1.5;
/** Cells a prop covers: along its facing, then across it. Everything not listed fills one cell. */
export const PROP_SIZE: Partial<Record<ObstacleProp, [number, number]>> = {
  hammer: [2, 1], wrench: [2, 1], screwdriver: [2, 1], pencil: [3, 1],
  dragon: [10, 4], castle: [6, 6], ship: [9, 3], robot: [3, 3], rocket: [3, 3], windmill: [3, 3], teapot: [4, 4],
};
/** Tools lie across several cells along their facing (kept for the prompts). */
export const PROP_LENGTH: Partial<Record<ObstacleProp, number>> = { hammer: 2, wrench: 2, screwdriver: 2, pencil: 3 };

const Hex = z.string().regex(/^#[0-9a-f]{6}$/i);

export const Landscape = z.object({
  name: z.string().max(60).describe('what the world looks like, in a few words: "British Columbia forest", "giant workshop table"'),
  setting: z.enum(['outdoor', 'tabletop']).default('outdoor').describe('outdoor: land all round; tabletop: the board is a corner of a huge table in a real-size room, so the machine reads as a miniature'),
  sky: Hex.describe('sky colour (indoors: the room\'s walls and air)'),
  ground: Hex.describe('the board floor the machine stands on'),
  land: Hex.describe('the land around the board (tabletop: the table top)'),
  rock: Hex.describe('rocks, cliffs, mountains and raised ground (tabletop: the room\'s floor)'),
  water: Hex.describe('lakes, rivers and ditches named as water (lava when red)'),
  foliage: Hex.describe('trees and bushes'),
  accent: Hex.describe('flowers, crystals, candy, lanterns, mugs: the world\'s bright colour'),
  features: z.array(z.object({
    kind: z.enum(LANDSCAPE_FEATURES),
    amount: z.enum(['few', 'some', 'many']).default('some'),
  })).min(1).max(8).describe('what fills the world around the board'),
  hero: z.enum(HEROES).optional().describe('one big low-poly landmark lying on the board, the world\'s centrepiece: a dragon in its lair, a castle, a pirate ship, a robot, a rocket, a windmill, a giant teapot on a desk'),
  obstacles: z.array(z.enum(OBSTACLE_PROPS)).min(1).max(4).optional().describe('what stands in the ball\'s way on the board, in this world\'s style: tools on a workbench, crystals in a cave, rocks outdoors'),
  snow: z.boolean().optional().describe('snow on mountain tops and conifers'),
  seed: z.number().int().min(0).max(999_999).optional(),
});
export type Landscape = z.infer<typeof Landscape>;
export type LandscapeInput = z.input<typeof Landscape>;

/** Keyword worlds, for when no AI is available or its reply left the world out. */
const WORLDS: { words: RegExp; world: LandscapeInput }[] = [
  { words: /\b(workshop|work ?bench|workbench|desk|garage|toolbox|tools|miniature|tiny|real[- ]size|tabletop|table)\b/i, world: {
    name: 'Giant workshop table', setting: 'tabletop', sky: '#3b4248', ground: '#c89b64', land: '#b5834a', rock: '#4a4f55', water: '#4f8fc0', foliage: '#5b7a4a', accent: '#e2452b',
    features: [{ kind: 'pegboard', amount: 'few' }, { kind: 'tools', amount: 'some' }, { kind: 'wrenches', amount: 'few' }, { kind: 'screws', amount: 'some' }, { kind: 'pencils', amount: 'few' }, { kind: 'mugs', amount: 'few' }, { kind: 'lamp', amount: 'few' }],
    obstacles: ['hammer', 'wrench', 'nut', 'tape'] } },
  { words: /\b(british columbia|canad\w*|pacific northwest|taiga|pine|conifer\w*|fir|spruce|forest\w*|woods|woodland)\b/i, world: {
    name: 'Pine forest and mountains', sky: '#a9cbe0', ground: '#8b9a5b', land: '#5f7f45', rock: '#7d8086', water: '#3f7fa8', foliage: '#2f5b3a', accent: '#d9c27a',
    features: [{ kind: 'conifers', amount: 'many' }, { kind: 'mountains', amount: 'some' }, { kind: 'hills', amount: 'some' }, { kind: 'lake', amount: 'few' }, { kind: 'rocks', amount: 'some' }, { kind: 'birches', amount: 'few' }], snow: true } },
  { words: /\b(crystal\w*|cave\w*|gem\w*|geode|mine)\b/i, world: {
    name: 'Crystal cavern', sky: '#1d1830', ground: '#4a3f5c', land: '#352c45', rock: '#5b5470', water: '#5ad1e6', foliage: '#3f6b5a', accent: '#b57bff',
    features: [{ kind: 'crystals', amount: 'many' }, { kind: 'boulders', amount: 'some' }, { kind: 'mushrooms', amount: 'some' }, { kind: 'lanterns', amount: 'few' }], obstacles: ['crystal', 'rock'] } },
  { words: /\b(candy|sweet\w*|chocolate|lollipop|sugar|cake|dessert)\b/i, world: {
    name: 'Candy land', sky: '#ffd6ec', ground: '#ffc8dd', land: '#bde0fe', rock: '#cdb4db', water: '#8a5a44', foliage: '#90e0a8', accent: '#ff5d8f',
    features: [{ kind: 'candy', amount: 'many' }, { kind: 'mushrooms', amount: 'some' }, { kind: 'hills', amount: 'some' }, { kind: 'flowers', amount: 'some' }] } },
  { words: /\b(steampunk|clockwork|factory|gears?|cogs?|industrial|machine room)\b/i, world: {
    name: 'Clockwork factory', sky: '#3a2f28', ground: '#8a6a45', land: '#5a4636', rock: '#4a4540', water: '#c8893a', foliage: '#5f6b4a', accent: '#d9a441',
    features: [{ kind: 'cogs', amount: 'many' }, { kind: 'lanterns', amount: 'some' }, { kind: 'columns', amount: 'few' }, { kind: 'screws', amount: 'some' }], obstacles: ['nut', 'bolt', 'spool'] } },
  { words: /\b(temple|ruin\w*|ancient|greek|roman|egypt\w*|aztec|maya\w*|atlantis)\b/i, world: {
    name: 'Ancient ruins', sky: '#e8d9b8', ground: '#cdb88f', land: '#a8956a', rock: '#b5a789', water: '#3f8fb0', foliage: '#5b7a3a', accent: '#d9a441',
    features: [{ kind: 'columns', amount: 'many' }, { kind: 'statues', amount: 'some' }, { kind: 'palms', amount: 'few' }, { kind: 'rocks', amount: 'some' }], obstacles: ['column', 'rock'] } },
  { words: /\b(under ?water|ocean|reef|sea ?bed|atlant\w*|mermaid|submarine)\b/i, world: {
    name: 'Coral reef', sky: '#1f6f8b', ground: '#d9c49a', land: '#c2ad80', rock: '#7d8a8a', water: '#2fa6c9', foliage: '#2f8f6a', accent: '#ff7f6e',
    features: [{ kind: 'coral', amount: 'many' }, { kind: 'reeds', amount: 'some' }, { kind: 'rocks', amount: 'some' }, { kind: 'boulders', amount: 'few' }] } },
  { words: /\b(moon|mars|alien|planet|space|asteroid|crater\w*|lunar)\b/i, world: {
    name: 'Alien moon', sky: '#140f2a', ground: '#8f7a9e', land: '#6c5a7d', rock: '#4f4560', water: '#7cf2c2', foliage: '#3f8f7a', accent: '#7cf2c2',
    features: [{ kind: 'craters', amount: 'many' }, { kind: 'crystals', amount: 'some' }, { kind: 'boulders', amount: 'some' }, { kind: 'mountains', amount: 'few' }], obstacles: ['rock', 'crystal'] } },
  { words: /\b(village|town|city|street|houses?|cottage\w*|hamlet)\b/i, world: {
    name: 'Little village', sky: '#b8dcf0', ground: '#a7b57a', land: '#8aa860', rock: '#9a9488', water: '#4b8fc8', foliage: '#3d7a3f', accent: '#d9583b',
    features: [{ kind: 'houses', amount: 'some' }, { kind: 'broadleaf', amount: 'some' }, { kind: 'lanterns', amount: 'some' }, { kind: 'flowers', amount: 'some' }] } },
  { words: /\b(arctic|snow\w*|winter|alps?|alpine|glacier|tundra|frozen|ice)\b/i, world: {
    name: 'Snowy peaks', sky: '#cfdde8', ground: '#e8eef2', land: '#dfe8ee', rock: '#8a919a', water: '#6fa7cf', foliage: '#2e4f3e', accent: '#c8d8e8',
    features: [{ kind: 'mountains', amount: 'many' }, { kind: 'ice_spikes', amount: 'some' }, { kind: 'conifers', amount: 'some' }, { kind: 'snowdrifts', amount: 'some' }], snow: true } },
  { words: /\b(desert|sahara|arizona|dune\w*|canyon|western|cowboy|mesa)\b/i, world: {
    name: 'Desert canyon', sky: '#f3d7a6', ground: '#d8b07a', land: '#c99a5b', rock: '#b06a45', water: '#4f9cc4', foliage: '#6a8a4a', accent: '#e0574f',
    features: [{ kind: 'cacti', amount: 'some' }, { kind: 'boulders', amount: 'some' }, { kind: 'mountains', amount: 'few' }, { kind: 'rocks', amount: 'many' }], obstacles: ['cactus', 'rock'] } },
  { words: /\b(beach|tropic\w*|island|hawaii|caribbean|palm\w*|coast|seaside)\b/i, world: {
    name: 'Tropical beach', sky: '#9fd8f0', ground: '#ecd9a6', land: '#e4cf95', rock: '#a59a86', water: '#2fa6c9', foliage: '#3f8f4a', accent: '#ff7f6e',
    features: [{ kind: 'palms', amount: 'some' }, { kind: 'lake', amount: 'some' }, { kind: 'coral', amount: 'few' }, { kind: 'rocks', amount: 'few' }] } },
  { words: /\b(jungle|rainforest|amazon)\b/i, world: {
    name: 'Jungle', sky: '#b9d9b0', ground: '#7b8f4a', land: '#4f7a36', rock: '#6b6f5a', water: '#3c8f8a', foliage: '#2f7a3a', accent: '#ff9f40',
    features: [{ kind: 'broadleaf', amount: 'many' }, { kind: 'palms', amount: 'some' }, { kind: 'bushes', amount: 'many' }, { kind: 'flowers', amount: 'some' }] } },
  { words: /\b(autumn|fall|maple|new england)\b/i, world: {
    name: 'Autumn woods', sky: '#e8d3b8', ground: '#a7905e', land: '#8a7a4a', rock: '#857b70', water: '#4a7fa0', foliage: '#c8642d', accent: '#e8b13a',
    features: [{ kind: 'broadleaf', amount: 'many' }, { kind: 'bushes', amount: 'some' }, { kind: 'hills', amount: 'some' }, { kind: 'mushrooms', amount: 'few' }] } },
  { words: /\b(swamp|marsh|bog|bayou|wetland)\b/i, world: {
    name: 'Misty swamp', sky: '#a7b3a0', ground: '#6f7a4e', land: '#55653f', rock: '#5f6458', water: '#4b6b55', foliage: '#3f5a35', accent: '#c94f4f',
    features: [{ kind: 'reeds', amount: 'many' }, { kind: 'lake', amount: 'some' }, { kind: 'mushrooms', amount: 'some' }, { kind: 'broadleaf', amount: 'few' }] } },
  { words: /\b(volcan\w*|lava|mordor|inferno)\b/i, world: {
    name: 'Volcanic badlands', sky: '#4a2f2f', ground: '#5a4a45', land: '#3d3330', rock: '#2f2a28', water: '#e2582a', foliage: '#4a4a3a', accent: '#ff7a2a',
    features: [{ kind: 'mountains', amount: 'some' }, { kind: 'boulders', amount: 'many' }, { kind: 'craters', amount: 'some' }, { kind: 'rocks', amount: 'some' }] } },
  { words: /\b(meadow|countryside|england|farm\w*|garden|park|spring|hills?)\b/i, world: {
    name: 'Rolling countryside', sky: '#b8dcf0', ground: '#9fbf6a', land: '#7fae55', rock: '#9a9488', water: '#4b8fc8', foliage: '#3d7a3f', accent: '#f2c84b',
    features: [{ kind: 'hills', amount: 'many' }, { kind: 'broadleaf', amount: 'some' }, { kind: 'flowers', amount: 'many' }, { kind: 'bushes', amount: 'some' }] } },
];

/** A world named in the words, or null. The first match wins, so specific places beat general words. */
export function landscapeFromWords(text: string): Landscape | null {
  const hit = WORLDS.find((w) => w.words.test(text));
  return hit ? Landscape.parse({ ...hit.world, hero: heroFromWords(text) ?? hit.world.hero, seed: seedOf(text) }) : null;
}

const HERO_WORDS: [RegExp, Hero][] = [
  [/\b(dragons?|wyrm|lair)\b/i, 'dragon'], [/\b(castles?|knights?|kings?|queens?|princess\w*|fortress|medieval)\b/i, 'castle'],
  [/\b(pirates?|ships?|boats?|treasure|harbou?r|sail\w*)\b/i, 'ship'], [/\b(robots?|android|factory|mech)\b/i, 'robot'],
  [/\b(rockets?|space|moon|mars|launch pad|astronaut\w*)\b/i, 'rocket'], [/\b(windmills?|farm\w*|countryside|holland|dutch)\b/i, 'windmill'],
  [/\b(tea\w*|kitchen|desk|breakfast|cafe|coffee)\b/i, 'teapot'],
];
/** The centrepiece the words name, or null. */
export function heroFromWords(text: string): Hero | null {
  return HERO_WORDS.find(([words]) => words.test(text))?.[1] ?? null;
}

/** Words that ask for a world rather than a mechanism. */
export const WORLD_WORDS = /\b(terrain|landscape|scenery|world|environment|biome|forest\w*|woods|hills|mountains?|desert|jungle|beach|meadow|countryside|snowy|winter|autumn|swamp|volcan\w*|island|workshop|table|desk|cave|candy|temple|ruins?|moon|space|reef|village|looks? like)\b/i;

function seedOf(text: string): number {
  let h = 2166136261;
  for (const c of text) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return (h >>> 0) % 1_000_000;
}

function rng(seed: number) {
  let a = seed + 0x6d2b79f5;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** One placed object, in metres; the board spans x 0..W and z 0..D. */
export interface Prop { kind: LandscapeFeature; x: number; z: number; scale: number; turn: number }

/**
 * Where each kind goes: `back` only behind the board (west and north, away from the camera),
 * `near`..`far` metres out, a size range, `r` the clearance per unit of size, and `big` for kinds
 * counted like mountains (a few large ones) rather than like trees.
 */
interface Rule { back: boolean; near: number; far: number; size: [number, number]; r: number; big?: boolean }
const R = (back: boolean, near: number, far: number, size: [number, number], r = 0.15, big = false): Rule => ({ back, near, far, size, r, big });
const RULES: Record<LandscapeFeature, Rule> = {
  conifers: R(true, 0.6, 8, [0.7, 1.3]), broadleaf: R(true, 0.6, 8, [0.7, 1.3]), birches: R(true, 0.6, 8, [0.7, 1.3]), palms: R(true, 0.6, 8, [0.7, 1.3]),
  cacti: R(true, 0.6, 8, [0.7, 1.3]), bushes: R(false, 0.4, 3, [0.7, 1.3]), flowers: R(false, 0.4, 3, [0.6, 1.2]), mushrooms: R(false, 0.4, 3, [0.7, 1.5]),
  reeds: R(false, 0.4, 3, [0.7, 1.3]), rocks: R(false, 0.4, 3, [0.6, 1.2]), boulders: R(true, 0.6, 8, [0.7, 1.3], 0.35), hills: R(true, 1.8, 7, [1.2, 2.4], 1, true),
  mountains: R(true, 12, 19, [2.2, 3.4], 2, true), lake: R(true, 2, 6, [1.2, 2.2], 1, true), snowdrifts: R(false, 0.4, 3, [0.7, 1.3], 0.3),
  crystals: R(true, 0.5, 7, [0.8, 1.7], 0.25), columns: R(true, 0.6, 8, [0.8, 1.4], 0.3), statues: R(true, 1, 7, [1, 1.7], 0.35), houses: R(true, 1.5, 8, [1, 1.6], 0.6),
  lanterns: R(false, 0.4, 3, [0.8, 1.2]), candy: R(true, 0.6, 7, [0.8, 1.6], 0.3), coral: R(false, 0.4, 3, [0.7, 1.4]), cogs: R(false, 0.5, 3, [0.6, 1.3], 0.6),
  ice_spikes: R(true, 0.5, 7, [0.8, 1.7], 0.2), craters: R(false, 1, 4, [0.8, 1.4], 1),
  tools: R(true, 1, 6, [3, 4.5], 0.55, true), wrenches: R(true, 1, 6, [3, 4.5], 0.55, true), pencils: R(false, 0.8, 3.5, [2.5, 3.5], 0.5, true),
  screws: R(false, 0.8, 3.5, [2.5, 3.5], 0.4, true), nuts: R(false, 0.6, 3, [2, 3], 0.25, true), mugs: R(true, 1.5, 6, [3, 4], 0.4, true),
  books: R(true, 1.5, 6, [3, 4], 0.5, true), lamp: R(true, 3, 4, [3, 3.4], 1, true), pegboard: R(true, 7.5, 7.5, [1, 1], 0, true),
};
const COUNT = { few: 8, some: 20, many: 42 } as const;
const BIG = { few: 2, some: 4, many: 7 } as const;
/** How far out a tabletop world reaches: the table's edge. */
export const TABLE_MARGIN = 8;

/**
 * Scatter a landscape round the board, the same way every time for the same seed. The camera
 * looks from the south-east, so tall things stand to the west and north; the near sides get only
 * low ones, and mountains stand far back. On a tabletop everything stays on the table and the
 * pegboard and lamp stand behind the board once.
 */
export function scatterLandscape(l: Landscape, W: number, D: number): Prop[] {
  const rand = rng(l.seed ?? seedOf(l.name));
  const table = l.setting === 'tabletop';
  const props: Prop[] = [];
  const lakes: Prop[] = [];
  const clear = (x: number, z: number, r: number) =>
    !(x > -0.35 - r && x < W + 0.35 + r && z > -0.35 - r && z < D + 0.35 + r)
    && lakes.every((k) => Math.hypot(k.x - x, k.z - z) > k.scale + r)
    && props.every((p) => !RULES[p.kind].big || Math.hypot(p.x - x, p.z - z) > p.scale * RULES[p.kind].r + r);
  /** A spot on the apron `near`..`far` metres out; behind only (west or north) when `back`. */
  const spot = (near: number, far: number, back: boolean): { x: number; z: number } => {
    const out = near + rand() * (far - near);
    const side = Math.floor(rand() * (back ? 2 : 4));
    // Behind the board, runs stop at its near corners so nothing tall wanders into the view.
    const along = (len: number) => back ? -far * 0.6 + rand() * (len + far * 0.6) : -far * 0.6 + rand() * (len + far * 1.2);
    switch (side) {
      case 0: return { x: -out, z: along(D) };
      case 1: return { x: along(W), z: -out };
      case 2: return { x: W + out, z: along(D) };
      default: return { x: along(W), z: D + out };
    }
  };
  const place = (kind: LandscapeFeature, n: number, into = props) => {
    const rule = RULES[kind];
    const far = table ? Math.min(rule.far, TABLE_MARGIN - 1.5) : rule.far;
    const near = Math.min(rule.near, far);
    for (let i = 0, tries = 0; i < n && tries < n * 30; tries++) {
      const scale = rule.size[0] + rand() * (rule.size[1] - rule.size[0]);
      const p = spot(near, rule.back ? far : Math.min(far, 3.5), rule.back);
      if (!clear(p.x, p.z, scale * rule.r)) continue;
      into.push({ kind, x: p.x, z: p.z, scale, turn: rand() * Math.PI * 2 });
      i++;
    }
  };
  const has = (k: LandscapeFeature) => l.features.find((f) => f.kind === k);
  // One of each: the pegboard wall behind the board, the lamp at its back corner.
  if (has('pegboard')) props.push({ kind: 'pegboard', x: W / 2, z: -(table ? TABLE_MARGIN - 0.5 : 7.5), scale: 1, turn: 0 });
  if (has('lamp')) props.push({ kind: 'lamp', x: -3.2, z: -3.2, scale: 3.2, turn: Math.PI * 0.25 });
  // Lakes first, so nothing stands in the water.
  const lake = has('lake');
  if (lake) place('lake', { few: 1, some: 2, many: 3 }[lake.amount], lakes);
  for (const f of l.features) {
    if (f.kind === 'lake' || f.kind === 'pegboard' || f.kind === 'lamp' || (table && f.kind === 'mountains')) continue;
    const rule = RULES[f.kind];
    const n = rule.big ? BIG[f.amount] + (f.kind === 'mountains' ? 1 : 0) : COUNT[f.amount] * (f.kind === 'flowers' || f.kind === 'rocks' ? 1.5 : 1);
    place(f.kind, n);
  }
  return [...lakes, ...props];
}
