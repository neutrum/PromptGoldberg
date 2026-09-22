import { useFrame, useThree } from '@react-three/fiber';
import { anchorBody, orbitalPeriod, PIECE_BODIES, type Level } from '@og/shared';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { launchTime, useGame } from '../game/gameStore';
import type { RunData } from '../simClient';
import { useStore } from '../store';
import { frameAt, positionAt, simPositionAt, simVelocityAt } from './frames';

/** Share of the flight after launch that the dotted preview reveals. */
export const PREVIEW_FRACTION = 0.3;

const RAD = 180 / Math.PI;

/** How close to the probe (CSS px) a press grabs it; fingers need more room than a mouse. */
const grabRadius = (e: PointerEvent) => (e.pointerType === 'mouse' ? 56 : 80);
/** Pull distance (CSS px) for full power; shorter on small screens so a thumb can reach it. */
const fullPull = () => Math.min(220, Math.max(130, 0.42 * Math.min(window.innerWidth, window.innerHeight)));

/** Dashed line along body `i`'s path between two times. */
function DashedPath({ run, i, t0, t1, color, opacity = 0.85 }: { run: RunData; i: number; t0: number; t1: number; color: string; opacity?: number }) {
  const line = useMemo(() => {
    const f0 = Math.max(0, Math.floor(frameAt(run, t0)));
    const f1 = Math.min(run.frameCount - 1, Math.ceil(frameAt(run, t1)));
    const pts: THREE.Vector3[] = [];
    for (let f = f0; f <= f1; f++) {
      const o = f * run.frameStride + 1 + 3 * i;
      if (Number.isNaN(run.frames[o])) break;
      pts.push(new THREE.Vector3(run.frames[o], run.frames[o + 2], -run.frames[o + 1]));
    }
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const len = pts.reduce((s, p, k) => (k ? s + p.distanceTo(pts[k - 1]) : 0), 0);
    const mat = new THREE.LineDashedMaterial({ color, dashSize: len / 60, gapSize: len / 90, transparent: true, opacity, depthWrite: false });
    const l = new THREE.Line(geo, mat);
    l.computeLineDistances();
    l.frustumCulled = false;
    return l;
  }, [run, i, t0, t1, color, opacity]);
  useEffect(() => () => { line.geometry.dispose(); (line.material as THREE.Material).dispose(); }, [line]);
  return <primitive object={line} />;
}

/** The part of the flight the dashed preview reveals. */
function previewWindow(run: RunData, level: Level): [number, number] {
  const launchT = run.trace.launches[level.player] ?? 0;
  return [launchT, launchT + PREVIEW_FRACTION * (run.duration - launchT)];
}

/** Dashed path of the first part of the shot. */
export function PreviewPath({ run, level }: { run: RunData; level: Level }) {
  const [t0, t1] = previewWindow(run, level);
  return <DashedPath run={run} i={run.ids.indexOf(level.player)} t0={t0} t1={t1} color="#ffffff" />;
}

/** Where each placed piece travels while the probe flies its dashed preview, so pieces read as moving. */
export function PieceArcs({ run, level, scale }: { run: RunData; level: Level; scale: number }) {
  const [t0, t1] = previewWindow(run, level);
  const pieces = run.spec.bodies.filter((b) => /^piece\d+$/.test(b.id));
  const end = new THREE.Vector3();
  return (
    <>
      {pieces.map((b) => {
        const i = run.ids.indexOf(b.id);
        const color = b.color ?? '#ffffff';
        return (
          <group key={b.id}>
            <DashedPath run={run} i={i} t0={t0} t1={t1} color={color} opacity={0.6} />
            {positionAt(run, i, t1, end) && (
              <mesh position={end.clone()}>
                <sphereGeometry args={[scale * 0.006, 12, 12]} />
                <meshBasicMaterial color={color} transparent opacity={0.45} toneMapped={false} />
              </mesh>
            )}
          </group>
        );
      })}
    </>
  );
}

interface Basis {
  pad: number[];
  pro: number[];
  radial: number[];
}

/** Launch frame at the launch moment: pad position, prograde and outward directions (simulation frame). */
function launchBasis(run: RunData, level: Level, time: number): Basis | null {
  const body = run.spec.bodies.find((b) => b.id === level.player);
  if (!body) return null;
  const pad = [0, 0, 0];
  if (body.placement.kind !== 'launch') {
    return simPositionAt(run, run.ids.indexOf(body.id), time, pad) ? { pad, pro: [1, 0, 0], radial: [0, 1, 0] } : null;
  }
  const from = run.spec.bodies.find((b) => b.id === (body.placement as { from: string }).from);
  if (!from) return null;
  const si = run.ids.indexOf(from.id);
  const parentId = from.placement.kind === 'orbit' ? from.placement.parent : anchorBody(run.spec).id;
  const pi = run.ids.indexOf(parentId);
  const ppos = [0, 0, 0], vs = [0, 0, 0], vp = [0, 0, 0];
  if (!simPositionAt(run, si, time, pad) || !simVelocityAt(run, si, time, vs)) return null;
  if (pi >= 0 && pi !== si) {
    simPositionAt(run, pi, time, ppos);
    simVelocityAt(run, pi, time, vp);
  }
  const rel = [pad[0] - ppos[0], pad[1] - ppos[1]];
  const v = [vs[0] - vp[0], vs[1] - vp[1]];
  const vl = Math.hypot(v[0], v[1]) || 1;
  const pro = [v[0] / vl, v[1] / vl];
  const dot = rel[0] * pro[0] + rel[1] * pro[1];
  const r = [rel[0] - dot * pro[0], rel[1] - dot * pro[1]];
  const rl = Math.hypot(r[0], r[1]) || 1;
  return { pad, pro, radial: [r[0] / rl, r[1] / rl] };
}

const toScene = (p: number[], out: THREE.Vector3) => out.set(p[0], p[2] ?? 0, -p[1]);

/** Where the launch pad is on screen (CSS px, viewport), for tutorial pointers. Null when off-screen or absent. */
export const padScreen: { current: { x: number; y: number } | null } = { current: null };

/** Pull back from the probe to aim (like a slingshot); click the plane to drop a piece when placing. */
export function AimController({ run, level, scale }: { run: RunData; level: Level; scale: number }) {
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);
  const phase = useGame((s) => s.phase);
  const placing = useGame((s) => s.placing);
  const values = useGame((s) => s.values);

  const speedIdx = level.controls.findIndex((c) => c.path === `bodies.${level.player}.placement.speed`);
  const angleIdx = level.controls.findIndex((c) => c.path === `bodies.${level.player}.placement.angle`);
  const canDrag = speedIdx >= 0 || angleIdx >= 0;
  const time = launchTime(level, values);
  const basis = useMemo(() => launchBasis(run, level, Math.min(time, run.duration)), [run, level, time]);

  const drag = useRef<{ active: boolean; pointer: THREE.Vector3 }>({ active: false, pointer: new THREE.Vector3() });
  /** Pointer id of a press that will drop a piece on release (the ghost ring follows it meanwhile). */
  const placeDrag = useRef<number | null>(null);
  /** Whether `hover` tracks a real pointer (a mouse, or a finger that is down). */
  const hoverLive = useRef(false);
  const hover = useRef(new THREE.Vector3());
  const band = useRef<THREE.Line>(null);
  const arrow = useRef<THREE.Group>(null);
  const ghost = useRef<THREE.Group>(null);

  const planePoint = (e: PointerEvent, out: THREE.Vector3): boolean => {
    const rect = gl.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, camera);
    return ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), out) !== null;
  };

  useEffect(() => {
    const el = gl.domElement.parentElement ?? gl.domElement;
    const padOnScreen = () => {
      if (!basis) return null;
      const p = toScene(basis.pad, new THREE.Vector3()).project(camera);
      const rect = gl.domElement.getBoundingClientRect();
      return { x: rect.left + ((p.x + 1) / 2) * rect.width, y: rect.top + ((1 - p.y) / 2) * rect.height };
    };

    const applyDrag = (e: PointerEvent) => {
      const game = useGame.getState();
      if (!basis || !planePoint(e, drag.current.pointer)) return;
      const px = drag.current.pointer.x, py = -drag.current.pointer.z;
      const pull = [basis.pad[0] - px, basis.pad[1] - py];
      const s = padOnScreen();
      const pixels = s ? Math.hypot(e.clientX - s.x, e.clientY - s.y) : 0;
      if (angleIdx >= 0 && Math.hypot(pull[0], pull[1]) > 0) {
        const c = level.controls[angleIdx];
        let a = Math.atan2(pull[0] * basis.radial[0] + pull[1] * basis.radial[1], pull[0] * basis.pro[0] + pull[1] * basis.pro[1]) * RAD;
        const mid = (c.min + c.max) / 2;
        while (a - mid > 180) a -= 360;
        while (a - mid < -180) a += 360;
        game.setValue(angleIdx, a);
      }
      if (speedIdx >= 0) {
        const c = level.controls[speedIdx];
        const f = Math.min(1, Math.max(0, (pixels - 12) / fullPull()));
        game.setValue(speedIdx, c.min + f * (c.max - c.min));
      }
    };

    const dropPiece = (e: PointerEvent) => {
      const game = useGame.getState();
      const p = new THREE.Vector3();
      if (!game.placing || !planePoint(e, p)) return;
      const anchor = anchorBody(run.spec);
      const ai = run.ids.indexOf(anchor.id);
      const ap = [0, 0, 0];
      simPositionAt(run, ai, time, ap);
      const x = p.x - ap[0], y = -p.z - ap[1];
      const r = Math.hypot(x, y);
      if (r < scale * 0.03) return;
      const period = orbitalPeriod(r, anchor.mass + PIECE_BODIES[game.placing].mass);
      const angle = ((Math.atan2(y, x) * RAD - (360 * time) / period) % 360 + 360) % 360;
      game.placePiece({ kind: game.placing, r, angle });
    };

    const onDown = (e: PointerEvent) => {
      const game = useGame.getState();
      if (e.button !== 0 || game.phase === 'flying') return;
      if (game.placing) {
        // Drop on release, so a finger can slide to the spot while the ghost orbit follows.
        if (!e.isPrimary || !planePoint(e, hover.current)) return;
        e.stopPropagation();
        placeDrag.current = e.pointerId;
        hoverLive.current = true;
        return;
      }
      if (!canDrag) return;
      const s = padOnScreen();
      if (!s || Math.hypot(e.clientX - s.x, e.clientY - s.y) > grabRadius(e)) return;
      e.stopPropagation();
      drag.current.active = true;
      document.body.style.cursor = 'grabbing';
      applyDrag(e);
    };
    const onMove = (e: PointerEvent) => {
      if (drag.current.active) {
        applyDrag(e);
        return;
      }
      if (placeDrag.current !== null && e.pointerId !== placeDrag.current) return;
      if (e.pointerType === 'mouse') hoverLive.current = true;
      else if (placeDrag.current === null) return;
      planePoint(e, hover.current);
      if (useGame.getState().placing) {
        document.body.style.cursor = 'crosshair';
        return;
      }
      const s = padOnScreen();
      const near = canDrag && s && Math.hypot(e.clientX - s.x, e.clientY - s.y) <= grabRadius(e);
      document.body.style.cursor = near ? 'grab' : '';
    };
    const onUp = (e: PointerEvent) => {
      if (placeDrag.current === e.pointerId) {
        placeDrag.current = null;
        hoverLive.current = e.pointerType === 'mouse';
        dropPiece(e);
      }
      if (!drag.current.active) return;
      drag.current.active = false;
      document.body.style.cursor = '';
    };
    const onCancel = (e: PointerEvent) => {
      if (placeDrag.current === e.pointerId) placeDrag.current = null;
      hoverLive.current = e.pointerType === 'mouse';
      drag.current.active = false;
    };
    el.addEventListener('pointerdown', onDown, { capture: true });
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    return () => {
      el.removeEventListener('pointerdown', onDown, { capture: true });
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      document.body.style.cursor = '';
    };
  }, [gl, camera, basis, run, level, scale, time, canDrag, angleIdx, speedIdx]);

  const bandLine = useMemo(() => {
    const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    const l = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: '#ffd27a', transparent: true, opacity: 0.7 }));
    l.frustumCulled = false;
    return l;
  }, []);

  const guide = useMemo(() => {
    const pts = Array.from({ length: 129 }, (_, k) => new THREE.Vector3(Math.cos((k / 128) * Math.PI * 2), 0, Math.sin((k / 128) * Math.PI * 2)));
    const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: '#8ef0b4', transparent: true, opacity: 0.5 }));
    l.frustumCulled = false;
    return l;
  }, []);

  useEffect(() => () => { padScreen.current = null; }, []);

  useFrame(() => {
    const aiming = phase === 'aiming' || phase === 'result';
    const b = basis;
    if (b && canDrag) {
      const p = toScene(b.pad, new THREE.Vector3()).project(camera);
      const rect = gl.domElement.getBoundingClientRect();
      padScreen.current = p.z < 1 && Math.abs(p.x) <= 1 && Math.abs(p.y) <= 1
        ? { x: rect.left + ((p.x + 1) / 2) * rect.width, y: rect.top + ((1 - p.y) / 2) * rect.height }
        : null;
    } else {
      padScreen.current = null;
    }
    if (band.current) {
      band.current.visible = drag.current.active && !!b;
      if (b && drag.current.active) {
        const pos = band.current.geometry.getAttribute('position') as THREE.BufferAttribute;
        const pad = toScene(b.pad, new THREE.Vector3());
        pos.setXYZ(0, pad.x, pad.y, pad.z);
        pos.setXYZ(1, drag.current.pointer.x, 0, drag.current.pointer.z);
        pos.needsUpdate = true;
      }
    }
    if (arrow.current) {
      arrow.current.visible = aiming && canDrag && !!b && phase === 'aiming';
      if (b) {
        const vals = useGame.getState().values;
        const th = angleIdx >= 0 ? vals[angleIdx] / RAD : 0;
        const dir = [Math.cos(th) * b.pro[0] + Math.sin(th) * b.radial[0], Math.cos(th) * b.pro[1] + Math.sin(th) * b.radial[1]];
        const c = speedIdx >= 0 ? level.controls[speedIdx] : null;
        const f = c ? (vals[speedIdx] - c.min) / (c.max - c.min) : 0.5;
        toScene(b.pad, arrow.current.position);
        // Rotating about y by θ maps +x to (cos θ, 0, -sin θ), which is sim direction (cos θ, sin θ).
        arrow.current.rotation.set(0, Math.atan2(dir[1], dir[0]), 0);
        arrow.current.scale.setScalar(scale * (0.05 + 0.1 * f));
      }
    }
    if (ghost.current) {
      const placingNow = useGame.getState().placing;
      ghost.current.visible = !!placingNow && aiming && hoverLive.current;
      if (placingNow) {
        const anchor = anchorBody(run.spec);
        const ap = [0, 0, 0];
        simPositionAt(run, run.ids.indexOf(anchor.id), Math.min(time, run.duration), ap);
        const center = toScene(ap, new THREE.Vector3());
        const r = Math.hypot(hover.current.x - center.x, hover.current.z - center.z);
        ghost.current.position.copy(center);
        ghost.current.scale.setScalar(Math.max(r, 1e-6));
      }
    }
  });

  return (
    <group>
      <primitive ref={band} object={bandLine} />
      <group ref={arrow}>
        {/* Points along +x; rotated about y so +x maps to the launch direction. */}
        <mesh position={[0.6, 0, 0]} rotation={[0, 0, -Math.PI / 2]}>
          <coneGeometry args={[0.12, 0.35, 16]} />
          <meshBasicMaterial color="#ffd27a" toneMapped={false} />
        </mesh>
        <mesh position={[0.25, 0, 0]} rotation={[0, 0, -Math.PI / 2]}>
          <cylinderGeometry args={[0.03, 0.03, 0.5, 8]} />
          <meshBasicMaterial color="#ffd27a" toneMapped={false} />
        </mesh>
      </group>
      <group ref={ghost} visible={false}>
        <primitive object={guide} />
      </group>
    </group>
  );
}
