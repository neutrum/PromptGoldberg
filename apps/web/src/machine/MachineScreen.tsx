import { useEffect, useState } from 'react';
import demo from '@og/machine/fixtures/ramp-dominoes-bell.json' with { type: 'json' };
import { parseMachine } from '@og/machine';
import { useGame } from '../game/gameStore';
import { MachineScene } from './MachineScene';
import { useMachine } from './machineStore';

/** Anything works as a prompt; the chips show the range and skip the blank-page moment. */
const IDEAS = [
  'Get the ball into the bucket using dominoes and a fan',
  'The slowest possible machine that rings the bell',
  'Launch the ball with a cannon over a wall into a bucket',
  'A seesaw, a trampoline, then dominoes',
  'pizza delivery',
  'Ring the bell twice',
  'my cat knocking things off the shelf',
  'A machine with only three parts',
];
const EDITS = ['make it longer', 'swap the fan for a cannon', 'add a trampoline', 'make it ring the bell twice'];

function PromptBar() {
  const ai = useMachine((s) => s.ai);
  const machine = useMachine((s) => s.machine);
  const { create, edit } = useMachine.getState();
  const [text, setText] = useState('');
  const [shown, setShown] = useState(() => Math.floor(Math.random() * IDEAS.length));
  const ideas = Array.from({ length: 3 }, (_, k) => IDEAS[(shown + k) % IDEAS.length]);
  const editing = !!machine && !ai.busy;
  const submit = () => {
    const t = text.trim();
    if (!t || ai.busy) return;
    void (editing && !startsFresh(t) ? edit(t) : create(t));
    setText('');
  };
  return (
    <div className="mprompt">
      <form onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={400}
          placeholder={editing ? 'Change it: "swap the fan for a cannon", or describe a new machine…' : 'Describe a machine… e.g. get the ball into the bucket using dominoes and a fan'}
          disabled={ai.busy}
          aria-label="Describe your machine"
        />
        <button className="primary" disabled={ai.busy || !text.trim()}>{ai.busy ? 'Building…' : editing ? 'Change' : 'Build'}</button>
      </form>
      {!ai.busy && (
        <div className="examples">
          {(editing ? EDITS : ideas).map((ex) => <button key={ex} onClick={() => setText(ex)}>{ex}</button>)}
          {!editing && <button className="dice" title="Other ideas" onClick={() => setShown((n) => (n + 3) % IDEAS.length)}>🎲</button>}
        </div>
      )}
    </div>
  );
}

/** "a new machine: …" or a long description after an edit means start over rather than edit. */
function startsFresh(t: string): boolean {
  return /^(new|another|a new|build|design|make me)\b/i.test(t) && t.length > 24;
}

function AiLog() {
  const ai = useMachine((s) => s.ai);
  if (!ai.busy && !ai.error && !ai.lines.length) return null;
  return (
    <div className="mlog">
      {ai.lines.map((l, i) => <div key={i} className={i === ai.lines.length - 1 && ai.busy ? 'current' : ''}>{i === ai.lines.length - 1 && ai.busy ? '◌ ' : '✓ '}{l}</div>)}
      {ai.busy && ai.lines.length === 0 && <div className="current">◌ Contacting the AI designer…</div>}
      {ai.busy && ai.progress > 0 && <div className="machine-bar"><div style={{ width: `${Math.round(ai.progress * 100)}%` }} /></div>}
      {ai.error && <div className="error-inline">{ai.error}</div>}
    </div>
  );
}

/** The game: a part is missing; put it back where the chain needs it. */
function FixPanel() {
  const fix = useMachine((s) => s.fix)!;
  const phase = useMachine((s) => s.phase);
  const result = useMachine((s) => s.result);
  const { pick, clearPlaced, runFix, showHint, leaveFix } = useMachine.getState();
  const allPlaced = fix.puzzle.missing.every((m) => fix.placed.some((p) => p.id === m.id));
  const failed = phase === 'done' && result && !result.success ? result.steps.find((s) => !s.satisfied) : null;
  const tries = (n: number) => `${n} ${n === 1 ? 'try' : 'tries'}`;
  return (
    <div className="mgoal mfix">
      <div className="mtitle">
        <h2>Fix it: {fix.puzzle.solution.title}</h2>
        <p>{fix.solved ? `Fixed in ${tries(fix.tries)}!` : `${fix.puzzle.missing.length === 1 ? 'A part is' : `${fix.puzzle.missing.length} parts are`} missing. Pick it, then click the stage where it belongs.`}</p>
      </div>
      <div className="mbin">
        {fix.puzzle.missing.map((m, i) => {
          const placed = fix.placed.find((p) => p.id === m.id);
          const count = m.kind === 'dominoes' || m.kind === 'platform' ? ` x${m.length ?? (m.kind === 'dominoes' ? 5 : 3)}` : '';
          return (
            <button key={m.id} className={fix.picking === i ? 'active' : ''} disabled={fix.solved} onClick={() => pick(i)}>
              {m.kind}{count} at height {m.y}{placed ? ' (placed)' : ''}
            </button>
          );
        })}
      </div>
      {failed && !fix.solved && <div className="mnote">x {failed.note}</div>}
      <div className="mactions">
        {!fix.solved && <button className="primary" onClick={() => void runFix()} disabled={!allPlaced || phase === 'simulating' || phase === 'playing'}>Run ({tries(fix.tries)})</button>}
        {!fix.solved && <button onClick={clearPlaced} disabled={!fix.placed.length}>Clear</button>}
        {!fix.solved && !fix.hint && fix.tries >= 2 && <button onClick={showHint}>Hint</button>}
        <button onClick={leaveFix}>{fix.solved ? 'Back to the machine' : 'Give up'}</button>
      </div>
    </div>
  );
}

function GoalPanel() {
  const machine = useMachine((s) => s.machine);
  const result = useMachine((s) => s.result);
  const celebrated = useMachine((s) => s.celebrated);
  const phase = useMachine((s) => s.phase);
  const proven = useMachine((s) => s.proven);
  const working = useMachine((s) => s.working);
  const moved = useMachine((s) => s.moved);
  const mode = useMachine((s) => s.mode);
  const { play, startFix } = useMachine.getState();
  if (!machine) return null;
  if (mode === 'fix') return <FixPanel />;
  const name = (id: string) => machine.parts.find((p) => p.id === id)?.kind ?? id;
  const label = (g: (typeof machine.goal)[number]) => {
    switch (g.type) {
      case 'bucket': return `Land in the ${name(g.part)}`;
      case 'bell': return g.times > 1 ? `Ring the bell ${g.times} times` : 'Ring the bell';
      case 'topple': return 'Topple the dominoes';
      case 'touch': return `Reach the ${name(g.part)}`;
    }
  };
  const done = phase === 'done';
  return (
    <div className="mgoal">
      <div className="mtitle">
        <h2>{machine.title}</h2>
        {machine.caption && <p>{machine.caption}</p>}
      </div>
      <ol className="chain-list">
        {machine.goal.map((g, i) => {
          const step = result?.steps[i];
          const state = i < celebrated || (done && step?.satisfied) ? 'done' : done && step && !step.satisfied && result?.failedAt === i ? 'failed' : 'todo';
          return <li key={i} className={state}>{state === 'done' ? '✓' : state === 'failed' ? '✗' : '○'} {label(g)}{state === 'failed' && step ? <span className="muted"> · {step.note}</span> : null}</li>;
        })}
      </ol>
      <div className="mbadges">
        {proven && <span className="badge ok">✓ Physics-proven{moved.length ? ` · nudged ${moved.length} part${moved.length > 1 ? 's' : ''}` : ''}</span>}
        {!proven && working && <span className="badge">◌ Proving it works…</span>}
        {!proven && !working && result && !result.success && <span className="badge warn">Closest attempt, not working yet</span>}
        {phase === 'simulating' && <span className="badge">Simulating…</span>}
      </div>
      <div className="mactions">
        <button className="primary" onClick={play} disabled={phase === 'simulating' || phase === 'playing'}>{done ? '↻ Run again' : '▶ Run'}</button>
        {proven && !working && <button onClick={() => void startFix()} disabled={phase === 'simulating'} title="A part goes missing; put it back">🔧 Break it, I'll fix it</button>}
      </div>
    </div>
  );
}

export function MachineScreen() {
  const { go } = useGame.getState();
  const error = useMachine((s) => s.error);
  const mode = useMachine((s) => s.mode);
  // Something runs the moment the screen opens: a sample machine until the visitor builds one.
  useEffect(() => {
    if (useMachine.getState().machine) return;
    const parsed = parseMachine({ ...demo, caption: 'A sample machine. Describe your own below.' });
    if (parsed.ok) void useMachine.getState().load(parsed.spec, { rank: 2, proven: true });
  }, []);
  return (
    <div className="app play machine-screen">
      <MachineScene />
      <div className="hud-top">
        <div className="hud-left">
          <button onClick={() => { useMachine.getState().stopAi(); go('menu'); }}>← Menu</button>
        </div>
        <div className="mbrand">Prompt <b>Goldberg</b></div>
        <div className="hud-right" />
      </div>
      <div className="mside">
        <GoalPanel />
        <AiLog />
        {error && <div className="error-inline">{error}</div>}
      </div>
      <div className="hud-bottom">
        {mode !== 'fix' && <PromptBar />}
      </div>
    </div>
  );
}
