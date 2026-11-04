/**
 * Composing the recipe library: the AI builds each common thing once from simple shapes, the
 * review page keeps or redoes it, and the game looks it up by words with no AI call.
 */
import { z } from 'zod';
import { isSolidShape, LandmarkShape } from '@pg/core';
import type { Completion, LlmBackend } from '../llm/client';
import { requestValidated } from '../llm/request';

const SYSTEM = `You build toy models of real things from a few simple coloured shapes, for a bright low-poly 3D puzzle game. Each model must be recognisable at a glance from a few metres away.

Units are cells (one cell is 0.5 m). Each shape: {"shape", "at": [along, up, across], "size": [along, height, across], "color": "#rrggbb", optional "tilt", optional "glow"}.
- at: along and across from the model's middle (each within -3 and 3); up is the height of the shape's BOTTOM above the ground (0 stands on the ground, at most 8).
- shapes: box; cylinder (size: diameter, height, -); sphere (diameter); cone (diameter, height); frustum, a cylinder that narrows (bottom diameter, height, top diameter); wheel, a disc standing on its edge with its axle running across (-, diameter, thickness); roof, a gable whose ridge runs along (length, height, width).
- tilt leans a shape toward +along by that many degrees about its bottom (negative leans toward -along): necks, arms, poles, beaks, tails. Shapes cannot lean across, so turn the model so that its leaning parts lean along.
- glow lights a shape: lamps, windows, flames, screens, eyes.

Rules:
- Toy scale, so it reads: small things (fruit, a cup, a shoe, a phone) about 1.5 to 2 cells across; animals, furniture and vehicles 2 to 4 cells long; buildings and landmarks 4 to 6 cells wide and up to 8 tall. Everything within 3 cells of the middle along and across.
- 4 to 14 shapes. The main body first, as an upright box, cylinder or sphere (no tilt): it is what the ball bumps into.
- The shapes touch or overlap so the model reads as one object standing on the ground (the lowest shape at up 0).
- Its front (face, door, headlights, screen) faces +along; a vehicle drives along, so its wheels sit on its sides across.
- The silhouette and the one or two features everyone knows matter most: a giraffe's long neck and spots, an elephant's trunk and ears, the Eiffel Tower's taper, Big Ben's clock face. Real colours.
- No people or faces of real people; for a statue, a simple figure is fine.

Reply with JSON only: {"recipes": [{"id": "<the id given>", "shapes": [ ... ]}]}, one per thing asked, numbers with at most 2 decimals.`;

const Recipe = z.object({
  id: z.string(),
  shapes: z.array(LandmarkShape).min(3).max(14).refine((s) => s.some(isSolidShape), 'at least one upright box, cylinder or sphere (no tilt), the main body'),
});

/** Numbers a little out of range (a 0.04 thin rim, a 95 degree lean) are pulled in, not a reason to throw the recipe away. */
function clamped(r: unknown): unknown {
  const rec = r as { shapes?: unknown };
  if (!rec || !Array.isArray(rec.shapes)) return r;
  const fit = (v: unknown, lo: number, hi: number) => (typeof v === 'number' ? Math.min(hi, Math.max(lo, v)) : v);
  const tuple = (t: unknown, ranges: [number, number][]) => (Array.isArray(t) && t.length === 3 ? t.map((v, i) => fit(v, ...ranges[i])) : t);
  return {
    ...rec,
    shapes: rec.shapes.slice(0, 14).map((s: Record<string, unknown>) => s && typeof s === 'object' ? {
      ...s,
      at: tuple(s.at, [[-3, 3], [-2, 8], [-3, 3]]),
      size: tuple(s.size, [[0.05, 6], [0.05, 8], [0.05, 6]]),
      ...(s.tilt === undefined ? {} : { tilt: fit(s.tilt, -90, 90) }),
    } : s),
  };
}

export interface ComposeItem { id: string; name: string; group?: string; words?: string[]; note?: string; previous?: z.infer<typeof LandmarkShape>[] }

/** Compose recipes for a batch of things (about 6 to 10 a call works well). Ids missing from the reply are left out. */
export async function composeRecipes(llm: LlmBackend, items: ComposeItem[], calls: Completion[] = []): Promise<Map<string, z.infer<typeof LandmarkShape>[]>> {
  const want = new Set(items.map((i) => i.id));
  const lines = items.map((i) => {
    const also = i.words?.filter((w) => w !== i.name.toLowerCase()).slice(0, 3) ?? [];
    let line = `- id "${i.id}": ${i.name}${also.length ? ` (also called ${also.join(', ')})` : ''}${i.group ? `, ${i.group}` : ''}`;
    if (i.note) line += `\n  The reviewer asked: ${i.note}`;
    if (i.previous) line += `\n  The last try, to improve on: ${JSON.stringify(i.previous)}`;
    return line;
  });
  const result = await requestValidated(
    llm,
    { system: SYSTEM, prompt: `Build these things:\n${lines.join('\n')}`, maxTokens: 1500 * items.length + 500 },
    (json) => {
      const parsed = z.object({ recipes: z.array(z.unknown()) }).safeParse(json);
      if (!parsed.success) return { ok: false, problems: '- the reply needs {"recipes": [...]}' };
      const good = new Map<string, z.infer<typeof LandmarkShape>[]>();
      const problems: string[] = [];
      for (const r of parsed.data.recipes) {
        const one = Recipe.safeParse(clamped(r));
        if (!one.success) { problems.push(`- ${(r as { id?: string })?.id ?? 'a recipe'}: ${one.error.issues.slice(0, 3).map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`); continue; }
        if (want.has(one.data.id)) good.set(one.data.id, one.data.shapes);
      }
      // Most of a batch is enough; the rest are asked again in a later batch.
      return good.size >= Math.ceil(items.length / 2) ? { ok: true, value: good } : { ok: false, problems: problems.join('\n') || '- recipes missing' };
    },
    calls,
  );
  return result;
}

/** Items in groups of `size`, for one call each. */
export function batchesOf<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
