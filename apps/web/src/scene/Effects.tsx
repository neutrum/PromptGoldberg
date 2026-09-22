import { Html } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import type { Level } from '@og/shared';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useGame } from '../game/gameStore';
import type { RunData } from '../simClient';
import { useStore } from '../store';
import { DEFAULT_COLORS, frameAt, positionAt } from './frames';

let glowTexture: THREE.Texture | null = null;

/** Soft radial sprite, generated once. */
export function getGlowTexture(): THREE.Texture {
  if (glowTexture) return glowTexture;
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d')!;
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.2, 'rgba(255,255,255,0.65)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.15)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  glowTexture = new THREE.CanvasTexture(canvas);
  return glowTexture;
}

interface Burst {
  pos: THREE.Vector3;
  color: string;
  size: number;
  born: number;
}

const bursts: Burst[] = [];
let shake = 0;

/** Expanding flash at a scene position; `size` is relative to the system scale. */
export function burst(pos: THREE.Vector3, color: string, size = 1) {
  bursts.push({ pos: pos.clone(), color, size, born: performance.now() });
  if (size > 1.5) shake = Math.max(shake, 1);
}

export function takeShake(dt: number): number {
  const s = shake;
  shake = Math.max(0, shake - dt * 2.2);
  return s;
}

const BURST_MS = 900;
const MAX_BURSTS = 8;

export function Bursts({ scale }: { scale: number }) {
  const rings = useRef<(THREE.Mesh | null)[]>([]);
  const flashes = useRef<(THREE.Sprite | null)[]>([]);
  const texture = useMemo(getGlowTexture, []);

  useFrame(() => {
    const now = performance.now();
    while (bursts.length && now - bursts[0].born > BURST_MS) bursts.shift();
    for (let k = 0; k < MAX_BURSTS; k++) {
      const b = bursts[k];
      const ring = rings.current[k];
      const flash = flashes.current[k];
      if (!ring || !flash) continue;
      ring.visible = flash.visible = !!b;
      if (!b) continue;
      const u = (now - b.born) / BURST_MS;
      const ease = 1 - (1 - u) ** 3;
      ring.position.copy(b.pos);
      ring.scale.setScalar(scale * 0.12 * b.size * ease + 1e-6);
      const rm = ring.material as THREE.MeshBasicMaterial;
      rm.color.set(b.color);
      rm.opacity = 0.9 * (1 - u);
      flash.position.copy(b.pos);
      flash.scale.setScalar(scale * 0.1 * b.size * (1 - u * 0.5));
      const fm = flash.material as THREE.SpriteMaterial;
      fm.color.set(b.color);
      fm.opacity = (1 - u) ** 2;
    }
  });

  return (
    <group>
      {Array.from({ length: MAX_BURSTS }, (_, k) => (
        <group key={k}>
          <mesh ref={(m) => { rings.current[k] = m; }} rotation={[-Math.PI / 2, 0, 0]} visible={false}>
            <ringGeometry args={[0.85, 1, 64]} />
            <meshBasicMaterial transparent depthWrite={false} side={THREE.DoubleSide} blending={THREE.AdditiveBlending} toneMapped={false} />
          </mesh>
          <sprite ref={(s) => { flashes.current[k] = s; }} visible={false}>
            <spriteMaterial map={texture} transparent depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
          </sprite>
        </group>
      ))}
    </group>
  );
}

const TAIL_FRAMES = 40;

/** The player's probe: a bright pulsing glow, a hot tail, and a label while aiming (never in a `showcase`). */
export function PlayerGlow({ run, level, scale, showcase = false }: { run: RunData; level: Level; scale: number; showcase?: boolean }) {
  const sprite = useRef<THREE.Sprite>(null);
  const halo = useRef<THREE.Sprite>(null);
  const label = useRef<THREE.Group>(null);
  const labelDiv = useRef<HTMLDivElement>(null);
  const texture = useMemo(getGlowTexture, []);
  const i = run.ids.indexOf(level.player);
  const body = run.spec.bodies[i];
  const canDrag = level.controls.some((c) => /\.(speed|angle)$/.test(c.path));
  const color = body?.color ?? DEFAULT_COLORS[body?.type ?? 'probe'];
  const tmp = useMemo(() => new THREE.Vector3(), []);

  const tail = useMemo(() => {
    const positions = new Float32Array(TAIL_FRAMES * 3);
    const colors = new Float32Array(TAIL_FRAMES * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const mat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    const line = new THREE.Line(geo, mat);
    line.frustumCulled = false;
    return line;
  }, []);

  useFrame((state) => {
    if (i < 0) return;
    const time = useStore.getState().time;
    const exists = positionAt(run, i, time, tmp);
    const launchT = run.trace.launches[level.player];
    const launched = (showcase || useGame.getState().phase !== 'aiming') && (launchT === undefined || time >= launchT);
    for (const s of [sprite.current, halo.current]) if (s) s.visible = exists;
    if (!exists) {
      tail.visible = false;
      if (labelDiv.current) labelDiv.current.style.display = 'none';
      return;
    }
    const pulse = 1 + 0.25 * Math.sin(state.clock.elapsedTime * 6);
    sprite.current!.position.copy(tmp);
    sprite.current!.scale.setScalar(scale * 0.03 * (launched ? 1 : pulse));
    halo.current!.position.copy(tmp);
    halo.current!.scale.setScalar(scale * (launched ? 0.08 : 0.12 * pulse));
    if (label.current) {
      const show = !showcase && !launched && canDrag && useGame.getState().phase === 'aiming';
      label.current.visible = show;
      if (labelDiv.current) labelDiv.current.style.display = show ? '' : 'none';
      label.current.position.copy(tmp);
    }

    const f = Math.floor(frameAt(run, time));
    const start = launchT !== undefined ? Math.ceil(frameAt(run, launchT)) : 0;
    const count = Math.max(0, Math.min(TAIL_FRAMES, f - start + 1));
    tail.visible = launched && count > 1;
    const pos = tail.geometry.getAttribute('position') as THREE.BufferAttribute;
    const col = tail.geometry.getAttribute('color') as THREE.BufferAttribute;
    const c = new THREE.Color(color);
    for (let k = 0; k < count; k++) {
      const frame = f - count + 1 + k;
      const o = frame * run.frameStride + 1 + 3 * i;
      pos.setXYZ(k, run.frames[o], run.frames[o + 2], -run.frames[o + 1]);
      const fade = (k + 1) / count;
      col.setXYZ(k, c.r * fade, c.g * fade, c.b * fade);
    }
    if (count > 0) pos.setXYZ(count - 1, tmp.x, tmp.y, tmp.z);
    pos.needsUpdate = col.needsUpdate = true;
    tail.geometry.setDrawRange(0, count);
  });

  return (
    <group>
      <primitive object={tail} />
      <sprite ref={halo}>
        <spriteMaterial map={texture} color={color} transparent opacity={0.35} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
      </sprite>
      <sprite ref={sprite}>
        <spriteMaterial map={texture} color="#ffffff" transparent depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
      </sprite>
      <group ref={label}>
        <Html center style={{ pointerEvents: 'none' }} position={[0, 0, 0]}>
          <div ref={labelDiv} className="pad-label">drag to aim</div>
        </Html>
      </group>
    </group>
  );
}
