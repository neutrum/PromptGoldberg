import { useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { scatterLandscape, type Landscape, type LandscapeFeature, type Prop } from '@og/machine';
import { useMachine } from './machineStore';
import { useSettings, type Theme } from './settings';

/** The world of the machine on screen, if it has one and the player shows machine worlds. */
export function useWorld(): { theme: Theme; landscape: Landscape | null } {
  const theme = useSettings((s) => s.theme);
  const landscape = useMachine((s) => (s.fix ? s.fix.puzzle.spec.landscape : s.run?.spec.landscape ?? s.machine?.landscape)) ?? null;
  return useMemo(() => {
    if (!landscape || !theme.landscapes) return { theme, landscape: null };
    const shade = (hex: string, k: number) => `#${new THREE.Color(hex).multiplyScalar(k).getHexString()}`;
    return {
      landscape,
      theme: { ...theme, sky: landscape.sky, board: landscape.ground, raised: landscape.rock, dug: shade(landscape.ground, 0.65), water: landscape.water,
        plinth: shade(landscape.rock, 0.85), foliage: landscape.foliage, grid: shade(landscape.ground, 0.85) },
    };
  }, [landscape, theme]);
}

type Tone = 'foliage' | 'light' | 'trunk' | 'bark' | 'birch' | 'rock' | 'accent' | 'water' | 'snow' | 'land' | 'stem';
interface Piece { geo: THREE.BufferGeometry; tone: Tone; y: number; dx?: number; sy?: number; snowOnly?: boolean; flat?: boolean }

const G = {
  trunk: new THREE.CylinderGeometry(0.05, 0.07, 0.4, 6), cone1: new THREE.ConeGeometry(0.36, 0.7, 7), cone2: new THREE.ConeGeometry(0.26, 0.55, 7), cap: new THREE.ConeGeometry(0.13, 0.26, 7),
  thick: new THREE.CylinderGeometry(0.06, 0.08, 0.6, 6), crown: new THREE.IcosahedronGeometry(0.42, 0), crown2: new THREE.IcosahedronGeometry(0.3, 0),
  thin: new THREE.CylinderGeometry(0.035, 0.045, 0.9, 6), palm: new THREE.CylinderGeometry(0.04, 0.07, 1.2, 6), fronds: new THREE.ConeGeometry(0.62, 0.14, 7), nut: new THREE.SphereGeometry(0.07, 6, 4),
  cactus: new THREE.CylinderGeometry(0.09, 0.1, 0.7, 8), arm: new THREE.CylinderGeometry(0.05, 0.05, 0.3, 6), bush: new THREE.IcosahedronGeometry(0.22, 0),
  bloom: new THREE.SphereGeometry(0.05, 6, 4), stalk: new THREE.CylinderGeometry(0.025, 0.03, 0.12, 5), hood: new THREE.SphereGeometry(0.08, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2),
  reed: new THREE.CylinderGeometry(0.012, 0.012, 0.45, 4), rock: new THREE.DodecahedronGeometry(0.16, 0), boulder: new THREE.DodecahedronGeometry(0.45, 0),
  hill: new THREE.SphereGeometry(1, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), peak: new THREE.ConeGeometry(2.2, 4, 7), peakCap: new THREE.ConeGeometry(0.75, 1.36, 7),
  lake: new THREE.CircleGeometry(1, 28).rotateX(-Math.PI / 2), drift: new THREE.SphereGeometry(0.4, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2),
};

const PIECES: Record<LandscapeFeature, Piece[]> = {
  conifers: [{ geo: G.trunk, tone: 'trunk', y: 0.2 }, { geo: G.cone1, tone: 'foliage', y: 0.65 }, { geo: G.cone2, tone: 'light', y: 1.0 }, { geo: G.cap, tone: 'snow', y: 1.17, snowOnly: true }],
  broadleaf: [{ geo: G.thick, tone: 'trunk', y: 0.3 }, { geo: G.crown, tone: 'foliage', y: 0.85 }, { geo: G.crown2, tone: 'light', y: 0.78, dx: 0.22 }],
  birches: [{ geo: G.thin, tone: 'birch', y: 0.45 }, { geo: G.crown2, tone: 'light', y: 1.0 }],
  palms: [{ geo: G.palm, tone: 'bark', y: 0.6 }, { geo: G.fronds, tone: 'foliage', y: 1.22 }, { geo: G.nut, tone: 'trunk', y: 1.12 }],
  cacti: [{ geo: G.cactus, tone: 'foliage', y: 0.35 }, { geo: G.arm, tone: 'foliage', y: 0.42, dx: 0.14 }],
  bushes: [{ geo: G.bush, tone: 'foliage', y: 0.12 }],
  flowers: [{ geo: G.bloom, tone: 'accent', y: 0.06 }],
  mushrooms: [{ geo: G.stalk, tone: 'stem', y: 0.06 }, { geo: G.hood, tone: 'accent', y: 0.12 }],
  reeds: [{ geo: G.reed, tone: 'light', y: 0.22 }, { geo: G.reed, tone: 'foliage', y: 0.2, dx: 0.06 }],
  rocks: [{ geo: G.rock, tone: 'rock', y: 0.05 }],
  boulders: [{ geo: G.boulder, tone: 'rock', y: 0.18 }],
  hills: [{ geo: G.hill, tone: 'land', y: 0, sy: 0.4 }],
  mountains: [{ geo: G.peak, tone: 'rock', y: 2 }, { geo: G.peakCap, tone: 'snow', y: 3.32, snowOnly: true }],
  lake: [{ geo: G.lake, tone: 'water', y: 0.012, flat: true }],
  snowdrifts: [{ geo: G.drift, tone: 'snow', y: 0, sy: 0.35 }],
};

function toneColor(l: Landscape, tone: Tone): string {
  const mix = (a: string, b: string, k: number) => `#${new THREE.Color(a).lerp(new THREE.Color(b), k).getHexString()}`;
  switch (tone) {
    case 'foliage': return l.foliage;
    case 'light': return mix(l.foliage, '#d8e8a0', 0.25);
    case 'trunk': return '#5c3d24';
    case 'bark': return '#9b7a4f';
    case 'birch': return '#ece6d8';
    case 'rock': return l.rock;
    case 'accent': return l.accent;
    case 'water': return l.water;
    case 'snow': return '#f4f7fa';
    case 'land': return mix(l.land, l.foliage, 0.2);
    case 'stem': return '#efe4cc';
  }
}

/** One instanced mesh: every prop of a kind gets this piece. */
function PieceInstances({ piece, props, color, y0 }: { piece: Piece; props: Prop[]; color: string; y0: number }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
    props.forEach((p, i) => {
      q.setFromAxisAngle(up, p.turn);
      const off = new THREE.Vector3(piece.dx ?? 0, 0, 0).applyQuaternion(q).multiplyScalar(p.scale);
      m.compose(new THREE.Vector3(p.x + off.x, y0 + piece.y * p.scale * (piece.sy ?? 1), p.z + off.z), q, new THREE.Vector3(p.scale, p.scale * (piece.sy ?? 1), p.scale));
      mesh.setMatrixAt(i, m);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [props, piece, y0]);
  return (
    <instancedMesh ref={ref} args={[piece.geo, undefined, props.length]} castShadow={!piece.flat} receiveShadow>
      {piece.tone === 'water'
        ? <meshStandardMaterial color={color} roughness={0.2} transparent opacity={0.85} />
        : <meshStandardMaterial color={color} roughness={0.9} flatShading />}
    </instancedMesh>
  );
}

/** The world around a board of W by D metres whose surrounding land is at height y. */
export function Landscape3D({ landscape, w, d, y }: { landscape: Landscape; w: number; d: number; y: number }) {
  const props = useMemo(() => scatterLandscape(landscape, w, d), [landscape, w, d]);
  const byKind = useMemo(() => {
    const out = new Map<LandscapeFeature, Prop[]>();
    for (const p of props) out.set(p.kind, [...(out.get(p.kind) ?? []), p]);
    return out;
  }, [props]);
  return (
    <>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[w / 2, y - 0.01, d / 2]} receiveShadow>
        <planeGeometry args={[w + 48, d + 48]} />
        <meshStandardMaterial color={landscape.land} roughness={1} />
      </mesh>
      {[...byKind].flatMap(([kind, list]) => PIECES[kind]
        .filter((piece) => !piece.snowOnly || landscape.snow)
        .map((piece, i) => <PieceInstances key={`${kind}-${i}-${list.length}`} piece={piece} props={list} color={toneColor(landscape, piece.tone)} y0={y} />))}
    </>
  );
}
