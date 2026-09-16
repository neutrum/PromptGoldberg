import { useMemo } from 'react';
import { EVENT_ICON, describeEvent, formatTime } from '../format';
import type { RunData } from '../simClient';
import { useStore } from '../store';

/** Event markers along the run; goal hits and the first miss are emphasised. */
export function Timeline({ run }: { run: RunData }) {
  const time = useStore((s) => s.time);
  const { setTime, setPlaying } = useStore.getState();
  const names = useMemo(() => new Map(run.spec.bodies.map((b) => [b.id, b.name])), [run]);
  const jump = (t: number) => { setPlaying(false); setTime(t); };
  const pct = (t: number) => `${(100 * t) / run.duration}%`;

  const goalMarks = run.goal.events.flatMap((g) => {
    if (g.satisfied && g.t !== undefined) return [{ t: g.t, ok: true, note: `Goal ${g.index + 1}: ${g.note}` }];
    if (!g.satisfied && g.missT !== undefined) return [{ t: g.missT, ok: false, note: `Goal ${g.index + 1} missed: ${g.note}` }];
    return [];
  });

  return (
    <div className="timeline">
      <div className="timeline-track">
        {run.events.map((e, i) => (
          <button
            key={i}
            className={`marker marker-${e.type}`}
            style={{ left: pct(e.t) }}
            title={`${formatTime(e.t)} — ${describeEvent(e, names)}`}
            onClick={() => jump(e.t)}
          >
            {EVENT_ICON[e.type]}
          </button>
        ))}
        {goalMarks.map((m, i) => (
          <button
            key={`g${i}`}
            className={`goal-marker ${m.ok ? 'ok' : 'miss'}`}
            style={{ left: pct(m.t) }}
            title={`${formatTime(m.t)} — ${m.note}`}
            onClick={() => jump(m.t)}
          >
            {m.ok ? '✓' : '✗'}
          </button>
        ))}
        <div className="playhead" style={{ left: pct(time) }} />
      </div>
    </div>
  );
}
