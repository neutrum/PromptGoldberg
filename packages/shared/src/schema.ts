import { z } from 'zod';

const Vec3 = z.tuple([z.number(), z.number(), z.number()]);

export const BodyType = z.enum(['star', 'planet', 'moon', 'comet', 'probe']);
export type BodyType = z.infer<typeof BodyType>;

/** Keplerian orbit relative to a parent body. Angles in degrees. */
export const OrbitPlacement = z.object({
  kind: z.literal('orbit'),
  parent: z.string().describe('id of the body this one orbits'),
  a: z.number().positive().describe('semi-major axis in AU'),
  e: z.number().min(0).max(0.99).default(0).describe('eccentricity'),
  phase: z.number().default(0).describe('true anomaly at t=0, degrees'),
  argPeriapsis: z.number().default(0).describe('argument of periapsis, degrees'),
  inclination: z.number().min(0).max(180).default(0).describe('degrees from the system plane'),
  retrograde: z.boolean().default(false),
});

/** Launched from another body at a given time (probes, comets). Angles in degrees. */
export const LaunchPlacement = z.object({
  kind: z.literal('launch'),
  from: z.string().describe('id of the body it launches from'),
  speed: z.number().min(0).describe('departure speed relative to the source body once clear of its gravity, AU/yr (1 AU/yr is about 4.74 km/s)'),
  angle: z.number().default(0).describe('in-plane direction, degrees: 0 = source prograde, 90 = outward from its parent'),
  elevation: z.number().min(-90).max(90).default(0).describe('out-of-plane angle, degrees'),
  time: z.number().min(0).default(0).describe('launch time in years'),
});

/** Free initial state in the system frame (rogue bodies). */
export const FreePlacement = z.object({
  kind: z.literal('free'),
  position: Vec3.describe('AU'),
  velocity: Vec3.describe('AU/yr'),
});

export const Placement = z.discriminatedUnion('kind', [OrbitPlacement, LaunchPlacement, FreePlacement]);

export const BodySpec = z.object({
  id: z.string().regex(/^[a-z0-9_-]+$/i).describe('short unique id'),
  name: z.string(),
  type: BodyType,
  mass: z.number().nonnegative().describe('solar masses (Earth about 3e-6, Jupiter about 9.5e-4)'),
  radius: z.number().positive().describe('physical radius in AU (Sun 4.65e-3, Jupiter 4.8e-4, Earth 4.3e-5)'),
  color: z.string().optional(),
  placement: Placement,
});
export type BodySpec = z.infer<typeof BodySpec>;

export const FlybyGoal = z.object({
  type: z.literal('flyby'),
  body: z.string(),
  target: z.string(),
  maxDistance: z.number().positive().describe('closest approach must be within this many AU'),
});
export const CaptureGoal = z.object({
  type: z.literal('capture'),
  body: z.string(),
  target: z.string().describe('body that ends up being orbited'),
  minDuration: z.number().positive().optional().describe('years it must stay bound; default one orbit'),
});
export const CollisionGoal = z.object({
  type: z.literal('collision'),
  a: z.string(),
  b: z.string(),
});
export const EscapeGoal = z.object({
  type: z.literal('escape'),
  body: z.string(),
});
export const EclipseGoal = z.object({
  type: z.literal('eclipse'),
  occluder: z.string(),
  source: z.string().describe('the star being blocked'),
  observer: z.string(),
  period: z.number().positive().optional().describe('if set, eclipses must repeat with this period in years'),
});

export const GoalEvent = z.discriminatedUnion('type', [FlybyGoal, CaptureGoal, CollisionGoal, EscapeGoal, EclipseGoal]);
export type GoalEvent = z.infer<typeof GoalEvent>;

export const Tunable = z.object({
  path: z.string().describe('e.g. "bodies.probe.placement.speed"'),
  min: z.number(),
  max: z.number(),
});
export type Tunable = z.infer<typeof Tunable>;

export const SimSettings = z.object({
  duration: z.number().positive().describe('years to simulate'),
  dt: z.number().positive().optional().describe('timestep in years; derived if omitted'),
  samples: z.number().int().min(10).max(20000).default(2000).describe('recorded frames for playback'),
});

export const SystemSpec = z.object({
  title: z.string(),
  description: z.string().default(''),
  bodies: z.array(BodySpec).min(1).max(16),
  goal: z.array(GoalEvent).max(4),
  tunables: z.array(Tunable).default([]),
  sim: SimSettings,
});
export type SystemSpec = z.infer<typeof SystemSpec>;
export type SystemSpecInput = z.input<typeof SystemSpec>;

export interface SpecIssue {
  path: string;
  message: string;
}

/** Semantic checks zod cannot express: references and placement cycles. */
export function checkReferences(spec: SystemSpec): SpecIssue[] {
  const issues: SpecIssue[] = [];
  const ids = new Set<string>();
  spec.bodies.forEach((b, i) => {
    if (ids.has(b.id)) issues.push({ path: `bodies.${i}.id`, message: `duplicate id "${b.id}"` });
    ids.add(b.id);
  });
  const byId = new Map(spec.bodies.map((b) => [b.id, b]));
  const ref = (path: string, id: string) => {
    if (!byId.has(id)) issues.push({ path, message: `unknown body "${id}"` });
  };

  spec.bodies.forEach((b, i) => {
    const p = b.placement;
    if (p.kind === 'orbit') ref(`bodies.${i}.placement.parent`, p.parent);
    if (p.kind === 'launch') ref(`bodies.${i}.placement.from`, p.from);
  });

  for (const b of spec.bodies) {
    const seen = new Set<string>();
    let cur: BodySpec | undefined = b;
    while (cur) {
      if (seen.has(cur.id)) {
        issues.push({ path: 'bodies', message: `placement cycle involving "${b.id}"` });
        break;
      }
      seen.add(cur.id);
      cur = placementRef(cur) ? byId.get(placementRef(cur)!) : undefined;
    }
  }

  spec.goal.forEach((g, i) => {
    for (const [key, id] of Object.entries(goalBodies(g))) ref(`goal.${i}.${key}`, id);
  });

  spec.tunables.forEach((t, i) => {
    if (t.min > t.max) issues.push({ path: `tunables.${i}`, message: 'min is greater than max' });
  });
  return issues;
}

/** The body a placement is relative to, if any. */
export function placementRef(b: BodySpec): string | undefined {
  const p = b.placement;
  return p.kind === 'orbit' ? p.parent : p.kind === 'launch' ? p.from : undefined;
}

/** Body-id fields of a goal event, keyed by field name. */
export function goalBodies(g: GoalEvent): Record<string, string> {
  switch (g.type) {
    case 'flyby':
    case 'capture':
      return { body: g.body, target: g.target };
    case 'collision':
      return { a: g.a, b: g.b };
    case 'escape':
      return { body: g.body };
    case 'eclipse':
      return { occluder: g.occluder, source: g.source, observer: g.observer };
  }
}

export type ParseResult = { ok: true; spec: SystemSpec } | { ok: false; issues: SpecIssue[] };

export function parseSpec(input: unknown): ParseResult {
  const r = SystemSpec.safeParse(input);
  if (!r.success) {
    return {
      ok: false,
      issues: r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    };
  }
  const issues = checkReferences(r.data);
  return issues.length ? { ok: false, issues } : { ok: true, spec: r.data };
}
