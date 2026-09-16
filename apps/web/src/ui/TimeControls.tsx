import { useMemo } from 'react';
import { formatTime } from '../format';
import { useCurrentAttempt, useStore } from '../store';
import { Timeline } from './Timeline';

const SPEED_FACTORS = [0.1, 0.25, 0.5, 1, 2, 4];

export function TimeControls() {
  const attempt = useCurrentAttempt();
  const time = useStore((s) => s.time);
  const playing = useStore((s) => s.playing);
  const speed = useStore((s) => s.speed);
  const { setTime, setPlaying, setSpeed } = useStore.getState();
  const base = useMemo(() => (attempt ? attempt.run.duration / 20 : 1), [attempt]);
  if (!attempt) return null;
  const { duration } = attempt.run;

  const toggle = () => {
    if (!playing && time >= duration) setTime(0);
    setPlaying(!playing);
  };

  return (
    <div className="panel time-controls">
      <div className="time-row">
        <button onClick={toggle} title="Play / pause (space)">{playing ? '❚❚' : '▶'}</button>
        <button onClick={() => { setTime(0); }} title="Restart">⟲</button>
        <span className="time-readout">{formatTime(time)} / {formatTime(duration)}</span>
        <input
          className="scrub"
          type="range"
          min={0}
          max={duration}
          step={duration / 2000}
          value={time}
          onChange={(e) => { setPlaying(false); setTime(Number(e.target.value)); }}
        />
        <select value={SPEED_FACTORS.find((f) => Math.abs(f * base - speed) < 1e-12) ?? 1} onChange={(e) => setSpeed(Number(e.target.value) * base)}>
          {SPEED_FACTORS.map((f) => <option key={f} value={f}>{f}×</option>)}
        </select>
      </div>
      <Timeline run={attempt.run} />
    </div>
  );
}
