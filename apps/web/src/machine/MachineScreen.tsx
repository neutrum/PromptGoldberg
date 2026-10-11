import { useEffect, useRef, useState } from 'react';
import demo from '@og/machine/fixtures/ramp-dominoes-bell.json' with { type: 'json' };
import { parseMachine, PUZZLE_KINDS, type PuzzleKind } from '@og/machine';
import { CARDS, dealCards, EDIT_IDEAS } from './cards';
import { MachineScene } from './MachineScene';
import { useMachine } from './machineStore';

const WELCOME_KEY = 'pg.welcomed';
const COACH_KEY = 'pg.coached';
const flag = (key: string) => { try { return localStorage.getItem(key) === '1'; } catch { return false; } };
const setFlag = (key: string) => { try { localStorage.setItem(key, '1'); } catch { /* private mode */ } };

const KIND_LABEL: Record<PuzzleKind, { name: string; blurb: string }> = {
  missing: { name: '1 part missing', blurb: 'One part is gone. Put it back where the chain needs it.' },
  missing2: { name: '2 parts missing', blurb: 'Two parts are gone. Put both back.' },
  moved: { name: 'a part moved', blurb: 'Every part is here, but one is in the wrong place. Click it to pick it up, then drop it where it belongs.' },
};

/** A hand of three prompt cards; clicking one builds that machine. */
function CardDeck({ onPick, big = false }: { onPick: () => void; big?: boolean }) {
  const busy = useMachine((s) => s.ai.busy);
  const [offset, setOffset] = useState(() => Math.floor(Math.random() * CARDS.length));
  const { create } = useMachine.getState();
  return (
    <div className={`cards ${big ? 'big' : ''}`}>
      {dealCards(offset).map((c) => (
        <button key={c.title} className="card" disabled={busy} onClick={() => { onPick(); void create(c.prompt); }} title={c.prompt}>
          <span className="card-face">{c.emoji}</span>
          <span className="card-title">{c.title}</span>
          {big && <span className="card-prompt">{c.prompt}</span>}
        </button>
      ))}
      <button className="card shuffle" disabled={busy} onClick={() => setOffset((n) => (n + 3) % CARDS.length)} title="Other cards">
        <span className="card-face">🎲</span>
        <span className="card-title">Shuffle</span>
      </button>
    </div>
  );
}

/** First visit: what this is, and three ways in. The sample machine keeps running behind it. */
function Welcome({ onClose }: { onClose: () => void }) {
  const daily = useMachine((s) => s.daily);
  return (
    <div className="welcome" role="dialog" aria-label="Welcome">
      <div className="welcome-card">
        <h1 className="logo">Prompt<span>Goldberg</span></h1>
        <p className="tagline">Describe a machine in one sentence. <b>The AI builds it</b>, real physics proves it runs, and then you can break it and fix it.</p>
        <p className="muted small">Pick a card to see one get built:</p>
        <CardDeck onPick={onClose} big />
        <div className="welcome-actions">
          <button className="primary" onClick={onClose}>✍️ I'll describe my own</button>
          <button onClick={() => { onClose(); void useMachine.getState().playDaily(); }} disabled={daily.loading}>📅 Today's fix-it puzzle</button>
        </div>
        <p className="muted small">Drag to look around · wheel to zoom</p>
      </div>
    </div>
  );
}

/** Two short nudges after the first machine the player built: edit by talking, then break it. */
function Coach() {
  const builds = useMachine((s) => s.builds);
  const busy = useMachine((s) => s.ai.busy);
  const mode = useMachine((s) => s.mode);
  const [step, setStep] = useState<0 | 1 | 2>(() => (flag(COACH_KEY) ? 2 : 0));
  if (step === 2 || builds === 0 || busy || mode !== 'build') return null;
  const next = () => { if (step === 1) setFlag(COACH_KEY); setStep((s) => (s + 1) as 0 | 1 | 2); };
  return (
    <div className="coach-pop">
      {step === 0
        ? <span>Your machine runs. Now <b>change it by talking</b>: try “add a trampoline” or “make it ring the bell twice”.</span>
        : <span>Want to play? <b>🔧 Break it</b> pulls a part out and you put it back. Same for today's puzzle.</span>}
      <button onClick={next}>{step === 0 ? 'Next' : 'Got it'}</button>
    </div>
  );
}

function PromptBar({ inputRef }: { inputRef: React.RefObject<HTMLInputElement | null> }) {
  const ai = useMachine((s) => s.ai);
  const machine = useMachine((s) => s.machine);
  const builds = useMachine((s) => s.builds);
  const { create, edit } = useMachine.getState();
  const [text, setText] = useState('');
  const [deck, setDeck] = useState(false);
  // Edits apply to a machine the player built; the sample is only there to watch.
  const editing = !!machine && !ai.busy && builds > 0;
  const submit = () => {
    const t = text.trim();
    if (!t || ai.busy) return;
    void (editing && !startsFresh(t) ? edit(t) : create(t));
    setText('');
  };
  return (
    <div className="mprompt">
      {deck && !ai.busy && <CardDeck onPick={() => setDeck(false)} />}
      <form onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <button type="button" className={`lucky ${deck ? 'active' : ''}`} onClick={() => setDeck((d) => !d)} disabled={ai.busy} title="Pick a card instead of typing">🎲</button>
        <input
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={400}
          placeholder={editing ? 'Change it: “swap the fan for a cannon”, or describe a new machine…' : 'Describe a machine… e.g. get the ball into the bucket using dominoes and a fan'}
          disabled={ai.busy}
          aria-label="Describe your machine"
        />
        <button className="primary" disabled={ai.busy || !text.trim()}>{ai.busy ? 'Building…' : editing ? 'Change' : 'Build'}</button>
      </form>
      {!ai.busy && editing && !deck && (
        <div className="examples">
          {EDIT_IDEAS.map((ex) => <button key={ex} onClick={() => setText(ex)}>{ex}</button>)}
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

const tries = (n: number) => `${n} ${n === 1 ? 'try' : 'tries'}`;

/** The game: something is wrong with the machine; put it right. */
function FixPanel() {
  const fix = useMachine((s) => s.fix)!;
  const phase = useMachine((s) => s.phase);
  const result = useMachine((s) => s.result);
  const daily = useMachine((s) => s.daily);
  const { pick, pickPlaced, clearPlaced, runFix, showHint, leaveFix, nextDailyStage } = useMachine.getState();
  const allPlaced = fix.puzzle.missing.every((m) => fix.placed.some((p) => p.id === m.id));
  const failed = phase === 'done' && result && !result.success ? result.steps.find((s) => !s.satisfied) : null;
  const inDaily = !!daily.date;
  const lastStage = daily.stage >= PUZZLE_KINDS.length;
  const label = (kind: string, length?: number) => kind === 'dominoes' || kind === 'platform' ? `${kind} x${length ?? (kind === 'dominoes' ? 5 : 3)}` : kind;
  return (
    <div className="mgoal mfix">
      <div className="mtitle">
        <h2>{inDaily ? `Daily ${Math.min(daily.stage, PUZZLE_KINDS.length)}/${PUZZLE_KINDS.length}: ` : 'Fix it: '}{fix.puzzle.solution.title}</h2>
        <p>{fix.solved ? `Fixed in ${tries(fix.tries)}!${inDaily ? ` ${tries(daily.tries)} so far today.` : ''}` : KIND_LABEL[fix.kind].blurb}</p>
      </div>
      {!fix.solved && (
        <div className="mbin">
          {fix.puzzle.missing.map((m, i) => {
            const placed = fix.placed.find((p) => p.id === m.id);
            return (
              <button key={m.id} className={fix.picking === i ? 'active' : ''} onClick={() => (placed ? pickPlaced(m.id) : pick(i))} title={placed ? 'Pick it up again' : 'Pick it, then click the stage'}>
                {placed ? '📍' : '✋'} {label(m.kind, m.length)}{placed ? '' : fix.picking === i ? ' · click the stage' : ''}
              </button>
            );
          })}
        </div>
      )}
      {failed && !fix.solved && <div className="mnote">✗ {failed.note}</div>}
      <div className="mactions">
        {!fix.solved && <button className="primary" onClick={() => void runFix()} disabled={!allPlaced || phase === 'simulating' || phase === 'playing'}>▶ Run ({tries(fix.tries)})</button>}
        {!fix.solved && <button onClick={clearPlaced} disabled={!fix.placed.length}>Clear</button>}
        {!fix.solved && !fix.hint && fix.tries >= 2 && <button onClick={showHint}>Hint</button>}
        {fix.solved && inDaily && !lastStage && <button className="primary" onClick={() => void nextDailyStage()} disabled={phase === 'simulating'}>Next: {KIND_LABEL[PUZZLE_KINDS[daily.stage]].name} →</button>}
        {fix.solved && inDaily && lastStage && <span className="badge ok">Daily done in {tries(daily.tries)}{daily.best[daily.date] ? ` · best ${daily.best[daily.date]}` : ''}</span>}
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
  const [breaking, setBreaking] = useState(false);
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
        {proven && !working && !breaking && <button onClick={() => setBreaking(true)} disabled={phase === 'simulating'} title="Something goes wrong with it; you put it right">🔧 Break it, I'll fix it</button>}
      </div>
      {breaking && proven && (
        <div className="mbin mbreak">
          <span className="muted">Break it how?</span>
          {PUZZLE_KINDS.map((k) => <button key={k} onClick={() => { setBreaking(false); void startFix(k); }}>{KIND_LABEL[k].name}</button>)}
          <button onClick={() => setBreaking(false)}>✕</button>
        </div>
      )}
    </div>
  );
}

function DailyButton() {
  const daily = useMachine((s) => s.daily);
  const busy = useMachine((s) => s.ai.busy);
  const today = new Date().toISOString().slice(0, 10);
  const best = daily.best[today];
  return (
    <button onClick={() => void useMachine.getState().playDaily()} disabled={daily.loading || busy || !!daily.date} title="The same machine for everyone today, broken three ways">
      {daily.loading ? 'Loading…' : best ? `📅 Daily · best ${best}` : '📅 Daily puzzle'}
    </button>
  );
}

export function MachineScreen() {
  const error = useMachine((s) => s.error);
  const mode = useMachine((s) => s.mode);
  const [welcome, setWelcome] = useState(() => !flag(WELCOME_KEY));
  const inputRef = useRef<HTMLInputElement>(null);
  // Something runs the moment the screen opens: a sample machine until the visitor builds one.
  useEffect(() => {
    if (useMachine.getState().machine) return;
    const parsed = parseMachine({ ...demo, caption: 'A sample machine, to show the idea. Yours goes below.' });
    if (parsed.ok) void useMachine.getState().load(parsed.spec, { rank: 2, proven: true });
  }, []);
  const closeWelcome = () => { setFlag(WELCOME_KEY); setWelcome(false); setTimeout(() => inputRef.current?.focus(), 200); };
  return (
    <div className="app play machine-screen">
      <MachineScene />
      <div className="hud-top">
        <div className="hud-left mbrand">
          <button className="brand" onClick={() => setWelcome(true)} title="What is this?">Prompt <b>Goldberg</b></button>
          <span className="mtag">Describe a machine. The AI builds it. Physics proves it runs.</span>
        </div>
        <div className="hud-right"><DailyButton /></div>
      </div>
      <div className="mside">
        <GoalPanel />
        <AiLog />
        {error && <div className="error-inline">{error}</div>}
      </div>
      <div className="hud-bottom">
        {mode !== 'fix' && <Coach />}
        {mode !== 'fix' && <PromptBar inputRef={inputRef} />}
      </div>
      {welcome && <Welcome onClose={closeWelcome} />}
    </div>
  );
}
