/**
 * The parts kit: what each part is made of, as plain geometry. The simulation builds colliders
 * from these and the renderer draws them, so the two never disagree about where a part is.
 */
import { collides, HERO_SCALE, isGadget, propSize } from './landscape';
import { CELL, type Part, type PartKind, type Yaw } from './schema';

export type Vec3 = [number, number, number];
/** Quaternion [x, y, z, w]. */
export type Quat = [number, number, number, number];

export type Shape =
  | { kind: 'box'; size: Vec3 }
  | { kind: 'sphere'; radius: number }
  | { kind: 'cylinder'; radius: number; height: number }
  /** Right-angled wedge: `length` along local +x sloping down toward +x, `height` at the back, `width` across. */
  | { kind: 'wedge'; length: number; height: number; width: number };

export interface Body {
  /** Unique within the machine: `<partId>` or `<partId>.<n>` for multi-body parts. */
  id: string;
  part: string;
  kind: PartKind;
  shape: Shape;
  dynamic: boolean;
  /** Centre of the body (metres) and its orientation. */
  position: Vec3;
  rotation: Quat;
  color: string;
  /** Rapier-only tweaks. */
  sensor?: boolean;
  restitution?: number;
  friction?: number;
  density?: number;
  /** Use this body's restitution for contacts regardless of the other body's (bucket walls). */
  deadens?: boolean;
  /** A fixed obstacle drawn as its collider (a rock, a tree), not as the wall model. */
  prop?: string;
  /** Turns about its own middle at a steady rate (radians a second) round `axis` (world), pushing what it meets: a workbench part's paddle. */
  spin?: { axis: Vec3; rate: number };
}

/** Hinge between two bodies: `anchor` in world space, `axis` in world space. */
export interface Hinge {
  part: string;
  bodyA: string;
  bodyB: string;
  anchor: Vec3;
  axis: Vec3;
}

export interface Assembly {
  bodies: Body[];
  hinges: Hinge[];
}

export const DEFAULT_COLORS: Record<PartKind, string> = {
  ball: '#ff5a4e', ramp: '#58c4ff', platform: '#9aa5b5', wall: '#6f7886', dominoes: '#ffd166',
  seesaw: '#c38d5c', fan: '#7de0a7', trampoline: '#ff8fd1', cannon: '#4b5563', bucket: '#5c7cfa', bell: '#ffcc33',
  track: '#d9452b', curve: '#d9452b', descent: '#d9452b', ascent: '#d9452b',
};

/** Sizes in metres. */
export const SCENERY_COLOR = '#4a4f5c';

export const KIT = {
  ballRadius: 0.16,
  rampLength: 2 * CELL,
  rampHeight: CELL,
  platformThickness: 0.1,
  wallHeight: 2 * CELL,
  wallThickness: 0.12,
  domino: { thickness: 0.06, height: 0.42, width: 0.22, spacing: 0.24 },
  seesaw: { length: 3 * CELL, thickness: 0.05, pivotHeight: 0.22, pivotRadius: 0.06 },
  fan: { body: [0.24, 0.4, 0.4] as Vec3, reach: 3 * CELL, accel: 9 },
  trampoline: { thickness: 0.12, jumpSpeed: 5.5 },
  cannon: { body: [0.4, 0.3, 0.3] as Vec3, catchZone: [CELL, CELL, CELL] as Vec3, speed: 6.5, elevation: 25 },
  bucket: { wall: 0.03, height: 0.6 },
  bell: { radius: 0.18, height: 0.32 },
  /** Coaster track: the floor's thickness, the room between the rails, a rail's width and height above the floor; the ascent's chain-lift speed. */
  track: { floor: 0.06, inside: 0.38, rail: 0.04, railHeight: 0.12, liftSpeed: 1.8 },
} as const;

/** Unit vector a part faces. Yaw is clockwise seen from above with y up. */
export function facing(yaw: Yaw): Vec3 {
  switch (yaw) {
    case 0: return [1, 0, 0];
    case 90: return [0, 0, 1];
    case 180: return [-1, 0, 0];
    case 270: return [0, 0, -1];
  }
}

/** Unit vector to the part's left when facing `yaw` (perpendicular on the ground). */
export function sideways(yaw: Yaw): Vec3 {
  const [fx, , fz] = facing(yaw);
  return [fz, 0, -fx];
}

/** Rotation about +y that turns local +x into `facing(yaw)`. */
export function yawQuat(yaw: Yaw): Quat {
  const angle = (-yaw * Math.PI) / 180;
  return [0, Math.sin(angle / 2), 0, Math.cos(angle / 2)];
}

/** The middle of a prop that covers several cells (its origin cell is the first along and across). */
export function propCentre(p: Part): Vec3 {
  const [len, wide] = propSize(p);
  return add(add(partOrigin(p), facing(p.yaw), (len - 1) * CELL / 2), sideways(p.yaw), (wide - 1) * CELL / 2);
}

/** a then b, as one rotation. */
export function mulQuat(a: Quat, b: Quat): Quat {
  const [ax, ay, az, aw] = a, [bx, by, bz, bw] = b;
  return [aw * bx + ax * bw + ay * bz - az * by, aw * by - ax * bz + ay * bw + az * bx, aw * bz + ax * by - ay * bx + az * bw, aw * bw - ax * bx - ay * by - az * bz];
}
/** Turn about +y by `a` radians. */
const aboutY = (a: number): Quat => [0, Math.sin(a / 2), 0, Math.cos(a / 2)];
/** A part's local vector (x along its facing, y up, z to its right) in world axes. */
function local(yaw: Yaw, [x, y, z]: Vec3): Vec3 {
  const f = facing(yaw), l = sideways(yaw);
  return [x * f[0] - z * l[0], y, x * f[2] - z * l[2]];
}
const TRACK_FLOOR = '#3d4652';
/** A straight run of track from (along a, height ha) to (along b, height hb), in the part's own axes. */
function slope(a: number, ha: number, b: number, hb: number) {
  const angle = Math.atan2(hb - ha, b - a);
  return { tilt: [0, 0, Math.sin(angle / 2), Math.cos(angle / 2)] as Quat, mid: [(a + b) / 2, (ha + hb) / 2, 0] as Vec3, up: [-Math.sin(angle), Math.cos(angle), 0] as Vec3 };
}
/** Coaster track: a floor and two rails along a straight run (flat, down or up). */
function channel(p: Part, o: Vec3, q: Quat, color: string, fixed: (id: string, shape: Shape, at: Vec3, rotation?: Quat, extra?: Partial<Body>) => void, a: number, ha: number, b: number, hb: number) {
  const { floor, inside, rail, railHeight } = KIT.track;
  const { tilt, mid, up } = slope(a, ha, b, hb);
  const length = Math.hypot(b - a, hb - ha), turn = mulQuat(q, tilt);
  fixed(p.id, { kind: 'box', size: [length, floor, inside + 2 * rail] }, add(o, local(p.yaw, add(mid, up, -floor / 2))), turn, { color: TRACK_FLOOR, friction: 0.25 });
  for (const side of [-1, 1]) {
    const at = add(add(mid, up, railHeight / 2), [0, 0, side * (inside / 2 + rail / 2)]);
    fixed(`${p.id}.${side < 0 ? 'left' : 'right'}`, { kind: 'box', size: [length, railHeight, rail] }, add(o, local(p.yaw, at)), turn, { color, restitution: 0.1, friction: 0.1 });
  }
}
/** A cylinder turned onto its side, its axis along the part's facing. */
const ON_SIDE: Quat = [0, 0, Math.SQRT1_2, Math.SQRT1_2];

/** World position of a part's cell centre at its base height, including fine offsets. */
export function partOrigin(p: Part): Vec3 {
  return [(p.x + 0.5 + (p.dx ?? 0)) * CELL, p.y * CELL, (p.z + 0.5 + (p.dz ?? 0)) * CELL];
}

const add = (a: Vec3, b: Vec3, k = 1): Vec3 => [a[0] + k * b[0], a[1] + k * b[1], a[2] + k * b[2]];
const IDENTITY: Quat = [0, 0, 0, 1];

export const DOMINO_DEFAULT = 5;
export const PLATFORM_DEFAULT = 3;

/** Bodies and hinges for one part. */
export function assemblePart(p: Part): Assembly {
  const o = partOrigin(p);
  const f = facing(p.yaw);
  const q = yawQuat(p.yaw);
  // Scenery reads as stone: part of the level, not a part to play with.
  const color = p.color ?? (p.fixed ? SCENERY_COLOR : DEFAULT_COLORS[p.kind]);
  const base = { part: p.id, kind: p.kind, color };
  const bodies: Body[] = [];
  const hinges: Hinge[] = [];
  const fixed = (id: string, shape: Shape, position: Vec3, rotation: Quat = IDENTITY, extra: Partial<Body> = {}) =>
    bodies.push({ ...base, id, shape, dynamic: false, position, rotation, ...extra });

  switch (p.kind) {
    case 'ball':
      bodies.push({ ...base, id: p.id, shape: { kind: 'sphere', radius: KIT.ballRadius }, dynamic: true, position: add(o, [0, KIT.ballRadius + 0.02, 0]), rotation: IDENTITY, density: 1, restitution: 0.3, friction: 0.6 });
      break;
    case 'ramp':
      // Fills its own cell and the next one in its facing; the high end is in its own cell.
      fixed(p.id, { kind: 'wedge', length: KIT.rampLength, height: KIT.rampHeight, width: CELL }, add(o, f, CELL / 2), q, { friction: 0.4 });
      break;
    case 'platform': {
      // The top surface is at the part's height, so parts standing on it share its y.
      const len = (p.length ?? PLATFORM_DEFAULT) * CELL;
      fixed(p.id, { kind: 'box', size: [len, KIT.platformThickness, CELL] }, add(add(o, f, len / 2 - CELL / 2), [0, -KIT.platformThickness / 2, 0]), q, { friction: 0.5 });
      break;
    }
    case 'wall':
      if (p.prop) {
        // Obstacles in a cell: what the ball bounces off is exactly what is drawn.
        const prop = { prop: p.prop, restitution: 0.35 };
        const tone = (fallback: string) => p.color ?? fallback;
        switch (p.prop) {
          case 'rock': fixed(p.id, { kind: 'sphere', radius: 0.38 }, add(o, [0, 0.22, 0]), q, { ...prop, color: tone('#8a8d90') }); break;
          // A fence panel across the cell, like a low wall: what the ball bounces off is the board drawn.
          case 'fence': fixed(p.id, { kind: 'box', size: [0.06, 0.32, CELL * 0.98] }, add(o, [0, 0.16, 0]), q, { ...prop, color: tone('#8a6a45') }); break;
          case 'crate': fixed(p.id, { kind: 'box', size: [0.42, 0.42, 0.42] }, add(o, [0, 0.21, 0]), q, { ...prop, color: tone('#a8794a') }); break;
          case 'cactus': fixed(p.id, { kind: 'cylinder', radius: 0.1, height: 0.75 }, add(o, [0, 0.375, 0]), q, { ...prop, color: tone('#5f8f4a') }); break;
          case 'stump': fixed(p.id, { kind: 'cylinder', radius: 0.17, height: 0.3 }, add(o, [0, 0.15, 0]), q, { ...prop, color: tone('#7a5230') }); break;
          case 'tree':
            fixed(p.id, { kind: 'cylinder', radius: 0.07, height: 0.7 }, add(o, [0, 0.35, 0]), q, { ...prop, color: '#5c3d24' });
            fixed(`${p.id}.crown`, { kind: 'cylinder', radius: 0.3, height: 0.75 }, add(o, [0, 1.07, 0]), q, { ...prop, color: tone('#2f5a3c') });
            break;
          case 'crystal': fixed(p.id, { kind: 'cylinder', radius: 0.14, height: 0.7 }, add(o, [0, 0.35, 0]), q, { ...prop, color: tone('#b57bff') }); break;
          case 'column': fixed(p.id, { kind: 'cylinder', radius: 0.17, height: 0.95 }, add(o, [0, 0.475, 0]), q, { ...prop, color: tone('#d8ccb0') }); break;
          case 'nut': fixed(p.id, { kind: 'cylinder', radius: 0.21, height: 0.17 }, add(o, [0, 0.085, 0]), q, { ...prop, color: tone('#9aa3ad') }); break;
          case 'tape': fixed(p.id, { kind: 'cylinder', radius: 0.22, height: 0.24 }, add(o, [0, 0.12, 0]), q, { ...prop, color: tone('#f2c230') }); break;
          case 'spool': fixed(p.id, { kind: 'cylinder', radius: 0.19, height: 0.32 }, add(o, [0, 0.16, 0]), q, { ...prop, color: tone('#c0503f') }); break;
          case 'bolt':
            fixed(p.id, { kind: 'cylinder', radius: 0.15, height: 0.12 }, add(o, [0, 0.06, 0]), q, { ...prop, color: tone('#8d959e') });
            fixed(`${p.id}.shank`, { kind: 'cylinder', radius: 0.06, height: 0.45 }, add(o, [0, 0.345, 0]), q, { ...prop, color: tone('#8d959e') });
            break;
          default: {
            // Props over several cells (tools lying along the facing, the big landmarks); `c` is their middle.
            const c = propCentre(p);
            const s = sideways(p.yaw);
            const side = mulQuat(q, ON_SIDE);
            const at = (along: number, up: number, across = 0) => add(add(add(c, f, along), s, across), [0, up, 0]);
            // Landmarks are modelled at unit size and stand HERO_SCALE times bigger.
            const k = HERO_SCALE;
            const big = (shape: Shape): Shape => shape.kind === 'box' ? { kind: 'box', size: [shape.size[0] * k, shape.size[1] * k, shape.size[2] * k] }
              : shape.kind === 'sphere' ? { kind: 'sphere', radius: shape.radius * k }
              : shape.kind === 'cylinder' ? { kind: 'cylinder', radius: shape.radius * k, height: shape.height * k } : shape;
            const hero = (id: string, shape: Shape, pos: Vec3, color: string, rot = q) => {
              const d: Vec3 = [(pos[0] - c[0]) * k, (pos[1] - c[1]) * k, (pos[2] - c[2]) * k];
              fixed(id ? `${p.id}.${id}` : p.id, big(shape), add(c, d), rot, { ...prop, restitution: 0.3, color });
            };
            switch (p.prop) {
              // The landmarks: solid wherever a rolling or bouncing ball can reach; details above that are drawn by the scene.
              case 'dragon': {
                const skin = tone('#3f7a4a');
                hero('', { kind: 'box', size: [1.4, 0.5, 0.8] }, at(-0.05, 0.3), skin);
                hero('neck', { kind: 'box', size: [0.5, 0.36, 0.36] }, at(0.85, 0.42), skin);
                hero('head', { kind: 'box', size: [0.5, 0.32, 0.38] }, at(1.18, 0.52), skin);
                hero('tail', { kind: 'box', size: [0.95, 0.2, 0.22] }, at(-1.15, 0.12), skin);
                break;
              }
              case 'castle': {
                const stone = tone('#b8ad9a');
                hero('', { kind: 'box', size: [1.5, 0.7, 1.5] }, at(0, 0.35), stone);
                for (const [k, [a, b]] of ([[0.75, 0.75], [0.75, -0.75], [-0.75, 0.75], [-0.75, -0.75]] as const).entries()) hero(`tower${k}`, { kind: 'cylinder', radius: 0.24, height: 1.15 }, at(a, 0.575, b), stone);
                break;
              }
              case 'ship': {
                hero('', { kind: 'box', size: [2.2, 0.42, 0.78] }, at(0, 0.21), tone('#7a4a2b'));
                hero('mast', { kind: 'cylinder', radius: 0.05, height: 1.5 }, at(0.1, 1.17), '#5c3d24');
                break;
              }
              case 'robot': {
                const metal = tone('#9aa3ad');
                hero('', { kind: 'box', size: [0.3, 0.55, 0.3] }, at(0, 0.275, 0.24), metal);
                hero('leg2', { kind: 'box', size: [0.3, 0.55, 0.3] }, at(0, 0.275, -0.24), metal);
                hero('body', { kind: 'box', size: [0.55, 0.6, 0.8] }, at(0, 0.85), metal);
                break;
              }
              case 'rocket': {
                const hull = tone('#e8e4dc');
                hero('', { kind: 'cylinder', radius: 0.34, height: 1.7 }, at(0, 0.85), hull);
                hero('fin', { kind: 'box', size: [1.0, 0.36, 0.08] }, at(0, 0.18), '#d9452b');
                hero('fin2', { kind: 'box', size: [0.08, 0.36, 1.0] }, at(0, 0.18), '#d9452b');
                break;
              }
              case 'windmill':
                hero('', { kind: 'cylinder', radius: 0.36, height: 1.5 }, at(0, 0.75), tone('#efe4cc'));
                break;
              case 'teapot':
                hero('', { kind: 'sphere', radius: 0.62 }, at(0, 0.55), tone('#5b8fd6'));
                break;
              case 'landmark':
                // Composed for the place, in cells: the solid shapes collide, cones and roofs are drawn on top by the scene.
                // A workbench part's tilted boxes collide too: turned toward its right first, then leaning toward where they point, about their bottom as drawn.
                for (const [i, s] of (p.build ?? []).filter((s) => collides(s, isGadget(p))).entries()) {
                  // Across runs to the part's right, as the scene draws it (sideways() is its left).
                  const [along, up, right] = s.at.map((v) => v * CELL), [a, h, b] = s.size.map((v) => v * CELL), across = -right;
                  const id = i ? `${p.id}.${i}` : p.id, extra: Partial<Body> = { ...prop, restitution: 0.3, color: s.color };
                  // A spinning shape turns about its own middle. Turning forward, a wheel's bottom pushes toward the facing,
                  // and a flat one sweeps the side the ball comes from (its back) toward the part's right.
                  if (s.spin) extra.spin = { axis: s.axis === 'across' ? [-f[2], 0, f[0]] : [0, 1, 0], rate: s.spin * 2 * Math.PI };
                  const lean = ((s.tilt ?? 0) * Math.PI) / 180, turn = ((s.turn ?? 0) * Math.PI) / 180, shift = Math.sin(lean) * h / 2;
                  if (s.shape === 'box') fixed(id, { kind: 'box', size: [a, h, b] }, at(along + Math.cos(turn) * shift, up + Math.cos(lean) * h / 2, across - Math.sin(turn) * shift), mulQuat(mulQuat(q, aboutY(-turn)), [0, 0, Math.sin(-lean / 2), Math.cos(-lean / 2)]), extra);
                  else if (s.shape === 'cylinder') fixed(id, { kind: 'cylinder', radius: a / 2, height: h }, at(along, up + h / 2, across), q, extra);
                  else fixed(id, { kind: 'sphere', radius: a / 2 }, at(along, up + a / 2, across), q, extra);
                }
                break;
              case 'hammer':
                fixed(p.id, { kind: 'cylinder', radius: 0.06, height: 0.85 }, at(-0.08, 0.06), side, { ...prop, color: '#b5834a' });
                fixed(`${p.id}.head`, { kind: 'box', size: [0.18, 0.2, 0.46] }, at(0.4, 0.1), q, { ...prop, color: tone('#5b6168') });
                break;
              case 'wrench':
                fixed(p.id, { kind: 'box', size: [0.72, 0.1, 0.14] }, at(0, 0.05), q, { ...prop, color: tone('#9aa3ad') });
                fixed(`${p.id}.jaw`, { kind: 'cylinder', radius: 0.15, height: 0.1 }, at(0.4, 0.05), q, { ...prop, color: tone('#9aa3ad') });
                fixed(`${p.id}.ring`, { kind: 'cylinder', radius: 0.13, height: 0.1 }, at(-0.4, 0.05), q, { ...prop, color: tone('#9aa3ad') });
                break;
              case 'screwdriver':
                fixed(p.id, { kind: 'cylinder', radius: 0.09, height: 0.4 }, at(-0.27, 0.09), side, { ...prop, color: tone('#d9452b') });
                fixed(`${p.id}.shaft`, { kind: 'cylinder', radius: 0.03, height: 0.55 }, at(0.2, 0.09), side, { ...prop, color: '#b8bec4' });
                break;
              case 'pencil':
                fixed(p.id, { kind: 'cylinder', radius: 0.08, height: 1.3 }, at(0.06, 0.08), side, { ...prop, color: tone('#f2c230') });
                fixed(`${p.id}.eraser`, { kind: 'cylinder', radius: 0.08, height: 0.14 }, at(-0.66, 0.08), side, { ...prop, color: '#f08fa0' });
                break;
            }
          }
        }
        break;
      }
      // A wall stands across its facing, so a ball rolling toward it stops.
      fixed(p.id, { kind: 'box', size: [KIT.wallThickness, KIT.wallHeight, CELL] }, add(o, [0, KIT.wallHeight / 2, 0]), q, { restitution: 0.4 });
      break;
    case 'dominoes': {
      const n = p.length ?? DOMINO_DEFAULT;
      const d = KIT.domino;
      for (let i = 0; i < n; i++) {
        bodies.push({
          ...base, id: `${p.id}.${i}`, shape: { kind: 'box', size: [d.thickness, d.height, d.width] }, dynamic: true,
          position: add(add(o, f, i * d.spacing), [0, d.height / 2, 0]), rotation: q, density: 2, friction: 0.5, restitution: 0.05,
        });
      }
      break;
    }
    case 'seesaw': {
      const s = KIT.seesaw;
      const pivot = add(o, [0, s.pivotHeight / 2, 0]);
      fixed(`${p.id}.pivot`, { kind: 'box', size: [s.pivotRadius * 2, s.pivotHeight, CELL * 0.6] }, pivot, q);
      const top = add(o, [0, s.pivotHeight + s.thickness / 2, 0]);
      bodies.push({ ...base, id: p.id, shape: { kind: 'box', size: [s.length, s.thickness, CELL * 0.8] }, dynamic: true, position: top, rotation: q, density: 1.5, friction: 0.5 });
      hinges.push({ part: p.id, bodyA: `${p.id}.pivot`, bodyB: p.id, anchor: top, axis: sideways(p.yaw) });
      break;
    }
    case 'fan': {
      const b = KIT.fan.body;
      fixed(p.id, { kind: 'box', size: b }, add(o, [0, b[1] / 2, 0]), q);
      // The stream of air: a sensor in front of the fan, three cells wide so a fan beside the path still pushes.
      fixed(`${p.id}.air`, { kind: 'box', size: [KIT.fan.reach, CELL, 3 * CELL] }, add(add(o, f, b[0] / 2 + KIT.fan.reach / 2), [0, CELL / 2, 0]), q, { sensor: true });
      break;
    }
    case 'trampoline':
      fixed(p.id, { kind: 'box', size: [CELL, KIT.trampoline.thickness, CELL] }, add(o, [0, KIT.trampoline.thickness / 2, 0]), q);
      break;
    case 'cannon': {
      const b = KIT.cannon.body;
      // The whole cell is the barrel: a ball rolling or falling into it is shot out toward the facing.
      fixed(p.id, { kind: 'box', size: KIT.cannon.catchZone }, add(o, [0, CELL / 2, 0]), q, { sensor: true });
      fixed(`${p.id}.barrel`, { kind: 'cylinder', radius: b[1] / 2, height: b[0] }, add(o, [0, b[1] / 2 + 0.08, 0]), q, { sensor: true });
      fixed(`${p.id}.stand`, { kind: 'box', size: [0.2, 0.1, 0.2] }, add(o, [0, 0.05, 0]), q);
      break;
    }
    case 'bucket': {
      const { wall } = KIT.bucket;
      // Sunk in a pit, its rim is flush with the ground, so a rolling ball drops straight in (a rim
      // above the ground turned most rolling balls away: 19 -> 30 of 32 judge levels solvable with the kit).
      const height = p.y < 0 ? Math.min(KIT.bucket.height, -p.y * CELL) : KIT.bucket.height;
      const w = CELL * 0.9;
      // Dead walls and floor: a ball that gets in stays in instead of bouncing back out.
      const dead = { restitution: 0, friction: 0.9, deadens: true };
      fixed(`${p.id}.floor`, { kind: 'box', size: [w, wall, w] }, add(o, [0, wall / 2, 0]), q, dead);
      const side = (id: string, dir: Vec3, size: Vec3) => fixed(`${p.id}.${id}`, { kind: 'box', size }, add(add(o, dir, w / 2 - wall / 2), [0, height / 2, 0]), q, dead);
      side('front', f, [wall, height, w]);
      side('back', f.map((v) => -v) as Vec3, [wall, height, w]);
      const s = sideways(p.yaw);
      side('left', s, [w, height, wall]);
      side('right', s.map((v) => -v) as Vec3, [w, height, wall]);
      fixed(p.id, { kind: 'box', size: [w - 2 * wall, height - wall, w - 2 * wall] }, add(o, [0, wall + (height - wall) / 2, 0]), q, { sensor: true });
      break;
    }
    case 'bell': {
      const { radius, height } = KIT.bell;
      fixed(p.id, { kind: 'cylinder', radius, height }, add(o, [0, height / 2, 0]), q, { restitution: 0.5 });
      break;
    }
    case 'track':
      channel(p, o, q, color, fixed, -CELL / 2, 0, CELL / 2, 0);
      break;
    case 'descent':
      channel(p, o, q, color, fixed, -CELL / 2, CELL, 1.5 * CELL, 0);
      break;
    case 'ascent': {
      channel(p, o, q, color, fixed, -CELL / 2, 0, 1.5 * CELL, CELL);
      // The chain lift: a sensor over the slope that the simulation keeps the ball climbing through.
      const { tilt, mid, up } = slope(-CELL / 2, 0, 1.5 * CELL, CELL);
      const length = Math.hypot(2 * CELL, CELL);
      fixed(`${p.id}.lift`, { kind: 'box', size: [length, KIT.ballRadius * 2, KIT.track.inside] }, add(o, local(p.yaw, add(mid, up, KIT.ballRadius + 0.02))), mulQuat(q, tilt), { sensor: true });
      break;
    }
    case 'curve': {
      // A quarter turn round the cell's back-left corner: in over the back edge, out over the left side.
      // Only the outer rail: the turn presses the ball against it.
      const { floor, inside, rail, railHeight } = KIT.track;
      const corner: Vec3 = [-CELL / 2, 0, -CELL / 2];
      fixed(p.id, { kind: 'box', size: [CELL, floor, CELL] }, add(o, [0, -floor / 2, 0]), q, { color: TRACK_FLOOR, friction: 0.25 });
      const r = CELL / 2 + inside / 2 + rail / 2, n = 6;
      for (let i = 0; i < n; i++) {
        const phi = ((i + 0.5) / n) * Math.PI / 2, chord = 2 * r * Math.sin(Math.PI / 4 / n) + 0.01;
        const at: Vec3 = [corner[0] + r * Math.cos(phi), railHeight / 2, corner[2] + r * Math.sin(phi)];
        fixed(`${p.id}.rail${i}`, { kind: 'box', size: [chord, railHeight, rail] }, add(o, local(p.yaw, at)), mulQuat(q, aboutY(-(phi + Math.PI / 2))), { color, restitution: 0.1, friction: 0.1 });
      }
      break;
    }
  }
  return { bodies, hinges };
}

export function assemble(parts: Part[]): Assembly {
  const bodies: Body[] = [];
  const hinges: Hinge[] = [];
  for (const p of parts) {
    const a = assemblePart(p);
    bodies.push(...a.bodies);
    hinges.push(...a.hinges);
  }
  return { bodies, hinges };
}

/** The grid cells a part takes up on its level (platforms and ramps span several). */
export function footprint(p: Part): { x: number; z: number }[] {
  const f = facing(p.yaw);
  const along = (n: number) => Array.from({ length: n }, (_, i) => ({ x: p.x + f[0] * i, z: p.z + f[2] * i }));
  switch (p.kind) {
    case 'platform': return along(p.length ?? PLATFORM_DEFAULT);
    case 'ramp': case 'descent': case 'ascent': return along(2);
    case 'dominoes': return along(Math.ceil(((p.length ?? DOMINO_DEFAULT) - 1) * KIT.domino.spacing / CELL + 0.5));
    case 'seesaw': return [{ x: p.x - f[0], z: p.z - f[2] }, { x: p.x, z: p.z }, { x: p.x + f[0], z: p.z + f[2] }];
    case 'wall': {
      const [len, wide] = propSize(p);
      if (wide === 1) return along(len);
      const s = sideways(p.yaw);
      return along(len).flatMap((c) => Array.from({ length: wide }, (_, j) => ({ x: c.x + s[0] * j, z: c.z + s[2] * j })));
    }
    default: return [{ x: p.x, z: p.z }];
  }
}

/** Where the "action" of a part is, for distances and the camera: its origin lifted a little. */
export function partCentre(p: Part): Vec3 {
  const o = partOrigin(p);
  return [o[0], o[1] + CELL / 2, o[2]];
}
