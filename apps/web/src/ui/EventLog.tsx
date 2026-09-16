import { useMemo } from 'react';
import { EVENT_ICON, describeEvent, formatTime } from '../format';
import { useCurrentAttempt, useStore } from '../store';

export function EventLog() {
  const attempt = useCurrentAttempt();
  const time = useStore((s) => s.time);
  const { setTime, setPlaying } = useStore.getState();
  const spec = attempt?.run.spec;
  const names = useMemo(() => new Map(spec?.bodies.map((b) => [b.id, b.name]) ?? []), [spec]);
  if (!attempt) return null;
  const { events } = attempt.run;

  return (
    <div className="panel event-log">
      <div className="panel-title">Event log <span className="muted">{events.length}</span></div>
      {events.length === 0 && <div className="muted">Nothing notable happened.</div>}
      <ul>
        {events.map((e, i) => (
          <li key={i} className={e.t <= time ? 'past' : 'future'}>
            <button onClick={() => { setPlaying(false); setTime(e.t); }}>
              <span className="event-time">{formatTime(e.t)}</span>
              <span className="event-icon">{EVENT_ICON[e.type]}</span>
              {describeEvent(e, names)}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
