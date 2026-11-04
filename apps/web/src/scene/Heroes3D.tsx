import { useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { assemblePart, CELL, collides, HERO_SCALE, HEROES, isGadget, propCentre, type Hero, type Part } from '@pg/core';
import { Recipe } from './Recipe3D';
import { worldMotion } from './Landscape3D';
import { bodiesBox, LibraryModel, libraryLook, recipeBox, useLookReady } from './LibraryModel';

/**
 * The details of a board landmark above what the ball can reach: wings, horns, sails, roofs,
 * windmill blades. The solid body is drawn from its colliders by BodyMesh; these never collide.
 * Local axes: x along the part's facing, z across it, y up, origin at the footprint's middle.
 */
export const isHero = (p: Part): p is Part & { prop: Hero } => !!p.prop && (HEROES as readonly string[]).includes(p.prop);

const M = ({ color, glow = false, metal = false }: { color: string; glow?: boolean; metal?: boolean }) => (
  <meshStandardMaterial color={color} roughness={metal ? 0.35 : 0.8} metalness={metal ? 0.6 : 0} flatShading emissive={glow ? color : '#000000'} emissiveIntensity={glow ? 1.2 : 0} />
);

function Dragon({ color }: { color: string }) {
  const dark = `#${new THREE.Color(color).multiplyScalar(0.6).getHexString()}`;
  return (
    <>
      {[1, -1].map((side) => (
        <mesh key={side} position={[-0.1, 0.78, side * 0.62]} rotation={[side * -0.45, 0, 0]} castShadow>
          <boxGeometry args={[0.95, 0.04, 0.75]} /><M color={dark} />
        </mesh>
      ))}
      {[-0.55, -0.25, 0.05, 0.35].map((x) => <mesh key={x} position={[x, 0.62, 0]} castShadow><coneGeometry args={[0.09, 0.22, 4]} /><M color={dark} /></mesh>)}
      {[1, -1].map((side) => <mesh key={`h${side}`} position={[1.28, 0.78, side * 0.11]} rotation={[0, 0, -0.5]} castShadow><coneGeometry args={[0.05, 0.24, 5]} /><M color="#efe4cc" /></mesh>)}
      {[1, -1].map((side) => <mesh key={`e${side}`} position={[1.44, 0.58, side * 0.12]}><sphereGeometry args={[0.04, 8, 6]} /><M color="#ffd44a" glow /></mesh>)}
      <mesh position={[-1.72, 0.12, 0]} rotation={[0, 0, Math.PI / 2]} castShadow><coneGeometry args={[0.13, 0.3, 4]} /><M color={dark} /></mesh>
    </>
  );
}

function Castle({ roof }: { roof: string }) {
  return (
    <>
      {[[0.75, 0.75], [0.75, -0.75], [-0.75, 0.75], [-0.75, -0.75]].map(([x, z]) => (
        <mesh key={`${x}${z}`} position={[x, 1.4, z]} castShadow><coneGeometry args={[0.32, 0.5, 8]} /><M color={roof} /></mesh>
      ))}
      {[-0.5, -0.17, 0.17, 0.5].flatMap((k) => [[k, 0.68], [k, -0.68], [0.68, k], [-0.68, k]]).map(([x, z], i) => (
        <mesh key={i} position={[x, 0.78, z]} castShadow><boxGeometry args={[0.14, 0.16, 0.14]} /><M color="#a89d8a" /></mesh>
      ))}
      <mesh position={[0.76, 0.22, 0]}><boxGeometry args={[0.04, 0.42, 0.34]} /><M color="#3a2c22" /></mesh>
      <mesh position={[0, 1.15, 0]}><boxGeometry args={[0.02, 0.5, 0.02]} /><M color="#3a3a3a" /></mesh>
      <mesh position={[0, 1.33, 0.14]}><boxGeometry args={[0.02, 0.16, 0.26]} /><M color={roof} /></mesh>
    </>
  );
}

function Ship() {
  return (
    <>
      <mesh position={[0.1, 1.25, 0]} castShadow><boxGeometry args={[0.05, 0.85, 0.75]} /><M color="#f3ead8" /></mesh>
      <mesh position={[0.1, 1.98, 0.12]}><boxGeometry args={[0.02, 0.14, 0.24]} /><M color="#1f1f1f" /></mesh>
      <mesh position={[-0.82, 0.55, 0]} castShadow><boxGeometry args={[0.5, 0.26, 0.6]} /><M color="#5c3d24" /></mesh>
      <mesh position={[1.25, 0.28, 0]} rotation={[0, 0, -Math.PI / 2]} castShadow><coneGeometry args={[0.39, 0.4, 4]} /><M color="#6b4026" /></mesh>
    </>
  );
}

function Robot() {
  return (
    <>
      <mesh position={[0, 1.33, 0]} castShadow><boxGeometry args={[0.36, 0.3, 0.38]} /><M color="#b8bec4" metal /></mesh>
      {[1, -1].map((side) => <mesh key={side} position={[0.19, 1.36, side * 0.09]}><sphereGeometry args={[0.04, 8, 6]} /><M color="#5ad1e6" glow /></mesh>)}
      {[1, -1].map((side) => <mesh key={`a${side}`} position={[0, 0.85, side * 0.5]} castShadow><boxGeometry args={[0.14, 0.5, 0.14]} /><M color="#9aa3ad" metal /></mesh>)}
      <mesh position={[0, 1.58, 0]}><cylinderGeometry args={[0.012, 0.012, 0.2, 4]} /><M color="#33363b" /></mesh>
      <mesh position={[0, 1.7, 0]}><sphereGeometry args={[0.035, 8, 6]} /><M color="#ff5d5d" glow /></mesh>
    </>
  );
}

function Rocket() {
  return (
    <>
      <mesh position={[0, 1.95, 0]} castShadow><coneGeometry args={[0.34, 0.5, 16]} /><M color="#d9452b" /></mesh>
      <mesh position={[0.33, 1.2, 0]} rotation={[0, 0, Math.PI / 2]}><cylinderGeometry args={[0.1, 0.1, 0.03, 16]} /><M color="#5ad1e6" glow /></mesh>
    </>
  );
}

function Windmill() {
  const blades = useRef<THREE.Group>(null);
  useFrame((_, delta) => { if (blades.current && worldMotion.active) blades.current.rotation.x += Math.min(delta, 0.05) * 0.9; });
  return (
    <>
      <mesh position={[0, 1.68, 0]} castShadow><coneGeometry args={[0.46, 0.42, 8]} /><M color="#9b4a2b" /></mesh>
      <group ref={blades} position={[0.42, 1.5, 0]}>
        {[0, 1, 2, 3].map((k) => (
          <mesh key={k} rotation={[(k * Math.PI) / 2, 0, 0]} position={[0, 0, 0]}>
            <boxGeometry args={[0.03, 0.08, 1.15]} /><M color="#efe4cc" />
          </mesh>
        ))}
        {[0, 1, 2, 3].map((k) => (
          <mesh key={`s${k}`} rotation={[(k * Math.PI) / 2, 0, 0]}>
            <boxGeometry args={[0.02, 0.22, 0.5]} /><meshStandardMaterial color="#d8c8a8" side={THREE.DoubleSide} />
          </mesh>
        ))}
      </group>
    </>
  );
}

function Teapot({ color }: { color: string }) {
  return (
    <>
      <mesh position={[0, 1.1, 0]} castShadow><sphereGeometry args={[0.36, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2]} /><M color={color} /></mesh>
      <mesh position={[0, 1.48, 0]}><sphereGeometry args={[0.07, 10, 8]} /><M color="#efe4cc" /></mesh>
      <mesh position={[0.72, 0.82, 0]} rotation={[0, 0, -0.8]} castShadow><cylinderGeometry args={[0.05, 0.09, 0.6, 10]} /><M color={color} /></mesh>
      <mesh position={[-0.66, 0.62, 0]} castShadow><torusGeometry args={[0.26, 0.06, 8, 16]} /><M color={color} /></mesh>
    </>
  );
}

/** A composed landmark's drawn-only shapes (tops, tilted and lit parts), on its footprint and turned with it; its solids are drawn from their colliders. */
export function LandmarkDecor({ part, ghost }: { part: Part; ghost?: string }) {
  const ref = useRef<THREE.Group>(null);
  useLayoutEffect(() => {
    if (!ref.current) return;
    const [x, y, z] = propCentre(part);
    ref.current.position.set(x, y, z);
    ref.current.rotation.set(0, (-part.yaw * Math.PI) / 180, 0);
  }, [part]);
  const look = libraryLook(part), ready = useLookReady(look);
  const box = useMemo(() => recipeBox(part.build ?? []), [part.build]);
  // A library thing with a made model draws the model; the recipe's details only until it has loaded.
  return <group ref={ref}>{look && <LibraryModel id={look} box={box} ghost={ghost} />}{!ready && !ghost && <Recipe shapes={part.build ?? []} unit={[CELL, CELL, CELL]} only={(sh) => !collides(sh, isGadget(part))} />}</group>;
}

/** A world's centrepiece: its model in the space its colliders take, or its own shapes until the model has loaded. */
export function HeroDecor({ part, ghost }: { part: Part & { prop: Hero }; ghost?: string }) {
  const look = libraryLook(part), ready = useLookReady(look);
  const box = useMemo(() => bodiesBox(assemblePart(part).bodies), [part]);
  return <>{look && <LibraryModel id={look} box={box} ghost={ghost} />}{!ready && !ghost && <HeroShapes part={part} />}</>;
}

/** A landmark's details, set on its footprint and turned with it. */
function HeroShapes({ part }: { part: Part & { prop: Hero } }) {
  const ref = useRef<THREE.Group>(null);
  useLayoutEffect(() => {
    if (!ref.current) return;
    const [x, y, z] = propCentre(part);
    ref.current.position.set(x, y, z);
    // Yaw 0 faces +x, 90 faces +z: a turn about y by minus the yaw.
    ref.current.rotation.set(0, (-part.yaw * Math.PI) / 180, 0);
    ref.current.scale.setScalar(HERO_SCALE);
  }, [part]);
  const color = part.color ?? '#3f7a4a';
  return (
    <group ref={ref}>
      {part.prop === 'dragon' ? <Dragon color={color} />
        : part.prop === 'castle' ? <Castle roof={part.color ? color : '#b5402b'} />
        : part.prop === 'ship' ? <Ship />
        : part.prop === 'robot' ? <Robot />
        : part.prop === 'rocket' ? <Rocket />
        : part.prop === 'windmill' ? <Windmill />
        : <Teapot color={part.color ?? '#5b8fd6'} />}
    </group>
  );
}
