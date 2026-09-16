import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import type { RunData } from '../simClient';
import { useStore } from '../store';
import { DEFAULT_COLORS, frameAt } from './frames';

interface TrailSet {
  full: THREE.Line[];
  traveled: THREE.Line[];
  startFrame: number[];
  dispose: () => void;
}

/** Scene-space polyline per body; gaps (merged/unlaunched) carry the last valid point forward. */
function buildTrails(run: RunData, ghost: boolean, showFull: (id: string) => boolean, ghostColor?: string): TrailSet {
  const n = run.ids.length;
  const full: THREE.Line[] = [];
  const traveled: THREE.Line[] = [];
  const startFrame: number[] = [];
  const disposables: { dispose: () => void }[] = [];
  const bodies = new Map(run.spec.bodies.map((b) => [b.id, b]));

  for (let i = 0; i < n; i++) {
    const id = run.ids[i];
    const body = bodies.get(id)!;
    const color = new THREE.Color(body.color ?? DEFAULT_COLORS[body.type]);
    const positions = new Float32Array(run.frameCount * 3);
    let lx = 0, ly = 0, lz = 0, first = -1;
    for (let f = 0; f < run.frameCount; f++) {
      const o = f * run.frameStride + 1 + 3 * i;
      if (!Number.isNaN(run.frames[o])) {
        lx = run.frames[o]; ly = run.frames[o + 1]; lz = run.frames[o + 2];
        if (first < 0) first = f;
      }
      positions[3 * f] = lx;
      positions[3 * f + 1] = lz;
      positions[3 * f + 2] = -ly;
    }
    const launchT = run.trace.launches[id];
    const start = launchT !== undefined ? Math.floor(frameAt(run, launchT)) : Math.max(first, 0);
    startFrame.push(start);

    const attr = new THREE.BufferAttribute(positions, 3);
    const fullGeo = new THREE.BufferGeometry().setAttribute('position', attr);
    fullGeo.setDrawRange(start, run.frameCount - start);
    const fullMat = new THREE.LineBasicMaterial({
      color: ghost ? (ghostColor ? new THREE.Color(ghostColor) : color.clone().lerp(new THREE.Color('#8090a0'), 0.5)) : color,
      transparent: true,
      opacity: ghost ? (ghostColor ? 0.55 : 0.18) : 0.12,
      depthWrite: false,
    });
    const fullLine = new THREE.Line(fullGeo, fullMat);
    fullLine.frustumCulled = false;
    fullLine.visible = showFull(id);
    full.push(fullLine);
    disposables.push(fullGeo, fullMat);

    if (!ghost && body.type !== 'star') {
      const travGeo = new THREE.BufferGeometry().setAttribute('position', attr);
      const travMat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.8, depthWrite: false });
      const travLine = new THREE.Line(travGeo, travMat);
      travLine.frustumCulled = false;
      traveled.push(travLine);
      disposables.push(travGeo, travMat);
    }
  }
  return { full, traveled, startFrame, dispose: () => disposables.forEach((d) => d.dispose()) };
}

const always = () => true;

export function Trails({ run, ghost = false, showFull = always, ghostColor }: {
  run: RunData;
  ghost?: boolean;
  /** Which bodies get their whole-run path drawn (the travelled part is always drawn). */
  showFull?: (id: string) => boolean;
  ghostColor?: string;
}) {
  const trails = useMemo(() => buildTrails(run, ghost, showFull, ghostColor), [run, ghost, showFull, ghostColor]);
  useEffect(() => () => trails.dispose(), [trails]);

  useFrame(() => {
    if (ghost) return;
    const f = Math.floor(frameAt(run, useStore.getState().time));
    let k = 0;
    run.spec.bodies.forEach((b, i) => {
      if (b.type === 'star') return;
      const line = trails.traveled[k++];
      const start = trails.startFrame[i];
      line.geometry.setDrawRange(start, Math.max(0, f - start + 1));
    });
  });

  return (
    <group>
      {trails.full.map((l, i) => <primitive key={`f${i}`} object={l} />)}
      {trails.traveled.map((l, i) => <primitive key={`t${i}`} object={l} />)}
    </group>
  );
}
