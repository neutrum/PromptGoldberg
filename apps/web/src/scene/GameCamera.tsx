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
 * The part of the canvas the HUD leaves free: how far to pull the camera back so the system
 * fits in it (1 on a wide desktop screen), and how far the free area's center sits above the
 * canvas center, in CSS px.
 */
function freeArea(canvas: HTMLCanvasElement): { zoom: number; lift: number } {
  const rect = canvas.getBoundingClientRect();
  const top = document.querySelector('.hud-top')?.getBoundingClientRect().bottom ?? rect.top;
  const bottom = document.querySelector('.hud-bottom')?.getBoundingClientRect().top ?? rect.bottom;
  const freeH = Math.max(rect.height * 0.3, bottom - top);
  const zoom = THREE.MathUtils.clamp(rect.height / Math.min(freeH * 1.4, rect.width), 1, 2.5);
  const lift = (rect.top + rect.bottom) / 2 - (top + bottom) / 2;
  return { zoom, lift };
}

/**
 * Overview while aiming; during a flight the view glides after the player, zooming in once
 * at launch and then respecting whatever zoom and angle the user picks.
 */
export function GameCamera({ run, level, scale }: { run: RunData; level: Level; scale: number }) {
  const controls = useRef<OrbitControlsImpl>(null);
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const gl = useThree((s) => s.gl);
  const view = useRef({ zoom: 1, lift: 0 });
  const phase = useGame((s) => s.phase);
  const transition = useRef({ phase, since: 0, fromDist: 0 });

  useEffect(() => {
    camera.near = scale * 1e-4;
    camera.far = scale * 2000;
    camera.updateProjectionMatrix();
    view.current = freeArea(gl.domElement);
    camera.position.set(0, scale * 2.1, scale * 0.95).multiplyScalar(view.current.zoom);
    controls.current?.target.set(0, 0, 0);
    controls.current?.update();
  }, [camera, gl, scale]);

  useEffect(() => () => { camera.clearViewOffset(); }, [camera]);

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

    // Keep the scene centered in the space between the HUD panels, easing as they change size.
    const free = freeArea(gl.domElement);
    const v = view.current;
    v.zoom = free.zoom;
    v.lift += (free.lift - v.lift) * (1 - Math.exp(-dt * 6));
    const { width, height } = gl.domElement.getBoundingClientRect();
    if (width > 0 && height > 0) camera.setViewOffset(width, height, 0, v.lift, width, height);
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
      const goal = phase === 'flying' ? scale * 0.55 * Math.sqrt(v.zoom) : phase === 'aiming' ? scale * 2.3 * v.zoom : null;
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
