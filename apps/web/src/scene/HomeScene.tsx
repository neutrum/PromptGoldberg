import { Stars } from '@react-three/drei';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Level, shotSpec } from '@og/shared';
import { useEffect, useMemo, useState } from 'react';
import * as THREE from 'three';
import showcaseLevel from '../showcase.json';
import { runSimulation, type RunData } from '../simClient';
import { useStore } from '../store';
import { Bodies } from './Bodies';
import { Checkpoints } from './Checkpoints';
import { PlayerGlow } from './Effects';
import { gameScale } from './frames';
import { planFlight } from './GameScene';
import { Trails } from './Trails';

/** Real seconds one demo flight takes, before the slow motion near each goal hit. */
const FLIGHT_SECONDS = 10;
const HOLD_SECONDS = 2.5;

const LEVEL = Level.parse(showcaseLevel);

/** Loops the level's proven shot and drifts the camera around the system. */
function Showcase({ run, scale }: { run: RunData; scale: number }) {
  const plan = useMemo(() => planFlight(LEVEL, run), [run]);
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const size = useThree((s) => s.size);
  const [done, setDone] = useState(0);
  const clock = useMemo(() => ({ time: plan.start, hold: 0 }), [plan]);

  useEffect(() => {
    useStore.getState().setTime(plan.start);
    camera.near = scale * 1e-3;
    camera.far = scale * 200;
    camera.updateProjectionMatrix();
    return () => camera.clearViewOffset();
  }, [plan, camera, scale]);

  useFrame((state, delta) => {
    // Flight time, slowed near each goal hit like the game does.
    const span = plan.end - plan.start;
    const w = 0.025 * span;
    let slow = 1;
    for (const k of plan.keys) slow = Math.min(slow, 1 - 0.8 * Math.exp(-(((clock.time - k) / w) ** 2)));
    if (clock.time < plan.end) {
      clock.time = Math.min(plan.end, clock.time + Math.min(delta, 0.05) * (span / FLIGHT_SECONDS) * slow);
    } else if ((clock.hold += delta) > HOLD_SECONDS) {
      clock.time = plan.start;
      clock.hold = 0;
    }
    useStore.getState().setTime(clock.time);
    const hits = plan.hits.filter((t) => t !== undefined && t <= clock.time).length;
    if (hits !== done) setDone(hits);

    // Slow drift around the system, tilted like the game view.
    const a = state.clock.elapsedTime * 0.04;
    const dist = scale * 1.55;
    camera.position.set(Math.sin(a) * dist * 0.55, dist * 0.78, Math.cos(a) * dist * 0.55);
    camera.lookAt(0, 0, 0);
    // Wide screens: keep the system to the right of the text column.
    const shift = size.width > 900 ? -size.width * 0.18 : 0;
    camera.setViewOffset(size.width, size.height, shift, size.width > 900 ? 0 : size.height * 0.12, size.width, size.height);
  });

  const notPlayer = (id: string) => id !== LEVEL.player;
  return (
    <>
      <Trails run={run} showFull={notPlayer} />
      <Bodies run={run} scale={scale} hidden={[LEVEL.player]} />
      <PlayerGlow run={run} level={LEVEL} scale={scale} showcase />
      <Checkpoints run={run} level={LEVEL} scale={scale} showcase={{ done }} />
    </>
  );
}

/** Start-screen backdrop: an AI-built level flying its proven solution, on the real engine. */
export function HomeScene() {
  const [run, setRun] = useState<RunData | null>(null);
  useEffect(() => {
    let alive = true;
    const values = LEVEL.solution?.values;
    if (values) void runSimulation(shotSpec(LEVEL, values, LEVEL.solution?.pieces ?? [])).then((r) => { if (alive) setRun(r); }).catch(() => {});
    return () => { alive = false; };
  }, []);
  const scale = useMemo(() => (run ? gameScale(run, LEVEL.player) : 1), [run]);

  return (
    <div className="home-scene" aria-hidden>
      <Canvas camera={{ fov: 45, position: [0, 10, 6] }} gl={{ antialias: true }} dpr={[1, 1.75]}>
        <color attach="background" args={['#04050c']} />
        <ambientLight intensity={0.15} />
        <Stars radius={300} depth={120} count={4000} factor={6} fade speed={0.4} />
        {run && <Showcase run={run} scale={scale} />}
      </Canvas>
      <div className="home-scene-shade" />
      {run && <div className="home-scene-caption">Live: “{LEVEL.title}”, a level the AI built, flown by its proven winning shot</div>}
    </div>
  );
}
