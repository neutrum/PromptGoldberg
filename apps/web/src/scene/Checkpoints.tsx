import { Html } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import type { Level } from '@og/shared';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useGame } from '../game/gameStore';
import { goalTarget } from '../game/hints';
import type { RunData } from '../simClient';
import { useStore } from '../store';
import { displayRadii, positionAt } from './frames';

const COLORS = { done: '#5fffa0', next: '#ffd27a', later: '#6f7fb8', failed: '#ff6b5a' };

/**
 * Numbered rings around each goal step's target body, lit up as the chain progresses.
 * `showcase` drives them without a game in progress (the start screen's demo flight).
 */
export function Checkpoints({ run, level, scale, showcase }: { run: RunData; level: Level; scale: number; showcase?: { done: number } }) {
  const gamePhase = useGame((s) => s.phase);
  const gameCelebrated = useGame((s) => s.celebrated);
  const gameOutcome = useGame((s) => s.outcome);
  const gameFlight = useGame((s) => s.flight);
  const phase = showcase ? 'flying' : gamePhase;
  const celebrated = showcase ? showcase.done : gameCelebrated;
  const outcome = showcase ? null : gameOutcome;
  const flight = showcase ? null : gameFlight;
  const radii = useMemo(() => displayRadii(run.spec, scale), [run, scale]);
  const groups = useRef<(THREE.Group | null)[]>([]);
  const tmp = useMemo(() => new THREE.Vector3(), []);

  const steps = level.spec.goal.map((g, i) => {
    const target = goalTarget(g, level.player);
    const idx = target ? run.ids.indexOf(target) : -1;
    const zone = g.type === 'flyby' ? g.maxDistance : 0;
    const radius = Math.max(zone, (target ? radii.get(target) ?? 0 : 0) * 2.4, scale * 0.02);
    return { i, idx, radius };
  });

  const failedAt = phase === 'result' && outcome && !outcome.success ? flight?.goal.failedAt ?? null : null;
  const state = (i: number): keyof typeof COLORS =>
    i === failedAt ? 'failed' : (phase === 'result' && outcome?.success) || i < celebrated ? 'done' : i === celebrated ? 'next' : 'later';

  useFrame((s) => {
    const time = useStore.getState().time;
    steps.forEach((step, k) => {
      const g = groups.current[k];
      if (!g) return;
      const ok = step.idx >= 0 && positionAt(run, step.idx, time, tmp);
      g.visible = ok;
      if (!ok) return;
      g.position.copy(tmp);
      const st = state(step.i);
      const pulse = st === 'next' ? 1 + 0.12 * Math.sin(s.clock.elapsedTime * 4) : 1;
      g.scale.setScalar(step.radius * pulse);
      g.rotation.y += st === 'next' ? 0.01 : 0.002;
    });
  });

  const missT = failedAt !== null ? flight?.goal.events[failedAt]?.missT : undefined;
  const missPos = useMemo(() => {
    if (missT === undefined || !flight) return null;
    const p = new THREE.Vector3();
    return positionAt(flight, flight.ids.indexOf(level.player), missT, p) ? p : null;
  }, [missT, flight, level]);

  return (
    <group>
      {steps.map((step, k) => {
        const st = state(step.i);
        const color = COLORS[st];
        return (
          <group key={k} ref={(el) => { groups.current[k] = el; }} visible={false}>
            <mesh rotation={[-Math.PI / 2, 0, 0]}>
              <ringGeometry args={[0.93, 1, 96]} />
              <meshBasicMaterial color={color} transparent opacity={st === 'later' ? 0.35 : 0.85} side={THREE.DoubleSide} depthWrite={false} toneMapped={false} />
            </mesh>
            <mesh rotation={[-Math.PI / 2, 0, 0]}>
              <circleGeometry args={[1, 96]} />
              <meshBasicMaterial color={color} transparent opacity={st === 'done' ? 0.12 : 0.05} side={THREE.DoubleSide} depthWrite={false} toneMapped={false} />
            </mesh>
            {level.spec.goal.length > 1 && (
              <Html position={[0.75, 0, -0.75]} center style={{ pointerEvents: 'none' }}>
                <div className={`checkpoint-num ${st}`}>{st === 'done' ? '✓' : step.i + 1}</div>
              </Html>
            )}
          </group>
        );
      })}
      {missPos && phase === 'result' && (
        <Html position={missPos} center style={{ pointerEvents: 'none' }}>
          <div className="miss-marker">✗ closest miss</div>
        </Html>
      )}
    </group>
  );
}
