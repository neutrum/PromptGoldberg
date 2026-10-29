import { useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { scatterLandscape, TABLE_MARGIN, type Landscape, type LandscapeFeature, type Prop } from '@og/machine';
import { useMachine } from './machineStore';
import { useSettings, type Theme } from './settings';

/** Set while the world on screen has moving things, so the scene keeps rendering at its capped rate. */
export const worldMotion = { active: false };
const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** The world of the machine on screen, if it has one and the player shows machine worlds. */
export function useWorld(): { theme: Theme; landscape: Landscape | null } {
  const theme = useSettings((s) => s.theme);
  // While a new level is made, its world shows at once and the board waits for its parts.
  const landscape = useMachine((s) => (s.ai.busy && s.ai.creating ? s.ai.world : s.fix ? s.fix.puzzle.spec.landscape : s.run?.spec.landscape ?? s.machine?.landscape)) ?? null;
  return useMemo(() => {
    if (!landscape || !theme.landscapes) return { theme, landscape: null };
    return {
      landscape,
      theme: { ...theme, sky: landscape.sky, board: landscape.ground, raised: landscape.rock, dug: shade(landscape.ground, 0.65), water: landscape.water,
        plinth: shade(landscape.rock, 0.85), foliage: landscape.foliage, grid: shade(landscape.ground, 0.85) },
    };
  }, [landscape, theme]);
}

const shade = (hex: string, k: number) => `#${new THREE.Color(hex).multiplyScalar(k).getHexString()}`;
const mix = (a: string, b: string, k: number) => `#${new THREE.Color(a).lerp(new THREE.Color(b), k).getHexString()}`;

type Tone = 'foliage' | 'light' | 'trunk' | 'bark' | 'birch' | 'rock' | 'stone' | 'accent' | 'accent2' | 'glow' | 'water' | 'snow' | 'land' | 'stem'
  | 'steel' | 'dark' | 'yellow' | 'pink' | 'wood' | 'white' | 'ice' | 'plaster';
type Motion = 'spin' | 'bob' | 'float';
interface Piece { geo: THREE.BufferGeometry; tone: Tone; y: number; dx?: number; sy?: number; snowOnly?: boolean; flat?: boolean; motion?: Motion }

const side = (g: THREE.BufferGeometry) => g.rotateZ(Math.PI / 2);
const G = {
  trunk: new THREE.CylinderGeometry(0.05, 0.07, 0.4, 6), cone1: new THREE.ConeGeometry(0.36, 0.7, 7), cone2: new THREE.ConeGeometry(0.26, 0.55, 7), cap: new THREE.ConeGeometry(0.13, 0.26, 7),
  thick: new THREE.CylinderGeometry(0.06, 0.08, 0.6, 6), crown: new THREE.IcosahedronGeometry(0.42, 0), crown2: new THREE.IcosahedronGeometry(0.3, 0),
  thin: new THREE.CylinderGeometry(0.035, 0.045, 0.9, 6), palm: new THREE.CylinderGeometry(0.04, 0.07, 1.2, 6), fronds: new THREE.ConeGeometry(0.62, 0.14, 7), nut: new THREE.SphereGeometry(0.07, 6, 4),
  cactus: new THREE.CylinderGeometry(0.09, 0.1, 0.7, 8), arm: new THREE.CylinderGeometry(0.05, 0.05, 0.3, 6), bush: new THREE.IcosahedronGeometry(0.22, 0),
  bloom: new THREE.SphereGeometry(0.05, 6, 4), stalk: new THREE.CylinderGeometry(0.025, 0.03, 0.12, 5), hood: new THREE.SphereGeometry(0.08, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2),
  reed: new THREE.CylinderGeometry(0.012, 0.012, 0.45, 4), rock: new THREE.DodecahedronGeometry(0.16, 0), boulder: new THREE.DodecahedronGeometry(0.45, 0),
  hill: new THREE.SphereGeometry(1, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), peak: new THREE.ConeGeometry(2.2, 4, 7), peakCap: new THREE.ConeGeometry(0.75, 1.36, 7),
  lake: new THREE.CircleGeometry(1, 28).rotateX(-Math.PI / 2), drift: new THREE.SphereGeometry(0.4, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2),
  // Fantasy and built things
  gem: new THREE.OctahedronGeometry(0.18, 0), gem2: new THREE.OctahedronGeometry(0.1, 0),
  shaft: new THREE.CylinderGeometry(0.14, 0.15, 1.4, 12), slab: new THREE.BoxGeometry(0.42, 0.1, 0.42),
  plinth: new THREE.BoxGeometry(0.4, 0.25, 0.4), figure: new THREE.CylinderGeometry(0.1, 0.14, 0.6, 10), head: new THREE.SphereGeometry(0.1, 10, 8),
  walls: new THREE.BoxGeometry(0.6, 0.45, 0.5), roof: new THREE.ConeGeometry(0.5, 0.35, 4).rotateY(Math.PI / 4),
  post: new THREE.CylinderGeometry(0.02, 0.02, 0.9, 5), lantern: new THREE.BoxGeometry(0.1, 0.13, 0.1),
  stick: new THREE.CylinderGeometry(0.015, 0.015, 0.6, 5), disc: new THREE.CylinderGeometry(0.18, 0.18, 0.05, 20).rotateX(Math.PI / 2), swirl: new THREE.CylinderGeometry(0.1, 0.1, 0.056, 16).rotateX(Math.PI / 2),
  branch: new THREE.ConeGeometry(0.08, 0.5, 6), branch2: new THREE.ConeGeometry(0.06, 0.35, 6),
  gear: new THREE.CylinderGeometry(0.4, 0.4, 0.08, 10), teeth: new THREE.CylinderGeometry(0.46, 0.46, 0.05, 10).rotateY(Math.PI / 10), hub: new THREE.CylinderGeometry(0.1, 0.1, 0.14, 8),
  spike: new THREE.ConeGeometry(0.12, 0.9, 5), spike2: new THREE.ConeGeometry(0.07, 0.5, 5),
  rim: new THREE.TorusGeometry(0.5, 0.08, 6, 20).rotateX(Math.PI / 2), pit: new THREE.CircleGeometry(0.48, 20).rotateX(-Math.PI / 2),
  // Giant everyday things (unit sizes; the scatter scales them 2 to 4.5 times)
  handle: side(new THREE.CylinderGeometry(0.035, 0.035, 0.8, 8)), hammerHead: new THREE.BoxGeometry(0.14, 0.14, 0.36),
  bar: new THREE.BoxGeometry(0.8, 0.04, 0.1), jaw: new THREE.CylinderGeometry(0.11, 0.11, 0.04, 6), ring: new THREE.CylinderGeometry(0.09, 0.09, 0.04, 12),
  pencil: side(new THREE.CylinderGeometry(0.04, 0.04, 0.9, 6)), tip: new THREE.ConeGeometry(0.04, 0.14, 6).rotateZ(-Math.PI / 2), eraser: side(new THREE.CylinderGeometry(0.04, 0.04, 0.08, 6)),
  screw: side(new THREE.CylinderGeometry(0.025, 0.025, 0.5, 6)), screwHead: side(new THREE.CylinderGeometry(0.06, 0.06, 0.03, 10)), hexNut: new THREE.CylinderGeometry(0.12, 0.12, 0.08, 6),
  mug: new THREE.CylinderGeometry(0.12, 0.11, 0.28, 16), mugHandle: new THREE.TorusGeometry(0.07, 0.018, 6, 12),
  book: new THREE.BoxGeometry(0.3, 0.06, 0.22), book2: new THREE.BoxGeometry(0.28, 0.05, 0.2),
  lampBase: new THREE.CylinderGeometry(0.15, 0.17, 0.04, 16), lampArm: new THREE.BoxGeometry(0.03, 0.6, 0.03), lampArm2: new THREE.BoxGeometry(0.4, 0.03, 0.03),
  shade: new THREE.ConeGeometry(0.12, 0.18, 16, 1, true), bulb: new THREE.SphereGeometry(0.04, 8, 6),
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
  crystals: [{ geo: G.gem, tone: 'glow', y: 0.45, sy: 2.2, motion: 'float' }, { geo: G.gem2, tone: 'accent2', y: 0.22, dx: 0.16, sy: 1.8, motion: 'float' }],
  columns: [{ geo: G.slab, tone: 'stone', y: 0.05 }, { geo: G.shaft, tone: 'stone', y: 0.8 }, { geo: G.slab, tone: 'stone', y: 1.55 }],
  statues: [{ geo: G.plinth, tone: 'stone', y: 0.125 }, { geo: G.figure, tone: 'stone', y: 0.55 }, { geo: G.head, tone: 'stone', y: 0.95 }],
  houses: [{ geo: G.walls, tone: 'plaster', y: 0.225 }, { geo: G.roof, tone: 'accent', y: 0.62 }],
  lanterns: [{ geo: G.post, tone: 'dark', y: 0.45 }, { geo: G.lantern, tone: 'glow', y: 0.95, motion: 'bob' }],
  candy: [{ geo: G.stick, tone: 'white', y: 0.3 }, { geo: G.disc, tone: 'accent', y: 0.75, motion: 'spin' }, { geo: G.swirl, tone: 'white', y: 0.75, motion: 'spin' }],
  coral: [{ geo: G.branch, tone: 'accent', y: 0.25 }, { geo: G.branch2, tone: 'accent2', y: 0.17, dx: 0.1 }, { geo: G.bloom, tone: 'accent', y: 0.52 }],
  cogs: [{ geo: G.teeth, tone: 'steel', y: 0.03, motion: 'spin' }, { geo: G.gear, tone: 'steel', y: 0.05, motion: 'spin' }, { geo: G.hub, tone: 'dark', y: 0.07 }],
  ice_spikes: [{ geo: G.spike, tone: 'ice', y: 0.45 }, { geo: G.spike2, tone: 'ice', y: 0.25, dx: 0.13 }],
  craters: [{ geo: G.rim, tone: 'rock', y: 0.02 }, { geo: G.pit, tone: 'dark', y: 0.006, flat: true }],
  tools: [{ geo: G.handle, tone: 'wood', y: 0.035, dx: -0.08 }, { geo: G.hammerHead, tone: 'steel', y: 0.07, dx: 0.38 }],
  wrenches: [{ geo: G.bar, tone: 'steel', y: 0.02 }, { geo: G.jaw, tone: 'steel', y: 0.02, dx: 0.42 }, { geo: G.ring, tone: 'steel', y: 0.02, dx: -0.42 }],
  pencils: [{ geo: G.pencil, tone: 'yellow', y: 0.04 }, { geo: G.tip, tone: 'wood', y: 0.04, dx: 0.52 }, { geo: G.eraser, tone: 'pink', y: 0.04, dx: -0.49 }],
  screws: [{ geo: G.screw, tone: 'steel', y: 0.025, dx: 0.05 }, { geo: G.screwHead, tone: 'steel', y: 0.06, dx: -0.22 }],
  nuts: [{ geo: G.hexNut, tone: 'steel', y: 0.04 }],
  mugs: [{ geo: G.mug, tone: 'accent', y: 0.14 }, { geo: G.mugHandle, tone: 'accent', y: 0.15, dx: 0.13 }],
  books: [{ geo: G.book, tone: 'accent', y: 0.03 }, { geo: G.book2, tone: 'accent2', y: 0.085 }],
  lamp: [{ geo: G.lampBase, tone: 'dark', y: 0.02 }, { geo: G.lampArm, tone: 'dark', y: 0.32 }, { geo: G.lampArm2, tone: 'dark', y: 0.62, dx: 0.18 },
    { geo: G.shade, tone: 'accent', y: 0.55, dx: 0.38 }, { geo: G.bulb, tone: 'glow', y: 0.5, dx: 0.38 }],
  pegboard: [],
};

function toneColor(l: Landscape, tone: Tone): string {
  switch (tone) {
    case 'foliage': return l.foliage;
    case 'light': return mix(l.foliage, '#d8e8a0', 0.25);
    case 'trunk': return '#5c3d24';
    case 'bark': return '#9b7a4f';
    case 'birch': return '#ece6d8';
    case 'rock': return l.rock;
    case 'stone': return mix(l.rock, '#f2ead8', 0.55);
    case 'accent': case 'glow': return l.accent;
    case 'accent2': return mix(l.accent, '#ffffff', 0.35);
    case 'water': return l.water;
    case 'snow': return '#f4f7fa';
    case 'land': return mix(l.land, l.foliage, 0.2);
    case 'stem': return '#efe4cc';
    case 'steel': return '#a4acb5';
    case 'dark': return '#33363b';
    case 'yellow': return '#f2c230';
    case 'pink': return '#f08fa0';
    case 'wood': return '#c89b64';
    case 'white': return '#fbf7f2';
    case 'ice': return '#cfe8f5';
    case 'plaster': return '#efe4cc';
  }
}

/** One instanced mesh: every prop of a kind gets this piece; moving pieces spin, bob or float. */
function PieceInstances({ piece, props, color, y0 }: { piece: Piece; props: Prop[]; color: string; y0: number }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const place = useMemo(() => {
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), at = new THREE.Vector3(), size = new THREE.Vector3(), off = new THREE.Vector3();
    return (mesh: THREE.InstancedMesh, t: number) => {
      props.forEach((p, i) => {
        const phase = p.turn * 3;
        const spin = piece.motion === 'spin' ? t * 0.8 : piece.motion === 'float' ? t * 0.4 : 0;
        const lift = piece.motion === 'float' ? (Math.sin(t * 1.3 + phase) * 0.5 + 0.6) * 0.18 : piece.motion === 'bob' ? Math.sin(t * 1.8 + phase) * 0.03 : 0;
        q.setFromAxisAngle(up, p.turn + spin);
        off.set(piece.dx ?? 0, 0, 0).applyAxisAngle(up, p.turn).multiplyScalar(p.scale);
        at.set(p.x + off.x, y0 + (piece.y * (piece.sy ?? 1) + lift) * p.scale, p.z + off.z);
        m.compose(at, q, size.set(p.scale, p.scale * (piece.sy ?? 1), p.scale));
        mesh.setMatrixAt(i, m);
      });
      mesh.instanceMatrix.needsUpdate = true;
    };
  }, [props, piece, y0]);
  useLayoutEffect(() => { if (ref.current) { place(ref.current, 0); ref.current.computeBoundingSphere(); } }, [place]);
  useFrame(({ clock }) => { if (piece.motion && worldMotion.active && ref.current) place(ref.current, clock.elapsedTime); });
  return (
    <instancedMesh ref={ref} args={[piece.geo, undefined, props.length]} castShadow={!piece.flat} receiveShadow frustumCulled={!piece.motion}>
      {piece.tone === 'water'
        ? <meshStandardMaterial color={color} roughness={0.2} transparent opacity={0.85} />
        : <meshStandardMaterial color={color} roughness={piece.tone === 'steel' ? 0.35 : 0.85} metalness={piece.tone === 'steel' ? 0.6 : 0} flatShading
            emissive={piece.tone === 'glow' ? color : '#000000'} emissiveIntensity={piece.tone === 'glow' ? 0.9 : 0} side={piece.geo === G.shade ? THREE.DoubleSide : THREE.FrontSide} />}
    </instancedMesh>
  );
}

/** A huge table under the board, its legs down to a workshop floor far below. */
function Table({ w, d, y, top, floor }: { w: number; d: number; y: number; top: string; floor: string }) {
  const W = w + TABLE_MARGIN * 2, D = d + TABLE_MARGIN * 2, legs = 9;
  return (
    <>
      <mesh position={[w / 2, y - 0.35, d / 2]} receiveShadow castShadow>
        <boxGeometry args={[W, 0.7, D]} />
        <meshStandardMaterial color={top} roughness={0.75} />
      </mesh>
      {[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sz]) => (
        <mesh key={`${sx}${sz}`} position={[w / 2 + sx * (W / 2 - 1), y - 0.7 - legs / 2, d / 2 + sz * (D / 2 - 1)]}>
          <boxGeometry args={[0.9, legs, 0.9]} />
          <meshStandardMaterial color={shade(top, 0.7)} roughness={0.8} />
        </mesh>
      ))}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[w / 2, y - 0.7 - legs, d / 2]} receiveShadow>
        <planeGeometry args={[W + 80, D + 80]} />
        <meshStandardMaterial color={floor} roughness={1} />
      </mesh>
    </>
  );
}

/** The workshop wall behind the board: a pegboard with giant tools hanging on it. */
function Pegboard({ p, w, y, accent }: { p: Prop; w: number; y: number; accent: string }) {
  const width = w + 12, height = 7;
  return (
    <group position={[p.x, y, p.z]}>
      <mesh position={[0, height / 2, 0]} receiveShadow>
        <boxGeometry args={[width, height, 0.2]} />
        <meshStandardMaterial color="#c8a36b" roughness={0.9} />
      </mesh>
      {[-0.32, -0.12, 0.1, 0.3].map((k, i) => (
        <group key={k} position={[k * width, height * 0.6, 0.22]} rotation={[0, 0, i % 2 ? 0.2 : -0.15]}>
          <mesh position={[0, -0.6, 0]}><boxGeometry args={[0.22, 2.2, 0.15]} /><meshStandardMaterial color={i % 2 ? '#a4acb5' : '#b5834a'} metalness={i % 2 ? 0.6 : 0} roughness={0.5} /></mesh>
          <mesh position={[0, 0.55, 0]}><boxGeometry args={[i % 2 ? 0.7 : 0.9, 0.35, 0.18]} /><meshStandardMaterial color={i % 2 ? '#a4acb5' : accent} metalness={i % 2 ? 0.6 : 0.2} roughness={0.5} /></mesh>
        </group>
      ))}
    </group>
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
  useLayoutEffect(() => {
    worldMotion.active = !reducedMotion() && [...byKind.keys()].some((k) => PIECES[k].some((piece) => piece.motion));
    return () => { worldMotion.active = false; };
  }, [byKind]);
  const table = landscape.setting === 'tabletop';
  const pegboard = byKind.get('pegboard')?.[0];
  return (
    <>
      {table
        ? <Table w={w} d={d} y={y} top={landscape.land} floor={landscape.rock} />
        : <mesh rotation={[-Math.PI / 2, 0, 0]} position={[w / 2, y - 0.01, d / 2]} receiveShadow>
            <planeGeometry args={[w + 48, d + 48]} />
            <meshStandardMaterial color={landscape.land} roughness={1} />
          </mesh>}
      {pegboard && <Pegboard p={pegboard} w={w} y={y} accent={landscape.accent} />}
      {[...byKind].flatMap(([kind, list]) => PIECES[kind]
        .filter((piece) => !piece.snowOnly || landscape.snow)
        .map((piece, i) => <PieceInstances key={`${kind}-${i}-${list.length}`} piece={piece} props={list} color={toneColor(landscape, piece.tone)} y0={y} />))}
    </>
  );
}
