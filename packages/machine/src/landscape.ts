/**
 * The world around the board: forests, hills, mountains and lakes in the player's words ("forests
 * and hills in British Columbia"). Looks only: nothing here has a collider, nothing stands on a
 * cell of the board, and the simulation never reads it. Shaped ground the ball has to deal with
 * stays `terrain`.
 */
import { z } from 'zod';

export const LANDSCAPE_FEATURES = [
  'conifers', 'broadleaf', 'birches', 'palms', 'cacti', 'bushes', 'flowers', 'mushrooms', 'reeds',
  'rocks', 'boulders', 'hills', 'mountains', 'lake', 'snowdrifts',
] as const;
export type LandscapeFeature = (typeof LANDSCAPE_FEATURES)[number];

const Hex = z.string().regex(/^#[0-9a-f]{6}$/i);

export const Landscape = z.object({
  name: z.string().max(60).describe('what the world looks like, in a few words: "British Columbia forest"'),
  sky: Hex.describe('sky colour'),
  ground: Hex.describe('the board floor the machine stands on'),
  land: Hex.describe('the land around the board'),
  rock: Hex.describe('rocks, cliffs, mountains and raised ground'),
  water: Hex.describe('lakes, rivers and ditches named as water'),
  foliage: Hex.describe('trees and bushes'),
  accent: Hex.describe('flowers, mushrooms, autumn leaves'),
  features: z.array(z.object({
    kind: z.enum(LANDSCAPE_FEATURES),
    amount: z.enum(['few', 'some', 'many']).default('some'),
  })).min(1).max(8).describe('what fills the world around the board'),
  snow: z.boolean().optional().describe('snow on mountain tops and conifers'),
  seed: z.number().int().min(0).max(999_999).optional(),
});
export type Landscape = z.infer<typeof Landscape>;
export type LandscapeInput = z.input<typeof Landscape>;

/** Keyword worlds, for when no AI is available or its reply left the world out. */
const WORLDS: { words: RegExp; world: LandscapeInput }[] = [
  { words: /\b(british columbia|canad\w*|pacific northwest|taiga|pine|conifer\w*|fir|spruce|forest\w*|woods|woodland)\b/i, world: {
    name: 'Pine forest and mountains', sky: '#a9cbe0', ground: '#8b9a5b', land: '#5f7f45', rock: '#7d8086', water: '#3f7fa8', foliage: '#2f5b3a', accent: '#d9c27a',
    features: [{ kind: 'conifers', amount: 'many' }, { kind: 'mountains', amount: 'some' }, { kind: 'hills', amount: 'some' }, { kind: 'lake', amount: 'few' }, { kind: 'rocks', amount: 'some' }, { kind: 'birches', amount: 'few' }], snow: true } },
  { words: /\b(arctic|snow\w*|winter|alps?|alpine|glacier|tundra|frozen|ice)\b/i, world: {
    name: 'Snowy peaks', sky: '#cfdde8', ground: '#e8eef2', land: '#dfe8ee', rock: '#8a919a', water: '#6fa7cf', foliage: '#2e4f3e', accent: '#c8d8e8',
    features: [{ kind: 'mountains', amount: 'many' }, { kind: 'conifers', amount: 'some' }, { kind: 'snowdrifts', amount: 'some' }, { kind: 'rocks', amount: 'few' }], snow: true } },
  { words: /\b(desert|sahara|arizona|dune\w*|canyon|western|cowboy|mesa)\b/i, world: {
    name: 'Desert canyon', sky: '#f3d7a6', ground: '#d8b07a', land: '#c99a5b', rock: '#b06a45', water: '#4f9cc4', foliage: '#6a8a4a', accent: '#e0574f',
    features: [{ kind: 'cacti', amount: 'some' }, { kind: 'boulders', amount: 'some' }, { kind: 'mountains', amount: 'few' }, { kind: 'rocks', amount: 'many' }] } },
  { words: /\b(beach|tropic\w*|island|hawaii|caribbean|palm\w*|coast|seaside)\b/i, world: {
    name: 'Tropical beach', sky: '#9fd8f0', ground: '#ecd9a6', land: '#e4cf95', rock: '#a59a86', water: '#2fa6c9', foliage: '#3f8f4a', accent: '#ff7f6e',
    features: [{ kind: 'palms', amount: 'some' }, { kind: 'lake', amount: 'some' }, { kind: 'bushes', amount: 'few' }, { kind: 'rocks', amount: 'few' }] } },
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
    features: [{ kind: 'mountains', amount: 'some' }, { kind: 'boulders', amount: 'many' }, { kind: 'rocks', amount: 'some' }] } },
  { words: /\b(meadow|countryside|england|farm\w*|village|garden|park|spring|hills?)\b/i, world: {
    name: 'Rolling countryside', sky: '#b8dcf0', ground: '#9fbf6a', land: '#7fae55', rock: '#9a9488', water: '#4b8fc8', foliage: '#3d7a3f', accent: '#f2c84b',
    features: [{ kind: 'hills', amount: 'many' }, { kind: 'broadleaf', amount: 'some' }, { kind: 'flowers', amount: 'many' }, { kind: 'bushes', amount: 'some' }] } },
];

/** A world named in the words, or null. The first match wins, so specific places beat general words. */
export function landscapeFromWords(text: string): Landscape | null {
  const hit = WORLDS.find((w) => w.words.test(text));
  return hit ? Landscape.parse({ ...hit.world, seed: seedOf(text) }) : null;
}

/** Words that ask for a world rather than a mechanism. */
export const WORLD_WORDS = /\b(terrain|landscape|scenery|world|environment|biome|forest\w*|woods|hills|mountains?|desert|jungle|beach|meadow|countryside|snowy|winter|autumn|swamp|volcan\w*|island|looks? like)\b/i;

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

const TALL = new Set<LandscapeFeature>(['conifers', 'broadleaf', 'birches', 'palms', 'cacti', 'boulders', 'hills']);
const COUNT = { few: 8, some: 20, many: 42 } as const;
const BIG = { few: 2, some: 4, many: 7 } as const;

/**
 * Scatter a landscape round the board, the same way every time for the same seed. The camera
 * looks from the south-east, so tall things stand to the west and north; the near sides get only
 * low ones, and mountains stand far back.
 */
export function scatterLandscape(l: Landscape, W: number, D: number): Prop[] {
  const rand = rng(l.seed ?? seedOf(l.name));
  const props: Prop[] = [];
  const lakes: Prop[] = [];
  const clear = (x: number, z: number, r: number) =>
    !(x > -0.35 - r && x < W + 0.35 + r && z > -0.35 - r && z < D + 0.35 + r)
    && lakes.every((k) => Math.hypot(k.x - x, k.z - z) > k.scale + r);
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
  const place = (kind: LandscapeFeature, n: number, near: number, far: number, size: [number, number], into = props) => {
    for (let i = 0, tries = 0; i < n && tries < n * 30; tries++) {
      const scale = size[0] + rand() * (size[1] - size[0]);
      const back = TALL.has(kind) || kind === 'mountains' || kind === 'lake';
      const p = spot(near, back ? far : Math.min(far, 3), back);
      if (!clear(p.x, p.z, kind === 'lake' || kind === 'hills' ? scale : 0.15)) continue;
      into.push({ kind, x: p.x, z: p.z, scale, turn: rand() * Math.PI * 2 });
      i++;
    }
  };
  const has = (k: LandscapeFeature) => l.features.find((f) => f.kind === k);
  // Lakes first, so trees keep out of the water.
  const lake = has('lake');
  if (lake) place('lake', { few: 1, some: 2, many: 3 }[lake.amount], 2, 6, [1.2, 2.2], lakes);
  for (const f of l.features) {
    if (f.kind === 'lake') continue;
    if (f.kind === 'mountains') place('mountains', BIG[f.amount] + 1, 12, 19, [2.2, 3.4]);
    else if (f.kind === 'hills') place('hills', BIG[f.amount], 1.8, 7, [1.2, 2.4]);
    else if (f.kind === 'flowers' || f.kind === 'rocks') place(f.kind, COUNT[f.amount] * 1.5, 0.4, 3, [0.6, 1.2]);
    else place(f.kind, COUNT[f.amount], TALL.has(f.kind) ? 0.6 : 0.4, 8, [0.7, 1.3]);
  }
  return [...lakes, ...props];
}
