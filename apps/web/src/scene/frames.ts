import type { SystemSpec } from '@og/shared';
import type { Vector3 } from 'three';
import type { RunData } from '../simClient';

/** Simulation frame (x, y, z) with z up, to three.js (x, z, -y) with y up. */
export function setScene(out: Vector3, x: number, y: number, z: number): Vector3 {
  return out.set(x, z, -y);
}

/** Fractional frame index for a time. */
export function frameAt(run: RunData, time: number): number {
  if (run.frameCount < 2 || run.duration <= 0) return 0;
  return Math.min(run.frameCount - 1, Math.max(0, (time / run.duration) * (run.frameCount - 1)));
}

/** Interpolated scene-space position of body `i`; false if it does not exist at this time. */
export function positionAt(run: RunData, i: number, time: number, out: Vector3): boolean {
  const f = frameAt(run, time);
  const f0 = Math.floor(f);
  const f1 = Math.min(run.frameCount - 1, f0 + 1);
  const u = f - f0;
  const s = run.frameStride;
  const fr = run.frames;
  const a = f0 * s + 1 + 3 * i;
  const b = f1 * s + 1 + 3 * i;
  if (Number.isNaN(fr[a])) return false;
  const bx = Number.isNaN(fr[b]) ? fr[a] : fr[b];
  const by = Number.isNaN(fr[b + 1]) ? fr[a + 1] : fr[b + 1];
  const bz = Number.isNaN(fr[b + 2]) ? fr[a + 2] : fr[b + 2];
  setScene(out, fr[a] + (bx - fr[a]) * u, fr[a + 1] + (by - fr[a + 1]) * u, fr[a + 2] + (bz - fr[a + 2]) * u);
  return true;
}

/** Typical size of the system: farthest body from the origin over the run. */
export function systemScale(run: RunData): number {
  let max = 0;
  const n = run.ids.length;
  const step = Math.max(1, Math.floor(run.frameCount / 50));
  for (let f = 0; f < run.frameCount; f += step) {
    for (let i = 0; i < n; i++) {
      const o = f * run.frameStride + 1 + 3 * i;
      const d = Math.hypot(run.frames[o], run.frames[o + 1], run.frames[o + 2]);
      if (Number.isFinite(d)) max = Math.max(max, d);
    }
  }
  return Math.max(max, 0.01);
}

const TYPE_SIZE: Record<string, number> = { star: 0.04, planet: 0.016, moon: 0.007, comet: 0.006, probe: 0.006, portal: 0.02, bumper: 0.012 };

/**
 * Exaggerated display radii: sized by type relative to the system, then shrunk so
 * every parent stays well inside its moons' orbits.
 */
export function displayRadii(spec: SystemSpec, scale: number): Map<string, number> {
  const radii = new Map(spec.bodies.map((b) => [b.id, TYPE_SIZE[b.type] * scale]));
  for (const b of spec.bodies) {
    if (b.placement.kind !== 'orbit') continue;
    const a = b.placement.a;
    const parent = b.placement.parent;
    radii.set(parent, Math.min(radii.get(parent)!, 0.35 * a));
    radii.set(b.id, Math.min(radii.get(b.id)!, 0.15 * a));
  }
  return radii;
}

export const DEFAULT_COLORS: Record<string, string> = {
  star: '#ffd27a',
  planet: '#7fb2ff',
  moon: '#cfcfd8',
  comet: '#9ff5ff',
  probe: '#ffffff',
  portal: '#b388ff',
  bumper: '#ff5fa2',
};

/** Interpolated simulation-frame position of body `i` into `out`; false if it does not exist. */
export function simPositionAt(run: RunData, i: number, time: number, out: number[]): boolean {
  const f = frameAt(run, time);
  const f0 = Math.floor(f);
  const f1 = Math.min(run.frameCount - 1, f0 + 1);
  const u = f - f0;
  const a = f0 * run.frameStride + 1 + 3 * i;
  const b = f1 * run.frameStride + 1 + 3 * i;
  const fr = run.frames;
  if (Number.isNaN(fr[a])) return false;
  for (let k = 0; k < 3; k++) out[k] = Number.isNaN(fr[b + k]) ? fr[a + k] : fr[a + k] + (fr[b + k] - fr[a + k]) * u;
  return true;
}

/** Simulation-frame velocity of body `i` from neighbouring frames. */
export function simVelocityAt(run: RunData, i: number, time: number, out: number[]): boolean {
  const h = run.duration / Math.max(1, run.frameCount - 1);
  const p0 = [0, 0, 0], p1 = [0, 0, 0];
  const t0 = Math.max(0, time - h / 2), t1 = Math.min(run.duration, time + h / 2);
  if (t1 <= t0 || !simPositionAt(run, i, t0, p0) || !simPositionAt(run, i, t1, p1)) return false;
  for (let k = 0; k < 3; k++) out[k] = (p1[k] - p0[k]) / (t1 - t0);
  return true;
}

/** Display scale for a game level: the extent of everything except the player (which may fly off). */
export function gameScale(run: RunData, player: string): number {
  let max = 0;
  const skip = run.ids.indexOf(player);
  const step = Math.max(1, Math.floor(run.frameCount / 60));
  for (let f = 0; f < run.frameCount; f += step) {
    for (let i = 0; i < run.ids.length; i++) {
      if (i === skip) continue;
      const o = f * run.frameStride + 1 + 3 * i;
      const d = Math.hypot(run.frames[o], run.frames[o + 1], run.frames[o + 2]);
      if (Number.isFinite(d)) max = Math.max(max, d);
    }
  }
  return Math.max(max, 0.01);
}
