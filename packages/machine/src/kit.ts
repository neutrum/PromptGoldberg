/**
 * The parts kit: what each part is made of, as plain geometry. The simulation builds colliders
 * from these and the renderer draws them, so the two never disagree about where a part is.
 */
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
};

/** Sizes in metres. */
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
  const color = p.color ?? DEFAULT_COLORS[p.kind];
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
      const { wall, height } = KIT.bucket;
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
    case 'ramp': return along(2);
    case 'dominoes': return along(Math.ceil(((p.length ?? DOMINO_DEFAULT) - 1) * KIT.domino.spacing / CELL + 0.5));
    case 'seesaw': return [{ x: p.x - f[0], z: p.z - f[2] }, { x: p.x, z: p.z }, { x: p.x + f[0], z: p.z + f[2] }];
    default: return [{ x: p.x, z: p.z }];
  }
}

/** Where the "action" of a part is, for distances and the camera: its origin lifted a little. */
export function partCentre(p: Part): Vec3 {
  const o = partOrigin(p);
  return [o[0], o[1] + CELL / 2, o[2]];
}
