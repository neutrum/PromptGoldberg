import type { GoalEvent, SystemSpec } from '@og/shared';
import { useMemo } from 'react';
import { formatDistance, formatTime } from '../format';
import { useCurrentAttempt, useStore } from '../store';

function describeGoal(g: GoalEvent, n: (id: string) => string): string {
  switch (g.type) {
    case 'flyby': return `${n(g.body)} flies within ${formatDistance(g.maxDistance)} of ${n(g.target)}`;
    case 'capture': return `${n(g.body)} ends up orbiting ${n(g.target)}`;
    case 'collision': return `${n(g.a)} collides with ${n(g.b)}`;
    case 'escape': return `${n(g.body)} escapes the system`;
    case 'eclipse': return `${n(g.occluder)} eclipses ${n(g.source)} as seen from ${n(g.observer)}${g.period ? ` every ${formatTime(g.period)}` : ''}`;
    case 'warp': return `${n(g.body)} flies into the portal ${n(g.portal)}`;
    case 'bounce': return `${n(g.body)} bounces off ${n(g.target)}`;
  }
}

export function GoalPanel() {
  const attempt = useCurrentAttempt();
  const { setTime, setPlaying } = useStore.getState();
  const spec: SystemSpec | undefined = attempt?.run.spec;
  const names = useMemo(() => new Map(spec?.bodies.map((b) => [b.id, b.name]) ?? []), [spec]);
  if (!attempt || !spec) return null;
  const { goal } = attempt.run;
  const n = (id: string) => names.get(id) ?? id;

  return (
    <div className="panel goal-panel">
      <div className="panel-title">
        Goal
        <span className={`badge ${goal.success ? 'ok' : 'miss'}`}>
          {goal.success ? 'Reached' : `${Math.round(goal.progress * 100)}%`}
        </span>
      </div>
      {spec.goal.length === 0 && <div className="muted">No goal set.</div>}
      <ol className="goal-list">
        {spec.goal.map((g, i) => {
          const r = goal.events[i];
          const t = r.satisfied ? r.t : r.missT;
          return (
            <li key={i} className={r.satisfied ? 'ok' : r.note === 'not reached' ? 'pending' : 'miss'}>
              <div className="goal-desc">{r.satisfied ? '✓' : '✗'} {describeGoal(g, n)}</div>
              <button
                className="goal-note"
                disabled={t === undefined}
                onClick={() => { if (t !== undefined) { setPlaying(false); setTime(t); } }}
              >
                {r.note}
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
