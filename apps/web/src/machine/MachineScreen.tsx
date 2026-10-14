import { useEffect, useRef, useState } from 'react';
import demo from '@og/machine/fixtures/ramp-dominoes-bell.json' with { type: 'json' };
import { parseMachine, PUZZLE_KINDS, TARGET_KINDS, type PartKind, type PuzzleKind } from '@og/machine';
import { CARDS, dealCards, EDIT_IDEAS } from './cards';
import { LEVELS } from './levels';
import { MachineScene } from './MachineScene';
import { DAILY_LADDER, useMachine } from './machineStore';

const WELCOME_KEY = 'pg.welcomed';
const COACH_KEY = 'pg.coached';
const flag = (key: string) => { try { return localStorage.getItem(key) === '1'; } catch { return false; } };
const setFlag = (key: string) => { try { localStorage.setItem(key, '1'); } catch { /* private mode */ } };

const PART_ICON: Record<PartKind, string> = { ball: '🔴', ramp: '📐', platform: '▬', wall: '🧱', dominoes: '🁢', seesaw: '⚖️', fan: '🌀', trampoline: '🛏️', cannon: '💣', bucket: '🪣', bell: '🔔' };

const KIND_LABEL: Record<PuzzleKind, { name: string; blurb: string }> = {
  connect: { name: 'build the route', blurb: 'The ball, the targets and the scenery are where they are. Build the route between them from the parts below. Any build that works counts.' },
  missing: { name: '1 part missing', blurb: 'One part is held back. Pick it below, then click the stage where the chain needs it.' },
  missing2: { name: '2 parts missing', blurb: 'Two parts are held back. Put both where the chain needs them.' },
  moved: { name: 'a part moved', blurb: 'Every part is here, but one is in the wrong place. Click it to pick it up, then drop it where it belongs.' },
};

/** The goal chain with its current state, shared by the build and fix panels. */
function ChainList({ goal, parts }: { goal: { type: string; part: string; times?: number }[]; parts: { id: string; kind: string }[] }) {
  const result = useMachine((s) => s.result);
  const celebrated = useMachine((s) => s.celebrated);
  const phase = useMachine((s) => s.phase);
  const done = phase === 'done';
  const name = (id: string) => parts.find((p) => p.id === id)?.kind ?? id;
  const label = (g: { type: string; part: string; times?: number }) => {
    switch (g.type) {
      case 'bucket': return `Land in the ${name(g.part)}`;
      case 'bell': return (g.times ?? 1) > 1 ? `Ring the bell ${g.times} times` : 'Ring the bell';
      case 'topple': return 'Topple the dominoes';
      default: return `Reach the ${name(g.part)}`;
    }
  };
  return (
    <ol className="chain-list">
      {goal.map((g, i) => {
        const step = result?.steps[i];
        const state = i < celebrated || (done && step?.satisfied) ? 'done' : done && step && !step.satisfied && result?.failedAt === i ? 'failed' : 'todo';
        return <li key={i} className={state}>{state === 'done' ? '✓' : state === 'failed' ? '✗' : '○'} {label(g)}{state === 'failed' && step ? <span className="muted"> · {step.note}</span> : null}</li>;
      })}
    </ol>
  );
}

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

/** Example levels the AI built from one sentence each; they open at once. */
function LevelStrip({ onPick }: { onPick: () => void }) {
  const busy = useMachine((s) => s.ai.busy);
  const current = useMachine((s) => s.level?.slug);
  if (!LEVELS.length) return null;
  return (
    <div className="levels">
      {LEVELS.map((l) => (
        <button key={l.slug} className={`level ${current === l.slug ? 'active' : ''}`} disabled={busy} onClick={() => { onPick(); void useMachine.getState().playLevel(l); }} title={`“${l.mission}”`}>
          <span className="card-face">{l.emoji}</span>
          <span className="card-title">{l.name}</span>
        </button>
      ))}
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
        <p className="tagline">Tell the AI <b>a goal and a place</b>. It builds the level: the targets, the walls, and a route it keeps to itself. <b>You get the parts and build the route.</b> Real physics is the judge.</p>
        {LEVELS.length > 0 && <p className="muted small">Play a level the AI already made:</p>}
        <LevelStrip onPick={onClose} />
        <p className="muted small">{LEVELS.length ? 'Or make your own. Pick a mission:' : 'Pick a mission:'}</p>
        <CardDeck onPick={onClose} big />
        <div className="welcome-actions">
          <button className="primary" onClick={onClose}>✍️ I'll write my own mission</button>
          <button onClick={() => { onClose(); void useMachine.getState().playDaily(); }} disabled={daily.loading}>📅 Today's level</button>
        </div>
        <p className="muted small">Drag to look around · wheel to zoom</p>
      </div>
    </div>
  );
}

/** After an example level: this is what one sentence makes; now write yours. */
function MakeYourOwn({ inputRef }: { inputRef: React.RefObject<HTMLInputElement | null> }) {
  const level = useMachine((s) => s.level);
  const solved = useMachine((s) => s.fix?.solved ?? false);
  const builds = useMachine((s) => s.builds);
  if (!level || !solved || builds > 0) return null;
  return (
    <div className="coach-pop">
      <span>This level came from one sentence: <i>“{level.mission}”</i>. <b>Now make your own</b>: tell the AI a goal and a place.</span>
      <button className="primary" onClick={() => inputRef.current?.focus()}>✍️ Write a mission</button>
    </div>
  );
}

/** Two short nudges once the player's first machine runs: edit by talking, then the harder breaks. */
function Coach() {
  const builds = useMachine((s) => s.builds);
  const busy = useMachine((s) => s.ai.busy);
  const [step, setStep] = useState<0 | 1 | 2>(() => (flag(COACH_KEY) ? 2 : 0));
  if (step === 2 || builds === 0 || busy) return null;
  const next = () => { if (step === 1) setFlag(COACH_KEY); setStep((s) => (s + 1) as 0 | 1 | 2); };
  return (
    <div className="coach-pop">
      {step === 0
        ? <span>It runs! Now <b>change it by talking</b>: try “add a trampoline” or “make it ring the bell twice”. <b>Click a part</b> to put its name in the prompt. Each change is a new puzzle.</span>
        : <span>Other breaks: <b>🔧 Break it again</b> hides a part or moves one. The 📅 Daily is the same machine for everyone.</span>}
      <button onClick={next}>{step === 0 ? 'Next' : 'Got it'}</button>
    </div>
  );
}

/** Puzzle play (a built machine arrives with a part held back) or just watch it run. */
function ModeSwitch() {
  const puzzle = useMachine((s) => s.puzzle);
  const { setPuzzle } = useMachine.getState();
  return (
    <div className="mswitch" role="radiogroup" aria-label="Play mode" title="Puzzle: you get the parts and build the chain. Watch: the AI's machine just runs.">
      <button className={puzzle ? 'active' : ''} onClick={() => setPuzzle(true)}>🧩 Puzzle</button>
      <button className={puzzle ? '' : 'active'} onClick={() => setPuzzle(false)}>👀 Watch</button>
    </div>
  );
}

function PromptBar({ inputRef }: { inputRef: React.RefObject<HTMLInputElement | null> }) {
  const ai = useMachine((s) => s.ai);
  const machine = useMachine((s) => s.machine);
  const builds = useMachine((s) => s.builds);
  const text = useMachine((s) => s.draft);
  const draftFocus = useMachine((s) => s.draftFocus);
  const { create, edit, setDraft } = useMachine.getState();
  const [deck, setDeck] = useState(false);
  // Edits apply to a machine the player built; the sample is only there to watch.
  const editing = !!machine && !ai.busy && builds > 0;
  // A part clicked on the stage lands in the draft; put the caret after it.
  useEffect(() => {
    if (!draftFocus) return;
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [draftFocus, inputRef]);
  const submit = () => {
    const t = text.trim();
    if (!t || ai.busy) return;
    void (editing && !startsFresh(t) ? edit(t) : create(t));
    setDraft('');
  };
  return (
    <div className="mprompt">
      {deck && !ai.busy && <CardDeck onPick={() => setDeck(false)} />}
      <form onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <button type="button" className={`lucky ${deck ? 'active' : ''}`} onClick={() => setDeck((d) => !d)} disabled={ai.busy} title="Pick a card instead of typing">🎲</button>
        <input
          ref={inputRef}
          value={text}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={400}
          placeholder={editing ? 'Change it: “move the fan closer”, “add a trampoline”… Click a part to name it.' : 'Your mission: a goal and a place, e.g. “ring the bell behind the castle wall”'}
          disabled={ai.busy}
          aria-label="Describe your machine"
        />
        <button className="primary" disabled={ai.busy || !text.trim()}>{ai.busy ? 'Building…' : editing ? 'Change' : 'Make the level'}</button>
      </form>
      {!ai.busy && editing && !deck && (
        <div className="examples">
          <span className="muted lock" title="The ball and the targets (bucket, bell, dominoes) stay where they are. You change the route between them.">🔒 ball &amp; targets stay put</span>
          {EDIT_IDEAS.map((ex) => <button key={ex} onClick={() => setDraft(ex)}>{ex}</button>)}
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
  const puzzle = useMachine((s) => s.puzzle);
  if (!ai.busy && !ai.error && !ai.lines.length) return null;
  // In puzzle play the stage shows only the targets; say how much is going into the bin instead.
  const bin = puzzle && ai.busy && ai.sketch ? ai.sketch.parts.filter((p) => !TARGET_KINDS.includes(p.kind)).length : 0;
  return (
    <div className="mlog">
      {puzzle && ai.busy && ai.sketch && <div className="muted small">{ai.sketch.title ? `“${ai.sketch.title}”: ` : ''}targets on the stage, {bin} part{bin === 1 ? '' : 's'} for your bin so far.</div>}
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
  const { pick, pickPlaced, clearPlaced, runFix, showHint, leaveFix, nextDailyStage, startFix } = useMachine.getState();
  const [breaking, setBreaking] = useState(false);
  const allPlaced = fix.puzzle.missing.every((m) => fix.placed.some((p) => p.id === m.id));
  const failed = phase === 'done' && result && !result.success ? result.steps.find((s) => !s.satisfied) : null;
  const level = useMachine((s) => s.level);
  const inDaily = !!daily.date;
  const lastStage = daily.stage >= DAILY_LADDER.length;
  const stageLabel = inDaily ? `Daily ${Math.min(daily.stage, DAILY_LADDER.length)}/${DAILY_LADDER.length}: ` : fix.kind === 'connect' ? '' : 'Fix it: ';
  // R turns the part in hand; up/down raise or lower a shelf; Escape puts it down.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.key === 'r' || e.key === 'R') useMachine.getState().rotatePicked();
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); useMachine.getState().liftBy(e.key === 'ArrowUp' ? 1 : -1); }
      if (e.key === 'Escape') pick(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pick]);
  const label = (kind: string, length?: number) => kind === 'dominoes' || kind === 'platform' ? `${kind} x${length ?? (kind === 'dominoes' ? 5 : 3)}` : kind;
  return (
    <div className="mgoal mfix">
      <div className="mtitle">
        <h2>{stageLabel}{fix.puzzle.solution.title}</h2>
        {level && <p className="mission">Mission: “{level.mission}”</p>}
        <p>{fix.solved
          ? `${fix.puzzle.verified === false ? 'Solved' : 'Fixed'} in ${tries(fix.tries)}!${inDaily ? ` ${tries(daily.tries)} so far today.` : ''}`
          : fix.puzzle.verified === false
            ? `The AI set the stage and picked the parts, but nobody has solved this level yet. Physics decides. Its own idea used ${fix.puzzle.missing.length} of the ${fix.hand.length} parts below.`
            : KIND_LABEL[fix.kind].blurb}</p>
      </div>
      <ChainList goal={fix.puzzle.solution.goal} parts={fix.puzzle.solution.parts} />
      {!fix.solved && (
        <div className="mbin">
          {fix.hand.map((m, i) => {
            const placed = fix.placed.find((p) => p.id === m.id);
            return (
              <button key={m.id} className={`part ${fix.picking === i ? 'active' : ''} ${placed ? 'down' : ''}`} onClick={() => (placed ? pickPlaced(m.id) : pick(i))} title={placed ? 'Pick it up again' : 'Pick it, then click the stage'}>
                {PART_ICON[m.kind]} {label(m.kind, m.length)}
              </button>
            );
          })}
          {fix.picking !== null && <button onClick={() => useMachine.getState().rotatePicked()} title="Turn the part in hand (R)">↻ Turn</button>}
          {fix.picking !== null && fix.hand[fix.picking].kind === 'platform' && (
            <span className="lift" title="Shelf height (arrow keys)">
              <button onClick={() => useMachine.getState().liftBy(-1)} disabled={fix.lift <= 0}>▼</button>
              height {fix.lift}
              <button onClick={() => useMachine.getState().liftBy(1)}>▲</button>
            </span>
          )}
        </div>
      )}
      {!fix.solved && fix.picking !== null && (
        <div className="muted small">
          {fix.hand[fix.picking].kind === 'platform'
            ? `Click the stage to put the shelf there, ${fix.lift ? `${fix.lift} cell${fix.lift > 1 ? 's' : ''} up` : 'on the floor'}. Arrow keys change the height, R turns it. Parts can stand on it.`
            : `Click the stage to drop the ${fix.hand[fix.picking].kind}. It lands on the floor or on a shelf. Turn it with R.`}
        </div>
      )}
      {failed && !fix.solved && <div className="mnote">✗ {failed.note}</div>}
      <div className="mactions">
        {!fix.solved && <button className="primary" onClick={() => void runFix()} disabled={!fix.placed.length || phase === 'simulating' || phase === 'playing'} title={allPlaced ? '' : 'You can test it before every part is down'}>▶ Run ({tries(fix.tries)})</button>}
        {!fix.solved && <button onClick={clearPlaced} disabled={!fix.placed.length}>Clear</button>}
        {!fix.solved && !fix.hint && fix.tries >= 2 && <button onClick={showHint} title={fix.puzzle.verified === false ? 'Shows the AI\'s own idea; nobody has tested it' : ''}>{fix.puzzle.verified === false ? 'AI\'s idea' : 'Hint'}</button>}
        {fix.solved && inDaily && !lastStage && <button className="primary" onClick={() => void nextDailyStage()} disabled={phase === 'simulating'}>Next: {KIND_LABEL[DAILY_LADDER[daily.stage]].name} →</button>}
        {fix.solved && inDaily && lastStage && <span className="badge ok">Daily done in {tries(daily.tries)}{daily.best[daily.date] ? ` · best ${daily.best[daily.date]}` : ''}</span>}
        {fix.solved && !inDaily && !breaking && <button onClick={() => setBreaking(true)}>🔧 Break it again</button>}
        <button onClick={leaveFix}>{fix.solved ? '▶ Watch it whole' : 'Give up'}</button>
      </div>
      {breaking && (
        <div className="mbin mbreak">
          <span className="muted">How?</span>
          {PUZZLE_KINDS.filter((k) => k !== fix.kind).map((k) => <button key={k} onClick={() => { setBreaking(false); void startFix(k); }}>{KIND_LABEL[k].name}</button>)}
          <button onClick={() => setBreaking(false)}>✕</button>
        </div>
      )}
    </div>
  );
}

function GoalPanel() {
  const machine = useMachine((s) => s.machine);
  const result = useMachine((s) => s.result);
  const phase = useMachine((s) => s.phase);
  const proven = useMachine((s) => s.proven);
  const working = useMachine((s) => s.working);
  const moved = useMachine((s) => s.moved);
  const mode = useMachine((s) => s.mode);
  const { play, startFix } = useMachine.getState();
  const [breaking, setBreaking] = useState(false);
  if (!machine) return null;
  if (mode === 'fix') return <FixPanel />;
  const done = phase === 'done';
  return (
    <div className="mgoal">
      <div className="mtitle">
        <h2>{machine.title}</h2>
        {machine.caption && <p>{machine.caption}</p>}
      </div>
      <ChainList goal={machine.goal} parts={machine.parts} />
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
  const solved = useMachine((s) => s.fix?.solved ?? false);
  // In fix mode the prompt waits until the puzzle is solved; then the player can change the machine.
  const prompting = mode !== 'fix' || solved;
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
          <span className="mtag">One sentence makes a level. You build the route. Physics judges.</span>
        </div>
        <div className="hud-right"><ModeSwitch />{LEVELS.length > 0 && <button onClick={() => setWelcome(true)} title="Example levels and missions">🎮 Levels</button>}<DailyButton /></div>
      </div>
      <div className="mside">
        <GoalPanel />
        <AiLog />
        {error && <div className="error-inline">{error}</div>}
      </div>
      <div className="hud-bottom">
        {prompting && <MakeYourOwn inputRef={inputRef} />}
        {prompting && <Coach />}
        {prompting && <PromptBar inputRef={inputRef} />}
      </div>
      {welcome && <Welcome onClose={closeWelcome} />}
    </div>
  );
}
