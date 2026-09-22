import { Html } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { RunData } from '../simClient';
import { useStore } from '../store';
import { getGlowTexture } from './Effects';
import { DEFAULT_COLORS, positionAt } from './frames';

/** Twin portals share a colour; pairs cycle through these unless the level sets one. */
const PORTAL_COLORS = ['#b388ff', '#4de8ff', '#ff8a4d', '#7dff9b'];

let swirlTexture: THREE.Texture | null = null;

/** Spiral-arm vortex for portal discs, generated once. */
function getSwirlTexture(): THREE.Texture {
  if (swirlTexture) return swirlTexture;
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const c = size / 2;
  const glow = ctx.createRadialGradient(c, c, 0, c, c, c);
  glow.addColorStop(0, 'rgba(255,255,255,0.95)');
  glow.addColorStop(0.35, 'rgba(255,255,255,0.35)');
  glow.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = 'rgba(255,255,255,0.8)';
  ctx.lineCap = 'round';
  for (let arm = 0; arm < 4; arm++) {
    ctx.beginPath();
    for (let k = 0; k <= 60; k++) {
      const f = k / 60;
      const a = arm * (Math.PI / 2) + f * Math.PI * 2.2;
      const r = f * c * 0.95;
      const x = c + r * Math.cos(a), y = c + r * Math.sin(a);
      if (k === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.lineWidth = 6;
    ctx.globalAlpha = 0.55;
    ctx.stroke();
  }
  swirlTexture = new THREE.CanvasTexture(canvas);
  return swirlTexture;
}

/** 0..1 flash that decays after the latest of `times` at or before `now`. */
function flash(times: number[], now: number, width: number): number {
  let last = -Infinity;
  for (const t of times) if (t <= now && t > last) last = t;
  return Number.isFinite(last) ? Math.exp(-(now - last) / width) : 0;
}

const tmp = new THREE.Vector3();
const tmp2 = new THREE.Vector3();

/**
 * Portals (wormhole mouths) and bumpers, drawn at their true size since that is where they
 * act. Portals swirl and flash when something warps through; bumpers flash on every bounce.
 */
export function Gadgets({ run, scale, onBodyClick }: { run: RunData; scale: number; onBodyClick?: (id: string) => void }) {
  const gadgets = useMemo(() => {
    const portalColor = new Map<string, string>();
    let pairs = 0;
    for (const b of run.spec.bodies) {
      if (b.type !== 'portal' || portalColor.has(b.id)) continue;
      const color = b.color ?? PORTAL_COLORS[pairs++ % PORTAL_COLORS.length];
      portalColor.set(b.id, color);
      // Twins always share a colour, so it is obvious which portals are connected.
      if (b.link) portalColor.set(b.link, color);
    }
    return run.spec.bodies
      .map((b, i) => ({ b, i }))
      .filter(({ b }) => b.type === 'portal' || b.type === 'bumper')
      .map(({ b, i }) => ({
        body: b,
        index: i,
        twin: b.link ? run.ids.indexOf(b.link) : -1,
        color: b.type === 'portal' ? portalColor.get(b.id)! : b.color ?? DEFAULT_COLORS.bumper,
        // Physical radius, with a floor so a tiny gadget is still findable.
        radius: Math.max(b.radius, scale * 0.004),
        hits: b.type === 'portal'
          ? run.trace.warps.filter((w) => w.from === b.id || w.to === b.id).map((w) => w.t)
          : run.trace.bounces.filter((x) => x.target === b.id).map((x) => x.t),
      }));
  }, [run, scale]);

  const groups = useRef<(THREE.Group | null)[]>([]);
  const discs = useRef<(THREE.Mesh | null)[]>([]);
  const rings = useRef<(THREE.Mesh | null)[]>([]);
  const halos = useRef<(THREE.Sprite | null)[]>([]);
  const glow = useMemo(getGlowTexture, []);
  const swirl = useMemo(getSwirlTexture, []);

  // Faint dotted links between twin portals, so players see where each one leads.
  const links = useMemo(() => {
    const seen = new Set<string>();
    return gadgets.filter((g) => g.twin >= 0 && !seen.has(g.body.id) && (seen.add(g.body.link!), true)).map((g) => {
      const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
      const line = new THREE.Line(geo, new THREE.LineDashedMaterial({ color: g.color, dashSize: scale * 0.02, gapSize: scale * 0.02, transparent: true, opacity: 0.35, depthWrite: false }));
      line.frustumCulled = false;
      return { from: g.index, to: g.twin, line };
    });
  }, [gadgets, scale]);
  useEffect(() => () => links.forEach((l) => { l.line.geometry.dispose(); (l.line.material as THREE.Material).dispose(); }), [links]);

  useFrame((state) => {
    const time = useStore.getState().time;
    const span = run.duration || 1;
    gadgets.forEach((g, k) => {
      const group = groups.current[k];
      if (!group) return;
      const ok = positionAt(run, g.index, time, tmp);
      group.visible = ok;
      if (!ok) return;
      group.position.copy(tmp);
      const f = flash(g.hits, time, span * 0.012);
      if (discs.current[k]) {
        discs.current[k]!.rotation.z = -state.clock.elapsedTime * (1.5 + 6 * f);
        (discs.current[k]!.material as THREE.MeshBasicMaterial).opacity = 0.55 + 0.45 * f;
      }
      if (rings.current[k]) rings.current[k]!.scale.setScalar(1 + 0.35 * f + (g.body.type === 'portal' ? 0.04 * Math.sin(state.clock.elapsedTime * 3) : 0));
      if (halos.current[k]) halos.current[k]!.scale.setScalar(g.radius * (3 + 5 * f));
    });
    for (const l of links) {
      const pos = l.line.geometry.getAttribute('position') as THREE.BufferAttribute;
      const a = positionAt(run, l.from, time, tmp), b = positionAt(run, l.to, time, tmp2);
      l.line.visible = a && b;
      if (!a || !b) continue;
      pos.setXYZ(0, tmp.x, tmp.y, tmp.z);
      pos.setXYZ(1, tmp2.x, tmp2.y, tmp2.z);
      pos.needsUpdate = true;
      l.line.computeLineDistances();
    }
  });

  return (
    <group>
      {links.map((l, k) => <primitive key={`link-${k}`} object={l.line} />)}
      {gadgets.map((g, k) => (
        <group key={g.body.id} ref={(el) => { groups.current[k] = el; }}>
          <sprite ref={(el) => { halos.current[k] = el; }}>
            <spriteMaterial map={glow} color={g.color} transparent opacity={0.4} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
          </sprite>
          {g.body.type === 'portal' ? (
            <>
              {/* Lies in the orbital plane: the ring marks exactly where warping starts. */}
              <mesh ref={(el) => { rings.current[k] = el; }} rotation={[-Math.PI / 2, 0, 0]}>
                <torusGeometry args={[g.radius, g.radius * 0.09, 12, 64]} />
                <meshBasicMaterial color={g.color} toneMapped={false} />
              </mesh>
              <mesh ref={(el) => { discs.current[k] = el; }} rotation={[-Math.PI / 2, 0, 0]} onClick={(e) => { e.stopPropagation(); onBodyClick?.(g.body.id); }}>
                <circleGeometry args={[g.radius * 0.95, 48]} />
                <meshBasicMaterial map={swirl} color={g.color} transparent opacity={0.6} depthWrite={false} side={THREE.DoubleSide} blending={THREE.AdditiveBlending} toneMapped={false} />
              </mesh>
            </>
          ) : (
            <>
              <mesh onClick={(e) => { e.stopPropagation(); onBodyClick?.(g.body.id); }}>
                <sphereGeometry args={[g.radius, 32, 16]} />
                <meshStandardMaterial color={g.color} metalness={0.6} roughness={0.25} emissive={g.color} emissiveIntensity={0.35} />
              </mesh>
              <mesh ref={(el) => { rings.current[k] = el; }} rotation={[-Math.PI / 2, 0, 0]}>
                <torusGeometry args={[g.radius * 1.12, g.radius * 0.08, 12, 64]} />
                <meshBasicMaterial color="#ffffff" toneMapped={false} />
              </mesh>
            </>
          )}
          <Html center style={{ pointerEvents: 'none' }} position={[0, g.radius * 1.9, 0]}>
            <div className={`body-label body-label-${g.body.type}`}>{g.body.name}</div>
          </Html>
        </group>
      ))}
    </group>
  );
}
