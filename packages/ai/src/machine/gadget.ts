/**
 * The workbench: the level designer describes a new part for the player ("a curved chute", "a
 * ski jump") and the AI builds it from simple shapes. Its boxes collide, tilted ones too, so what
 * the player sees is what the ball meets. The one thing that moves is a shape that spins (a sweeper
 * arm, a paddle wheel): the physics turns it at a steady rate and it pushes the ball.
 */
import { z } from 'zod';
import { collides, gadgetFromWords, initPhysics, LandmarkShape, testGadget, type GadgetTest, type Landmark } from '@pg/core';
import type { Completion, LlmBackend } from '../llm/client';
import { requestValidated } from '../llm/request';

const SYSTEM = `You design new parts for a marble-run puzzle game: the player places your part on a grid to help a rolling marble reach a goal. Build it from a few simple coloured shapes.

Units are cells (one cell is 0.5 m). The marble is 0.64 cells across. The kit's ramp is 2 cells long and 1 cell high.
Each shape: {"shape", "at": [along, up, across], "size": [along, height, across], "color": "#rrggbb", optional "tilt", optional "turn", optional "spin", optional "axis"}.
- at: along and across from the part's middle (each within -1.5 and 1.5); up is the height of the shape's BOTTOM above the ground (0 to 3).
- shapes: box; cylinder (size: diameter, height, -); sphere (diameter); cone, roof, frustum, wheel are drawn only (decoration).
- tilt leans a box toward +along by that many degrees about the middle of its bottom face, so a flat plank (height 0.1) with tilt 15 is a slope that goes DOWN toward +along. A tilted box collides like any other; tilted cylinders and spheres are drawn only.
- turn turns a box about its middle by that many degrees from +along toward +across (90 points it at +across, 180 back toward -along, -90 at -across); its size stays [its own length, height, width] and a tilt then slopes it down toward where it points. Turned planks make the marble change direction: a spiral or zigzag is planks each turned a further 90 degrees, each one starting just below and beyond the end of the one before, with a wall at each corner so the marble does not fly off the outside.
- spin (turns per second, 0.3 to 1.5) makes a box, cylinder or sphere turn about its own middle and push the marble: only when the words ask for something that spins, turns, rotates or sweeps (a paddle wheel, a sweeper arm, a turntable, a propeller, a windmill). "axis": "up" (the default) turns it flat round its upright like a turntable or a sweeper arm; positive sweeps the side the marble comes from toward +across. "axis": "across" turns it like a wheel rolling toward +along; positive pushes the marble on toward +along with its bottom. Shapes that turn together (the arms of one wheel) share the same middle: the same along and across, and the same middle height (up + height / 2). Use one bar, not a cross: a marble fits between the two ends of a bar, not between four arms. A bar's lower end must reach down to 0.1 above the ground or lower, so it hits a rolling marble.

Rules:
- The part points toward +along: a slope runs down toward +along, a launcher throws toward +along.
- It fits in 3 by 3 cells and stands at most 3 cells tall. 2 to 10 shapes.
- Everything the marble rolls on is a box: floors at least 1 cell wide, rails at least 0.3 cells high on both sides of a chute, slopes between 8 and 30 degrees. Leave gaps of at least 0.8 cells where the marble must pass.
- The shapes touch or overlap so the part reads as one object, its lowest shape at up 0 or resting on another shape.
- Nothing moves or pushes but a spinning shape: no springs or wind.
- A spinning part is tested by rolling the marble into it along the ground from -along: it must send the marble on, out of its +along end or a side, never back. A spinning shape needs no slope.
- Any other part: the marble must keep rolling all the way through: every surface it rolls on slopes down (8 to 30 degrees) toward where it points. A flat landing stops it. The last surface points toward +along (turn 0).
- Any other part: the marble is dropped on the high end of your highest wide surface and must come out of the low (+along) end.
- Bright toy colours; a short plain name of 1 to 3 words.

Reply with JSON only: {"name": "...", "shapes": [ ... ]}, numbers with at most 2 decimals.`;

/** Numbers a little out of range are pulled in rather than thrown away. */
function clamped(json: unknown): unknown {
  const rec = json as { shapes?: unknown };
  if (!rec || !Array.isArray(rec.shapes)) return json;
  const fit = (v: unknown, lo: number, hi: number) => (typeof v === 'number' ? Math.min(hi, Math.max(lo, v)) : v);
  const tuple = (t: unknown, ranges: [number, number][]) => (Array.isArray(t) && t.length === 3 ? t.map((v, i) => fit(v, ...ranges[i])) : t);
  return {
    ...rec,
    shapes: rec.shapes.slice(0, 10).map((s: Record<string, unknown>) => s && typeof s === 'object' ? {
      ...s,
      at: tuple(s.at, [[-1.5, 1.5], [0, 3], [-1.5, 1.5]]),
      size: tuple(s.size, [[0.05, 3], [0.05, 3], [0.05, 3]]),
      ...(s.tilt === undefined ? {} : { tilt: fit(s.tilt, -45, 45) }),
      ...(s.turn === undefined ? {} : { turn: fit(s.turn, -180, 180) }),
      ...(s.spin === undefined ? {} : { spin: fit(s.spin, -3, 3) }),
    } : s),
  };
}

const Gadget = z.object({
  name: z.string().min(1).max(40),
  shapes: z.array(LandmarkShape).min(1).max(10).refine((s) => s.some((x) => collides(x, true)), 'at least one box, cylinder or sphere the marble meets'),
});

const validate = (json: unknown) => {
  const r = Gadget.safeParse(clamped(json));
  return r.success ? { ok: true as const, value: r.data } : { ok: false as const, problems: r.error.issues.slice(0, 4).map((i) => `- ${i.path.join('.')}: ${i.message}`).join('\n') };
};

export type TestedGadget = Landmark & { closest?: string; test?: GadgetTest };

/** The test lab's run of a made part (the physics engine loads on first use). */
export async function labTest(part: Landmark): Promise<GadgetTest> {
  await initPhysics();
  return testGadget(part.shapes, part.name.toLowerCase());
}

/**
 * A workbench part for the words: the AI's, or one known by word when there is no AI. Every part the
 * AI makes is run in the test lab; one that fails gets one more try, told what the ball did. The best
 * try comes back with its test, so the designer sees whether a ball gets through. `retryUntil` (a time) skips
 * the retry when the first try came back too late for another.
 */
export async function composeGadget(llm: LlmBackend | null, text: string, calls: Completion[] = [], opts: { retryUntil?: number } = {}): Promise<TestedGadget> {
  if (!llm) {
    const known = gadgetFromWords(text) ?? gadgetFromWords('chute')!;
    return { ...known, test: await labTest(known), ...(gadgetFromWords(text) ? {} : { closest: 'Without the AI only a spiral chute, spinner, chute, ski jump, bumper or gate can be made; here is a chute.' }) };
  }
  const first = await requestValidated(llm, { system: SYSTEM, prompt: `Make this part: ${text}`, maxTokens: 1500, thinking: 'off' }, validate, calls);
  const tested = await labTest(first);
  if (tested.verdict === 'through') return { ...first, test: tested };
  let best: TestedGadget = { ...first, test: tested };
  // The retry only when there is time for it: a late answer would throw away the first try too.
  if (Date.now() < (opts.retryUntil ?? Infinity)) try {
    const again = await fixGadget(llm, first, tested, tested.suggestion ?? 'make the marble roll all the way through', calls);
    if (again.test?.verdict === 'through') return again;
  } catch { /* the first try stands */ }
  // Both tries fail the lab: a known part of that kind (spiral, chute, ski jump...) works, so it is the better answer.
  const known = gadgetFromWords(text);
  if (known) {
    const test = await labTest(known);
    if (test.verdict === 'through') best = { ...known, test, closest: `The AI's ${first.name.toLowerCase()} did not let the ball through, so here is the known ${known.name}.` };
  }
  return best;
}

/** The part changed as the designer (or the lab) asks, then tested again. */
export async function fixGadget(llm: LlmBackend, part: Landmark, test: GadgetTest | undefined, change: string, calls: Completion[] = []): Promise<TestedGadget> {
  const prompt = [
    `Here is a part: ${JSON.stringify({ name: part.name, shapes: part.shapes })}`,
    test ? `In the physics test lab a marble was dropped on its high end. ${test.message} (Positions are the part's cells: along, up, across.)` : '',
    `Change it: ${change}. Keep its name unless the change makes it something else. Reply with the whole part.`,
  ].filter(Boolean).join('\n\n');
  const fixed = await requestValidated(llm, { system: SYSTEM, prompt, maxTokens: 1500, thinking: 'off' }, validate, calls);
  return { ...fixed, test: await labTest(fixed) };
}
