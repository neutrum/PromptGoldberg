import { useEffect, useState } from 'react';
import { useGame } from '../game/gameStore';
import { FIXTURES } from '../fixtures';
import { SystemScene } from '../scene/SystemScene';
import { useCurrentAttempt, useStore } from '../store';
import { AttemptHistory } from '../ui/AttemptHistory';
import { EventLog } from '../ui/EventLog';
import { GoalPanel } from '../ui/GoalPanel';
import { PromptBar } from '../ui/PromptBar';
import { SpecEditor } from '../ui/SpecEditor';
import { TimeControls } from '../ui/TimeControls';

/** The original simulator: hand-made systems, prompt-to-system, raw JSON, event log. */
export function SandboxScreen() {
  const go = useGame((s) => s.go);
  const loadSpec = useStore((s) => s.loadSpec);
  const status = useStore((s) => s.status);
  const error = useStore((s) => s.error);
  const focusId = useStore((s) => s.focusId);
  const attempt = useCurrentAttempt();
  const [editing, setEditing] = useState(false);
  const [fixture, setFixture] = useState(FIXTURES[0].id);

  useEffect(() => {
    const f = FIXTURES.find((x) => x.id === fixture)!;
    void loadSpec(f.spec, 'Hand-made', { replace: true });
  }, [fixture, loadSpec]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || (e.target as HTMLElement).closest('input, textarea, select')) return;
      e.preventDefault();
      const s = useStore.getState();
      const run = s.attempts.find((a) => a.id === s.currentId)?.run;
      if (run && !s.playing && s.time >= run.duration) s.setTime(0);
      s.setPlaying(!s.playing);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const focusName = attempt?.run.spec.bodies.find((b) => b.id === focusId)?.name;

  return (
    <div className="app">
      <SystemScene />

      <header className="top">
        <div className="brand">
          <h1><button className="icon" onClick={() => go('menu')} title="Menu">←</button> Sandbox</h1>
          {attempt && <div className="system-title">{attempt.run.spec.title}</div>}
          {attempt?.run.spec.description && <div className="muted">{attempt.run.spec.description}</div>}
        </div>
        <PromptBar />
        <div className="toolbar">
          <select value={fixture} onChange={(e) => setFixture(e.target.value)} title="Load a hand-made system">
            {FIXTURES.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
          </select>
          <button onClick={() => setEditing((v) => !v)}>{editing ? 'Hide JSON' : 'Edit JSON'}</button>
          {status === 'simulating' && <span className="muted">Simulating…</span>}
          {status === 'error' && !editing && <span className="error-inline">{error}</span>}
        </div>
      </header>

      <aside className="side">
        <GoalPanel />
        <AttemptHistory />
        <EventLog />
      </aside>

      {editing && <SpecEditor onClose={() => setEditing(false)} />}

      <footer className="bottom">
        {focusName && (
          <div className="focus-hint">
            Following <strong>{focusName}</strong> · <button onClick={() => useStore.getState().setFocus(null)}>show whole system</button>
          </div>
        )}
        <TimeControls />
        {attempt && (
          <div className="stats muted">
            {attempt.run.stats.steps.toLocaleString()} steps · {attempt.run.stats.substeps.toLocaleString()} substeps · {attempt.run.stats.ms.toFixed(0)} ms · click a body to follow it
          </div>
        )}
      </footer>
    </div>
  );
}
