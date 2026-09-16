import { Html } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { RunData } from '../simClient';
import { useStore } from '../store';
import { DEFAULT_COLORS, displayRadii, positionAt, systemScale } from './frames';

const tmp = new THREE.Vector3();

export function Bodies({ run, scale, onBodyClick, hidden }: {
  run: RunData;
  /** Display scale; defaults to the run's extent. */
  scale?: number;
  onBodyClick?: (id: string) => void;
  /** Bodies not drawn (e.g. the player, drawn separately). */
  hidden?: string[];
}) {
  const groups = useRef<(THREE.Group | null)[]>([]);
  const radii = useMemo(() => displayRadii(run.spec, scale ?? systemScale(run)), [run, scale]);
  const setFocus = useStore((s) => s.setFocus);
  const click = onBodyClick ?? setFocus;

  useFrame(() => {
    const time = useStore.getState().time;
    run.ids.forEach((_, i) => {
      const g = groups.current[i];
      if (!g) return;
      const launchT = run.trace.launches[run.ids[i]];
      const visible = !hidden?.includes(run.ids[i]) && positionAt(run, i, time, tmp) && (launchT === undefined || time >= launchT);
      g.visible = visible;
      if (visible) g.position.copy(tmp);
    });
  });

  return (
    <group>
      {run.spec.bodies.map((b, i) => {
        if (hidden?.includes(b.id)) return null;
        const r = radii.get(b.id)!;
        const color = b.color ?? DEFAULT_COLORS[b.type];
        return (
          <group key={b.id} ref={(el) => { groups.current[i] = el; }}>
            <mesh
              onClick={(e) => { e.stopPropagation(); click(b.id); }}
              onPointerOver={() => { document.body.style.cursor = 'pointer'; }}
              onPointerOut={() => { document.body.style.cursor = ''; }}
            >
              <sphereGeometry args={[r, 32, 16]} />
              {b.type === 'star'
                ? <meshBasicMaterial color={color} toneMapped={false} />
                : <meshStandardMaterial color={color} roughness={0.8} emissive={color} emissiveIntensity={0.08} />}
            </mesh>
            {b.type === 'star' && <pointLight intensity={3} decay={0} color={color} />}
            <Html center distanceFactor={undefined} style={{ pointerEvents: 'none' }} position={[0, r * 1.8, 0]}>
              <div className={`body-label body-label-${b.type}`}>{b.name}</div>
            </Html>
          </group>
        );
      })}
    </group>
  );
}
