import { z } from 'zod';
import { MachineSpec, Part, parseMachine, type MachineEvent, type MachineResult, type SpecIssue } from '@og/machine';
import example from '@og/machine/fixtures/ramp-dominoes-bell.json' with { type: 'json' };
import type { Completion, LlmBackend } from '../llm/client';
import { requestValidated, type Validation } from '../llm/design';

export const MACHINE_SCHEMA = JSON.stringify(z.toJSONSchema(MachineSpec, { io: 'input' }));

const EXAMPLE = { ...example, caption: 'Down the ramp, through the dominoes, and the bell rings.' };

/**
 * The parts manual. Everything the model needs to compose a chain that works on the first try
 * most of the time; the optimizer only nudges parts by up to a cell, so the sequence and the
 * rough alignment have to come from here.
 */
export const MACHINE_PROMPT = `You design Rube Goldberg machines for Prompt Goldberg, a browser toy where a user describes a contraption in plain language, you build it from a fixed kit of parts, and a rigid-body physics engine runs it to see whether the goal chain happens. An optimizer then nudges parts by up to a cell to make it work, so get the sequence and the rough alignment right rather than exact numbers.

THE STAGE
A grid of 0.5 m cells: x from 0 (west) to 23 (east), z from 0 (north) to 23 (south), y from 0 (the floor) to 15 (height of a part's base, in cells). Gravity points down. One ball (radius 0.16 m, a third of a cell) starts at rest and everything else is triggered by it. There are no walls around the stage: a ball that rolls off the edge is lost.

FACING ("yaw"): 0 = toward +x (east), 90 = toward +z (south), 180 = toward -x (west), 270 = toward -z (north). Most machines run in a straight line along x on one z row, using yaw 0 everywhere; turn corners with a cannon or a fan facing another way.

THE KIT (each part stands on its cell at height y unless said otherwise)
- ball: the one ball. Place it at (x, y+1, z) directly above the high end of a ramp at (x, y, z) so it drops onto the ramp and rolls off; or above a platform.
- ramp: a wedge 2 cells long: the high end (1 cell tall) is in its own cell, the low end is in the next cell toward its facing. The ball leaves the low end at height y, rolling toward the facing at about 2.5 m/s (it then travels 3 to 5 cells on a flat platform at the same y).
- platform: a flat shelf, "length" cells long (1 to 8, default 3), 1 cell wide, extending from its cell toward its facing. Its TOP is at height y, so parts standing on it use the same y. A ball rolling off the far end falls.
- wall: thin, 1 cell wide, 2 cells tall, standing across its facing; a ball rolling into it bounces back.
- dominoes: a row of "length" standing dominoes (3 to 8, default 5) starting in its cell and continuing toward its facing, 0.24 m apart (5 dominoes span about 2.5 cells). A rolling ball knocks the first one, they fall in sequence, and the last one falling can ring a bell placed in the next cell. They need something to stand on: the floor (y 0) or a platform with the same y.
- seesaw: a plank 3 cells long centred on its cell on a pivot 0.22 m high. A ball rolling onto one end tips the plank and rolls off the other end slightly lower; it adds a dramatic pause.
- fan: blows the ball toward its facing, 3 cells in front of it, at about 9 m/s2 while the ball is in the stream (height y to y+1). Put it beside the ball's path, facing along the path, to push the ball further, up a shallow slope or off a shelf.
- trampoline: a 1-cell pad; a ball landing on it bounces straight up at 5.5 m/s (about 3 cells high) while keeping its horizontal speed. Good for getting back up to a higher shelf.
- cannon: when the ball rolls or falls into its cell (the barrel spans height y to y+0.4 m), it fires the ball toward its facing at 6.5 m/s, 25 degrees up. On flat ground the ball lands about 6 to 7 cells away (rising less than a cell). The reliable way to turn a corner or jump a gap.
- bucket: a 1-cell box with walls 0.45 m high, open at the top. The ball has to land in it from above and settle. The usual final goal.
- bell: a short post 0.36 m tall; rings when the ball or a falling domino hits it.

GOALS: an ordered list of 1 to 4 events the machine must make happen, in order:
- {"type": "bucket", "part": id}: the ball settles in that bucket.
- {"type": "bell", "part": id, "times": n}: that bell rings n times (1 to 3; 1 unless the request says otherwise).
- {"type": "topple", "part": id}: every domino in that row falls.
- {"type": "touch", "part": id}: the ball touches or passes through that part (seesaw, cannon, trampoline, fan, ramp, platform).
Use 2 or 3 goals that tell the story of the chain; the last one is usually the bucket or the bell.

DESIGN RULES
- 4 to 10 parts. The ball starts at the highest point; everything after it is lower or reached by a cannon or trampoline. Energy only comes from height, fans, trampolines and cannons.
- Keep the chain on one z row where possible so parts line up; when a part must sit on a shelf, give the shelf the same y as the part and start the shelf at or before the part.
- Leave 1 to 2 cells of platform after a ramp before the next part, so the ball is rolling steadily when it arrives.
- Each part must be reachable from the previous one: a rolling ball stays on the level it is on, drops at platform ends, flies 6 to 7 cells from a cannon, rises 3 cells from a trampoline.
- Dominoes end where the bell is: for 5 dominoes starting at x, put the bell at x+3 on the same y.
- Ids: short lowercase words (ball, ramp1, row, bell). Do not set dx or dz.
- "title": 2 to 5 playful words. "caption": one sentence for players describing what should happen, no numbers.
- If the request is not about machines, reinterpret it playfully as a machine (a pizza delivery becomes a ball rolling into a bucket called "oven"); use the request's words in the title, caption and ids.

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
export function validateMachineDesign(json: unknown): Validation<MachineDesign> {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return { ok: false, problems: '- expected a JSON object' };
  const { machine: nested, ...rest } = json as Record<string, unknown>;
  const raw = nested && typeof nested === 'object' ? nested : rest;
  const parsed = parseMachine(raw);
  if (!parsed.ok) return { ok: false, problems: formatMachineIssues(parsed.issues) };
  const spec: MachineSpec = {
    ...parsed.spec,
    caption: text(parsed.spec.caption, 240),
    parts: parsed.spec.parts.map(({ dx: _dx, dz: _dz, ...p }) => p),
  };
  return { ok: true, value: { spec, notes: [] } };
}

/** Parts that are already complete in a partly streamed reply, so a UI can show them appear. */
export function sketchMachine(textSoFar: string): { title?: string; parts: Part[] } {
  const rawTitle = textSoFar.match(/"title"\s*:\s*"((?:[^"\\]|\\.)*)"/)?.[1];
  let title: string | undefined;
  if (rawTitle !== undefined) {
    try { title = JSON.parse(`"${rawTitle}"`) as string; } catch { title = rawTitle; }
  }
  const parts: Part[] = [];
  const key = textSoFar.indexOf('"parts"');
  const open = key < 0 ? -1 : textSoFar.indexOf('[', key);
  if (open < 0) return { title, parts };
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
          const p = Part.safeParse(JSON.parse(textSoFar.slice(start, i + 1)));
          if (p.success) parts.push(p.data);
        } catch {
          // An unfinished or broken part: skip it.
        }
        start = -1;
      }
    } else if (ch === ']' && depth === 0) break;
  }
  return { title, parts };
}

const MODEL = () => process.env.CLAUDE_MACHINE_MODEL ?? 'claude-sonnet-5-5';

export async function designMachine(llm: LlmBackend, userPrompt: string, calls: Completion[], onProgress?: (textSoFar: string) => void): Promise<MachineDesign> {
  return requestValidated(
    llm,
    { system: MACHINE_PROMPT, prompt: `Design a machine for this request:\n\n${userPrompt}`, thinking: 'off', maxTokens: 4000, model: MODEL() },
    validateMachineDesign,
    calls,
    1,
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
export async function redesignMachine(llm: LlmBackend, ctx: MachineRedesignContext, calls: Completion[], onProgress?: (textSoFar: string) => void): Promise<MachineDesign> {
  const failed = ctx.result.steps.find((s) => !s.satisfied);
  const prompt = `${ctx.request}

The previous machine did not work, even after the optimizer tried ${ctx.evals} nudged variants. Goal check:
${ctx.result.steps.map((s, i) => `${i + 1}. ${s.satisfied ? 'OK' : 'FAILED'}: ${s.note}`).join('\n')}

What happened in the best variant:
${describeRun(ctx.events)}

Previous machine:
${JSON.stringify(ctx.previous)}

Fix it while keeping the idea${failed ? `, focusing on why "${failed.note}"` : ''}: check that each part is reachable from the one before (right row, right height, within rolling or flying range), that shelves support what stands on them, and that the ball cannot roll off an edge before the next part. Reply with the full JSON object.`;
  return requestValidated(llm, { system: MACHINE_PROMPT, prompt, thinking: 'off', maxTokens: 4000, model: MODEL() }, validateMachineDesign, calls, 1, onProgress);
}

/** Talk-to-edit: apply a plain-language change to an existing machine. */
export async function editMachineDesign(llm: LlmBackend, spec: MachineSpec, instruction: string, calls: Completion[], onProgress?: (textSoFar: string) => void): Promise<MachineDesign> {
  const prompt = `${editMachineRequest(spec, instruction)}

Current machine:
${JSON.stringify(spec)}

Apply the change and keep everything else as it is where possible (same ids and positions for untouched parts). Update the goal and caption if the request changes what should happen. Reply with the full JSON object.`;
  return requestValidated(llm, { system: MACHINE_PROMPT, prompt, thinking: 'off', maxTokens: 4000, model: MODEL() }, validateMachineDesign, calls, 1, onProgress);
}

export const editMachineRequest = (spec: MachineSpec, instruction: string) =>
  `Edit the machine "${spec.title}" with this change requested by the player:\n\n${instruction}`;
