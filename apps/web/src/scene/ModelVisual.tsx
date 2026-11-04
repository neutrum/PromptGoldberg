import { useEffect, useMemo, useState } from 'react';
import { Box3, Group, Mesh, MeshStandardMaterial, Vector3 } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import type { Vec3 } from '@pg/core';

const loaded = new Map<string, Promise<Group>>();
export function loadModel(url: string) {
  let promise = loaded.get(url);
  if (!promise) {
    promise = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(url).then(gltf => {
      const root = gltf.scene;
      root.traverse(object => { if (object instanceof Mesh) { object.castShadow = true; object.receiveShadow = true; } });
      return root;
    });
    loaded.set(url, promise);
    promise.catch(() => loaded.delete(url));
  }
  return promise;
}

export { shapeSize } from './kitVisuals';

const NO_ROTATION: Vec3 = [0, 0, 0];
/** Shared geometry/textures, independent transforms; loaded only for parts actually on screen. */
export function useModel(url: string | undefined, size: Vec3, rotation = NO_ROTATION, tint?: string, hidden = false) {
  const [state, setState] = useState<{ url: string; root?: Group; error?: string } | null>(null);
  useEffect(() => {
    let active = true;
    if (url) void loadModel(url).then(root => { if (active) setState({ url, root }); }, () => { if (active) setState({ url, error: 'This look could not be loaded. The original part is still available.' }); });
    return () => { active = false; };
  }, [url]);
  const object = useMemo(() => {
    if (!url || state?.url !== url || !state.root || hidden) return null;
    const root = state.root.clone(true);
    const oriented = new Group(); oriented.add(root); oriented.rotation.set(...rotation);
    const bounds = new Box3().setFromObject(oriented), extent = bounds.getSize(new Vector3()), center = bounds.getCenter(new Vector3());
    if (![extent.x, extent.y, extent.z].every(n => Number.isFinite(n) && n > 0.000001)) return null;
    if (tint) root.traverse(o => {
      if (!(o instanceof Mesh)) return;
      const colorize = (material: MeshStandardMaterial) => { const copy = material.clone(); copy.color.set(tint); return copy; };
      o.material = Array.isArray(o.material) ? o.material.map(colorize) : colorize(o.material);
    });
    const wrapper = new Group(); wrapper.name = url; wrapper.add(oriented);
    oriented.position.sub(center);
    wrapper.scale.set(size[0] / extent.x, size[1] / extent.y, size[2] / extent.z);
    return wrapper;
  }, [url, state, size[0], size[1], size[2], rotation[0], rotation[1], rotation[2], tint, hidden]);
  useEffect(() => () => {
    if (tint) object?.traverse(o => { if (o instanceof Mesh) for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.dispose(); });
  }, [object, tint]);
  return { object, ready: !!url && state?.url === url && !!state.root, error: state?.url === url ? state?.error : undefined };
}
