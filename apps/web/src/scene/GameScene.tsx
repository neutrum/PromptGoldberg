import { Html, Stars } from '@react-three/drei';
import { Canvas, useFrame } from '@react-three/fiber';
import type { Level } from '@og/shared';
import { useCallback, useMemo, useRef } from 'react';
import { useGame } from '../game/gameStore';
import { sfx } from '../game/audio';
import type { RunData } from '../simClient';
import { useStore } from '../store';
import { AimController, PieceArcs, PreviewPath } from './Aim';
import { Bodies } from './Bodies';
import { Checkpoints } from './Checkpoints';
import { Bursts, burst, PlayerGlow } from './Effects';
import { gameScale, positionAt } from './frames';
import { GameCamera } from './GameCamera';
import { Trails } from './Trails';
import * as THREE from 'three';

/** Real seconds a flight takes before slow motion. */
const FLIGHT_SECONDS = 11;

interface FlightPlan {
  start: number;
  end: number;
  /** Moments worth slowing down for. */
  keys: number[];
  /** Time each satisfied goal step happened. */
  hits: (number | undefined)[];
  crashT?: number;
  escapeT?: number;
}

export function planFlight(level: Level, run: RunData): FlightPlan {
  const start = run.trace.launches[level.player] ?? 0;
  const hits = run.goal.events.map((e) => (e.satisfied ? e.t : undefined));
  const keys = hits.filter((t): t is number => t !== undefined);
  const failed = run.goal.events.find((e) => !e.satisfied && e.missT !== undefined);
  if (failed?.missT !== undefined) keys.push(failed.missT);
  const crash = run.trace.collisions.find((c) => c.groupA.includes(level.player) || c.groupB.includes(level.player));
  if (crash) keys.push(crash.t);
  const escapeT = run.trace.escapes[level.player];
  const span = run.duration - start;
  let end = run.duration;
  if (run.goal.success && keys.length) end = Math.min(run.duration, Math.max(...keys) + 0.1 * span);
  else if (crash) end = Math.min(run.duration, Math.max(crash.t, ...keys) + 0.06 * span);
  return { start, end: Math.max(end, start + 1e-6), keys, hits, crashT: crash?.t, escapeT };
}

function FlightDriver({ level, run }: { level: Level; run: RunData }) {
  const plan = useMemo(() => planFlight(level, run), [level, run]);
  const crashed = useRef(false);
  const escaped = useRef(false);
  const playerIdx = run.ids.indexOf(level.player);
  const tmp = useMemo(() => new THREE.Vector3(), []);

  useFrame((_, delta) => {
    const pb = useStore.getState();
    const game = useGame.getState();
    if (!pb.playing || game.phase !== 'flying') return;
    const span = plan.end - plan.start;
    const base = span / FLIGHT_SECONDS;
    const w = 0.025 * span;
    let slow = 1;
    for (const k of plan.keys) slow = Math.min(slow, 1 - 0.8 * Math.exp(-(((pb.time - k) / w) ** 2)));
    const next = Math.min(plan.end, pb.time + Math.min(delta, 0.05) * base * slow);

    plan.hits.forEach((t, i) => {
      if (t !== undefined && next >= t && i >= game.celebrated) {
        game.celebrate(i);
        if (positionAt(run, playerIdx, t, tmp)) burst(tmp, '#7dffb0');
      }
    });
    if (plan.crashT !== undefined && !crashed.current && next >= plan.crashT) {
      crashed.current = true;
      sfx.crash();
      if (positionAt(run, playerIdx, plan.crashT - 1e-9, tmp)) burst(tmp, '#ffb070', 2.2);
    }
    if (plan.escapeT !== undefined && !escaped.current && next >= plan.escapeT) {
      escaped.current = true;
      sfx.escape();
    }
    pb.setTime(next);
    if (next >= plan.end) game.finishFlight();
  });
  return null;
}

/** Sparkle markers where the known solution's pieces sit, shown when the player asks for the solution. */
function HintPieces({ run }: { run: RunData }) {
  const groups = useRef<(THREE.Group | null)[]>([]);
  const ids = run.ids.map((id, i) => ({ id, i })).filter((b) => /^piece\d+$/.test(b.id));
  const tmp = useMemo(() => new THREE.Vector3(), []);
  useFrame(() => {
    const time = useStore.getState().time;
    ids.forEach((b, k) => {
      const g = groups.current[k];
      if (g && positionAt(run, b.i, time, tmp)) g.position.copy(tmp);
    });
  });
  return (
    <>
      {ids.map((b, k) => (
        <group key={b.id} ref={(el) => { groups.current[k] = el; }}>
          <Html center style={{ pointerEvents: 'none' }}>
            <div className="hint-piece">✨ place here</div>
          </Html>
        </group>
      ))}
    </>
  );
}

function Level3D({ level }: { level: Level }) {
  const phase = useGame((s) => s.phase);
  const preview = useGame((s) => s.preview);
  const flight = useGame((s) => s.flight);
  const shots = useGame((s) => s.shots);
  const hint = useGame((s) => s.hint);
  const removePiece = useGame((s) => s.removePiece);

  const run = phase === 'flying' || (phase === 'result' && flight) ? flight ?? preview : preview;
  const scaleRef = useRef<{ level: Level; scale: number } | null>(null);
  if (preview && scaleRef.current?.level !== level) scaleRef.current = { level, scale: gameScale(preview, level.player) };
  const scale = scaleRef.current?.level === level ? scaleRef.current.scale : undefined;

  const notPlayer = useCallback((id: string) => id !== level.player && !id.startsWith('piece'), [level]);
  const onlyPlayer = useCallback((id: string) => id === level.player, [level]);
  const onBodyClick = useCallback((id: string) => {
    const m = id.match(/^piece(\d+)$/);
    if (m && useGame.getState().phase !== 'flying') removePiece(Number(m[1]) - 1);
  }, [removePiece]);

  if (!run || scale === undefined) return null;
  const ghosts = shots.slice(-6).filter((s) => s.run !== flight);

  return (
    <>
      {phase === 'flying' && flight && <FlightDriver key={flight.stats.ms + flight.frames.length} level={level} run={flight} />}
      <GameCamera run={run} level={level} scale={scale} />
      {ghosts.map((s, i) => <Trails key={`g${shots.indexOf(s)}`} run={s.run} ghost showFull={onlyPlayer} ghostColor={i === ghosts.length - 1 ? '#8aa0ff' : '#56608a'} />)}
      {hint && <Trails run={hint} ghost showFull={onlyPlayer} ghostColor="#ffd27a" />}
      {hint && phase !== 'flying' && <HintPieces run={hint} />}
      <Trails run={run} showFull={notPlayer} />
      <Bodies run={run} scale={scale} onBodyClick={onBodyClick} hidden={[level.player]} />
      <PlayerGlow run={run} level={level} scale={scale} />
      <Checkpoints run={run} level={level} scale={scale} />
      {phase === 'aiming' && <PreviewPath run={run} level={level} />}
      {phase === 'aiming' && <PieceArcs run={run} level={level} scale={scale} />}
      {phase !== 'flying' && <AimController run={run} level={level} scale={scale} />}
      <Bursts scale={scale} />
    </>
  );
}

export function GameScene() {
  const level = useGame((s) => s.level);
  return (
    <Canvas className="scene" camera={{ fov: 50, position: [0, 10, 12] }} gl={{ antialias: true }}>
      <color attach="background" args={['#04050c']} />
      <ambientLight intensity={0.12} />
      <Stars radius={3000} depth={500} count={5000} factor={60} fade />
      {level && <Level3D key={level.id + level.title} level={level} />}
    </Canvas>
  );
}
