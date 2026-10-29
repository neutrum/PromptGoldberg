import { Grid, Html, OrbitControls } from '@react-three/drei';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { assemble, assemblePart, CELL, dropAt, facing, footprint, FRAME_HZ, GRID, groundAt, groundRuns, KIT, lockedParts, lowestGround, partCentre, partNames, partOrigin, restingHeight, TARGET_KINDS, WATER_WORDS, yawQuat, type Body, type MachineRun, type Part, type Terrain } from '@og/machine';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { sfx } from '../game/audio';
import { useMachine } from './machineStore';
import { shapeSize, useModel } from './ModelVisual';
import { kitUrl, kitVisual } from './kitVisuals';

/** Right-angled wedge: tall at -x, flat at +x, base on y = 0 (matches the physics collider). */
function wedgeGeometry(l: number, h: number, w: number): THREE.BufferGeometry {
  const a = [-l / 2, 0, -w / 2], b = [-l / 2, 0, w / 2], c = [l / 2, 0, w / 2], d = [l / 2, 0, -w / 2];
  const e = [-l / 2, h, -w / 2], f = [-l / 2, h, w / 2];
  const tri = (...p: number[][]) => p.flat();
  const verts = [
    ...tri(a, c, b), ...tri(a, d, c), // bottom
    ...tri(e, f, c), ...tri(e, c, d), // slope
    ...tri(a, b, f), ...tri(a, f, e), // back
    ...tri(b, c, f), // right side
    ...tri(a, e, d), // left side
  ];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  g.computeVertexNormals();
  return g;
}

function BodyMesh({ body, meshRef, ghost, onClick, onGrab, onHover, glow, cursor = 'grab', assetId, tint }: {
  body: Body; meshRef?: (m: THREE.Object3D | null) => void; ghost?: string; onClick?: () => void; onHover?: (over: boolean) => void; glow?: boolean; cursor?: string;
  /** Pressed on: start dragging it. */
  onGrab?: () => void;
  assetId?: string;
  tint?: string;
}) {
  const visual = kitVisual(body);
  const { object: custom, ready } = useModel(!ghost && !body.sensor
    ? assetId ? `/api/looks/${encodeURIComponent(assetId)}/model.glb` : visual ? kitUrl(visual.asset) : undefined : undefined,
    assetId ? shapeSize(body.shape) : visual?.size ?? shapeSize(body.shape), assetId ? undefined : visual?.rotation, tint, !assetId && visual?.hidden);
  const modelVisible = !!custom || (!assetId && !!visual?.hidden && ready);
  const geometry = useMemo(() => {
    const s = body.shape;
    switch (s.kind) {
      case 'box': return new THREE.BoxGeometry(...s.size);
      case 'sphere': return new THREE.SphereGeometry(s.radius, 24, 16);
      case 'cylinder': return new THREE.CylinderGeometry(s.radius, s.radius * 1.15, s.height, 24);
      case 'wedge': return wedgeGeometry(s.length, s.height, s.width);
    }
  }, [body.shape]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const sensor = !!body.sensor;
  const air = body.kind === 'fan' && sensor;
  // The cannon's barrel is drawn by Decor, tilted the way it fires; its sensor stays as an invisible handle to click and drag.
  const barrel = body.kind === 'cannon' && sensor && body.id.endsWith('.barrel');
  if (sensor && !air && !barrel) return null;
  if (ghost) {
    return (
      <mesh geometry={geometry} position={body.position} quaternion={body.rotation}>
        <meshStandardMaterial color={ghost} transparent opacity={air ? 0.05 : 0.35} depthWrite={false} emissive={ghost} emissiveIntensity={0.4} />
      </mesh>
    );
  }
  return (
    <mesh
      ref={meshRef}
      geometry={geometry}
      position={body.position}
      quaternion={body.rotation}
      castShadow={!sensor && !modelVisible}
      receiveShadow
      onClick={onClick ? (e) => { e.stopPropagation(); if (!onGrab || e.shiftKey) onClick(); } : undefined}
      onPointerDown={onGrab ? (e) => { if (e.button !== 0 || e.shiftKey) return; e.stopPropagation(); onGrab(); } : undefined}
      onPointerOver={onClick || onGrab ? (e) => { e.stopPropagation(); document.body.style.cursor = cursor; onHover?.(true); } : undefined}
      onPointerOut={onClick || onGrab ? () => { document.body.style.cursor = ''; onHover?.(false); } : undefined}
    >
      {modelVisible
        ? <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        : air
        ? <meshBasicMaterial color="#7de0a7" transparent opacity={0.1} depthWrite={false} />
        : barrel
          ? <meshBasicMaterial transparent opacity={0} depthWrite={false} />
          : <meshStandardMaterial color={body.color} roughness={body.kind === 'ball' ? 0.35 : 0.75} metalness={body.kind === 'bell' ? 0.6 : 0.05} emissive={glow ? '#ffd27a' : body.color} emissiveIntensity={glow ? 0.5 : body.kind === 'ball' ? 0.15 : 0.03} />}
      {custom && <group position={assetId ? undefined : visual?.offset}><primitive object={custom} dispose={null} /></group>}
      {body.kind === 'ball' && !custom && <group>
        {[-1, 1].map((side) => <group key={side} position={[side * 0.045, 0.04, 0.147]}><mesh><sphereGeometry args={[0.034, 12, 8]} /><meshStandardMaterial color="#fff7e4" /></mesh><mesh position={[0, 0, 0.026]}><sphereGeometry args={[0.015, 10, 8]} /><meshStandardMaterial color="#24323e" /></mesh></group>)}
        <mesh position={[0, -0.025, 0.158]} rotation={[0, 0, Math.PI]}><torusGeometry args={[0.035, 0.006, 6, 16, Math.PI]} /><meshStandardMaterial color="#602b35" /></mesh>
      </group>}
    </mesh>
  );
}

// ---- Juice: bursts on goal steps, confetti on a finished chain.

interface Particle { pos: THREE.Vector3; vel: THREE.Vector3; spin: number; born: number; color: THREE.Color }
const particles: Particle[] = [];
const PALETTE = ['#ffd166', '#ff5a4e', '#7de0a7', '#58c4ff', '#ff8fd1', '#ffffff'];

/** A puff of confetti at a point; `count` sets how big a deal it is. */
export function confettiAt(pos: THREE.Vector3, count = 30, up = 3) {
  const now = performance.now();
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2, r = 0.6 + Math.random() * 1.6;
    particles.push({
      pos: pos.clone(), born: now, spin: (Math.random() - 0.5) * 12,
      vel: new THREE.Vector3(Math.cos(a) * r, up + Math.random() * up, Math.sin(a) * r),
      color: new THREE.Color(PALETTE[i % PALETTE.length]),
    });
  }
  if (particles.length > 400) particles.splice(0, particles.length - 400);
}

const PARTICLE_MS = 2600;

function Confetti() {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  useFrame((_, delta) => {
    const m = mesh.current;
    if (!m) return;
    const now = performance.now();
    for (let i = particles.length - 1; i >= 0; i--) if (now - particles[i].born > PARTICLE_MS) particles.splice(i, 1);
    const dt = Math.min(delta, 0.05);
    particles.forEach((p, i) => {
      p.vel.y -= 9 * dt;
      p.vel.multiplyScalar(1 - 1.2 * dt);
      p.pos.addScaledVector(p.vel, dt);
      if (p.pos.y < 0.02) { p.pos.y = 0.02; p.vel.set(0, 0, 0); }
      const age = (now - p.born) / PARTICLE_MS;
      dummy.position.copy(p.pos);
      dummy.rotation.set(p.spin * age * 2, p.spin * age, 0);
      dummy.scale.setScalar(age > 0.8 ? (1 - age) * 5 : 1);
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
      m.setColorAt(i, p.color);
    });
    m.count = particles.length;
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  });
  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, 400]} frustumCulled={false}>
      <boxGeometry args={[0.06, 0.012, 0.09]} />
      <meshBasicMaterial toneMapped={false} />
    </instancedMesh>
  );
}

// ---- Decor: what makes a part read as itself (fan blades, a bell's dome, a cannon's barrel). Drawn only, never simulated.

const spinning = new Set<THREE.Object3D>();

function FanBlades({ part }: { part: Part }) {
  const { object } = useModel(kitUrl('fan-propeller'), [0.035, 0.34, 0.34]);
  const ref = useRef<THREE.Group>(null);
  useEffect(() => {
    const g = ref.current;
    if (!g) return;
    spinning.add(g);
    return () => { spinning.delete(g); };
  }, []);
  const o = partOrigin(part);
  const f = facing(part.yaw);
  const front = KIT.fan.body[0] / 2 + 0.012;
  return (
    <group position={[o[0] + f[0] * front, o[1] + KIT.fan.body[1] / 2, o[2] + f[2] * front]} quaternion={yawQuat(part.yaw)}>
      <group ref={ref}>
        {object ? <primitive object={object} dispose={null} /> : <>{[0, 1, 2].map((k) => (
          <mesh key={k} rotation={[(k * 2 * Math.PI) / 3, 0, 0]} position={[0, 0, 0]}>
            <boxGeometry args={[0.012, 0.3, 0.07]} />
            <meshStandardMaterial color="#e8fff1" roughness={0.4} />
          </mesh>
        ))}
        <mesh rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.035, 0.035, 0.03, 12]} />
          <meshStandardMaterial color="#2b3140" />
        </mesh></>}
      </group>
    </group>
  );
}

function BellDome({ part }: { part: Part }) {
  const { ready } = useModel(kitUrl('bell'), [1, 1, 1], undefined, undefined, true);
  if (ready) return null;
  const o = partOrigin(part);
  const { radius, height } = KIT.bell;
  return (
    <group position={[o[0], o[1] + height, o[2]]}>
      <mesh castShadow>
        <sphereGeometry args={[radius * 1.02, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial color="#ffcc33" metalness={0.7} roughness={0.25} />
      </mesh>
      <mesh position={[0, radius + 0.02, 0]}>
        <sphereGeometry args={[0.03, 12, 8]} />
        <meshStandardMaterial color="#c99a1a" metalness={0.6} roughness={0.3} />
      </mesh>
    </group>
  );
}

function CannonBarrel({ part }: { part: Part }) {
  const { ready } = useModel(kitUrl('cannon'), [1, 1, 1], undefined, undefined, true);
  if (ready) return null;
  const o = partOrigin(part);
  const tilt = (KIT.cannon.elevation * Math.PI) / 180;
  const r = KIT.cannon.body[1] / 2;
  return (
    <group position={[o[0], o[1] + 0.16, o[2]]} quaternion={yawQuat(part.yaw)}>
      {/* Local +x is the facing; tilt up about local z. */}
      <mesh rotation={[0, 0, -Math.PI / 2 + tilt]} position={[0.06, 0.04, 0]} castShadow>
        <cylinderGeometry args={[r * 0.8, r, 0.42, 20]} />
        <meshStandardMaterial color="#3a4256" metalness={0.5} roughness={0.45} />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={s} rotation={[Math.PI / 2, 0, 0]} position={[-0.04, -0.06, s * 0.15]} castShadow>
          <cylinderGeometry args={[0.09, 0.09, 0.035, 18]} />
          <meshStandardMaterial color="#8a5a2b" roughness={0.8} />
        </mesh>
      ))}
    </group>
  );
}

function Decor({ parts }: { parts: Part[] }) {
  useFrame((_, delta) => { if (useMachine.getState().phase === 'playing') for (const g of spinning) g.rotation.x += Math.min(delta, 0.05) * 14; });
  return (
    <>
      {parts.map((p) => p.kind === 'fan' ? <FanBlades key={`decor-${p.id}`} part={p} />
        : p.kind === 'bell' ? <BellDome key={`decor-${p.id}`} part={p} />
        : p.kind === 'cannon' ? <CannonBarrel key={`decor-${p.id}`} part={p} />
        : null)}
    </>
  );
}

// ---- Flashes: a ring that grows and fades where a part fires, bounces, rings or catches.

interface Flash { pos: THREE.Vector3; color: THREE.Color; born: number }
const flashes: Flash[] = [];
const FLASH_MS = 550;
const FLASH_COLOR: Partial<Record<string, string>> = { fired: '#ffb15a', bounce: '#ff8fd1', bell: '#ffe066', bucket: '#7de0a7', topple: '#ffd166' };

export function flashAt(pos: THREE.Vector3, color: string) {
  flashes.push({ pos: pos.clone(), color: new THREE.Color(color), born: performance.now() });
  if (flashes.length > 24) flashes.shift();
}

/** What each recorded event sounds like. */
function partSound(type: string, kind?: string) {
  switch (type) {
    case 'fired': sfx.cannon(); break;
    case 'bounce': sfx.boing(); break;
    case 'bell': sfx.ding(); break;
    case 'bucket': sfx.plop(); break;
    case 'topple': sfx.clack(); break;
    case 'touch': if (kind === 'fan') sfx.whoosh(); else if (kind === 'dominoes') sfx.clack(); break;
  }
}

function Flashes() {
  const group = useRef<THREE.Group>(null);
  const rings = useMemo(() => Array.from({ length: 24 }, () => new THREE.Mesh(new THREE.RingGeometry(0.8, 1, 32), new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }))), []);
  useEffect(() => () => rings.forEach((r) => { r.geometry.dispose(); (r.material as THREE.Material).dispose(); }), [rings]);
  useFrame(({ camera }) => {
    const now = performance.now();
    for (let i = flashes.length - 1; i >= 0; i--) if (now - flashes[i].born > FLASH_MS) flashes.splice(i, 1);
    rings.forEach((r, i) => {
      const f = flashes[i];
      r.visible = !!f;
      if (!f) return;
      const age = (now - f.born) / FLASH_MS;
      r.position.copy(f.pos);
      r.quaternion.copy(camera.quaternion);
      r.scale.setScalar(0.1 + age * 0.5);
      const m = r.material as THREE.MeshBasicMaterial;
      m.color.copy(f.color);
      m.opacity = 0.9 * (1 - age);
    });
  });
  return <group ref={group}>{rings.map((r, i) => <primitive key={i} object={r} />)}</group>;
}

const tmpQ = new THREE.Quaternion();
const tmpQ2 = new THREE.Quaternion();
const ballPos = new THREE.Vector3(NaN, 0, 0);

/** Moves the dynamic bodies along the recorded trace and drives the playback clock. */
function Playback({ run, dynamic }: { run: MachineRun; dynamic: Map<string, THREE.Object3D> }) {
  const ballIdx = run.dynamicIds.indexOf(run.spec.parts.find((p) => p.kind === 'ball')!.id);
  const keys = useMemo(() => (useMachine.getState().result?.steps ?? []).flatMap((s) => (s.satisfied && s.t !== undefined ? [s.t] : [])), [run]);
  const finished = useRef(false);
  // Every event the physics recorded gets its sound and a flash as playback passes it.
  const heard = useRef({ next: 0, t: 0 });
  useFrame((_, delta) => {
    const s = useMachine.getState();
    let t = s.time;
    if (t === 0) finished.current = false;
    if (t < heard.current.t) heard.current.next = 0;
    heard.current.t = t;
    if (s.phase === 'playing') {
      while (heard.current.next < run.events.length && run.events[heard.current.next].t <= t) {
        const e = run.events[heard.current.next++];
        const part = 'part' in e ? run.spec.parts.find((p) => p.id === e.part) : undefined;
        if (e.type === 'touch' && part && part.kind !== 'fan' && part.kind !== 'dominoes') continue;
        partSound(e.type, part?.kind);
        if (part && e.type !== 'touch') flashAt(new THREE.Vector3(...partCentre(part)), FLASH_COLOR[e.type] ?? '#ffffff');
      }
      // Slow motion around each goal event, so the payoff is readable.
      let slow = 1;
      for (const k of keys) slow = Math.min(slow, 1 - 0.75 * Math.exp(-(((t - k) / 0.22) ** 2)));
      t = Math.min(s.endTime, t + Math.min(delta, 0.05) * slow);
      s.result?.steps.forEach((step, i) => {
        if (step.satisfied && step.t !== undefined && t >= step.t && i >= s.celebrated) {
          s.celebrate(i);
          sfx.checkpoint(i);
          const part = run.spec.parts.find((p) => p.id === run.spec.goal[i]?.part);
          const at = part ? new THREE.Vector3(...partCentre(part)) : ballPos.clone();
          const last = i === run.spec.goal.length - 1 && s.result?.success;
          confettiAt(at, last ? 120 : 18, last ? 4 : 2.2);
        }
      });
      s.setTime(t);
      if (t >= s.endTime && !finished.current) {
        finished.current = true;
        s.finish();
      }
    }
    const f = Math.min(run.frameCount - 1, t * FRAME_HZ);
    const f0 = Math.floor(f), f1 = Math.min(run.frameCount - 1, f0 + 1), k = f - f0;
    run.dynamicIds.forEach((id, i) => {
      const obj = dynamic.get(id);
      if (!obj) return;
      const o0 = f0 * run.frameStride + 1 + i * 7, o1 = f1 * run.frameStride + 1 + i * 7;
      const fr = run.frames;
      obj.position.set(fr[o0] + (fr[o1] - fr[o0]) * k, fr[o0 + 1] + (fr[o1 + 1] - fr[o0 + 1]) * k, fr[o0 + 2] + (fr[o1 + 2] - fr[o0 + 2]) * k);
      tmpQ.set(fr[o0 + 3], fr[o0 + 4], fr[o0 + 5], fr[o0 + 6]);
      tmpQ2.set(fr[o1 + 3], fr[o1 + 4], fr[o1 + 5], fr[o1 + 6]);
      obj.quaternion.copy(tmpQ.slerp(tmpQ2, k));
      if (i === ballIdx) ballPos.copy(obj.position);
    });
  });
  return null;
}

/** Fit the whole route at any aspect ratio; leave subsequent orbiting to the player. */
function MachineCamera({ parts, resetView }: { parts: Part[]; resetView: number }) {
  const camera = useThree((s) => s.camera);
  const viewport = useThree((s) => s.size);
  const controls = useRef<OrbitControlsImpl>(null);
  const bounds = useMemo(() => {
    const box = new THREE.Box3();
    if (!parts.length) box.setFromCenterAndSize(new THREE.Vector3((GRID.x * CELL) / 2, 0.5, (GRID.z * CELL) / 2), new THREE.Vector3(6, 2, 6));
    for (const p of parts) box.expandByPoint(new THREE.Vector3((p.x + 0.5) * CELL, p.y * CELL + 0.3, (p.z + 0.5) * CELL));
    // Frame the playable route, not the full-width river or empty stage around it.
    for (const p of parts) for (const c of footprint(p)) box.expandByPoint(new THREE.Vector3((c.x + 0.5) * CELL, p.y * CELL, (c.z + 0.5) * CELL));
    box.expandByScalar(CELL * 1.5);
    const centre = box.getCenter(new THREE.Vector3());
    return { centre, box };
  }, [parts]);
  const framedFor = useRef<string>('');
  useEffect(() => {
    // Frame each machine once; later changes to the same machine keep the player's view.
    const key = parts.map((p) => `${p.id}:${p.x},${p.y},${p.z},${p.yaw},${p.length}`).join(',') + `|${viewport.width},${viewport.height}|${resetView}`;
    if (framedFor.current === key || !controls.current) return;
    framedFor.current = key;
    controls.current.target.copy(bounds.centre);
    const aspect = viewport.width / Math.max(1, viewport.height);
    const direction = new THREE.Vector3(0.6, 0.95, 0.85).normalize();
    const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), direction).normalize();
    const up = new THREE.Vector3().crossVectors(direction, right);
    const tanY = Math.tan(THREE.MathUtils.degToRad((camera as THREE.PerspectiveCamera).fov / 2));
    let distance = 3;
    // Fit each bounding-box corner in camera space, with room for labels and the airborne marble.
    for (const x of [bounds.box.min.x, bounds.box.max.x]) for (const y of [bounds.box.min.y, bounds.box.max.y]) for (const z of [bounds.box.min.z, bounds.box.max.z]) {
      const offset = new THREE.Vector3(x, y, z).sub(bounds.centre);
      const depth = offset.dot(direction);
      distance = Math.max(distance, depth + Math.abs(offset.dot(right)) / (tanY * aspect * 0.85), depth + Math.abs(offset.dot(up)) / (tanY * 0.85));
    }
    camera.position.copy(bounds.centre).add(direction.multiplyScalar(distance));
    controls.current.update();
  }, [bounds, camera, parts, viewport, resetView]);
  const dragging = useMachine((s) => s.dragging);
  return <OrbitControls ref={controls} enabled={!dragging} makeDefault enableDamping dampingFactor={0.12} maxPolarAngle={Math.PI * 0.49} minDistance={2} maxDistance={40} />;
}

/** When the last drag ended, so its trailing click does not drop the next part too. */
let droppedAt = 0;

/**
 * Fix mode: hover the stage to see where the part in hand would land (the floor, or the platform
 * under the cursor), click to drop it there. A cell something else stands in shows red.
 */
function Placement({ part, parts, lift, terrain }: { part: Part; parts: Part[]; lift: number; terrain?: Terrain[] }) {
  const [cell, setCell] = useState<{ x: number; z: number } | null>(null);
  const shelf = part.kind === 'platform';
  const w = GRID.x * CELL, d = GRID.z * CELL;
  const toCell = (e: ThreeEvent<PointerEvent | MouseEvent>) => {
    const x = Math.floor(e.point.x / CELL), z = Math.floor(e.point.z / CELL);
    if (x < 0 || z < 0 || x >= GRID.x || z >= GRID.z) return null;
    return { x, z };
  };
  const landing = useMemo(() => (cell ? dropAt(parts, part, cell.x, cell.z, { y: lift, terrain }) : null), [parts, part, cell, lift, terrain]);
  const y = cell ? (landing?.y ?? restingHeight(parts, cell.x, cell.z, part.id, terrain)) : 0;
  const base = lowestGround(terrain);
  const ground = useMemo(() => groundRuns(terrain, base), [terrain, base]);
  const ghost = useMemo(() => (landing ? assemblePart(landing).bodies : []), [landing]);
  const cells = useMemo(() => (cell ? footprint({ ...part, x: cell.x, y, z: cell.z }) : []), [part, cell, y]);
  const platforms = useMemo(() => parts.filter((p) => p.kind === 'platform' && p.id !== part.id), [parts, part.id]);
  const drop = (c: { x: number; z: number } | null) => {
    if (!c) return;
    const s = useMachine.getState();
    if (s.pendingPart ? s.placePending(c.x, c.z) : s.placeAt(c.x, c.z)) sfx.place();
    else sfx.miss();
  };
  const handlers = {
    onPointerMove: (e: ThreeEvent<PointerEvent>) => { e.stopPropagation(); setCell(toCell(e)); },
    onPointerOut: () => setCell(null),
    // A dragged part drops where the pointer is let go; the click that follows is the same gesture.
    onPointerUp: (e: ThreeEvent<PointerEvent>) => {
      if (!useMachine.getState().dragging) return;
      e.stopPropagation();
      useMachine.setState({ dragging: false });
      droppedAt = performance.now();
      // A tap picks the part up; a drag has a preview cell and drops on release.
      if (cell) drop(toCell(e));
    },
    onClick: (e: ThreeEvent<MouseEvent>) => {
      e.stopPropagation();
      if (performance.now() - droppedAt < 300) return;
      drop(toCell(e));
    },
  };
  const color = landing ? '#ffd27a' : '#ff5a4e';
  return (
    <>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[w / 2, base * CELL + 0.005, d / 2]} {...handlers}>
        <planeGeometry args={[w, d]} />
        <meshBasicMaterial color="#ffd27a" transparent opacity={0.03} depthWrite={false} />
      </mesh>
      {ground.map((g) => (
        <mesh key={`g${g.x0},${g.z0},${g.w},${g.d}`} rotation={[-Math.PI / 2, 0, 0]} position={[(g.x0 + g.w / 2) * CELL, g.h * CELL + 0.005, (g.z0 + g.d / 2) * CELL]} {...handlers}>
          <planeGeometry args={[g.w * CELL, g.d * CELL]} />
          <meshBasicMaterial color="#ffd27a" transparent opacity={0.03} depthWrite={false} />
        </mesh>
      ))}
      {platforms.map((p) => {
        const cs = footprint(p);
        const xs = cs.map((c) => c.x), zs = cs.map((c) => c.z);
        const x0 = Math.min(...xs), x1 = Math.max(...xs) + 1, z0 = Math.min(...zs), z1 = Math.max(...zs) + 1;
        return (
          <mesh key={p.id} rotation={[-Math.PI / 2, 0, 0]} position={[((x0 + x1) / 2) * CELL, p.y * CELL + 0.006, ((z0 + z1) / 2) * CELL]} {...handlers}>
            <planeGeometry args={[(x1 - x0) * CELL, (z1 - z0) * CELL]} />
            <meshBasicMaterial color="#ffd27a" transparent opacity={0.12} depthWrite={false} />
          </mesh>
        );
      })}
      {cells.map((c) => (
        <mesh key={`${c.x},${c.z}`} rotation={[-Math.PI / 2, 0, 0]} position={[(c.x + 0.5) * CELL, y * CELL + 0.02, (c.z + 0.5) * CELL]}>
          <planeGeometry args={[CELL, CELL]} />
          <meshBasicMaterial color={color} transparent opacity={0.45} depthWrite={false} />
        </mesh>
      ))}
      {cell && shelf && y > 0 && (
        <mesh position={[(cell.x + 0.5) * CELL, (y * CELL) / 2, (cell.z + 0.5) * CELL]}>
          <cylinderGeometry args={[0.012, 0.012, y * CELL, 6]} />
          <meshBasicMaterial color={color} transparent opacity={0.7} />
        </mesh>
      )}
      {ghost.map((b) => <BodyMesh key={`ghost-${b.id}`} body={b} ghost={color} />)}
    </>
  );
}

/** The name a clicked part puts in the prompt, floating over it while the pointer is there. */
function NameTag({ part, name, locked }: { part: Part; name: string; locked: boolean }) {
  const [x, y, z] = partCentre(part);
  return (
    <Html position={[x, y + 0.45, z]} center zIndexRange={[10, 0]} style={{ pointerEvents: 'none' }}>
      <div className={`name-tag ${locked ? 'locked' : ''}`}>{locked ? '🔒 ' : ''}{name}{locked ? <span> · stays put</span> : <span> · drag to move · Shift-click to name</span>}</div>
    </Html>
  );
}

/**
 * The stage floor, shaped by the level's terrain: a slab at the lowest level with the higher
 * ground stacked on it as blocks, exactly as the physics builds it. Sunken blocks with a watery
 * name get a water surface.
 */
function Ground({ terrain }: { terrain?: Terrain[] }) {
  const w = GRID.x * CELL, d = GRID.z * CELL;
  const base = lowestGround(terrain);
  const runs = useMemo(() => groundRuns(terrain, base), [terrain, base]);
  const water = (terrain ?? []).filter((t) => t.h < 0 && t.name && WATER_WORDS.test(t.name));
  // A wooden workbench on a stone plinth: raised ground is stone, dug ground is darker earth.
  const tone = (h: number) => (h > 0 ? '#a39684' : h === 0 ? '#b88b58' : '#6e5a45');
  const plinthTop = base * CELL - 0.02;
  return (
    <>
      <mesh position={[w / 2, plinthTop - 0.3, d / 2]} receiveShadow>
        <boxGeometry args={[w + 3, 0.6, d + 3]} />
        <meshStandardMaterial color="#6d7177" roughness={1} />
      </mesh>
      <Scenery y={plinthTop} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[w / 2, base * CELL - 0.001, d / 2]} receiveShadow>
        <planeGeometry args={[w, d]} />
        <meshStandardMaterial color={tone(base)} roughness={0.9} />
      </mesh>
      <Grid position={[w / 2, base * CELL + 0.002, d / 2]} args={[w, d]} cellSize={CELL} cellColor="#a57a4b" sectionSize={CELL * 4} sectionColor="#8e6639" fadeDistance={30} infiniteGrid={false} />
      {base < 0 && <Grid position={[w / 2, 0.008, d / 2]} args={[w, d]} cellSize={CELL} cellColor="#a57a4b" sectionSize={CELL * 4} sectionColor="#8e6639" fadeDistance={22} infiniteGrid={false} />}
      {runs.map((g) => {
        const top = g.h * CELL, bottom = base * CELL - 0.02;
        return (
          <mesh key={`${g.x0},${g.z0},${g.w},${g.d}`} position={[(g.x0 + g.w / 2) * CELL, (top + bottom) / 2, (g.z0 + g.d / 2) * CELL]} castShadow receiveShadow>
            <boxGeometry args={[g.w * CELL, top - bottom, g.d * CELL]} />
            <meshStandardMaterial color={tone(g.h)} roughness={0.95} />
          </mesh>
        );
      })}
      {water.map((t, i) => (
        <mesh key={`water-${i}`} rotation={[-Math.PI / 2, 0, 0]} position={[(t.x + t.w / 2) * CELL, -0.05, (t.z + t.d / 2) * CELL]}>
          <planeGeometry args={[t.w * CELL, t.d * CELL]} />
          <meshStandardMaterial color="#2a78b8" transparent opacity={0.7} roughness={0.25} depthWrite={false} />
        </mesh>
      ))}
    </>
  );
}

/**
 * Wooden posts under raised parts, down to the ground or shelf beneath. Visual only: no collider, and
 * thin enough that a marble passing under a shelf rarely clips one.
 */
function Supports({ parts, terrain }: { parts: Part[]; terrain?: Terrain[] }) {
  const posts = useMemo(() => {
    const out: { x: number; z: number; bottom: number; top: number }[] = [];
    for (const p of parts) {
      if (p.kind === 'ball') continue;
      for (const c of footprint(p)) {
        let below = groundAt(terrain, c.x, c.z);
        for (const q of parts) if (q.kind === 'platform' && q.id !== p.id && q.y < p.y && q.y > below && footprint(q).some((f) => f.x === c.x && f.z === c.z)) below = q.y;
        if (p.y - below < 1) continue;
        // Shelves stand on a thin deck; everything else on its own base.
        out.push({ x: (c.x + 0.5) * CELL, z: (c.z + 0.5) * CELL, bottom: below * CELL, top: p.y * CELL - (p.kind === 'platform' ? KIT.platformThickness : 0) });
      }
    }
    return out;
  }, [parts, terrain]);
  return (
    <>
      {posts.map((s, i) => (
        <group key={i} position={[s.x, 0, s.z]}>
          <mesh position={[0, (s.bottom + s.top) / 2, 0]} castShadow receiveShadow>
            <boxGeometry args={[0.07, s.top - s.bottom, 0.07]} />
            <meshStandardMaterial color="#6b4a2b" roughness={0.85} />
          </mesh>
          <mesh position={[0, s.bottom + 0.03, 0]} receiveShadow>
            <boxGeometry args={[0.15, 0.06, 0.15]} />
            <meshStandardMaterial color="#7c7f85" roughness={1} />
          </mesh>
        </group>
      ))}
    </>
  );
}

// Fixed scenery around the board's back edges, outside every placeable cell and away from the camera side.
const TREES: [number, number, number][] = [[-0.55, 1.2, 1], [-0.7, 4.6, 0.8], [-0.5, 8.4, 1.15], [-0.65, 11.2, 0.9], [2.4, -0.6, 0.95], [6.1, -0.7, 1.1], [9.8, -0.55, 0.85]];
const ROCKS: [number, number, number][] = [[-0.45, 2.9, 0.22], [-0.5, 10, 0.16], [4.3, -0.45, 0.2], [12.45, 3.5, 0.14], [8, 12.45, 0.12], [11.6, -0.4, 0.18]];
function Scenery({ y }: { y: number }) {
  return (
    <>
      {TREES.map(([x, z, s], i) => (
        <group key={`tree-${i}`} position={[x, y, z]} scale={s}>
          <mesh position={[0, 0.2, 0]} castShadow><cylinderGeometry args={[0.05, 0.07, 0.4, 6]} /><meshStandardMaterial color="#5c3d24" roughness={0.9} /></mesh>
          <mesh position={[0, 0.6, 0]} castShadow><coneGeometry args={[0.36, 0.6, 7]} /><meshStandardMaterial color="#2f5a3c" roughness={0.9} flatShading /></mesh>
          <mesh position={[0, 0.95, 0]} castShadow><coneGeometry args={[0.26, 0.5, 7]} /><meshStandardMaterial color="#3a6c47" roughness={0.9} flatShading /></mesh>
        </group>
      ))}
      {ROCKS.map(([x, z, r], i) => (
        <mesh key={`rock-${i}`} position={[x, y + r * 0.5, z]} rotation={[i, i * 2, 0]} castShadow receiveShadow>
          <dodecahedronGeometry args={[r, 0]} /><meshStandardMaterial color="#8a8d90" roughness={1} flatShading />
        </mesh>
      ))}
    </>
  );
}

function Machine3D({ resetView }: { resetView: number }) {
  const machine = useMachine((s) => s.machine);
  const sketch = useMachine((s) => s.ai.sketch);
  const run = useMachine((s) => s.run);
  const fix = useMachine((s) => s.fix);
  const phase = useMachine((s) => s.phase);
  const busy = useMachine((s) => s.ai.busy);
  const builds = useMachine((s) => s.builds);
  const puzzle = useMachine((s) => s.puzzle);
  const veiled = useMachine((s) => s.veiled);
  const pending = useMachine((s) => s.pendingPart);
  const lastEdit = useMachine((s) => s.lastEdit);
  // Puzzle play never draws the solution: while the AI writes it, only the targets take shape; once it is
  // proven, nothing shows until the puzzle has the connecting parts out.
  const parts = useMemo(() => {
    if (fix) return [...fix.puzzle.spec.parts, ...fix.placed];
    if (veiled) return [];
    if (run?.spec.parts) return run.spec.parts;
    if (machine?.parts) return pending ? machine.parts.filter(p => p.id !== pending.id) : machine.parts;
    const drawn = sketch?.parts ?? [];
    return puzzle ? drawn.filter((p) => TARGET_KINDS.includes(p.kind)) : drawn;
  }, [fix, run, machine, sketch, puzzle, veiled, pending]);
  // The ground is scenery: it shows from the first streamed block on, veil or not.
  const terrain = fix ? fix.puzzle.spec.terrain : run?.spec.terrain ?? machine?.terrain ?? sketch?.terrain;
  // Build mode, or a solved puzzle: clicking a part names it in the prompt ("move " + click = "move dominoes #2").
  const spec = fix ? fix.puzzle.solution : machine;
  const naming = !!spec && !busy && !pending && (!fix || fix.solved);
  const names = useMemo(() => (naming && spec ? partNames(spec.parts) : null), [naming, spec]);
  const locked = useMemo(() => (naming && spec ? lockedParts(spec) : null), [naming, spec]);
  const [hover, setHover] = useState<string | null>(null);
  const hovered = hover && names?.has(hover) ? parts.find((p) => p.id === hover) : null;
  const bodies = useMemo(() => (run ? run.bodies : assemble(parts).bodies), [run, parts]);
  const dynamic = useMemo(() => new Map<string, THREE.Object3D>(), []);
  const picking = pending ?? (fix && fix.picking !== null && !fix.solved ? fix.hand[fix.picking] : null);
  const hints = useMemo(() => (fix?.hint && !fix.solved ? assemble(fix.puzzle.missing.filter((p) => !fix.placed.some((q) => q.id === p.id))).bodies : []), [fix]);
  const framed = fix ? [...fix.puzzle.spec.parts, ...fix.puzzle.missing] : pending && machine ? machine.parts : parts;
  // Let go off the stage: the drag ends and the part stays in hand, to drop with a click.
  useEffect(() => {
    const end = () => setTimeout(() => { if (useMachine.getState().dragging) useMachine.setState({ dragging: false }); }, 0);
    window.addEventListener('pointerup', end);
    return () => window.removeEventListener('pointerup', end);
  }, []);
  // Parts the player put down (or found moved) can be picked up again by clicking them.
  // The opening replay (the stage before any try) never blocks building; the player's own run is theirs to watch.
  const building = !!fix && !fix.solved && (phase !== 'playing' || fix.tries === 0);
  const liftable = building ? new Set(fix!.placed.map((p) => p.id))
    : !fix && !busy && !pending && !['playing', 'simulating'].includes(phase) && spec
      ? new Set(parts.filter(p => !p.fixed && !lockedParts(spec).has(p.id)).map(p => p.id)) : null;
  return (
    <>
      <MachineCamera parts={framed} resetView={resetView} />
      <Ground terrain={terrain} />
      <Supports parts={parts} terrain={terrain} />
      {run && <Playback key={run.stats.ms + run.frames.length} run={run} dynamic={dynamic} />}
      {bodies.map((b) => (
        <BodyMesh
          key={b.id}
          body={b}
          assetId={parts.find(p => p.id === b.part)?.look?.assetId}
          tint={parts.find(p => p.id === b.part)?.color}
          meshRef={b.dynamic ? (m) => { if (m) dynamic.set(b.id, m); else dynamic.delete(b.id); } : undefined}
          glow={!!liftable?.has(b.part) || hover === b.part || (!!lastEdit && phase !== 'playing' && !lastEdit.parts.some((p) => p.id === b.part))}
          cursor={liftable?.has(b.part) ? 'grab' : 'copy'}
          onHover={names?.has(b.part) ? (over) => setHover(over ? b.part : (h) => (h === b.part ? null : h)) : undefined}
          onGrab={liftable?.has(b.part) ? () => { const s = useMachine.getState(); if (fix) s.pickPlaced(b.part); else if (!s.movePart(b.part)) return; useMachine.setState({ dragging: true }); sfx.place(); } : undefined}
          onClick={names?.has(b.part) ? () => { useMachine.getState().insertPart(b.part); sfx.place(); } : undefined}
        />
      ))}
      {hovered && names && <NameTag part={hovered} name={names.get(hovered.id)!} locked={!!locked?.has(hovered.id)} />}
      {spec && phase !== 'playing' && parts.filter((p) => p.kind === 'ball' || spec.goal.some((g) => g.part === p.id && g.type !== 'touch')).map((p) => {
        const [x, y, z] = partCentre(p);
        return <Html key={`label-${p.id}`} position={[x, y + 0.65, z]} center zIndexRange={[5, 0]} style={{ pointerEvents: 'none' }}><span className={`scene-label ${p.kind === 'ball' ? 'start' : 'target'}`}>{p.kind === 'ball' ? 'Start · ' : 'Goal · '}{p.label ?? p.kind}</span></Html>;
      })}
      {hints.map((b) => <BodyMesh key={`hint-${b.id}`} body={b} ghost="#7dffb0" />)}
      {picking && (pending || building) && <Placement part={picking} parts={parts} lift={fix?.lift ?? (pending?.kind === 'platform' ? pending.y : 0)} terrain={terrain} />}
      <Decor parts={parts.filter(p => !p.look || p.kind === 'fan')} />
      <Confetti />
      <Flashes />
    </>
  );
}

/** Dev only: lets headless browser checks turn a world point into a screen point (drag tests). */
function DevHook() {
  const { camera, size, gl, scene } = useThree();
  useEffect(() => {
    (window as unknown as { __project: (p: [number, number, number]) => [number, number] }).__project = (p) => {
      const v = new THREE.Vector3(...p).project(camera);
      return [((v.x + 1) / 2) * size.width, ((1 - v.y) / 2) * size.height];
    };
    (window as unknown as { __sceneStats: () => unknown }).__sceneStats = () => {
      const models: string[] = [];
      scene.traverse(o => { if (o.name.startsWith('/models/') || o.name.startsWith('/api/looks/')) models.push(o.name); });
      return { frame: gl.info.render.frame, calls: gl.info.render.calls, triangles: gl.info.render.triangles, textures: gl.info.memory.textures, dpr: gl.getPixelRatio(), models };
    };
  }, [camera, size, gl, scene]);
  return null;
}

/** Demand rendering at rest; animation is capped at 30 fps even on high-refresh displays. */
function AnimationFrames() {
  const invalidate = useThree(s => s.invalidate);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useFrame(() => {
    if (!timer.current && !document.hidden && (useMachine.getState().phase === 'playing' || particles.length || flashes.length)) {
      timer.current = setTimeout(() => { timer.current = null; invalidate(); }, 1000 / 30);
    }
  });
  useEffect(() => {
    const visible = () => { if (!document.hidden) invalidate(); };
    document.addEventListener('visibilitychange', visible);
    return () => { if (timer.current) clearTimeout(timer.current); document.removeEventListener('visibilitychange', visible); };
  }, [invalidate]);
  return null;
}

export function MachineScene({ resetView = 0 }: { resetView?: number }) {
  return (
    <Canvas className="scene" frameloop="demand" dpr={[1, 1.25]} shadows camera={{ fov: 45, position: [8, 6, 12], near: 0.05, far: 200 }} gl={{ antialias: true, powerPreference: 'low-power' }}>
      <color attach="background" args={['#30495d']} />
      <fog attach="fog" args={['#30495d', 28, 60]} />
      <hemisphereLight args={['#fff4dd', '#718fa0', 2.2]} />
      <directionalLight position={[6, 12, 4]} intensity={2.5} castShadow shadow-mapSize={[1024, 1024]} shadow-camera-left={-12} shadow-camera-right={12} shadow-camera-top={12} shadow-camera-bottom={-12} shadow-bias={-0.0005} />
      <Machine3D resetView={resetView} />
      <AnimationFrames />
      {import.meta.env.DEV && <DevHook />}
    </Canvas>
  );
}

export const BALL_RADIUS = KIT.ballRadius;
