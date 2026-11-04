/**
 * The workbench test lab: a ball dropped on a part's high end, run in the physics, and what became
 * of it. A part passes when the ball comes out of its low end (+along); otherwise the verdict says
 * where it stopped or where it fell off, in the part's own cells, so a fix can name the spot.
 * A part that spins (a sweeper, a paddle wheel) has the ball rolled into it along the ground instead,
 * and passes when it sends the ball on, out of its far end or a side.
 */
import { KIT, assemblePart } from './kit';
import { collides, halfFootprint, type LandmarkShape } from './landscape';
import { CELL, parseMachine } from './schema';
import { simulateSync } from './sim';
import type { Part } from './schema';

export type GadgetVerdict = 'through' | 'stops' | 'falls-off' | 'misses';

export interface GadgetTest {
  verdict: GadgetVerdict;
  /** One plain sentence: what the ball did, and where. */
  message: string;
  /** A change that would most likely fix it, for the "fix in words" box. */
  suggestion?: string;
  /** The ball's path in the part's cells: [along, up, across], about 15 points a second. */
  path: [number, number, number][];
  /** Where the ball was dropped, in the part's cells. */
  drop: [number, number, number];
}

// The part sits in the middle of a small empty stage, facing +x, on the floor.
const AT = { x: 8, z: 8 };

/** The top of a collider shape's high end, in cells, and the point to drop on just inside it (a turned box points toward its right). */
function highEnd(s: LandmarkShape): { top: number; along: number; across: number } {
  const lean = ((s.tilt ?? 0) * Math.PI) / 180, turn = ((s.turn ?? 0) * Math.PI) / 180;
  const [a, h] = [s.size[0], s.size[1]];
  // Tilted about the middle of the bottom face: the high (back) end rises by half the length times sin(lean).
  const top = s.at[1] + h * Math.cos(lean) + (s.shape === 'box' ? (a / 2) * Math.sin(lean) : 0);
  const back = (a / 2) * Math.cos(lean) - Math.min(0.5, a / 4);
  return { top, along: s.at[0] - back * Math.cos(turn), across: s.at[2] - back * Math.sin(turn) };
}

export function testGadget(shapes: LandmarkShape[], name = 'part'): GadgetTest {
  const solid = shapes.filter((s) => collides(s, true));
  const empty: GadgetTest = { verdict: 'misses', message: 'The part has nothing solid for the ball to roll on.', path: [], drop: [0, 0, 0] };
  if (!solid.length) return empty;
  const part: Part = { id: 'g', kind: 'wall', x: AT.x, y: 0, z: AT.z, yaw: 0, prop: 'landmark', label: name, build: shapes };
  // Where the part's "0, 0, 0" lands in metres, and which way its right points: two tiny probe boxes added to
  // the real shapes (the part is sized and centred from its shapes, so a probe must ride along with them).
  const probeAt = (across: number) => {
    const build: LandmarkShape[] = [...shapes, { shape: 'box', at: [0, 0, across], size: [0.05, 0.05, 0.05], color: '#010203' }];
    return assemblePart({ ...part, build }).bodies.find((b) => b.color === '#010203')!.position;
  };
  const probe = probeAt(0), mid = [probe[0], 0, probe[2]];
  const right = probeAt(0.2)[2] - probe[2] > 0 ? 1 : -1;
  const toLocal = (x: number, y: number, z: number): [number, number, number] => [(x - mid[0]) / CELL, y / CELL, ((z - mid[2]) / CELL) * right];

  // Drop on the highest surface's high end, as close above it as the grid allows (a ball sits on whole cells of height).
  // Only surfaces wide enough to hold the ball (not a rail's top edge), and a slope before a flat top (a pipe, a roof
  // on a post): the slope is where the ball is meant to go in.
  const floors = solid.filter((s) => s.shape === 'box' && s.size[0] >= 0.6 && s.size[2] >= 0.6), slopes = floors.filter((s) => Math.abs(s.tilt ?? 0) >= 5);
  const start = (slopes.length ? slopes : floors.length ? floors : solid).map(highEnd).sort((p, q) => q.top - p.top)[0];
  const wx = mid[0] + start.along * CELL, wz = mid[2] + start.across * CELL * right;
  const cx = Math.floor(wx / CELL), cz = Math.floor(wz / CELL);
  const ballY = Math.ceil((start.top * CELL) / CELL);
  const off = (v: number, c: number) => Math.max(-0.5, Math.min(0.5, v / CELL - c - 0.5));
  // The part's extent in its own cells, from its solid shapes, with a ball's width to spare.
  const lo = Math.min(...solid.map((s) => s.at[0] - halfFootprint(s)[0])) - 0.4, hi = Math.max(...solid.map((s) => s.at[0] + halfFootprint(s)[0])) + 0.4;
  const spins = solid.some((s) => s.spin);
  // A spinning part: a kit ramp just before its back edge rolls the ball in along its middle line.
  const rampAt = Math.floor((mid[0] + lo * CELL) / CELL) - 2, mz = Math.floor(mid[2] / CELL);
  const lane = { z: mz, yaw: 0 as const, dz: off(mid[2], mz) };
  const ball: Part = spins ? { id: 'ball', kind: 'ball', x: rampAt, y: 1, ...lane }
    : { id: 'ball', kind: 'ball', x: cx, y: ballY, z: cz, yaw: 0, dx: off(wx, cx), dz: off(wz, cz) };
  const feed: Part[] = spins ? [{ id: 'ramp', kind: 'ramp', x: rampAt, y: 0, ...lane }] : [];
  const parsed = parseMachine({ title: 'lab', parts: [part, ...feed, ball], goal: [{ type: 'touch', part: 'g' }], duration: 8 }, { allowMissingGoalParts: true });
  if (!parsed.ok) return { ...empty, message: `The part could not be tested: ${parsed.issues[0]?.message ?? 'invalid'}.` };
  const run = simulateSync(parsed.spec, { record: true });

  const i = run.dynamicIds.indexOf('ball'), st = run.frameStride;
  const at = (f: number) => { const o = f * st + 1 + i * 7; return [run.frames[o], run.frames[o + 1], run.frames[o + 2]] as const; };
  const step = Math.max(1, Math.round(run.frameCount / (8 * 15)));
  const path: [number, number, number][] = [];
  for (let f = 0; f < run.frameCount; f += step) path.push(toLocal(...at(f)).map((v) => Math.round(v * 100) / 100) as [number, number, number]);
  const drop = spins ? path[0] : toLocal(wx, ballY * CELL + KIT.ballRadius, wz).map((v) => Math.round(v * 100) / 100) as [number, number, number];
  const side = Math.max(...solid.map((s) => Math.abs(s.at[2]) + halfFootprint(s)[1])) + 0.4;
  const topOf = Math.max(...solid.map((s) => highEnd(s).top));

  // The first moment the ball leaves the part's box, and how.
  const out = path.findIndex(([a, , c]) => a > hi || a < lo || Math.abs(c) > side);
  if (spins) return spun(run.events.some((e) => e.type === 'touch' && e.part === 'g'));
  const touched = path.some(([, u]) => u < drop[1] - 0.3);
  if (out >= 0) {
    const [a, u, c] = path[out];
    if (a > hi && u < topOf) return { verdict: 'through', message: `The ball runs through the ${name} and comes out of its low end.`, path, drop };
    const where = a < lo ? 'its high end, backwards' : `its ${c > 0 ? 'right' : 'left'} side`;
    const from = path[Math.max(0, out - 6)];
    return { verdict: 'falls-off', message: `The ball falls off ${where}, near ${fmt(from)}.`, suggestion: `add a rail ${c > 0 ? 'on the right' : 'on the left'} near ${fmt(from)}`, path, drop };
  }
  if (!touched) return { verdict: 'misses', message: 'The ball never reaches a surface of the part.', path, drop };
  // Still on the part at the end: where it came to rest.
  const [a, u] = path.at(-1)!;
  const flat = solid.find((s) => !s.tilt && Math.abs(s.at[1] + s.size[1] - u + KIT.ballRadius / CELL) < 0.5 && Math.abs(s.at[0] - a) <= s.size[0] / 2 + 0.3);
  return {
    verdict: 'stops',
    message: `The ball stops on the ${name} near ${fmt(path.at(-1)!)}${flat ? ', on a flat surface' : ''}.`,
    suggestion: flat ? 'tilt the flat landing so it slopes down toward +along (10 degrees)' : 'make the slopes steeper (15 to 20 degrees)',
    path, drop,
  };

  /** The ball was rolled in from behind: where the spinning part sent it, if it reached it at all. */
  function spun(hit: boolean): GadgetTest {
    // Rolled in from behind, the ball starts outside the part: it counts from when it is inside.
    const inside = path.findIndex(([a]) => a >= lo);
    const left = inside < 0 ? -1 : path.findIndex(([a, , c], k) => k > inside && (a > hi || a < lo || Math.abs(c) > side));
    if (!hit) return { verdict: 'misses', message: `The ball rolls past the ${name} without its spinning shapes touching it.`, suggestion: 'bring the spinning shapes down to the ground (their bottom at up 0 to 0.2) and across the middle', path, drop };
    if (left < 0) return { verdict: 'stops', message: `The ball ends up stuck in the ${name} near ${fmt(path.at(-1)!)}.`, suggestion: 'leave a gap of a cell where the ball is pushed to, or spin it faster', path, drop };
    // Back is when it leaves mostly the way it came; batted aside on the way in is still sent on.
    const [a, , c] = path[left], [a0, , c0] = path[inside];
    if (a < lo && a0 - a > Math.abs(c - c0)) return { verdict: 'falls-off', message: `The ${name} knocks the ball back the way it came.`, suggestion: 'make it spin the other way round', path, drop };
    return { verdict: 'through', message: `The ${name} sends the ball on, out of ${a > hi ? 'its far end' : `its ${c > 0 ? 'right' : 'left'} side`}.`, path, drop };
  }
}

const fmt = ([a, u, c]: readonly number[]) => `along ${a.toFixed(1)}, up ${u.toFixed(1)}, across ${c.toFixed(1)}`;
