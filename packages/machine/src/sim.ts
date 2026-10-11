/**
 * Runs a machine in Rapier and records what happened: a frame trace for playback and the events
 * the goal checker needs. Deterministic: the same spec gives the same trace in Node and in the
 * browser (same WebAssembly build, fixed timestep, parts created in spec order).
 */
import RAPIER from '@dimforge/rapier3d-compat';
import { assemble, facing, KIT, partCentre, type Body, type Vec3 } from './kit';
import { CELL, type MachineSpec, type Part } from './schema';

export const STEP_HZ = 120;
/** Playback frames per second (every other physics step). */
export const FRAME_HZ = 60;

export type MachineEvent =
  | { type: 'touch'; t: number; part: string }
  | { type: 'bell'; t: number; part: string }
  | { type: 'bucket'; t: number; part: string }
  | { type: 'topple'; t: number; part: string }
  | { type: 'fired'; t: number; part: string }
  | { type: 'bounce'; t: number; part: string }
  | { type: 'fell'; t: number };

export interface MachineRun {
  spec: MachineSpec;
  bodies: Body[];
  /** Ids of the dynamic bodies, in frame order. */
  dynamicIds: string[];
  /** Per frame: t, then x y z qx qy qz qw per dynamic body. */
  frames: Float32Array;
  frameCount: number;
  frameStride: number;
  events: MachineEvent[];
  /** Closest the ball came to each part's centre (metres), for partial credit. */
  closest: Record<string, { d: number; t: number }>;
  /** Where the ball came to rest (or left the stage). */
  ballEnd: Vec3;
  stats: { steps: number; ms: number };
}

let ready: Promise<void> | null = null;
/** Loads the physics engine; call once before simulating (simulate() waits for it too). */
export function initPhysics(): Promise<void> {
  return (ready ??= RAPIER.init());
}

const quatOf = (r: { x: number; y: number; z: number; w: number }) => r;

function colliderDesc(b: Body): RAPIER.ColliderDesc {
  let desc: RAPIER.ColliderDesc;
  switch (b.shape.kind) {
    case 'box': desc = RAPIER.ColliderDesc.cuboid(b.shape.size[0] / 2, b.shape.size[1] / 2, b.shape.size[2] / 2); break;
    case 'sphere': desc = RAPIER.ColliderDesc.ball(b.shape.radius); break;
    case 'cylinder': desc = RAPIER.ColliderDesc.cylinder(b.shape.height / 2, b.shape.radius); break;
    case 'wedge': {
      const { length: l, height: h, width: w } = b.shape;
      // Local +x is downhill: tall at -x/2, flat at +x/2, base on y=0.
      const pts = new Float32Array([
        -l / 2, 0, -w / 2, -l / 2, 0, w / 2, l / 2, 0, -w / 2, l / 2, 0, w / 2,
        -l / 2, h, -w / 2, -l / 2, h, w / 2,
      ]);
      desc = RAPIER.ColliderDesc.convexHull(pts)!;
      break;
    }
  }
  if (b.sensor) desc.setSensor(true);
  if (b.restitution !== undefined) desc.setRestitution(b.restitution);
  if (b.friction !== undefined) desc.setFriction(b.friction);
  if (b.density !== undefined) desc.setDensity(b.density);
  if (b.deadens) desc.setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Min);
  return desc;
}

export interface SimulateOptions {
  /** Record playback frames (default true). Verification turns it off. */
  record?: boolean;
}

/** Simulate a machine. Waits for the engine to load on first use. */
export async function simulateMachine(spec: MachineSpec, opts: SimulateOptions = {}): Promise<MachineRun> {
  await initPhysics();
  return simulateSync(spec, opts);
}

/** Same as simulateMachine, after initPhysics() resolved. */
export function simulateSync(spec: MachineSpec, opts: SimulateOptions = {}): MachineRun {
  const started = Date.now();
  const record = opts.record ?? true;
  const { bodies, hinges } = assemble(spec.parts);
  const parts = new Map(spec.parts.map((p) => [p.id, p]));
  const ballPart = spec.parts.find((p) => p.kind === 'ball')!;

  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = 1 / STEP_HZ;
  const floor = world.createCollider(RAPIER.ColliderDesc.cuboid(GRID_HALF_X + 2, 0.5, GRID_HALF_Z + 2).setTranslation(GRID_HALF_X, -0.5, GRID_HALF_Z).setFriction(0.6));
  floor.setRestitution(0.2);

  const rigid = new Map<string, RAPIER.RigidBody>();
  const colliderBody = new Map<number, Body>();
  for (const b of bodies) {
    const desc = b.dynamic ? RAPIER.RigidBodyDesc.dynamic() : RAPIER.RigidBodyDesc.fixed();
    desc.setTranslation(...b.position).setRotation({ x: b.rotation[0], y: b.rotation[1], z: b.rotation[2], w: b.rotation[3] });
    if (b.dynamic) desc.setCcdEnabled(b.shape.kind === 'sphere').setCanSleep(true);
    const rb = world.createRigidBody(desc);
    const col = world.createCollider(colliderDesc(b), rb);
    // Contact events for the ball and the bells (a falling domino rings a bell too).
    if (b.kind === 'ball' || b.kind === 'bell') col.setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
    rigid.set(b.id, rb);
    colliderBody.set(col.handle, b);
  }
  for (const h of hinges) {
    const a = rigid.get(h.bodyA)!, b = rigid.get(h.bodyB)!;
    // Joint anchors and axis are in each body's local frame (both seesaw bodies share one rotation).
    const local = (rb: RAPIER.RigidBody, v: Vec3): RAPIER.Vector3 => {
      const t = rb.translation();
      const [x, y, z] = rotateInv(rb.rotation(), [v[0] - t.x, v[1] - t.y, v[2] - t.z]);
      return { x, y, z };
    };
    const [ax, ay, az] = rotateInv(a.rotation(), h.axis);
    const joint = RAPIER.JointData.revolute(local(a, h.anchor), local(b, h.anchor), { x: ax, y: ay, z: az });
    world.createImpulseJoint(joint, a, b, true);
  }

  const ball = rigid.get(ballPart.id)!;
  const ballCollider = ball.collider(0);
  const dynamic = bodies.filter((b) => b.dynamic);
  const dynamicIds = dynamic.map((b) => b.id);
  const dynamicBodies = dynamic.map((b) => rigid.get(b.id)!);
  const stride = 1 + 7 * dynamic.length;
  const steps = Math.round(spec.duration * STEP_HZ);
  const frameEvery = STEP_HZ / FRAME_HZ;
  const frameCount = record ? Math.floor(steps / frameEvery) + 1 : 0;
  const frames = new Float32Array(frameCount * stride);

  const events: MachineEvent[] = [];
  const closest: Record<string, { d: number; t: number }> = {};
  const centres = spec.parts.filter((p) => p.kind !== 'ball').map((p) => ({ id: p.id, c: partCentre(p) }));
  const lastTouch = new Map<string, number>();
  const lastRing = new Map<string, number>();
  const toppled = new Set<string>();
  const inBucket = new Map<string, number>();
  const fired = new Set<string>();
  let fell = false;
  const queue = new RAPIER.EventQueue(true);

  const recordFrame = (k: number, t: number) => {
    let o = k * stride;
    frames[o++] = t;
    for (const rb of dynamicBodies) {
      const p = rb.translation(), r = quatOf(rb.rotation());
      frames[o++] = p.x; frames[o++] = p.y; frames[o++] = p.z;
      frames[o++] = r.x; frames[o++] = r.y; frames[o++] = r.z; frames[o++] = r.w;
    }
  };
  if (record) recordFrame(0, 0);

  for (let step = 1; step <= steps; step++) {
    const t = step / STEP_HZ;
    // Fans push whatever is in their air stream; cannons fire what enters their barrel.
    world.intersectionPairsWith(ballCollider, (other) => {
      const b = colliderBody.get(other.handle);
      if (!b) return;
      const part = parts.get(b.part)!;
      if (b.kind === 'fan') {
        const f = facing(part.yaw);
        const m = ball.mass();
        ball.addForce({ x: f[0] * KIT.fan.accel * m, y: 0.15 * KIT.fan.accel * m, z: f[2] * KIT.fan.accel * m }, true);
        touch(b.part, t);
      } else if (b.kind === 'cannon') {
        if (fired.has(b.part)) return;
        fired.add(b.part);
        const f = facing(part.yaw);
        const el = (KIT.cannon.elevation * Math.PI) / 180;
        const s = KIT.cannon.speed;
        ball.setLinvel({ x: f[0] * s * Math.cos(el), y: s * Math.sin(el), z: f[2] * s * Math.cos(el) }, true);
        ball.setAngvel({ x: 0, y: 0, z: 0 }, true);
        events.push({ type: 'fired', t, part: b.part });
        touch(b.part, t);
      } else if (b.kind === 'bucket') {
        const since = inBucket.get(b.part) ?? t;
        inBucket.set(b.part, since);
        const v = ball.linvel();
        // Settled: inside for a moment and no longer flying around.
        if (t - since >= 0.5 && Math.hypot(v.x, v.y, v.z) < 1.5 && !events.some((e) => e.type === 'bucket' && e.part === b.part)) {
          events.push({ type: 'bucket', t, part: b.part });
        }
      }
    });
    for (const id of [...inBucket.keys()]) {
      // Left the bucket again: it has to settle from scratch.
      const sensor = bodies.find((b) => b.id === id)!;
      const col = rigid.get(sensor.id)!.collider(0);
      if (!world.intersectionPair(ballCollider, col)) inBucket.delete(id);
    }

    world.step(queue);
    ball.resetForces(true);

    queue.drainCollisionEvents((h1, h2, startedContact) => {
      if (!startedContact) return;
      const b1 = colliderBody.get(h1), b2 = colliderBody.get(h2);
      const bell = b1?.kind === 'bell' ? b1 : b2?.kind === 'bell' ? b2 : null;
      const striker = bell === b1 ? b2 : b1;
      if (bell && striker?.dynamic && t - (lastRing.get(bell.part) ?? -1) > 0.35) {
        lastRing.set(bell.part, t);
        events.push({ type: 'bell', t, part: bell.part });
      }
      const other = h1 === ballCollider.handle ? h2 : h2 === ballCollider.handle ? h1 : null;
      if (other === null) return;
      const b = colliderBody.get(other);
      if (!b) return;
      touch(b.part, t);
      if (b.kind === 'trampoline') {
        const v = ball.linvel();
        ball.setLinvel({ x: v.x, y: KIT.trampoline.jumpSpeed, z: v.z }, true);
        events.push({ type: 'bounce', t, part: b.part });
      }
    });

    // Dominoes: a row has toppled when every piece leans past 45 degrees.
    for (const p of spec.parts) {
      if (p.kind !== 'dominoes' || toppled.has(p.id)) continue;
      const n = p.length ?? 5;
      let down = 0;
      for (let i = 0; i < n; i++) {
        const r = rigid.get(`${p.id}.${i}`)!.rotation();
        // Local +y of the domino in world space: y component is cos(tilt).
        const upY = 1 - 2 * (r.x * r.x + r.z * r.z);
        if (upY < 0.7071) down++;
      }
      if (down === n) {
        toppled.add(p.id);
        events.push({ type: 'topple', t, part: p.id });
      }
    }

    const bp = ball.translation();
    for (const { id, c } of centres) {
      const d = Math.hypot(bp.x - c[0], bp.y - c[1], bp.z - c[2]);
      const best = closest[id];
      if (!best || d < best.d) closest[id] = { d, t };
    }
    if (!fell && (bp.y < -0.5 || bp.x < -1 || bp.z < -1 || bp.x > GRID_HALF_X * 2 + 1 || bp.z > GRID_HALF_Z * 2 + 1)) {
      fell = true;
      events.push({ type: 'fell', t });
    }
    if (record && step % frameEvery === 0) recordFrame(step / frameEvery, t);
  }

  const end = ball.translation();
  const run: MachineRun = {
    spec, bodies, dynamicIds, frames, frameCount, frameStride: stride, events, closest,
    ballEnd: [end.x, end.y, end.z], stats: { steps, ms: Date.now() - started },
  };
  queue.free();
  world.free();
  return run;

  function touch(part: string, t: number) {
    if (part === ballPart.id) return;
    if (t - (lastTouch.get(part) ?? -1) < 0.25 && lastTouch.has(part)) {
      lastTouch.set(part, t);
      return;
    }
    lastTouch.set(part, t);
    events.push({ type: 'touch', t, part });
  }
}

/** Rotate a vector by the inverse of a unit quaternion (world -> body local). */
function rotateInv(q: { x: number; y: number; z: number; w: number }, v: Vec3): Vec3 {
  // v' = v + 2w (u x v) + 2 u x (u x v), with u = -q.xyz (the conjugate).
  const ux = -q.x, uy = -q.y, uz = -q.z, w = q.w;
  const cx = uy * v[2] - uz * v[1], cy = uz * v[0] - ux * v[2], cz = ux * v[1] - uy * v[0];
  const dx = uy * cz - uz * cy, dy = uz * cx - ux * cz, dz = ux * cy - uy * cx;
  return [v[0] + 2 * (w * cx + dx), v[1] + 2 * (w * cy + dy), v[2] + 2 * (w * cz + dz)];
}

const GRID_HALF_X = (24 * CELL) / 2;
const GRID_HALF_Z = (24 * CELL) / 2;

/** Position and rotation of a dynamic body at a frame (interpolation is the renderer's business). */
export function bodyAt(run: MachineRun, bodyIndex: number, frame: number): { position: Vec3; rotation: [number, number, number, number] } {
  const o = frame * run.frameStride + 1 + bodyIndex * 7;
  const f = run.frames;
  return { position: [f[o], f[o + 1], f[o + 2]], rotation: [f[o + 3], f[o + 4], f[o + 5], f[o + 6]] };
}

/** A cheap fingerprint of a trace, to compare runs across machines. */
export function traceHash(run: MachineRun): string {
  let h = 2166136261;
  const f = run.frames;
  for (let i = 0; i < f.length; i++) {
    // Round to 1e-4 so the hash ignores float printing noise, not physics differences.
    const v = Math.round(f[i] * 1e4) | 0;
    h ^= v;
    h = Math.imul(h, 16777619);
  }
  for (const e of run.events) {
    h ^= Math.round(e.t * 1000) ^ e.type.length;
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export type { Part };
