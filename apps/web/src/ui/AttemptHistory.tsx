import { useStore } from '../store';

export function AttemptHistory() {
  const attempts = useStore((s) => s.attempts);
  const currentId = useStore((s) => s.currentId);
  const showGhosts = useStore((s) => s.showGhosts);
  const { selectAttempt, setShowGhosts } = useStore.getState();
  if (attempts.length < 2) return null;

  return (
    <div className="panel attempts">
      <div className="panel-title">
        Attempts
        <label className="toggle">
          <input type="checkbox" checked={showGhosts} onChange={(e) => setShowGhosts(e.target.checked)} /> ghosts
        </label>
      </div>
      <ol>
        {attempts.map((a, i) => (
          <li key={a.id}>
            <button className={a.id === currentId ? 'active' : ''} onClick={() => selectAttempt(a.id)}>
              <span>{i + 1}. {a.label}</span>
              <span className={`badge ${a.run.goal.success ? 'ok' : 'miss'}`}>
                {a.run.goal.success ? '✓' : `${Math.round(a.run.goal.progress * 100)}%`}
              </span>
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}
