/**
 * The fast path: the AI writes a route graph (the level's story in a few hundred tokens) and
 * the compiler lays it out by following the ball, so the level arrives in seconds and has been
 * run end to end. The same compiler builds a level from the mission's words alone when the AI is
 * unavailable. Missions the graph cannot say (a seesaw, a long domino chain) take the full designer.
 */
import { z } from 'zod';
import { RouteGraph, type RouteGraphInput, type RouteLink } from '@og/machine';
import type { Completion, LlmBackend } from '../llm/client';
import { requestValidated, type Validation } from '../llm/design';

export const ROUTE_SCHEMA = JSON.stringify(z.toJSONSchema(RouteGraph, { io: 'input' }));

export const ROUTE_PROMPT = `You design puzzle levels for Prompt Goldberg, a browser game in the spirit of The Incredible Machine. A player types a mission (a goal and a place); you reply with the level's ROUTE GRAPH: the story of how the ball gets from its start to the target. A compiler lays the graph out on the stage and the physics engine proves it works; the player then gets the route's parts in a bin and builds it themselves.

THE GRAPH
- start: "shelf" (the ball starts on a high shelf) or "hill" (on top of a hill).
- links: 1 or 2 steps (3 only for a hard mission) that carry the ball on, in order. Each is {"via", "turn"} with turn "left", "right" or "straight"; at least one link turns, so the target is round a corner.
  - cannon: catches the rolling ball and fires it 6 to 9 cells. The way across a river or a pit. At most one cannon unless the mission asks for more.
  - fan: the ball hits a wall in its way and the fan beside it blows it round the corner (a windy alley). Turns left or right.
  - trampoline: a falling ball (off a shelf or out of a cannon) bounces up and on. Always straight; put it first or right after a cannon.
  - ramp: a falling ball lands on a ramp against a wall and rolls off the way the ramp faces. Turns left or right.
- end: "bucket" (the ball lands in it: after a cannon or a drop), "bell" (the rolling ball rings it), "dominoes" (it knocks a row over that rings a bell).
- ground: "river" (under a cannon's flight), "pit", "hill", or "auto".
- names: the mission's words for the target ("oven", "gong"), the wall ("guard", "fence"), the ground block ("lava", "moat") and the ball ("pizza", "cheese"); 1 or 2 words each.
- spares: 2 or 3 extra kinds for the bin that the route does not use (ramp, platform, fan, trampoline, wall, cannon), so the player has to think.
- title: 2 to 5 playful words from the mission. caption: one sentence for players, what should happen, no numbers.
- closest: only when the mission asks for something the kit cannot do (an elephant, water flowing, two balls, a moving target): one honest, friendly sentence saying what you built instead. Leave it out otherwise.

VARIETY: pick links from the mission's words; when it names no mechanism, prefer a fan or a ramp turn over a cannon, and mix the ending. Any mission works: reinterpret playfully (a pizza delivery is a ball called "pizza" landing in a bucket called "oven").

JSON schema:
${ROUTE_SCHEMA}

Example for "get the pizza into the oven past the guard wall":
{"title":"Pizza Express","caption":"Fire the pizza over the river and into the oven.","start":"shelf","links":[{"via":"cannon","turn":"right"}],"end":"bucket","ground":"river","names":{"target":"oven","scenery":"guard","ground":"river","ball":"pizza"},"spares":[{"kind":"fan"},{"kind":"platform","length":3}]}

Reply with only the JSON object inside a single \`\`\`json code block.`;

const MODEL = () => process.env.CLAUDE_ROUTE_MODEL ?? 'claude-haiku-5-5';

/** Missions the graph cannot say: they name parts the compiler does not route with. */
export function routable(request: string): boolean {
  return !/\b(seesaws?|see-saws?|teeter|platforms? chain|every part|only (one|two|three|\d) parts?|twice|three times|slowest|longest)\b/i.test(request);
}

export function validateRoute(json: unknown): Validation<RouteGraph> {
  const r = RouteGraph.safeParse(json);
  if (!r.success) return { ok: false, problems: r.error.issues.slice(0, 8).map((i) => `- ${i.path.join('.')}: ${i.message}`).join('\n') };
  return { ok: true, value: r.data };
}

export function designRoute(llm: LlmBackend, mission: string, calls: Completion[]): Promise<RouteGraph> {
  return requestValidated(llm, { system: ROUTE_PROMPT, prompt: `Mission:\n\n${mission}`, thinking: 'off', maxTokens: 800, model: MODEL() }, validateRoute, calls, 1);
}

const has = (text: string, re: RegExp) => re.test(text);

/**
 * A route graph from the mission's words alone, for when the AI is unavailable: mechanisms and
 * endings it names, a turn, a title from the mission. Deterministic for a seed.
 */
export function routeFromWords(mission: string, seed = 1): RouteGraphInput {
  const m = mission.toLowerCase();
  const turn: RouteLink['turn'] = seed % 2 ? 'right' : 'left';
  const links: RouteGraphInput['links'] = [];
  if (has(m, /\b(fly|flies|fire|launch|cannon|rocket|shoot|over the|across)\b/)) links.push({ via: 'cannon', turn });
  if (has(m, /\b(wind|windy|blow|fan|breeze|storm)\b/)) links.push({ via: 'fan', turn: links.length ? 'straight' : turn });
  if (has(m, /\b(bounce|trampoline|jump|spring)\b/)) links.push({ via: 'trampoline', turn: 'straight' });
  if (!links.length) links.push({ via: (['fan', 'ramp', 'cannon'] as const)[seed % 3], turn });
  // A fan link needs a turn of its own; a straight fan after a cannon is fine.
  if (!links.some((l) => l.turn !== 'straight')) links[0] = { ...links[0], turn };
  const end = has(m, /\b(domino|dominoes|knock|topple|bowling|strike)\b/) ? 'dominoes'
    : has(m, /\b(bell|ring|gong|alarm|chime|wake)\b/) ? 'bell'
    : 'bucket';
  const words = mission.replace(/[^\p{L}\p{N} ]/gu, ' ').split(/\s+/).filter((w) => w.length > 2 && !/^(the|and|into|with|from|past|over|ball|get|make|then|that|this|behind|across|round|around)$/i.test(w));
  const title = words.slice(0, 4).map((w) => w[0].toUpperCase() + w.slice(1)).join(' ') || 'A Quick Level';
  const ground = has(m, /\b(river|water|moat|lake|sea|lava)\b/) ? 'river' : has(m, /\b(hill|mountain|roof|tower)\b/) ? 'hill' : has(m, /\b(pit|hole|ditch|crater)\b/) ? 'pit' : 'auto';
  return { title: title.slice(0, 40), caption: 'Build the route from the parts in your bin.', links: links.slice(0, 3), end, ground, start: ground === 'hill' ? 'hill' : 'shelf' };
}
