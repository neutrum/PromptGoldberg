/** Offline, one-frame thumbnails of the exact models/alignments used by the workshop. Open through Vite. */
import * as T from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { assemblePart, type PartKind, type Vec3 } from '@og/machine';
import { kitUrl, kitVisual } from '../apps/web/src/machine/kitVisuals';

const renderer = new T.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'low-power', preserveDrawingBuffer: true });
renderer.setSize(256, 192); renderer.setPixelRatio(1); renderer.setClearColor(0, 0);
document.body.append(renderer.domElement);
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const cache = new Map<string, T.Group>();
async function model(asset: string, size: Vec3, rotation: Vec3 = [0, 0, 0]) {
  if (!cache.has(asset)) cache.set(asset, (await loader.loadAsync(kitUrl(asset))).scene);
  const oriented = new T.Group(); oriented.add(cache.get(asset)!.clone(true)); oriented.rotation.set(...rotation);
  const box = new T.Box3().setFromObject(oriented), extent = box.getSize(new T.Vector3());
  oriented.position.sub(box.getCenter(new T.Vector3()));
  const wrapper = new T.Group(); wrapper.add(oriented); wrapper.scale.set(size[0] / extent.x, size[1] / extent.y, size[2] / extent.z);
  return wrapper;
}
const thumbnails: Record<string, string> = {};
for (const kind of ['ball', 'ramp', 'platform', 'wall', 'dominoes', 'seesaw', 'fan', 'trampoline', 'cannon', 'bucket', 'bell'] as PartKind[]) {
  const scene = new T.Scene(), group = new T.Group(); scene.add(group);
  for (const body of assemblePart({ id: kind, kind, x: 0, y: 0, z: 0, yaw: 0, ...(kind === 'dominoes' ? { length: 3 } : {}) }).bodies) {
    const visual = kitVisual(body); if (!visual || visual.hidden) continue;
    const mesh = await model(visual.asset, visual.size, visual.rotation);
    const at = new T.Group(); at.position.set(...body.position); at.quaternion.set(...body.rotation); group.add(at);
    if (visual.offset) mesh.position.set(...visual.offset); at.add(mesh);
  }
  if (kind === 'fan') { const rotor = await model('fan-propeller', [0.035, 0.34, 0.34]); rotor.position.set(0.382, 0.2, 0.25); group.add(rotor); }
  const box = new T.Box3().setFromObject(group), extent = box.getSize(new T.Vector3()); group.position.sub(box.getCenter(new T.Vector3()));
  group.scale.setScalar(1.55 / Math.max(extent.x, extent.y, extent.z));
  scene.add(new T.HemisphereLight('#fff1da', '#637b85', 2.4));
  const light = new T.DirectionalLight('#fff2de', 3); light.position.set(2, 4, 3); scene.add(light);
  const camera = new T.OrthographicCamera(-1.25, 1.25, .94, -.94, .01, 20); camera.position.set(2.6, 1.8, 3); camera.lookAt(0, 0, 0);
  renderer.render(scene, camera); thumbnails[kind] = renderer.domElement.toDataURL('image/webp', .9);
}
Object.assign(window, { kitThumbnails: thumbnails });
renderer.dispose();
