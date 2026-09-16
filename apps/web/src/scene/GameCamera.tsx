import { OrbitControls } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import type { Level } from '@og/shared';
import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { useGame } from '../game/gameStore';
import type { RunData } from '../simClient';
import { useStore } from '../store';
import { takeShake } from './Effects';
import { positionAt } from './frames';

type OrbitControlsImpl = React.ComponentRef<typeof OrbitControls>;

const tmp = new THREE.Vector3();
const desired = new THREE.Vector3();
const delta = new THREE.Vector3();

/**
 * Overview while aiming; during a flight the view glides after the player, zooming in once
 * at launch and then respecting whatever zoom and angle the user picks.
 */
export function GameCamera({ run, level, scale }: { run: RunData; level: Level; scale: number }) {
  const controls = useRef<OrbitControlsImpl>(null);
  const camera = useThree((s) => s.camera);
  const phase = useGame((s) => s.phase);
  const transition = useRef({ phase, since: 0, fromDist: 0 });

  useEffect(() => {
    camera.near = scale * 1e-4;
    camera.far = scale * 2000;
    camera.updateProjectionMatrix();
    camera.position.set(0, scale * 2.1, scale * 0.95);
    controls.current?.target.set(0, 0, 0);
    controls.current?.update();
  }, [camera, scale]);

  useFrame((state, dt) => {
    const c = controls.current;
    if (!c) return;
    const tr = transition.current;
    if (tr.phase !== phase) {
      tr.phase = phase;
      tr.since = state.clock.elapsedTime;
      tr.fromDist = camera.position.distanceTo(c.target);
    }
    const age = state.clock.elapsedTime - tr.since;
    const k = 1 - Math.exp(-dt * 5);
    const i = run.ids.indexOf(level.player);

    if ((phase === 'flying' || phase === 'result') && i >= 0 && positionAt(run, i, useStore.getState().time, tmp)) {
      desired.copy(tmp);
    } else {
      desired.set(0, 0, 0);
    }
    delta.copy(desired).sub(c.target).multiplyScalar(age < 1.2 ? k : 1 - Math.exp(-dt * 12));
    c.target.add(delta);
    camera.position.add(delta);

    // One-off zoom after a phase change, then hands off to the user.
    if (age < 1.2) {
      const goal = phase === 'flying' ? scale * 0.55 : phase === 'aiming' ? scale * 2.3 : null;
      if (goal !== null) {
        const offset = camera.position.clone().sub(c.target);
        const dist = offset.length();
        const want = THREE.MathUtils.lerp(dist, goal, 1 - Math.exp(-dt * 3));
        camera.position.copy(c.target).addScaledVector(offset.normalize(), want);
      }
    }

    const shake = takeShake(dt);
    if (shake > 0) camera.position.add(tmp.set((Math.random() - 0.5), (Math.random() - 0.5), (Math.random() - 0.5)).multiplyScalar(shake * scale * 0.02));
    c.update();
  });

  return <OrbitControls ref={controls} makeDefault enableDamping={false} maxDistance={scale * 20} minDistance={scale * 0.002} />;
}
