import { Grid, OrbitControls } from '@react-three/drei';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { assemble, assemblePart, CELL, FRAME_HZ, GRID, KIT, partCentre, type Body, type MachineRun, type Part } from '@og/machine';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { sfx } from '../game/audio';
import { useMachine } from './machineStore';

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

function BodyMesh({ body, meshRef, ghost }: { body: Body; meshRef?: (m: THREE.Object3D | null) => void; ghost?: string }) {
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
  const barrel = body.kind === 'cannon' && sensor;
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
      castShadow={!sensor}
      receiveShadow
    >
      {air
        ? <meshBasicMaterial color="#7de0a7" transparent opacity={0.1} depthWrite={false} />
        : barrel
          ? <meshStandardMaterial color="#2b3140" roughness={0.6} metalness={0.4} />
          : <meshStandardMaterial color={body.color} roughness={body.kind === 'ball' ? 0.35 : 0.75} metalness={body.kind === 'bell' ? 0.6 : 0.05} emissive={body.color} emissiveIntensity={body.kind === 'ball' ? 0.15 : 0.03} />}
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

const tmpQ = new THREE.Quaternion();
const tmpQ2 = new THREE.Quaternion();
const ballPos = new THREE.Vector3(NaN, 0, 0);

/** Moves the dynamic bodies along the recorded trace and drives the playback clock. */
function Playback({ run, dynamic }: { run: MachineRun; dynamic: Map<string, THREE.Object3D> }) {
  const ballIdx = run.dynamicIds.indexOf(run.spec.parts.find((p) => p.kind === 'ball')!.id);
  const keys = useMemo(() => (useMachine.getState().result?.steps ?? []).flatMap((s) => (s.satisfied && s.t !== undefined ? [s.t] : [])), [run]);
  const finished = useRef(false);
  useFrame((_, delta) => {
    const s = useMachine.getState();
    let t = s.time;
    if (s.phase === 'playing') {
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

/**
 * Orbit camera the player owns (drag to turn, wheel to zoom, right-drag to pan). A new machine
 * gets framed once; while the ball runs the view glides along with it, keeping the player's angle.
 */
function MachineCamera({ parts }: { parts: Part[] }) {
  const camera = useThree((s) => s.camera);
  const controls = useRef<OrbitControlsImpl>(null);
  const delta = useMemo(() => new THREE.Vector3(), []);
  const bounds = useMemo(() => {
    if (!parts.length) return { centre: new THREE.Vector3((GRID.x * CELL) / 2, 0.5, (GRID.z * CELL) / 2), size: 6 };
    const box = new THREE.Box3();
    for (const p of parts) box.expandByPoint(new THREE.Vector3((p.x + 0.5) * CELL, p.y * CELL + 0.3, (p.z + 0.5) * CELL));
    box.expandByScalar(CELL);
    const centre = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    return { centre, size: Math.max(size.x, size.z, size.y * 1.5, 3) };
  }, [parts]);
  const framedFor = useRef<string>('');
  useEffect(() => {
    // Frame each machine once; later changes to the same machine keep the player's view.
    const key = parts.map((p) => p.id).join(',') + '|' + bounds.size.toFixed(1);
    if (framedFor.current === key || !controls.current) return;
    framedFor.current = key;
    controls.current.target.copy(bounds.centre);
    camera.position.copy(bounds.centre).add(new THREE.Vector3(bounds.size * 0.55, bounds.size * 0.7, bounds.size * 0.95));
    controls.current.update();
  }, [bounds, camera, parts]);
  useFrame((_, dt) => {
    const c = controls.current;
    if (!c) return;
    const phase = useMachine.getState().phase;
    const following = phase === 'playing' && !Number.isNaN(ballPos.x);
    const want = following ? ballPos : bounds.centre;
    const k = 1 - Math.exp(-dt * (following ? 4 : 1.5));
    delta.copy(want).sub(c.target).multiplyScalar(k);
    c.target.add(delta);
    camera.position.add(delta);
    c.update();
  });
  return <OrbitControls ref={controls} makeDefault enableDamping dampingFactor={0.12} maxPolarAngle={Math.PI * 0.49} minDistance={2} maxDistance={40} />;
}

/** Fix mode: hover the stage to see where the missing part would go, click to put it there. */
function Placement({ part }: { part: Part }) {
  const [cell, setCell] = useState<{ x: number; z: number } | null>(null);
  const planeY = part.y * CELL;
  const w = GRID.x * CELL, d = GRID.z * CELL;
  const toCell = (e: ThreeEvent<PointerEvent | MouseEvent>) => {
    const x = Math.floor(e.point.x / CELL), z = Math.floor(e.point.z / CELL);
    if (x < 0 || z < 0 || x >= GRID.x || z >= GRID.z) return null;
    return { x, z };
  };
  const ghost = useMemo(() => (cell ? assemblePart({ ...part, x: cell.x, z: cell.z, dx: undefined, dz: undefined }).bodies : []), [part, cell]);
  const cx = cell ? (cell.x + 0.5) * CELL : 0, cz = cell ? (cell.z + 0.5) * CELL : 0;
  return (
    <>
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[w / 2, planeY + 0.005, d / 2]}
        onPointerMove={(e) => setCell(toCell(e))}
        onPointerOut={() => setCell(null)}
        onClick={(e) => { const c = toCell(e); if (c) { useMachine.getState().placeAt(c.x, c.z); sfx.place(); } }}
      >
        <planeGeometry args={[w, d]} />
        <meshBasicMaterial color="#ffd27a" transparent opacity={planeY > 0 ? 0.05 : 0.02} depthWrite={false} />
      </mesh>
      {planeY > 0 && <Grid position={[w / 2, planeY + 0.01, d / 2]} args={[w, d]} cellSize={CELL} cellColor="#8a7a4a" sectionSize={CELL * 4} sectionColor="#b09a5a" fadeDistance={30} />}
      {cell && (
        <>
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[cx, planeY + 0.02, cz]}>
            <planeGeometry args={[CELL, CELL]} />
            <meshBasicMaterial color="#ffd27a" transparent opacity={0.45} depthWrite={false} />
          </mesh>
          {planeY > 0 && (
            <mesh position={[cx, planeY / 2, cz]}>
              <cylinderGeometry args={[0.012, 0.012, planeY, 6]} />
              <meshBasicMaterial color="#ffd27a" transparent opacity={0.7} />
            </mesh>
          )}
        </>
      )}
      {ghost.map((b) => <BodyMesh key={`ghost-${b.id}`} body={b} ghost="#ffd27a" />)}
    </>
  );
}

function Machine3D() {
  const machine = useMachine((s) => s.machine);
  const sketch = useMachine((s) => s.ai.sketch);
  const run = useMachine((s) => s.run);
  const fix = useMachine((s) => s.fix);
  const phase = useMachine((s) => s.phase);
  const parts = fix ? [...fix.puzzle.spec.parts, ...fix.placed] : run?.spec.parts ?? machine?.parts ?? sketch?.parts ?? [];
  const bodies = useMemo(() => (run ? run.bodies : assemble(parts).bodies), [run, parts]);
  const dynamic = useMemo(() => new Map<string, THREE.Object3D>(), []);
  const picking = fix && fix.picking !== null && !fix.solved ? fix.puzzle.missing[fix.picking] : null;
  const hints = useMemo(() => (fix?.hint ? assemble(fix.puzzle.missing).bodies : []), [fix?.hint, fix?.puzzle]);
  const framed = fix ? [...fix.puzzle.spec.parts, ...fix.puzzle.missing] : parts;
  return (
    <>
      <MachineCamera parts={framed} />
      {run && <Playback key={run.stats.ms + run.frames.length} run={run} dynamic={dynamic} />}
      {bodies.map((b) => (
        <BodyMesh key={b.id} body={b} meshRef={b.dynamic ? (m) => { if (m) dynamic.set(b.id, m); else dynamic.delete(b.id); } : undefined} />
      ))}
      {hints.map((b) => <BodyMesh key={`hint-${b.id}`} body={b} ghost="#7dffb0" />)}
      {picking && phase !== 'playing' && <Placement part={picking} />}
      <Confetti />
    </>
  );
}

export function MachineScene() {
  const w = GRID.x * CELL, d = GRID.z * CELL;
  return (
    <Canvas className="scene" shadows camera={{ fov: 45, position: [8, 6, 12], near: 0.05, far: 200 }} gl={{ antialias: true }}>
      <color attach="background" args={['#0b0e1a']} />
      <fog attach="fog" args={['#0b0e1a', 18, 40]} />
      <hemisphereLight args={['#dfe8ff', '#1a1430', 0.7]} />
      <directionalLight position={[6, 12, 4]} intensity={1.6} castShadow shadow-mapSize={[2048, 2048]} shadow-camera-left={-10} shadow-camera-right={10} shadow-camera-top={10} shadow-camera-bottom={-10} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[w / 2, -0.001, d / 2]} receiveShadow>
        <planeGeometry args={[w, d]} />
        <meshStandardMaterial color="#141a2e" roughness={0.95} />
      </mesh>
      <Grid position={[w / 2, 0.002, d / 2]} args={[w, d]} cellSize={CELL} cellColor="#2a3354" sectionSize={CELL * 4} sectionColor="#3b4a7a" fadeDistance={30} infiniteGrid={false} />
      <Machine3D />
    </Canvas>
  );
}

export const BALL_RADIUS = KIT.ballRadius;
