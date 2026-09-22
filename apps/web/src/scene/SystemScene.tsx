import { Stars } from '@react-three/drei';
import { Canvas, useFrame } from '@react-three/fiber';
import { useCurrentAttempt, useStore } from '../store';
import { Bodies } from './Bodies';
import { systemScale } from './frames';
import { Gadgets } from './Gadgets';
import { CameraRig } from './CameraRig';
import { Trails } from './Trails';

/** Advances playback time. Lives inside the canvas so it ticks with rendering. */
function PlaybackDriver({ duration }: { duration: number }) {
  useFrame((_, delta) => {
    const { playing, speed, time, setTime, setPlaying } = useStore.getState();
    if (!playing) return;
    const next = time + Math.min(delta, 0.1) * speed;
    if (next >= duration) {
      setTime(duration);
      setPlaying(false);
    } else {
      setTime(next);
    }
  });
  return null;
}

export function SystemScene() {
  const attempt = useCurrentAttempt();
  const attempts = useStore((s) => s.attempts);
  const showGhosts = useStore((s) => s.showGhosts);
  const setFocus = useStore((s) => s.setFocus);

  return (
    <Canvas
      className="scene"
      camera={{ fov: 50, position: [0, 10, 12] }}
      onPointerMissed={() => setFocus(null)}
      gl={{ antialias: true }}
    >
      <color attach="background" args={['#05060d']} />
      <ambientLight intensity={0.08} />
      <Stars radius={3000} depth={500} count={4000} factor={60} fade />
      {attempt && (
        <>
          <PlaybackDriver duration={attempt.run.duration} />
          <CameraRig run={attempt.run} />
          {showGhosts &&
            attempts
              .filter((a) => a.id !== attempt.id && a.run.spec.title === attempt.run.spec.title)
              .map((a) => <Trails key={a.id} run={a.run} ghost />)}
          <Trails run={attempt.run} />
          <Bodies run={attempt.run} />
          <Gadgets run={attempt.run} scale={systemScale(attempt.run)} />
        </>
      )}
    </Canvas>
  );
}
