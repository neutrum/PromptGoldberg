import { CELL, KIT, type Body, type Vec3 } from '@og/machine';
import { shapeSize } from './ModelVisual';

export const kitUrl = (asset: string) => `/models/kit-v1/${asset}.glb`;
export interface KitVisual { asset: string; size: Vec3; rotation?: Vec3; offset?: Vec3; hidden?: boolean }

/** Authored alignment of the inspected models. This never changes a collider or playback transform. */
export function kitVisual(body: Body): KitVisual | null {
  if (body.sensor) return null;
  const size = shapeSize(body.shape);
  switch (body.kind) {
    case 'ball': return { asset: 'ball-round', size };
    case 'ramp': return { asset: 'ramp', size, rotation: [0, -Math.PI / 2, 0], offset: [0, size[1] / 2, 0] };
    case 'platform': return { asset: 'platform', size, rotation: [0, Math.PI / 2, 0] };
    case 'wall': return { asset: 'wall', size };
    case 'dominoes': return { asset: 'dominoes', size };
    case 'seesaw': return body.id.endsWith('.pivot')
      ? { asset: 'seesaw-block', size }
      : { asset: 'seesaw-board', size, rotation: [0, Math.PI / 2, 0] };
    case 'fan': return { asset: 'fan', size };
    case 'trampoline': return { asset: 'trampoline', size };
    case 'bucket': return { asset: 'bucket', size: [CELL * 0.9, KIT.bucket.height, CELL * 0.9],
      rotation: [0, 0, Math.PI / 2], offset: [0, (KIT.bucket.height - KIT.bucket.wall) / 2, 0], hidden: !body.id.endsWith('.floor') };
    case 'bell': return { asset: 'bell', size };
    // The entire cannon is drawn at the part origin, with its procedural barrel as the load-failure fallback.
    case 'cannon': return { asset: 'cannon', size: [0.5, 0.4, 0.36], offset: [0, 0.15, 0] };
  }
}
