import { useEffect, useMemo, useState } from 'react';
import { Box3, Group, Matrix4, Mesh, MeshStandardMaterial, Quaternion, Vector3 } from 'three';
import { CELL, halfFootprint, HEROES, isGadget, isSolidShape, KIT, libraryIn, slug, type Body, type Hero, type LandmarkShape, type Part } from '@pg/core';
import { shapeSize } from './kitVisuals';
import { loadModel } from './ModelVisual';
import MODELS from './libraryModels.json';

/**
 * Low-poly models made once for the library things players name most (scripts/pregen-library.ts).
 * The recipe's shapes stay the colliders; the model is only what is drawn, fitted to them.
 * `turn` (degrees about y) fixes a model that faces the wrong way.
 */
const KNOWN = MODELS as Record<string, { turn?: number }>;
const byLabel = new Map<string, string | null>();
/** The worlds' centrepieces: the ship uses the library's pirate ship, the rest their own models. */
const HERO_MODEL: Record<Hero, string> = { ship: 'pirate-ship', dragon: 'hero-dragon', castle: 'hero-castle', robot: 'hero-robot', rocket: 'hero-rocket', windmill: 'hero-windmill', teapot: 'hero-teapot' };

/**
 * The model id a landmark, a world's centrepiece or a goal (bucket, bell) is drawn with, if there is one; a workbench part's own model is its URL.
 * A goal named after a landmark that stands on the board (`parts`) stays a plain goal: the landmark is drawn big once, not again goal-sized.
 */
export function libraryLook(p: Part | undefined, parts?: Part[]): string | undefined {
  // A part that spins has a model of its still base only (the spinning shapes are drawn turning): none without a base.
  if (p?.build?.some((s) => s.spin) && !p.build.some((s) => isSolidShape(s) && !s.spin)) return undefined;
  if (p?.model && isGadget(p)) return p.model;
  if (p?.label && parts && (p.kind === 'bucket' || p.kind === 'bell') && parts.some((q) => q.prop === 'landmark' && q.label && sameName(q.label, p.label!))) return undefined;
  if (p?.prop && (HEROES as readonly string[]).includes(p.prop)) { const id = HERO_MODEL[p.prop as Hero]; return KNOWN[id] ? id : undefined; }
  // Otherwise a workbench part is drawn as its shapes: they are exactly what the ball meets.
  if (!p || !p.label || isGadget(p) || !(p.prop === 'landmark' || p.kind === 'bucket' || p.kind === 'bell')) return undefined;
  if (!byLabel.has(p.label)) {
    // A model made for exactly this name ("Eiffel Tower", "VR headset") first, then the library thing the name says.
    // A landmark called after a world centrepiece ("castle", "dragon") uses that centrepiece's model.
    const own = slug(p.label), id = libraryIn(p.label)[0]?.id, hero = HERO_MODEL[own as Hero];
    byLabel.set(p.label, KNOWN[own] ? own : id && KNOWN[id] ? id : hero && KNOWN[hero] ? hero : null);
  }
  return byLabel.get(p.label) ?? undefined;
}

const sameName = (a: string, b: string) => slug(a.replace(/^the\s+/i, '')) === slug(b.replace(/^the\s+/i, ''));

const url = (id: string) => (id.startsWith('/api/meshes/') ? id : `/models/library/${id}.glb`);

/** The loaded model, or null while it loads or when it failed (then the recipe is drawn). */
function useLook(id: string | undefined) {
  const [root, setRoot] = useState<{ id: string; root: Group } | null>(null);
  useEffect(() => {
    let live = true;
    if (id) loadModel(url(id)).then((r) => { if (live) setRoot({ id, root: r }); }, () => {});
    return () => { live = false; };
  }, [id]);
  return id && root?.id === id ? root.root : null;
}

/** True once the model is on screen, so the recipe's own boxes can hide. */
export const useLookReady = (id: string | undefined) => !!useLook(id);

/** The space the recipe's still shapes take, in metres, around the footprint's middle: where its model goes. */
export function recipeBox(shapes: LandmarkShape[]) {
  const box = new Box3();
  for (const s of shapes.filter((s) => isSolidShape(s) && !s.spin)) {
    const [ha, hb] = halfFootprint(s), tall = s.shape === 'sphere' ? s.size[0] : s.size[1];
    box.expandByPoint(new Vector3(s.at[0] - ha, s.at[1], s.at[2] - hb).multiplyScalar(CELL));
    box.expandByPoint(new Vector3(s.at[0] + ha, s.at[1] + tall, s.at[2] + hb).multiplyScalar(CELL));
  }
  return box;
}

/** The space some bodies take in the world, turned as they are. */
export function bodiesBox(bodies: Body[]) {
  const box = new Box3(), m = new Matrix4();
  for (const b of bodies) {
    if (b.sensor) continue;
    const half = new Vector3(...shapeSize(b.shape)).multiplyScalar(0.5);
    m.compose(new Vector3(...b.position), new Quaternion(...b.rotation), new Vector3(1, 1, 1));
    box.union(new Box3(half.clone().negate(), half).applyMatrix4(m));
  }
  return box;
}

/**
 * A goal's model's space round its cell's middle: wider than the bucket or bell that catches the
 * ball (1.6 cells, 1.2 for a bell), so the goal reads from the default camera.
 */
export function goalBox(kind: 'bucket' | 'bell') {
  const half = kind === 'bucket' ? CELL * 0.8 : CELL * 0.6;
  const height = kind === 'bucket' ? KIT.bucket.height : KIT.bell.height * 2;
  return new Box3(new Vector3(-half, 0, -half), new Vector3(half, height, half));
}

/**
 * The model in the given space (a recipe's, a goal's): its long side along the space's long side,
 * as wide as the footprint allows, its height within a quarter of the space's, standing on its floor.
 */
export function LibraryModel({ id, box: want, ghost }: { id: string; box: Box3; /** Drawn see-through in this colour: where a carried thing would land. */ ghost?: string }) {
  const root = useLook(id);
  const object = useMemo(() => {
    if (!root) return null;
    const size = want.getSize(new Vector3()), mid = want.getCenter(new Vector3());
    const model = root.clone(true);
    if (ghost) {
      const see = new MeshStandardMaterial({ color: ghost, emissive: ghost, emissiveIntensity: 0.6, transparent: true, opacity: 0.55, depthWrite: false });
      model.traverse((o) => { if ((o as Mesh).isMesh) { (o as Mesh).material = see; o.castShadow = false; } });
    }
    const turned = new Group(); turned.add(model);
    let have = new Box3().setFromObject(turned).getSize(new Vector3());
    // Long side along the recipe's long side.
    const turn = ((KNOWN[id]?.turn ?? 0) + ((have.x >= have.z) !== (size.x >= size.z) ? 90 : 0)) * Math.PI / 180;
    turned.rotation.y = turn;
    const box = new Box3().setFromObject(turned); have = box.getSize(new Vector3());
    const s = Math.min(size.x / have.x, size.z / have.z);
    const sy = Math.min(1.25 * s, Math.max(0.8 * s, size.y / have.y));
    const centre = box.getCenter(new Vector3());
    turned.position.set(-centre.x, -box.min.y, -centre.z);
    const fitted = new Group(); fitted.add(turned); fitted.name = `library:${id}`;
    fitted.scale.set(s, sy, s);
    fitted.position.set(mid.x, want.min.y, mid.z);
    return fitted;
  }, [root, id, want, ghost]);
  return object ? <primitive object={object} dispose={null} /> : null;
}
