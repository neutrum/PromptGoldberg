import { z } from 'zod';
import { WORLD_BRIEF } from './world';
import { binProblems, layoutProblems, lockedParts, lockProblems, MachineSpec, Part, parseMachine, partNames, SPREAD_MIN, Terrain, TERRAIN_MAX, TERRAIN_MIN, TURN_MIN, type BinRule, type Stage, type MachineEvent, type MachineResult, type SpecIssue } from '@og/machine';
import example from '@og/machine/fixtures/ramp-dominoes-bell.json' with { type: 'json' };
import type { Completion, LlmBackend } from '../llm/client';
import { requestValidated, type Validation } from '../llm/design';

export const MACHINE_SCHEMA = JSON.stringify(z.toJSONSchema(MachineSpec, { io: 'input' }));

const EXAMPLE = { ...example, caption: 'Down the ramp, through the dominoes, and the bell rings.', spares: [{ kind: 'trampoline' }, { kind: 'platform', length: 3 }] };

/**
 * The parts manual. Everything the model needs to compose a chain that works on the first try
 * most of the time; the optimizer only nudges parts by up to a cell, so the sequence and the
 * rough alignment have to come from here.
 */
export const MACHINE_PROMPT = `You design Rube Goldberg puzzle levels for Prompt Goldberg, a browser game in the spirit of The Incredible Machine: a player describes a contraption in plain language, you build a working machine from a fixed kit of parts, and a rigid-body physics engine runs it to prove the goal chain happens. An optimizer then nudges parts by up to a cell to make it work, so get the sequence and the rough alignment right rather than exact numbers.

THE GAME: the player then sees only the ball, the goal parts and the scenery, where you put them, and gets every other part of your machine in a bin to build the route with. So a level is a journey across the stage: the ball starts on a shelf 3 to 6 cells up near one side or corner, the final goal part is far away (at least ${SPREAD_MIN} cells counting x, y and z together; 12 to 16 is the sweet spot) and AROUND A CORNER: at least ${TURN_MIN} cells away along x and ${TURN_MIN} along z, never straight ahead on the same row. So the route turns at least once: a cannon or fan facing 90 or 270 sends the ball along z, a ramp and shelf with yaw 90 run along z, a wall stops a roll and a fan pushes it sideways. A goal part straight ahead of the start is not a level. Prefer simple, reliable links: a ramp onto a shelf, a drop off its end onto a lower shelf or the floor, dominoes, a seesaw, a fan beside the path. Use at most one cannon unless the request asks for more, and never chain two flights; keep the machine working first, spectacular second.

THE STAGE
A grid of 0.5 m cells, 24 by 24 unless the machine's "stage" says otherwise: x from 0 (west) to 23 (east), z from 0 (north) to 23 (south) (on a "stage" of {"x":X,"z":Z}, x runs 0 to X-1 and z 0 to Z-1), y from ${TERRAIN_MIN} (the bottom of the deepest ditch) through 0 (the flat floor) to 15 (height of a part's base, in cells). Gravity points down. One ball (radius 0.16 m, a third of a cell) starts at rest and everything else is triggered by it. There are no walls around the stage: a ball that rolls off the edge is lost.

FACING ("yaw"): 0 = toward +x (east), 90 = toward +z (south), 180 = toward -x (west), 270 = toward -z (north). A leg of the route runs straight along x (yaw 0 or 180) or along z (yaw 90 or 270); corners are turned by a cannon or a fan facing the new direction, or by dropping the ball onto a ramp that faces the new way.

THE KIT (each part stands on its cell at height y unless said otherwise)
- ball: the one ball. Place it at (x, y+1, z) directly above the high end of a ramp at (x, y, z) so it drops onto the ramp and rolls off; or above a platform.
- ramp: a wedge 2 cells long: the high end (1 cell tall) is in its own cell, the low end is in the next cell toward its facing. The ball leaves the low end at height y, rolling toward the facing at about 2.5 m/s (it then travels 3 to 5 cells on a flat platform at the same y).
- platform: a flat shelf, "length" cells long (1 to 8, default 3), 1 cell wide, extending from its cell toward its facing. Its TOP is at height y, so parts standing on it use the same y. A ball rolling off the far end falls.
- wall: thin, 1 cell wide, 2 cells tall, standing across its facing; a ball rolling into it bounces back.
- dominoes: a row of "length" standing dominoes (3 to 8, default 5) starting in its cell and continuing toward its facing, 0.24 m apart (5 dominoes span about 2.5 cells). A rolling ball knocks the first one, they fall in sequence, and the last one falling can ring a bell placed in the next cell. They need something to stand on: the floor (y 0) or a platform with the same y.
- seesaw: a plank 3 cells long centred on its cell on a pivot 0.22 m high. A ball rolling onto one end tips the plank and rolls off the other end slightly lower; it adds a dramatic pause.
- fan: blows the ball toward its facing for 3 cells in front of it (the stream is 3 cells wide and 1 cell tall, from height y to y+1) at about 9 m/s2. Put it on the row next to the ball's path (one cell to the side), at the same y as the ball's floor, facing the way the ball should go: it pushes the ball further, up a shallow slope or off a shelf.
- trampoline: a 1-cell pad; a ball landing on it bounces straight up at 5.5 m/s (about 3 cells high) while keeping its horizontal speed. Good for getting back up to a higher shelf.
- cannon: when the ball rolls or falls into its cell (the catch zone is the whole cell from height y to y+1), it fires the ball toward its facing at 6.5 m/s, 25 degrees up. On flat ground the ball lands about 6 to 7 cells away (rising less than a cell); from a bank or shelf 2 cells up it lands about 9 cells away on the floor. Put the landing platform or bucket there, at the cannon's y or lower. Give the cannon the same y as the floor the ball rolls in on (a cannon at y 2 next to a shelf at y 3 is below the ball). The reliable way to turn a corner or jump a gap.
- bucket: a 1-cell box with walls 0.45 m high, open at the top. The ball has to land in it from above and settle. The usual final goal.
- bell: a short post 0.36 m tall; rings when the ball or a falling domino hits it.

THE GROUND ("terrain"): the stage is not flat. Shape it with 1 to 4 rectangles of ground at another height, each {"name", "x", "z", "w", "d", "h"}: x, z is the north-west cell, w cells along x, d cells along z, h the ground height in cells from ${TERRAIN_MIN} to ${TERRAIN_MAX}. Negative h digs a ditch, river, moat or pit: a ball that rolls into it is stuck (a river right across the stage, w 24 or d 24, must be jumped by a cannon or a trampoline; a short ditch can be gone round). Positive h raises a bank, hill or plateau: a ball on it rolls off the edge and drops; the ball can start up there (y = h) instead of on a shelf, and the side of a hill is a wall to a ball at its foot. Parts standing on shaped ground take its h as their y (a bucket at the bottom of a pit with h -2 has y -2); the ball never starts in a ditch. Give blocks the mission's names ("river", "moat", "lava", "crater", "hill"). Put at least one shaped block between the start and the farthest target. Only when the request asks for flat ground do you leave "terrain" out. Write "terrain" before "parts" in the JSON.

THE WORLD ("landscape", optional): ${WORLD_BRIEF} When the request asks for things in the way, also put 2 to 5 fixed walls with a matching "prop" beside the route (never on the ball's way).

SCENERY: a wall or platform with "fixed": true is part of the level: it stays on the stage, the player does not get it in the bin and has to get past it or use it. Besides the shaped ground, most levels have a fixed wall standing in the ball's path between the start and the farthest target (same row as the route, on the floor or a shelf), so the route must go over it (a drop from a high shelf clears a 2-cell wall, a cannon, a trampoline) or around it (a fan or cannon facing another way). Fixed platforms are ledges the route may land on. Mark 1 to 3 scenery parts, never the ball, a target, or a part that moves the ball.

VARIETY: levels must not all look alike. "Ramp, cannon over the wall, bucket" is the shape to avoid: use a cannon in at most one level in three, and never as a reflex. Pick the main link from the mission and the twist in the request: a fan beside the path pushing the ball sideways, a trampoline up to a ledge, a seesaw tipping the ball down onto a ramp facing the other way, a long row of dominoes turning the corner, drops from shelf to lower shelf, a hill start with two legs on different rows, a gap in a pair of walls. Mix which part turns the corner, which scenery blocks the way and where the ball starts.

THE BIN: every part of your route that is not the ball, a target, scenery or a shelf under a target or the ball goes into the player's bin. A bin of one ramp is not a puzzle: build the route from 3 to 5 such parts (ramps, free shelves, fans, trampolines, a seesaw, at most one cannon), each standing on the ground or a free shelf, so the player has to work out the order.

SPARES: give the player 2 or 3 "spares" (as many as the difficulty says), extra parts beyond your route (a ramp, a shelf, a trampoline, a fan, a wall): the player gets your route's parts and the spares mixed in the bin with no positions, so the spares make them think and offer another way. Spares are kinds only, no positions.

GOALS: an ordered list of 1 to 4 events the machine must make happen, in order:
- {"type": "bucket", "part": id}: the ball settles in that bucket.
- {"type": "bell", "part": id, "times": n}: that bell rings n times (1 to 3; 1 unless the request says otherwise).
- {"type": "topple", "part": id}: every domino in that row falls.
- {"type": "touch", "part": id}: the ball touches or passes through that part (seesaw, cannon, trampoline, fan, ramp, platform).
Use 2 or 3 goals that tell the story of the chain; the last one is usually the bucket or the bell.

DESIGN RULES
- 6 to 12 parts. The ball starts at the highest point; everything after it is lower or reached by a cannon or trampoline. Energy only comes from height, fans, trampolines and cannons.
- Keep the chain on one z row where possible so parts line up; when a part must sit on a shelf, give the shelf the same y as the part and start the shelf at or before the part.
- Leave 1 to 2 cells of platform after a ramp before the next part, so the ball is rolling steadily when it arrives.
- Each part must be reachable from the previous one: a rolling ball stays on the level it is on, drops at platform ends, flies 6 to 7 cells from a cannon, rises 3 cells from a trampoline.
- Dominoes end where the bell is: for 5 dominoes starting at x, put the bell at x+3 on the same y.
- Every part gets its own cell: never put two parts at the same x, y, z (a bell and a cannon in one cell block each other). Only a platform shares its cells with what stands on it.
- Every part except the ball stands on something: the ground (y 0 on the flat floor, the block's h on shaped ground) or a platform at the same y whose cells include the part's cell. Nothing else floats.
- Ids: short lowercase words (ball, ramp1, row, bell). Do not set dx or dz.
- "title": 2 to 5 playful words. "caption": one sentence for players describing what should happen, no numbers.
- If the request is not about machines, reinterpret it playfully as a machine (a pizza delivery becomes a ball rolling into a bucket called "oven"); use the request's words in the title, caption and ids.
- If the request asks for something the kit cannot do (a part that is not in the kit, water flowing, two balls, a loop-the-loop, a moving target), build the closest level you can and set "closest" to one honest, friendly sentence for the player saying what you built instead ("No elephants in the kit, so a heavy ball plays the elephant"). Leave "closest" out when you built what was asked.

JSON schema of the machine:
${MACHINE_SCHEMA}

Example reply content:
${JSON.stringify(EXAMPLE)}

Reply with only the JSON object inside a single \`\`\`json code block. No other text.`;

export interface MachineDesign {
  spec: MachineSpec;
  notes: string[];
}

export function formatMachineIssues(issues: SpecIssue[]): string {
  return issues.slice(0, 20).map((i) => `- ${i.path || '(root)'}: ${i.message}`).join('\n');
}

const text = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined);

/** Validate the machine and drop any fine offsets the model wrote (those belong to the optimizer). */

/** Twists the server hands out so one mission does not always get the same level; the mission's own words win. */
export const TWISTS = [
  'a fan beside the path blows the ball sideways along the bank into the target; no cannon',
  'a trampoline bounces the ball up onto a high ledge where the target waits; no cannon',
  'a seesaw on a bank tips the ball down onto a ramp that faces the other way; no cannon',
  'a long row of dominoes carries the action round the corner to the bell; the ball only has to start it',
  'the ball starts on top of a hill and the route winds down it in two legs on different rows',
  'a pit between the start and the target: the only way across is a cannon shot from a shelf',
  'the target sits at the bottom of a pit; the route ends with a drop into it',
  'a pair of walls with a one-cell gap: a fan pushes the ball through the gap',
  'two shelves at different heights: the ball drops from one to the other and turns the corner on the lower one',
];

/** A twist for a mission that names no mechanism of its own (deterministic when `seed` is given). */
export function pickTwist(request: string, seed?: number): string | undefined {
  if (/\b(fan|trampoline|seesaw|cannon|dominoe?s?|shelf|shelves|hill|pit|ditch|river|moat|gap|flat)\b/i.test(request)) return undefined;
  const n = seed === undefined ? Math.floor(Math.random() * TWISTS.length) : Math.abs(seed) % TWISTS.length;
  return TWISTS[n];
}

export type Difficulty = 'easy' | 'normal' | 'hard';

/** What a difficulty word in the mission means, enforced at validation: how far the route runs and how full the bin is. */
export const DIFFICULTY: Record<Difficulty, { spreadMin: number; bin: BinRule; brief: string }> = {
  easy: { spreadMin: 8, bin: { minRoute: 1, minSpares: 1 }, brief: 'EASY: a short route (8 to 11 cells), one turn, 2 or 3 route parts and 1 spare; a first-timer should solve it in a try or two' },
  normal: { spreadMin: SPREAD_MIN, bin: { minRoute: 2, minSpares: 2 }, brief: 'NORMAL: 3 or 4 route parts and 2 spares' },
  hard: { spreadMin: 14, bin: { minRoute: 3, minSpares: 3 }, brief: 'HARD: a long route (14 or more cells) with two turns or a height change, 4 to 6 route parts and 3 spares that look useful' },
};

/** The difficulty a mission asks for in plain words ("an easy one", "make it fiendish"); normal when it says nothing. */
export function difficultyOf(request: string): Difficulty {
  if (/\b(hard|harder|difficult|tricky|tough|expert|fiendish|brutal|insane|evil)\b/i.test(request)) return 'hard';
  if (/\b(easy|easier|simple|beginners?|tiny|gentle|kids?|first)\b/i.test(request)) return 'easy';
  return 'normal';
}

/** True when the request asks for flat ground, the one case where the designer may leave the terrain out. */
const inner = (json: unknown): Record<string, unknown> | null => {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return null;
  const o = json as Record<string, unknown>;
  return o.machine && typeof o.machine === 'object' ? (o.machine as Record<string, unknown>) : o;
};
const hasField = (json: unknown, key: string) => !!inner(json) && key in inner(json)!;

/** Set a field on a designer's reply (top level or nested under "machine"). */
function withField(json: unknown, key: string, value: unknown): unknown {
  const o = inner(json);
  if (value === undefined || !o) return json;
  return o === json ? { ...o, [key]: value } : { ...(json as object), machine: { ...o, [key]: value } };
}

/** Set the stage on a designer's reply. */
export const withStage = (json: unknown, stage: Stage | undefined) => withField(json, 'stage', stage);

export const wantsFlat = (request: string) => /\bflat\b/i.test(request);

/**
 * `difficulty` sets how far the route must run; `bin` (puzzle levels, where the player builds the
 * route) also wants the bin full enough to be a puzzle.
 */
export function validateMachineDesign(json: unknown, opts: { layout?: boolean; flat?: boolean; difficulty?: Difficulty; bin?: boolean } = {}): Validation<MachineDesign> {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return { ok: false, problems: '- expected a JSON object' };
  const { machine: nested, ...rest } = json as Record<string, unknown>;
  const raw = nested && typeof nested === 'object' ? nested : rest;
  const parsed = parseMachine(raw);
  if (!parsed.ok) return { ok: false, problems: formatMachineIssues(parsed.issues) };
  const spec: MachineSpec = {
    ...parsed.spec,
    caption: text(parsed.spec.caption, 240),
    closest: text(parsed.spec.closest, 200),
    parts: parsed.spec.parts.map(({ dx: _dx, dz: _dz, ...p }) => p),
  };
  // A level, not just a machine: the goal has to be far enough from the start to build a route.
  const rules = opts.difficulty ? DIFFICULTY[opts.difficulty] : undefined;
  const layout = opts.layout === false ? [] : [...layoutProblems(spec, { flat: opts.flat, spreadMin: rules?.spreadMin }), ...(rules && opts.bin ? binProblems(spec, rules.bin) : [])];
  if (layout.length) return { ok: false, problems: layout.map((l) => `- ${l}`).join('\n') };
  return { ok: true, value: { spec, notes: [] } };
}

/**
 * An edit is a design that also keeps the lock: the ball and the goal parts stay, the goal does
 * not get easier. The prompt says so too, but this is what is trusted; a reply that breaks it is
 * sent back with the reason, like any other invalid machine.
 */
export function validateMachineEdit(original: MachineSpec): (json: unknown) => Validation<MachineDesign> {
  return (json) => {
    // The lock first: "you moved the ball" is the reason the model needs, not "the goal got closer".
    // A rewrite that leaves the stage or the world out keeps the original's.
    const staged = hasField(json, 'stage') ? json : withStage(json, original.stage);
    const v = validateMachineDesign(hasField(json, 'landscape') || !original.landscape ? staged : withField(staged, 'landscape', original.landscape), { layout: false });
    if (!v.ok) return v;
    // An edit never has to add terrain or scenery: a player who fills in the river gets no river.
    const problems = [...lockProblems(original, v.value.spec), ...layoutProblems(v.value.spec, { flat: true, scenery: false })];
    return problems.length ? { ok: false, problems: problems.map((p) => `- ${p}`).join('\n') } : v;
  };
}

/** The fixed parts and the player's names for every part, for the edit prompt. */
export function describeLocks(spec: MachineSpec): string {
  const names = partNames(spec.parts);
  const locked = [...lockedParts(spec)].flatMap((id) => {
    const p = spec.parts.find((q) => q.id === id);
    return p ? [`"${p.id}" (the ${names.get(id)}) at x ${p.x}, y ${p.y}, z ${p.z}, yaw ${p.yaw}${p.length ? `, length ${p.length}` : ''}`] : [];
  });
  return `Names the player uses for the parts: ${[...names].map(([id, name]) => `${name} = "${id}"`).join(', ')}.

FIXED PARTS (the game's rule): the ball and every part the goal names stay exactly as they are, same id, kind, x, y, z, yaw and length: ${locked.join('; ')}. Never move, remove, replace or re-aim them. The ground ("terrain") changes only when the player asks to dig, raise, flatten or move it, and never under the ball or a goal part; a part standing on reshaped ground gets the new ground's height as its y. Every goal step stays in the same order; a bell may ring more times, never fewer; steps may be added. Players build the chain between the fixed parts themselves, so moving a fixed part would end the game instead of changing it. If the request asks to change a fixed part, leave that part alone and apply the rest of the request to the other parts (add, move or swap those).`;
}

/** Parts that are already complete in a partly streamed reply, so a UI can show them appear. */
export function sketchMachine(textSoFar: string): { title?: string; parts: Part[]; terrain: Terrain[] } {
  const rawTitle = textSoFar.match(/"title"\s*:\s*"((?:[^"\\]|\\.)*)"/)?.[1];
  let title: string | undefined;
  if (rawTitle !== undefined) {
    try { title = JSON.parse(`"${rawTitle}"`) as string; } catch { title = rawTitle; }
  }
  return { title, parts: completeObjects(textSoFar, '"parts"', Part), terrain: completeObjects(textSoFar, '"terrain"', Terrain) };
}

/** The objects of the array under `key` that are complete so far in a partly streamed JSON text. */
function completeObjects<T>(textSoFar: string, key: string, schema: { safeParse: (v: unknown) => { success: boolean; data?: T } }): T[] {
  const parts: T[] = [];
  const at = textSoFar.indexOf(key);
  const open = at < 0 ? -1 : textSoFar.indexOf('[', at);
  if (open < 0) return parts;
  let depth = 0, inString = false, escaped = false, start = -1;
  for (let i = open + 1; i < textSoFar.length; i++) {
    const ch = textSoFar[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0 && start >= 0) {
        try {
          const p = schema.safeParse(JSON.parse(textSoFar.slice(start, i + 1)));
          if (p.success && p.data !== undefined) parts.push(p.data);
        } catch {
          // An unfinished or broken object: skip it.
        }
        start = -1;
      }
    } else if (ch === ']' && depth === 0) break;
  }
  return parts;
}

const MODEL = () => process.env.CLAUDE_MACHINE_MODEL ?? 'claude-sonnet-5-5';

export async function designMachine(llm: LlmBackend, userPrompt: string, calls: Completion[], onProgress?: (textSoFar: string) => void, opts: { twist?: string; bin?: boolean; stage?: Stage } = {}): Promise<MachineDesign> {
  const twist = opts.twist ? `\n\nThis level's twist, use it: ${opts.twist}.` : '';
  const difficulty = difficultyOf(userPrompt);
  return requestValidated(
    llm,
    { system: MACHINE_PROMPT, prompt: `Design a level for this mission:\n\n${userPrompt}${twist}\n\nDifficulty: ${DIFFICULTY[difficulty].brief}.`, thinking: 'off', maxTokens: 4000, model: MODEL() },
    (json) => validateMachineDesign(withStage(json, opts.stage), { flat: wantsFlat(userPrompt), difficulty, bin: opts.bin }),
    calls,
    2,
    onProgress,
  );
}

export interface MachineRedesignContext {
  request: string;
  previous: MachineSpec;
  result: MachineResult;
  events: MachineEvent[];
  evals: number;
}

/** What happened, as a short timeline the model can reason about. */
export function describeRun(events: MachineEvent[]): string {
  const lines = events.slice(0, 30).map((e) => `${e.t.toFixed(1)} s: ${e.type === 'fell' ? 'the ball fell off the stage' : `${e.type} ${e.part}`}`);
  return lines.length ? lines.join('\n') : 'nothing happened: the ball did not touch any part';
}

/** Ask for a fix after the physics (plus the optimizer's nudges) could not make the chain happen. */
export async function redesignMachine(
  llm: LlmBackend, ctx: MachineRedesignContext, calls: Completion[], onProgress?: (textSoFar: string) => void,
  validate: (json: unknown) => Validation<MachineDesign> = validateMachineDesign,
): Promise<MachineDesign> {
  const failed = ctx.result.steps.find((s) => !s.satisfied);
  const prompt = `${ctx.request}

The previous machine did not work, even after the optimizer tried ${ctx.evals} nudged variants. Goal check:
${ctx.result.steps.map((s, i) => `${i + 1}. ${s.satisfied ? 'OK' : 'FAILED'}: ${s.note}`).join('\n')}

What happened in the best variant:
${describeRun(ctx.events)}

Previous machine:
${JSON.stringify(ctx.previous)}

Fix it while keeping the idea${failed ? `, focusing on why "${failed.note}"` : ''}: check that each part is reachable from the one before (right row, right height, within rolling or flying range), that shelves support what stands on them, and that the ball cannot roll off an edge before the next part. Reply with the full JSON object.`;
  return requestValidated(llm, { system: MACHINE_PROMPT, prompt, thinking: 'off', maxTokens: 4000, model: MODEL() }, validate, calls, 2, onProgress);
}

/** Talk-to-edit: apply a plain-language change to an existing machine, keeping the ball and the goal parts where they are. */
export async function editMachineDesign(llm: LlmBackend, spec: MachineSpec, instruction: string, calls: Completion[], onProgress?: (textSoFar: string) => void): Promise<MachineDesign> {
  const prompt = `${editMachineRequest(spec, instruction)}

Current machine:
${JSON.stringify(spec)}

Apply the change and keep everything else as it is where possible (same ids and positions for untouched parts). Update the caption, and add goal steps, if the request changes what should happen. Reply with the full JSON object.`;
  return requestValidated(llm, { system: MACHINE_PROMPT, prompt, thinking: 'off', maxTokens: 4000, model: MODEL() }, validateMachineEdit(spec), calls, 2, onProgress);
}

/** The edit request as the redesign step repeats it: the change, plus the lock it must keep. */
export const editMachineRequest = (spec: MachineSpec, instruction: string) =>
  `Edit the machine "${spec.title}" with this change requested by the player:\n\n${instruction}\n\n${describeLocks(spec)}`;
