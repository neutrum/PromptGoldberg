/**
 * Workbench parts: new parts for the player, composed from simple shapes like a landmark but placed
 * by the player. Their boxes collide even when tilted, so a chute or a kicker carries the ball.
 * A shape may spin (a sweeper arm, a paddle wheel): the one thing on the workbench that moves.
 * These are the ones known by word, for when no AI composes one.
 */
import type { Landmark, LandmarkShape } from './landscape';

const S = (shape: LandmarkShape['shape'], at: LandmarkShape['at'], size: LandmarkShape['size'], color: string, tilt?: number, turn?: number): LandmarkShape => ({ shape, at, size, color, ...(tilt ? { tilt } : {}), ...(turn ? { turn } : {}) });
const WOOD = '#b5834a', RAIL = '#7a5230', RED = '#d9452b';

export const GADGET_PRESETS: { words: RegExp; gadget: Landmark }[] = [
  // Three quarters round a post, clockwise seen from above: each plank drops the ball onto the next one,
  // turned a further quarter, and a wall at each corner turns it; the last plank runs out toward the facing.
  { words: /\b(spiral|helter|corkscrew|helix|swirl)/, gadget: { name: 'spiral chute', shapes: [
    S('box', [1, 2.76, -0.5], [2, 0.1, 1], '#ff3b30', 12, 90),
    S('box', [0.5, 1.99, 1], [2, 0.1, 1], '#ff9f0a', 12, 180),
    S('box', [-1, 1.22, 0.5], [2, 0.1, 1], '#34c759', 12, -90),
    S('box', [0, 0.35, -1], [3, 0.1, 1], '#0a84ff', 12),
    S('box', [1, 1.9, 1.45], [1, 1, 0.1], '#ffd60a'),
    S('box', [-1.45, 1.1, 1], [0.1, 1, 1], '#ffd60a'),
    S('box', [-1, 0.3, -1.45], [1, 1, 0.1], '#ffd60a'),
    S('cylinder', [0, 0, 0], [1, 3, 1], WOOD),
  ] } },
  // Two crossed arms turning flat round a post, low enough to hit a rolling ball and bat it aside.
  { words: /\b(spin\w*|rotat\w*|sweep\w*|paddles?|propellers?|turntables?|whirl\w*|twirl\w*|windmills?)\b/, gadget: { name: 'spinner', shapes: [
    S('cylinder', [0, 0, 0], [0.4, 0.6, 0.4], RAIL),
    { ...S('box', [0, 0.05, 0], [2.6, 0.3, 0.2], RED), spin: 0.5 },
    { ...S('box', [0, 0.05, 0], [2.6, 0.3, 0.2], '#f2c230', 0, 90), spin: 0.5 },
  ] } },
  // Slopes down toward its facing, rails on both sides: it catches a ball from a shelf and keeps it in line.
  { words: /\b(chute|slide|gutter|channel|trough|slope)\b/, gadget: { name: 'chute', shapes: [
    S('box', [0, 0.4, 0], [3, 0.1, 1], WOOD, 14),
    S('box', [0, 0.45, -0.45], [3, 0.4, 0.1], RAIL, 14),
    S('box', [0, 0.45, 0.45], [3, 0.4, 0.1], RAIL, 14),
  ] } },
  // Down, then a short kick up: the ball leaves it flying toward its facing.
  { words: /\b(jump|kicker|ski|launch ramp|lip)\b/, gadget: { name: 'ski jump', shapes: [
    S('box', [-0.5, 0.4, 0], [2, 0.1, 1], WOOD, 20),
    S('box', [1, 0.23, 0], [1, 0.1, 1], WOOD, -20),
    S('box', [-0.5, 0, 0], [0.2, 0.75, 1], RAIL),
  ] } },
  // A round post the ball glances off.
  { words: /\b(bumper|post|pin|peg|pillar)\b/, gadget: { name: 'bumper', shapes: [
    S('cylinder', [0, 0, 0], [0.8, 0.6, 0.8], RED),
    S('cylinder', [0, 0.6, 0], [0.5, 0.1, 0.5], '#f2c230'),
  ] } },
  // Two posts with a ball-wide gap: lets the ball through one lane only.
  { words: /\b(gate|goalposts?|lane|door)\b/, gadget: { name: 'gate', shapes: [
    S('box', [0, 0, -0.75], [0.4, 0.8, 0.3], RAIL),
    S('box', [0, 0, 0.75], [0.4, 0.8, 0.3], RAIL),
    S('box', [0, 0.8, 0], [0.4, 0.15, 1.8], WOOD),
  ] } },
];

/** The workbench part the words name, or null. */
export function gadgetFromWords(text: string): Landmark | null {
  const t = text.toLowerCase();
  return GADGET_PRESETS.find((g) => g.words.test(t))?.gadget ?? null;
}
