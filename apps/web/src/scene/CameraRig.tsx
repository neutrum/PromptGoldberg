import { OrbitControls } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import React, { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { RunData } from '../simClient';
import { useStore } from '../store';
import { displayRadii, positionAt, systemScale } from './frames';

type OrbitControlsImpl = React.ComponentRef<typeof OrbitControls>;

const tmp = new THREE.Vector3();

/** Frames the whole system on load; follows the focused body, keeping the user's view offset. */
export function CameraRig({ run }: { run: RunData }) {
  const controls = useRef<OrbitControlsImpl>(null);
  const camera = useThree((s) => s.camera);
  const focusId = useStore((s) => s.focusId);
  const scale = useMemo(() => systemScale(run), [run]);
  const radii = useMemo(() => displayRadii(run.spec, scale), [run, scale]);
  const title = run.spec.title;

  useEffect(() => {
    camera.near = scale * 1e-5;
    camera.far = scale * 1000;
    camera.updateProjectionMatrix();
    camera.position.set(0, scale * 1.1, scale * 1.3);
    controls.current?.target.set(0, 0, 0);
    controls.current?.update();
    // Re-frame only when a different system loads, not on every attempt of the same one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, scale]);

  useEffect(() => {
    const c = controls.current;
    if (!c) return;
    if (!focusId) {
      c.target.set(0, 0, 0);
      return;
    }
    const i = run.ids.indexOf(focusId);
    if (i < 0 || !positionAt(run, i, useStore.getState().time, tmp)) return;
    const dist = Math.max((radii.get(focusId) ?? scale * 0.01) * 25, scale * 1e-4);
    const dir = camera.position.clone().sub(c.target).normalize();
    c.target.copy(tmp);
    camera.position.copy(tmp).addScaledVector(dir, dist);
    c.update();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusId]);

  useFrame(() => {
    const c = controls.current;
    if (!c || !focusId) return;
    const i = run.ids.indexOf(focusId);
    if (i < 0 || !positionAt(run, i, useStore.getState().time, tmp)) return;
    const delta = tmp.clone().sub(c.target);
    c.target.copy(tmp);
    camera.position.add(delta);
    c.update();
  });

  return <OrbitControls ref={controls} makeDefault enableDamping={false} />;
}
