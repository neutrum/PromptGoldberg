/**
 * Building by words during play: "put a ramp under the snowball facing the cave", "move the fan
 * two cells east", "turn the cannon left", "remove the shelf". A move uses a part from the player's
 * tray and a spot named after something on the board; it never changes the level itself.
 */
import { footprint, type Part, type PartKind, type Yaw } from '@og/machine';

export type BuildMove =
  | { action: 'place'; index: number; at?: { x: number; z: number }; near?: boolean; yaw?: Yaw; what: string }
  | { action: 'turn'; index: number; yaw: Yaw; what: string }
  | { action: 'remove'; index: number; what: string }
  | { action: 'error'; message: string };

const KIND_WORDS: [RegExp, PartKind][] = [
  [/\b(fans?|blowers?|wind)\b/, 'fan'],
  [/\b(ramps?|slides?|slopes?|tracks?|rails?|chutes?|coasters?)\b/, 'ramp'],
  [/\b(cannons?|launchers?|catapults?)\b/, 'cannon'],
  [/\b(trampolines?|springs?|bouncers?|bouncy)\b/, 'trampoline'],
  [/\b(seesaws?|see-saws?|teeter\w*|levers?)\b/, 'seesaw'],
  [/\b(shelf|shelves|platforms?|ledges?|bridges?|planks?|boards?)\b/, 'platform'],
  [/\b(walls?|blockers?|bumpers?)\b/, 'wall'],
  [/\b(dominoes|dominos?)\b/, 'dominoes'],
];
const NUMBERS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8 };
/** North is up the board (-z), east is +x; "left" and "right" read as west and east, "up" and "down" as north and south. */
const DIRS: Record<string, [number, number]> = {
  north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0], up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0],
  forward: [0, -1], back: [0, 1], backward: [0, 1],
};
const YAW_OF: Record<string, Yaw> = { east: 0, right: 0, south: 90, down: 90, west: 180, left: 180, north: 270, up: 270 };

/** The yaw that points most nearly from one cell toward another. */
export function yawToward(from: { x: number; z: number }, to: { x: number; z: number }): Yaw {
  const dx = to.x - from.x, dz = to.z - from.z;
  if (Math.abs(dx) >= Math.abs(dz)) return dx >= 0 ? 0 : 180;
  return dz >= 0 ? 90 : 270;
}

const kindIn = (text: string): PartKind | null => KIND_WORDS.find(([re]) => re.test(text))?.[1] ?? null;
const kindName = (k: PartKind) => (k === 'platform' ? 'shelf' : k);

/** The board thing a phrase names: a label ("snowball", "cave"), a kind ("ball", "bucket"), an obstacle ("rock") or a landmark ("chalet"). */
function thingNamed(phrase: string, parts: Part[]): Part | null {
  const words = phrase.toLowerCase().replace(/[^a-z0-9 -]/g, ' ').split(/\s+/).filter((w) => w && !/^(the|a|an|my|of|it)$/.test(w));
  if (!words.length) return null;
  const score = (p: Part) => {
    const names = [p.label, p.kind, p.prop, p.kind === 'ball' ? 'ball marble start' : '', p.kind === 'bucket' || p.kind === 'bell' ? 'goal target finish end' : '']
      .filter(Boolean).join(' ').toLowerCase();
    return words.filter((w) => names.split(/[\s-]+/).some((n) => n === w || n === w.replace(/s$/, '') || (w.length > 3 && n.startsWith(w)))).length;
  };
  let best: Part | null = null, top = 0;
  for (const p of parts) { const s = score(p); if (s > top) { best = p; top = s; } }
  return best;
}

/**
 * Read one building move. `parts` is everything on the board now (placed parts included), `hand`
 * the tray (placed or not), `placed` the ids already down. Returns null when the text is not a
 * building move at all ("make it snowy"), so it can go to the world editor instead.
 */
export function readBuildMove(input: string, ctx: { parts: Part[]; hand: Part[]; placed: Set<string> }): BuildMove | null {
  const text = input.toLowerCase().trim().replace(/[.!?]+$/, '');
  const kind = kindIn(text);
  const verb = /^(?:please\s+)?(add|put|place|set|drop|use|build|insert|move|shift|slide|push|turn|rotate|point|face|remove|delete|take|pick up|undo)\b/.exec(text)?.[1];
  if (!kind && !verb) return null;
  if (!kind) {
    // "move it two cells east": the part last named is unknown, so ask for it by name.
    const names = [...new Set(ctx.hand.map((h) => kindName(h.kind)))].join(', ');
    return { action: 'error', message: names ? `Which part? Your tray has: ${names}.` : 'Your tray is empty.' };
  }
  const what = kindName(kind);
  const ofKind = ctx.hand.map((h, i) => ({ h, i })).filter(({ h }) => h.kind === kind);
  if (!ofKind.length) {
    const names = [...new Set(ctx.hand.map((h) => kindName(h.kind)))].join(', ');
    return { action: 'error', message: `There is no ${what} in your tray for this level. You have: ${names || 'nothing'}.` };
  }
  const down = ofKind.filter(({ h }) => ctx.placed.has(h.id));
  const free = ofKind.filter(({ h }) => !ctx.placed.has(h.id));
  const placedPart = (id: string) => ctx.parts.find((p) => p.id === id);

  if (verb && /^(remove|delete|take|pick up|undo)$/.test(verb)) {
    const target = down.at(-1);
    return target ? { action: 'remove', index: target.i, what } : { action: 'error', message: `No ${what} is on the board yet.` };
  }

  // Facing: a compass word, "toward(s) the X", or "facing the X".
  let yaw: Yaw | undefined;
  const compass = /\b(?:facing|face|faces|pointing|point|points|toward|towards|to the|turned)\s+(north|south|east|west|left|right|up|down)\b/.exec(text) ?? /^(?:turn|rotate)\s+(?:the\s+)?\w+\s+(north|south|east|west|left|right|up|down)\b/.exec(text);
  if (compass) yaw = YAW_OF[compass[1]];
  const facingThing = /\b(?:facing|toward|towards|pointing at|aimed at|aim at|into|at)\s+(?:the\s+)?([a-z][a-z -]*?)(?=$|,| and | so | then )/.exec(text);

  if (verb && /^(turn|rotate|point|face)$/.test(verb) && !/\b(under|below|beneath|next to|beside|near|by|on|at|north of|south of|east of|west of|cells?)\b/.test(text.replace(/\b(?:facing|face|toward|towards|pointing)\b.*$/, ''))) {
    const target = down.at(-1) ?? free[0];
    let turn = yaw;
    if (turn === undefined && facingThing) {
      const thing = thingNamed(facingThing[1], ctx.parts);
      const from = placedPart(target.h.id) ?? target.h;
      if (thing) turn = yawToward(from, thing);
    }
    // "turn the fan" on its own: a quarter turn.
    if (turn === undefined) turn = ((((placedPart(target.h.id) ?? target.h).yaw ?? 0) + 90) % 360) as Yaw;
    return { action: 'turn', index: target.i, yaw: turn, what };
  }

  // Where: coordinates, "N cells east of the X", or "under / next to / beside the X".
  let at: { x: number; z: number } | undefined;
  let near = false;
  const coords = /\bat\s*\(?\s*(\d{1,2})\s*[, ]\s*(\d{1,2})\s*\)?/.exec(text);
  const moving = verb && /^(move|shift|slide|push)$/.test(verb);
  const moveTarget = moving ? down.at(-1) : undefined;
  const step = /\b(a|an|one|two|three|four|five|six|seven|eight|\d)\s+(?:cells?|squares?|spaces?|steps?|tiles?)?\s*(north|south|east|west|left|right|up|down|forward|back|backward)\b(?:\s+(?:of|from)\s+(?:the\s+)?([a-z][a-z -]*?))?(?=$|,| and | facing| toward| so )/.exec(text);
  const rel = /\b(under|below|beneath|underneath|next to|beside|by|near|in front of|behind|on|onto|after|before)\s+(?:the\s+)?([a-z][a-z -]*?)(?=$|,| and | facing| toward| pointing| so | then )/.exec(text);
  if (coords) at = { x: Number(coords[1]), z: Number(coords[2]) };
  else if (step) {
    const n = NUMBERS[step[1]] ?? Number(step[1]);
    const [dx, dz] = DIRS[step[2]];
    const origin = step[3] ? thingNamed(step[3], ctx.parts) : moveTarget ? placedPart(moveTarget.h.id) : null;
    if (!origin) return { action: 'error', message: step[3] ? `I can't find "${step[3]}" on the board.` : `Say where from, e.g. "2 cells east of the ${what === 'ramp' ? 'ball' : 'ramp'}".` };
    at = { x: origin.x + dx * n, z: origin.z + dz * n };
  } else if (rel) {
    const thing = thingNamed(rel[2], ctx.parts);
    if (!thing) return { action: 'error', message: `I can't find "${rel[2]}" on the board. Try the ball, the goal or an obstacle's name.` };
    const cells = footprint(thing);
    // Under a ball means the cell it starts over; beside anything means the nearest free cell round it.
    at = { x: cells[0].x, z: cells[0].z };
    near = !/^(under|below|beneath|underneath|on|onto)$/.test(rel[1]);
  } else if (moving && step === null && !coords) {
    return { action: 'error', message: `Say where to, e.g. "move the ${what} 2 cells east".` };
  }
  if (yaw === undefined && facingThing && at) {
    const thing = thingNamed(facingThing[1], ctx.parts);
    if (thing && !(rel && thingNamed(rel[2], ctx.parts) === thing && !near)) yaw = yawToward(at, footprint(thing)[0]);
  }
  const pick = moveTarget ?? free[0] ?? down.at(-1)!;
  return { action: 'place', index: pick.i, ...(at ? { at, near } : {}), ...(yaw !== undefined ? { yaw } : {}), what };
}

/** Cells to try for a placement, nearest first: the spot itself (unless only "near" it), then rings round it. */
export function cellsAround(at: { x: number; z: number }, near: boolean, toward?: { x: number; z: number }): { x: number; z: number }[] {
  const out: { x: number; z: number; d: number }[] = [];
  for (let dx = -3; dx <= 3; dx++) for (let dz = -3; dz <= 3; dz++) {
    if (near && !dx && !dz) continue;
    const c = { x: at.x + dx, z: at.z + dz };
    // Ties go to the side facing the goal, so "next to the ball" leans the right way.
    const lean = toward ? (Math.abs(toward.x - c.x) + Math.abs(toward.z - c.z)) * 0.01 : 0;
    out.push({ ...c, d: Math.max(Math.abs(dx), Math.abs(dz)) + (Math.abs(dx) + Math.abs(dz)) * 0.1 + lean });
  }
  return out.sort((a, b) => a.d - b.d).map(({ x, z }) => ({ x, z }));
}
