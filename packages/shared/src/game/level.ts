import { z } from 'zod';
import { evaluateGoal, type GoalResult } from '../goal';
import { optimize, type OptimizeOptions } from '../optimizer';
import { SystemSpec, type BodySpec, type Tunable } from '../schema';
import { simulate } from '../sim';
import { applyTunables, getTunable, isValidTunable } from '../tunables';
import { G } from '../units';

/** A number the player sets before a shot. `path` uses the tunable path syntax. */
export const Control = z.object({
  path: z.string().describe('tunable path, e.g. "bodies.probe.placement.speed"'),
  label: z.string(),
  min: z.number(),
  max: z.number(),
});
export type Control = z.infer<typeof Control>;

export const PieceKind = z.enum(['planet', 'giant', 'bumper', 'portal']);
export type PieceKind = z.infer<typeof PieceKind>;

/** A body the player drops into the system: orbiting the main star, or pinned in place for gadgets. */
export const Piece = z.object({
  kind: PieceKind,
  /** Orbit radius, AU. */
  r: z.number().positive(),
  /** Position angle at t=0, degrees (0 = +x, counter-clockwise seen from +z). */
  angle: z.number(),
});
export type Piece = z.infer<typeof Piece>;

export interface PieceDef {
  name: string;
  label: string;
  mass: number;
  radius: number;
  color: string;
  type: BodySpec['type'];
  /** Pinned where it is dropped instead of orbiting the star. */
  fixed?: boolean;
  bounce?: number;
  /** Placed in pairs that link to each other (portals); an unpaired one does nothing. */
  paired?: boolean;
}

export const PIECE_BODIES: Record<PieceKind, PieceDef> = {
  planet: { name: 'Placed planet', label: 'Planet', mass: 3e-4, radius: 4e-4, color: '#8ef0b4', type: 'planet' },
  giant: { name: 'Placed giant', label: 'Gas giant', mass: 2e-3, radius: 7e-4, color: '#f08ee0', type: 'planet' },
  bumper: { name: 'Bumper', label: 'Bumper', mass: 0, radius: 0.16, color: '#ff5fa2', type: 'bumper', fixed: true, bounce: 1.2 },
  portal: { name: 'Portal', label: 'Portal pair', mass: 0, radius: 0.18, color: '#b388ff', type: 'portal', fixed: true, paired: true },
};

export const Level = z.object({
  id: z.string().regex(/^[a-z0-9_-]+$/i),
  title: z.string(),
  /** One or two sentences shown before playing: what to do, in game terms. */
  briefing: z.string(),
  /** Starting values in the spec are what the player sees first; they should not already solve the goal. */
  spec: SystemSpec,
  /** Body the player controls; the camera follows it after launch. */
  player: z.string(),
  /** May be empty for pure build puzzles: the shot is fixed and only pieces change. */
  controls: z.array(Control).max(4),
  /** Shots for three stars. */
  par: z.number().int().min(1).default(3),
  pieces: z.object({ kinds: z.array(PieceKind).min(1), max: z.number().int().min(1).max(3) }).optional(),
  /** Known-good control values (and pieces) proving the level is solvable; powers hints. */
  solution: z.object({ values: z.array(z.number()), pieces: z.array(Piece).default([]) }).optional(),
  /** Optional nudge shown after a couple of misses. */
  tip: z.string().optional(),
});
export type Level = z.infer<typeof Level>;
export type LevelInput = z.input<typeof Level>;

/** Current control values as stored in the level's spec. */
export function controlValues(level: Level): number[] {
  return level.controls.map((c) => getTunable(level.spec, c.path) ?? (c.min + c.max) / 2);
}

export function clampControl(c: Control, v: number): number {
  return Math.min(c.max, Math.max(c.min, v));
}

/** Main star a piece orbits: the heaviest star, else the heaviest body. */
export function anchorBody(spec: SystemSpec): BodySpec {
  const stars = spec.bodies.filter((b) => b.type === 'star');
  const pool = stars.length ? stars : spec.bodies;
  return pool.reduce((a, b) => (b.mass > a.mass ? b : a));
}

export function pieceBody(spec: SystemSpec, piece: Piece, index: number): BodySpec {
  const def = PIECE_BODIES[piece.kind];
  const body: BodySpec = {
    id: `piece${index + 1}`,
    name: `${def.name} ${index + 1}`,
    type: def.type,
    mass: def.mass,
    radius: def.radius,
    color: def.color,
    placement: def.fixed
      ? { kind: 'free', position: [piece.r * Math.cos(RAD * piece.angle), piece.r * Math.sin(RAD * piece.angle), 0], velocity: [0, 0, 0] }
      : { kind: 'orbit', parent: anchorBody(spec).id, a: piece.r, e: 0, phase: piece.angle, argPeriapsis: 0, inclination: 0, retrograde: false },
  };
  if (def.fixed) body.fixed = true;
  if (def.bounce !== undefined) body.bounce = def.bounce;
  return body;
}

const RAD = Math.PI / 180;

/** Links paired pieces (portals) two by two, in the order they were placed. */
function linkPairs(bodies: BodySpec[], pieces: Piece[]): void {
  const waiting: Record<string, BodySpec | null> = {};
  pieces.forEach((p, i) => {
    if (!PIECE_BODIES[p.kind].paired) return;
    const body = bodies[i];
    const open = waiting[p.kind];
    if (open) {
      open.link = body.id;
      body.link = open.id;
      waiting[p.kind] = null;
    } else {
      waiting[p.kind] = body;
    }
  });
  // A portal with no twin yet would be an invalid spec: leave it out until its pair is placed.
  for (const open of Object.values(waiting)) {
    if (open) bodies.splice(bodies.indexOf(open), 1);
  }
}

/** The spec for one shot: controls applied, pieces added, tunables cleared. */
export function shotSpec(level: Level, values: number[], pieces: Piece[] = []): SystemSpec {
  const tunables: Tunable[] = level.controls.map((c) => ({ path: c.path, min: c.min, max: c.max }));
  const spec = applyTunables(level.spec, tunables, values.map((v, i) => clampControl(level.controls[i], v)));
  const placed = pieces.map((p, i) => pieceBody(level.spec, p, i));
  linkPairs(placed, pieces);
  spec.bodies.push(...placed);
  spec.tunables = [];
  return spec;
}

export interface ShotResult {
  spec: SystemSpec;
  goal: GoalResult;
}

export function checkShot(level: Level, values: number[], pieces: Piece[] = []): ShotResult {
  const spec = shotSpec(level, values, pieces);
  return { spec, goal: evaluateGoal(spec.goal, simulate(spec, { record: false }).trace) };
}

/** 0 stars on a miss; 3 within par shots, 2 within twice par, else 1. A used hint costs one star. */
export function starsFor(success: boolean, shots: number, par: number, usedHint = false): number {
  if (!success) return 0;
  const base = shots <= par ? 3 : shots <= 2 * par ? 2 : 1;
  return Math.max(1, base - (usedHint ? 1 : 0));
}

/** Semantic checks for a level beyond zod. */
export function checkLevel(level: Level): string[] {
  const issues: string[] = [];
  const ids = new Set(level.spec.bodies.map((b) => b.id));
  if (!ids.has(level.player)) issues.push(`player "${level.player}" is not a body`);
  level.controls.forEach((c, i) => {
    if (!isValidTunable(level.spec, { path: c.path, min: c.min, max: c.max })) issues.push(`controls.${i}: unknown path "${c.path}"`);
    if (c.min >= c.max) issues.push(`controls.${i}: min must be below max`);
  });
  if (level.solution && level.solution.values.length !== level.controls.length) {
    issues.push('solution.values must have one value per control');
  }
  if (level.solution?.pieces.length && !level.pieces) issues.push('solution uses pieces but the level allows none');
  return issues;
}

export type LevelParseResult = { ok: true; level: Level } | { ok: false; issues: string[] };

export function parseLevel(input: unknown): LevelParseResult {
  const r = Level.safeParse(input);
  if (!r.success) return { ok: false, issues: r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) };
  const issues = checkLevel(r.data);
  return issues.length ? { ok: false, issues } : { ok: true, level: r.data };
}

const LABELS: Record<string, string> = {
  speed: 'Power', angle: 'Aim', time: 'Launch time', elevation: 'Tilt',
  phase: 'Start position', a: 'Orbit size', e: 'Stretch',
};

export function labelForPath(path: string): string {
  const parts = path.split('.');
  const last = parts[parts.length - 1];
  if (/^\d$/.test(last)) {
    const axis = 'XYZ'[Number(last)] ?? last;
    return `${parts[parts.length - 2] === 'velocity' ? 'Velocity' : 'Position'} ${axis}`;
  }
  return LABELS[last] ?? last;
}

/**
 * Turn a designed system into a playable level: the player steers the launched body
 * (or the first body with tunables); its tunables become controls.
 */
export function levelFromSpec(spec: SystemSpec, opts: { id: string; briefing?: string; player?: string; par?: number }): Level {
  const tunableOwner = (t: Tunable) => t.path.split('.')[1];
  const valid = spec.tunables.filter((t) => isValidTunable(spec, t) && t.max > t.min);
  const player = opts.player && spec.bodies.some((b) => b.id === opts.player)
    ? opts.player
    : spec.bodies.find((b) => b.placement.kind === 'launch')?.id
      ?? valid.map(tunableOwner).find((id) => spec.bodies.some((b) => b.id === id && b.type !== 'star'))
      ?? spec.bodies.find((b) => b.type !== 'star')?.id
      ?? spec.bodies[0].id;
  let own = valid.filter((t) => tunableOwner(t) === player).slice(0, 4);
  if (!own.length) own = valid.slice(0, 4);
  return Level.parse({
    id: opts.id,
    title: spec.title,
    briefing: opts.briefing ?? spec.description,
    spec: { ...spec, tunables: [] },
    player,
    controls: own.map((t) => ({ path: t.path, label: labelForPath(t.path), min: t.min, max: t.max })),
    par: opts.par ?? 3,
  });
}

export interface SolveLevelResult {
  solved: boolean;
  values: number[];
  goal: GoalResult;
  evals: number;
}

/** Search the level's controls (with fixed pieces) for a solution. */
export function solveLevel(level: Level, pieces: Piece[] = [], opts: OptimizeOptions = {}): SolveLevelResult {
  const base = shotSpec(level, controlValues(level), pieces);
  base.tunables = level.controls.map((c) => ({ path: c.path, min: c.min, max: c.max }));
  const res = optimize(base, opts);
  return { solved: res.solved, values: res.values, goal: res.result, evals: res.evals };
}

/** Circular orbital speed at radius r around mass m (AU/yr). */
export const circularSpeed = (r: number, m: number) => Math.sqrt((G * m) / r);
