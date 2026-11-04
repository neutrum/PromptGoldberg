/**
 * Route graphs: a level as a story ("roll off the shelf, a cannon turns it south over the river,
 * land in the bucket") instead of coordinates. The AI writes the graph, a few hundred tokens, and
 * layoutLevel (level.ts) sets the stage from it.
 */
import { z } from 'zod';
import { Landscape, type ObstacleProp } from './landscape';
import { Spare } from './schema';

export const LINK_KINDS = ['cannon', 'fan', 'trampoline', 'ramp', 'seesaw'] as const;
export type LinkKind = (typeof LINK_KINDS)[number];

export const RouteLink = z.object({
  via: z.enum(LINK_KINDS).describe('cannon: catches the rolling ball and fires it 6 to 9 cells; fan: blows the rolling ball sideways; trampoline: bounces a falling ball up and on; ramp: a falling ball lands on it and rolls off the way it faces; seesaw: a falling ball lands on its plank, tips it and rolls on; always straight'),
  turn: z.enum(['left', 'right', 'straight']).default('straight').describe('which way the route bends at this link'),
});
export type RouteLink = z.infer<typeof RouteLink>;

const Name = z.string().max(24).optional();

export const RouteGraph = z.object({
  title: z.string().describe('2 to 5 playful words'),
  caption: z.string().optional().describe('one sentence for players: what should happen, no numbers'),
  closest: z.string().optional().describe('only when the mission could not be built as asked: one honest sentence saying what was built instead'),
  start: z.enum(['shelf', 'hill']).default('shelf').describe('the ball starts on a high shelf, or on top of a hill'),
  links: z.array(RouteLink).min(1).max(3).describe('what moves the ball on, in order; at least one turns left or right'),
  end: z.enum(['bucket', 'bell', 'dominoes']).describe('bucket: the ball lands in it; bell: the ball rings it; dominoes: the ball knocks a row over that rings a bell'),
  rings: z.number().int().min(1).max(3).default(1).describe('bell and dominoes endings: how many times the bell must ring ("ring it twice" is 2)'),
  row: z.number().int().min(3).max(16).optional().describe('dominoes ending: how many dominoes in the chain (default 5; a long chain is 10 to 16)'),
  ground: z.enum(['river', 'pit', 'hill', 'auto']).default('auto').describe('the shaped ground in the way: a river under a cannon flight, a pit, a hill start'),
  names: z.object({ target: Name, scenery: Name, ground: Name, ball: Name }).partial().optional().describe('the mission\'s words for the target, the wall, the ground block and the ball'),
  spares: z.array(Spare).max(4).optional(),
  landscape: Landscape.optional().describe('looks only: the world around the board when the mission names a place or a look (forest, desert, mountains)'),
});
export type RouteGraph = z.infer<typeof RouteGraph>;
export type RouteGraphInput = z.input<typeof RouteGraph>;

/** How hard a level is: how many obstacles stand in the way. */
export type Difficulty = 'easy' | 'normal' | 'hard';

/** A colour pulled toward a deep, saturated version of itself, so a big shape reads against light or dark ground. */
export function deepen(hex: string): string {
  const n = parseInt(hex.slice(1), 16), ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  const max = Math.max(...ch), min = Math.min(...ch);
  // Stretch the channels apart (more saturation), then darken.
  const out = ch.map((v) => Math.round((max === min ? v : ((v - min) / (max - min)) * 200 + 20) * 0.7));
  return `#${out.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/** Obstacles that suit the world: trees in a forest, cacti in a desert, crates and rocks in the workshop. */
export function worldProps(world: Landscape | undefined): ObstacleProp[] {
  if (world?.obstacles?.length) return world.obstacles;
  const kinds = new Set(world?.features.map((f) => f.kind));
  const out: ObstacleProp[] = [];
  if (['tools', 'wrenches', 'screws', 'nuts', 'pencils', 'pegboard'].some((k) => kinds.has(k as never))) out.push('hammer', 'nut', 'wrench', 'tape', 'pencil', 'bolt');
  if (kinds.has('cogs')) out.push('nut', 'bolt', 'spool');
  if (kinds.has('crystals')) out.push('crystal');
  if (kinds.has('columns') || kinds.has('statues')) out.push('column');
  if (['conifers', 'broadleaf', 'birches', 'palms'].some((k) => kinds.has(k as never))) out.push('tree', 'stump');
  if (kinds.has('cacti')) out.push('cactus');
  if (kinds.has('rocks') || kinds.has('boulders') || kinds.has('mountains')) out.push('rock');
  return out.length ? [...out, 'rock'] : ['crate', 'rock'];
}
