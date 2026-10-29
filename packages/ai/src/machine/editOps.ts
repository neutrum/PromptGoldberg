/**
 * Talk-to-edit as diff operations: a fast model answers "add a trampoline" with a few ops (add,
 * remove, move, rotate, swap, set) against a compact part list, and the ops are applied here, so
 * untouched parts never move and the reply is a few dozen tokens instead of the whole machine.
 * The result is checked like any edit (the lock, nothing floating); a reply that breaks it is sent
 * back with the reason, and the full rewrite is the fallback.
 */
import { z } from 'zod';
import { groundAt, Landscape, MachineGoal, Part, PartKind, Stage, stageOf, Terrain, Yaw, type MachineSpec } from '@og/machine';
import type { Completion, LlmBackend } from '../llm/client';
import { requestValidated, type Validation } from '../llm/design';
import { describeLocks, validateMachineEdit, type MachineDesign } from './design';

const Cell = z.number().int();

export const EditOp = z.discriminatedUnion('op', [
  z.object({ op: z.literal('add'), part: Part.omit({ dx: true, dz: true }) }),
  z.object({ op: z.literal('remove'), id: z.string() }),
  z.object({ op: z.literal('move'), id: z.string(), x: Cell.optional(), y: Cell.optional(), z: Cell.optional() }),
  z.object({ op: z.literal('rotate'), id: z.string(), yaw: Yaw }),
  z.object({ op: z.literal('swap'), id: z.string(), kind: PartKind.exclude(['ball']) }),
  z.object({ op: z.literal('ground'), ...Terrain.shape }),
  z.object({ op: z.literal('flatten'), name: z.string().optional() }),
  z.object({ op: z.literal('stage'), ...Stage.shape }),
  z.object({ op: z.literal('landscape'), ...Landscape.shape }),
  z.object({ op: z.literal('clearLandscape') }),
  z.object({ op: z.literal('set'), id: z.string(), length: z.number().int().min(1).max(8).optional(), label: z.string().max(40).optional(), color: z.string().regex(/^#[0-9a-f]{6}$/i).optional() })
    .refine((op) => op.length !== undefined || op.label !== undefined || op.color !== undefined, 'set needs a length, label, or color'),
]);
export type EditOp = z.infer<typeof EditOp>;

export const EditReply = z.object({
  ops: z.array(EditOp).min(1).max(12),
  caption: z.string().optional(),
  /** Goal steps to append (the lock keeps the old ones). */
  addGoal: z.array(MachineGoal).max(2).optional(),
});
export type EditReply = z.infer<typeof EditReply>;

/** One line per part, the way the edit prompt shows the machine. */
export function partLines(spec: MachineSpec): string {
  return spec.parts.map((p) => `${p.id}: ${p.kind} x ${p.x} y ${p.y} z ${p.z} yaw ${p.yaw}${p.length ? ` length ${p.length}` : ''}${p.label ? ` label ${JSON.stringify(p.label)}` : ''}${p.color ? ` color ${p.color}` : ''}${p.fixed ? ' (scenery)' : ''}`).join('\n');
}

/** Apply the ops in order; unknown ids are reported, not ignored. */
export function applyOps(spec: MachineSpec, reply: EditReply): { spec: MachineSpec; problems: string[] } {
  const parts = spec.parts.map((p) => ({ ...p }));
  const problems: string[] = [];
  const find = (id: string) => parts.findIndex((p) => p.id === id);
  let terrain = [...(spec.terrain ?? [])];
  let stage = spec.stage;
  let landscape = spec.landscape;
  for (const op of reply.ops) {
    if (op.op === 'ground') {
      const { op: _op, ...block } = op;
      terrain.push(block);
      continue;
    }
    if (op.op === 'flatten') {
      const before = terrain.length;
      terrain = op.name ? terrain.filter((t) => t.name?.toLowerCase() !== op.name!.toLowerCase()) : [];
      if (op.name && terrain.length === before) problems.push(`flatten: no ground named "${op.name}"; the ground is ${spec.terrain?.map((t) => t.name ?? 'block').join(', ') || 'flat'}`);
      continue;
    }
    if (op.op === 'landscape') {
      const { op: _op, ...world } = op;
      landscape = world;
      continue;
    }
    if (op.op === 'clearLandscape') {
      landscape = undefined;
      continue;
    }
    if (op.op === 'stage') {
      stage = op.x === 24 && op.z === 24 ? undefined : { x: op.x, z: op.z };
      continue;
    }
    if (op.op === 'add') {
      if (find(op.part.id) >= 0) problems.push(`add: there is already a part "${op.part.id}"; pick a new id`);
      else parts.push({ ...op.part });
      continue;
    }
    const i = find(op.id);
    if (i < 0) { problems.push(`${op.op}: no part "${op.id}"`); continue; }
    const p = parts[i];
    switch (op.op) {
      case 'remove': parts.splice(i, 1); break;
      // A part that moves keeps no fine offsets: those belong to the cell it left.
      case 'move': parts[i] = { ...p, x: op.x ?? p.x, y: op.y ?? p.y, z: op.z ?? p.z, dx: undefined, dz: undefined }; break;
      case 'rotate': parts[i] = { ...p, yaw: op.yaw }; break;
      case 'swap': parts[i] = { ...p, kind: op.kind, length: undefined }; break;
      case 'set': parts[i] = { ...p, ...(op.length !== undefined ? { length: op.length } : {}), ...(op.label !== undefined ? { label: op.label } : {}), ...(op.color !== undefined ? { color: op.color } : {}) }; break;
    }
  }
  if (terrain.length > 6) problems.push(`ground: at most 6 blocks of ground (there would be ${terrain.length}); flatten one by name first`);
  // Parts that stood on the ground follow it up or down; shelves (and what stands on them) stay put.
  for (const [i, p] of parts.entries()) {
    const was = groundAt(spec.terrain, p.x, p.z), now = groundAt(terrain, p.x, p.z);
    if (p.kind !== 'platform' && was !== now && p.y === was && spec.parts.some((q) => q.id === p.id)) parts[i] = { ...p, y: now };
  }
  const { stage: _stage, terrain: _terrain, landscape: _landscape, ...rest } = spec;
  return {
    spec: { ...rest, ...(stage ? { stage } : {}), ...(landscape ? { landscape } : {}), ...(terrain.length ? { terrain } : {}), parts, caption: reply.caption ?? spec.caption, goal: [...spec.goal, ...(reply.addGoal ?? [])] },
    problems,
  };
}

export const EDIT_OPS_PROMPT = `You edit Rube Goldberg puzzle levels in Prompt Goldberg by answering with a few EDIT OPERATIONS, never the whole machine. The stage is a grid of 0.5 m cells, its size given with the machine (x 0..X-1 west to east, z 0..Z-1 north to south), y is the height of a part's base in cells (0 is the floor; on a shelf it is the shelf's y; on shaped ground the ground's height). Yaw: 0 = east (+x), 90 = south (+z), 180 = west, 270 = north. A ramp slopes down toward its yaw; fans blow and cannons fire toward it.

Parts: ramp (2 cells long), platform (a shelf, "length" cells long toward its yaw, its top at y), wall, dominoes ("length" 3 to 8 standing in a row toward yaw), seesaw (3 cells), fan (blows 3 cells ahead), trampoline (bounces a falling ball up), cannon (fires a ball that rolls or falls into its cell 6 to 9 cells toward yaw), bucket, bell.

Operations (JSON):
- {"op":"add","part":{"id","kind","x","y","z","yaw","length"?}}: a new part with a new short id. It must stand on the ground or on a shelf at its y, in a cell no other part uses.
- {"op":"remove","id"}
- {"op":"move","id","x"?,"y"?,"z"?}
- {"op":"rotate","id","yaw"}
- {"op":"swap","id","kind"}: same place, another kind.
- {"op":"set","id","length"?,"label"?,"color"?}: change length, a friendly name, or a six-digit hex color. Use label for "name/call it", color for "paint/color it". Appearance changes do not move parts or change physics.
- {"op":"ground","name"?,"x","z","w","d","h"}: shape the ground: a block w cells along x and d along z from its north-west cell (x, z), at height h (-2 to 3). Negative digs a ditch, pit, river or moat (name it, e.g. "river", so it is drawn as water); positive raises a hill or bank; 0 levels that area back to the floor. Later blocks cover earlier ones; at most 6 blocks in all. Parts standing on the ground there move to its new height; never reshape the ground under the ball or a goal part.
- {"op":"flatten","name"?}: remove the ground block with that name, or all of the ground without a name.
- {"op":"landscape","name","sky","ground","land","rock","water","foliage","accent","features":[{"kind","amount"}],"snow"?}: the world around the board, for "make it look like...", "a terrain of forests and hills in British Columbia", "turn it into a desert". Colours are six-digit hex true to the place ("ground" is the floor under the machine, "land" the land around the board). Features, 3 to 6: conifers, broadleaf, birches, palms, cacti, bushes, flowers, mushrooms, reeds, rocks, boulders, hills, mountains, lake, snowdrifts; amount few, some or many. Looks only: it replaces the whole world and never moves a part. Add "ground" ops too only when the player wants the ball's own ground reshaped.
- {"op":"clearLandscape"}: back to the plain workshop.
- {"op":"stage","x","z"}: resize the stage (12 to 32 cells each way, default 24). Every part and ground block must still fit; when shrinking, move what would fall off first.

Reply with {"ops":[...], "caption"?: one new sentence for players when what happens changes, "addGoal"?: goal steps to add at the end, like {"type":"touch","part":"tramp1"} or {"type":"bell","part":"bell","times":2}}. Use as few ops as the request needs and leave every other part alone.

Reply with only the JSON object inside a single \`\`\`json code block.`;

const MODEL = () => process.env.CLAUDE_EDIT_MODEL ?? 'claude-haiku-5-5';

export function validateOpsEdit(original: MachineSpec): (json: unknown) => Validation<MachineDesign> {
  const edit = validateMachineEdit(original);
  return (json) => {
    const r = EditReply.safeParse(json);
    if (!r.success) return { ok: false, problems: r.error.issues.slice(0, 8).map((i) => `- ${i.path.join('.')}: ${i.message}`).join('\n') };
    const applied = applyOps(original, r.data);
    if (applied.problems.length) return { ok: false, problems: applied.problems.map((p) => `- ${p}`).join('\n') };
    const v = edit(applied.spec);
    // The check drops fine offsets (the full designer must not write them); parts the ops left alone keep the optimizer's.
    return v.ok ? { ok: true, value: { spec: { ...v.value.spec, parts: applied.spec.parts }, notes: [] } } : v;
  };
}

/** The edit as ops: a fast model, a short reply, untouched parts kept exactly. */
export function editByOps(llm: LlmBackend, spec: MachineSpec, instruction: string, calls: Completion[]): Promise<MachineDesign> {
  const stage = stageOf(spec);
  const prompt = `Machine "${spec.title}" on a ${stage.x} by ${stage.z} stage (x 0..${stage.x - 1}, z 0..${stage.z - 1})${spec.landscape ? `, world: ${spec.landscape.name}` : ''}${spec.terrain?.length ? `, ground: ${spec.terrain.map((t) => `${t.name ?? 'block'} x ${t.x}..${t.x + t.w - 1} z ${t.z}..${t.z + t.d - 1} at height ${t.h}`).join('; ')}` : ''}.
Parts:
${partLines(spec)}
Goal: ${spec.goal.map((g) => `${g.type} ${g.part}${g.type === 'bell' ? ` times ${g.times}` : ''}`).join(' -> ')}

${describeLocks(spec)}

The player asks: ${instruction}`;
  return requestValidated(llm, { system: EDIT_OPS_PROMPT, prompt, thinking: 'off', maxTokens: 700, model: MODEL() }, validateOpsEdit(spec), calls, 1);
}
