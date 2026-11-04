import { useLayoutEffect, useMemo } from 'react';
import * as THREE from 'three';
import type { ShapeKind } from '@pg/core';

/** One shape of a recipe, in its own units ([along, up, across]); see LandmarkShape and Skin in @pg/core. */
export interface RecipeShape { shape: ShapeKind; at: [number, number, number]; size: [number, number, number]; color: string; tilt?: number; turn?: number; glow?: boolean }

/** A gable roof one unit each way, its ridge along x, its eaves at y 0. */
function useRoof() {
  const geometry = useMemo(() => {
    const tri = new THREE.Shape([new THREE.Vector2(-0.5, 0), new THREE.Vector2(0.5, 0), new THREE.Vector2(0, 1)]);
    const g = new THREE.ExtrudeGeometry(tri, { depth: 1, bevelEnabled: false });
    g.translate(0, 0, -0.5);
    g.rotateY(Math.PI / 2);
    return g;
  }, []);
  useLayoutEffect(() => () => geometry.dispose(), [geometry]);
  return geometry;
}

const Paint = ({ color, glow }: { color: string; glow?: boolean }) => (
  <meshStandardMaterial color={color} roughness={0.8} flatShading emissive={glow ? color : '#000000'} emissiveIntensity={glow ? 1.4 : 0} />
);

/**
 * Draw a recipe: each shape scaled by `unit` (metres per unit along, up, across) and stood on
 * `base` (the height of up 0). A turned shape turns toward its right, then a tilt leans it toward where it points, about its own bottom.
 * `only` keeps some kinds of shape (a landmark draws its solids from their colliders).
 */
export function Recipe({ shapes, unit, base = 0, only }: { shapes: RecipeShape[]; unit: [number, number, number]; base?: number; only?: (s: RecipeShape) => boolean }) {
  const roof = useRoof();
  const [ux, uy, uz] = unit;
  return (
    <>
      {shapes.map((s, i) => {
        if (only && !only(s)) return null;
        const [a, h, b] = [s.size[0] * ux, s.size[1] * uy, s.size[2] * uz];
        const bottom: [number, number, number] = [s.at[0] * ux, base + s.at[1] * uy, s.at[2] * uz];
        let mesh: React.ReactNode;
        switch (s.shape) {
          case 'box': mesh = <mesh position={[0, h / 2, 0]} castShadow><boxGeometry args={[a, h, b]} /><Paint color={s.color} glow={s.glow} /></mesh>; break;
          case 'cylinder': mesh = <mesh position={[0, h / 2, 0]} castShadow><cylinderGeometry args={[a / 2, a / 2, h, 14]} /><Paint color={s.color} glow={s.glow} /></mesh>; break;
          case 'frustum': mesh = <mesh position={[0, h / 2, 0]} castShadow><cylinderGeometry args={[(s.size[2] * ux) / 2, a / 2, h, 14]} /><Paint color={s.color} glow={s.glow} /></mesh>; break;
          case 'cone': mesh = <mesh position={[0, h / 2, 0]} castShadow><coneGeometry args={[a / 2, h, 12]} /><Paint color={s.color} glow={s.glow} /></mesh>; break;
          case 'sphere': mesh = <mesh position={[0, a / 2, 0]} castShadow><sphereGeometry args={[a / 2, 16, 12]} /><Paint color={s.color} glow={s.glow} /></mesh>; break;
          // A disc standing across: its axis runs across, its diameter is the height.
          case 'wheel': mesh = <mesh position={[0, h / 2, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow><cylinderGeometry args={[h / 2, h / 2, b, 16]} /><Paint color={s.color} glow={s.glow} /></mesh>; break;
          case 'roof': mesh = <mesh geometry={roof} scale={[a, h, b]} castShadow><Paint color={s.color} glow={s.glow} /></mesh>; break;
        }
        return <group key={i} position={bottom} rotation={[0, -((s.turn ?? 0) * Math.PI) / 180, -((s.tilt ?? 0) * Math.PI) / 180]}>{mesh}</group>;
      })}
    </>
  );
}
