import { useEffect, useRef, useState } from 'react';
import demo from '@og/machine/fixtures/ramp-dominoes-bell.json' with { type: 'json' };
import { parseMachine, partNames, PUZZLE_KINDS, rulesLine, type MachineSpec, type Part, type PartKind, type PuzzleKind } from '@og/machine';
import { CARDS, dealCards, editIdeas } from './cards';
import { clearShareLink, galleryAsLevel, LEVELS, readShareLink, sharedAsLevel, shareLink } from './levels';
import { getMachine, listMachines, type MachineItem, type Score } from './machineClient';
import { MachineScene } from './MachineScene';
import { isMuted, setMuted } from '../game/audio';
import { DAILY_LADDER, HINT_COST, parOf, useMachine } from './machineStore';
import { addedPart, isEditInstruction } from './commands';
import { LookWorkshop } from './LookWorkshop';
import { PartsTray } from './PartsTray';
import { guideDismissed, WorkshopGuide } from './WorkshopGuide';
import { SettingsPanel } from './SettingsPanel';
import { themeStyle, useSettings } from './settings';

const WELCOME_KEY = 'pg.welcomed';
const flag = (key: string) => { try { return localStorage.getItem(key) === '1'; } catch { return false; } };
const setFlag = (key: string) => { try { localStorage.setItem(key, '1'); } catch { /* private mode */ } };

const PART_ICON: Record<PartKind, string> = { ball: '🔴', ramp: '📐', platform: '▬', wall: '🧱', dominoes: '🁢', seesaw: '⚖️', fan: '🌀', trampoline: '🛏️', cannon: '💣', bucket: '🪣', bell: '🔔' };
const PART_TIP: Record<PartKind, string> = {
  ball: 'Gravity starts the marble moving.', ramp: 'Put the high end under the marble. It rolls down toward the low end.',
  platform: 'A shelf supports other parts. Use ↑ and ↓ to choose its height.', wall: 'A wall blocks the marble or redirects it.',
  dominoes: 'Hit the first domino from behind to start the row falling.', seesaw: 'A falling marble tips the plank and rolls off the other end.',
  fan: 'Blows a nearby marble forward. Point it in the direction you want to go.', trampoline: 'Catches a falling marble and bounces it upward.',
  cannon: 'Catches a marble at its base and fires it along the barrel. It fires automatically.', bucket: 'Catch the marble inside the open top.', bell: 'Touch the bell with the marble or a falling domino.',
};

const KIND_LABEL: Record<PuzzleKind, { name: string; blurb: string }> = {
  connect: { name: 'build the route', blurb: 'The ball, the targets and the scenery are where they are. Build the route between them from the Parts tray. Any build that works counts.' },
  missing: { name: '1 part missing', blurb: 'One part is held back. Pick it in the Parts tray, then click the stage where the chain needs it.' },
  missing2: { name: '2 parts missing', blurb: 'Two parts are held back. Pick them in the Parts tray and put them where the chain needs them.' },
  moved: { name: 'a part moved', blurb: 'Every part is here, but one is in the wrong place. Drag it (or click it, then click) to where it belongs.' },
};

/** The goal chain with its current state, shared by the build and fix panels. */
function ChainList({ goal, parts }: { goal: { type: string; part: string; times?: number }[]; parts: Part[] }) {
  const result = useMachine((s) => s.result);
  const celebrated = useMachine((s) => s.celebrated);
  const phase = useMachine((s) => s.phase);
  const done = phase === 'done';
  const names = partNames(parts);
  const name = (id: string) => names.get(id) ?? id;
  const label = (g: { type: string; part: string; times?: number }) => {
    switch (g.type) {
      case 'bucket': return `Land in the ${name(g.part)}`;
      case 'bell': return `Ring the ${name(g.part)}${(g.times ?? 1) > 1 ? ` ${g.times} times` : ''}`;
      case 'topple': return `Topple the ${name(g.part)}`;
      default: return `Reach the ${name(g.part)}`;
    }
  };
  return (
    <ol className="chain-list">
      {goal.map((g, i) => {
        const step = result?.steps[i];
        const state = i < celebrated || (done && step?.satisfied) ? 'done' : done && step && !step.satisfied && result?.failedAt === i ? 'failed' : 'todo';
        return <li key={i} className={state}><span className="chain-number" aria-hidden="true">{state === 'done' ? '✓' : state === 'failed' ? '!' : String(i + 1).padStart(2, '0')}</span><span>{label(g)}{state === 'failed' && step ? <span className="muted">{step.note}</span> : null}</span></li>;
      })}
    </ol>
  );
}

/** A hand of three prompt cards; clicking one builds that machine. */
function CardDeck({ onPick, big = false }: { onPick: () => void; big?: boolean }) {
  const busy = useMachine((s) => s.ai.busy);
  const [offset, setOffset] = useState(0);
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
  const stars = useMachine((s) => s.stars);
  if (!LEVELS.length) return null;
  return (
    <div className="levels">
      {LEVELS.map((l) => (
        <button key={l.slug} className={`level ${current === l.slug ? 'active' : ''}`} disabled={busy} onClick={() => { onPick(); void useMachine.getState().playLevel(l); }} title={`“${l.mission}”`}>
          <span className="card-face">{l.emoji}</span>
          <span className="card-title">{l.name}</span>
          {stars[l.slug] ? <span className="stars" aria-label={`${stars[l.slug]} of 3 stars`}>{starRow(stars[l.slug])}</span> : <span className="muted small">#{l.order}</span>}
        </button>
      ))}
    </div>
  );
}

/** Levels players made and published, each solved by its publisher's build. */
function CommunityStrip({ onPick }: { onPick: () => void }) {
  const busy = useMachine((s) => s.ai.busy);
  const [items, setItems] = useState<MachineItem[] | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    listMachines('top').then((xs) => live && setItems(xs), () => live && setItems([]));
    return () => { live = false; };
  }, []);
  if (!items?.length) return null;
  const open = async (id: string) => {
    setOpening(id);
    try {
      const entry = await getMachine(id);
      const parsed = parseMachine(entry.machine);
      if (!parsed.ok) throw new Error('That level no longer loads.');
      onPick();
      await useMachine.getState().playLevel(galleryAsLevel({ ...entry, machine: parsed.spec }));
    } catch (err) {
      useMachine.setState({ error: err instanceof Error ? err.message : String(err) });
    } finally {
      setOpening(null);
    }
  };
  return (
    <>
      <p className="muted small">Levels other players made:</p>
      <div className="levels community">
        {items.slice(0, 8).map((m) => (
          <button key={m.id} className="level" disabled={busy || !!opening} onClick={() => void open(m.id)} title={m.mission ? `“${m.mission}” by ${m.author}` : `by ${m.author}`}>
            <span className="card-face">{opening === m.id ? '◌' : '🌍'}</span>
            <span className="card-title">{m.title}</span>
            <span className="muted small">{m.author} · {m.clears} solved{m.board[0] ? ` · best ${m.board[0].parts} parts` : ''}</span>
          </button>
        ))}
      </div>
    </>
  );
}

/** Best builds: a community level's (fewest parts) or today's daily (fewest tries). */
function BoardView({ rows, rank, kind }: { rows: Score[]; rank?: number; kind: 'level' | 'daily' }) {
  if (!rows.length) return null;
  return (
    <ol className="board">
      {rows.slice(0, 5).map((r, i) => (
        <li key={r.name} className={rank === i + 1 ? 'me' : ''}>
          <span>{i + 1}. {r.name}</span>
          <span className="muted">{kind === 'daily' ? `${tries(r.tries)} · ${r.parts} parts` : `${r.parts} parts · ${tries(r.tries)}`}</span>
        </li>
      ))}
      {rank !== undefined && rank > 5 && <li className="me"><span>{rank}. you</span></li>}
    </ol>
  );
}

/** The name that goes on boards and published levels; kept in this browser. */
function NameField() {
  const name = useMachine((s) => s.playerName);
  return <input className="name-field" value={name} onChange={(e) => useMachine.getState().setPlayerName(e.target.value)} placeholder="Your name" maxLength={24} aria-label="Your name for the boards" />;
}

/** After solving: the board for a community level, the daily board, or a button to publish the level. */
function AfterSolve({ inDaily, lastStage }: { inDaily: boolean; lastStage: boolean }) {
  const board = useMachine((s) => s.board);
  const level = useMachine((s) => s.level);
  const { postDaily, publish } = useMachine.getState();
  const [published, setPublished] = useState<{ title: string } | { error: string } | 'busy' | null>(null);
  if (inDaily) {
    if (!lastStage) return null;
    const posted = board?.kind === 'daily' && board.rank;
    return (
      <div className="after-solve">
        {!posted && <div className="mactions"><NameField /><button className="primary" disabled={board?.busy} onClick={() => void postDaily()}>🏆 Post to today's board</button></div>}
        {board?.kind === 'daily' && board.error && <div className="mnote">{board.error}</div>}
        {board?.kind === 'daily' && <BoardView rows={board.rows} rank={board.rank} kind="daily" />}
      </div>
    );
  }
  if (level?.gallery) {
    return (
      <div className="after-solve">
        {board?.busy && <div className="muted small">◌ The server is checking your build…</div>}
        {board?.error && <div className="mnote">{board.error}</div>}
        {board?.kind === 'level' && board.rank ? <div className="muted small">Your build is #{board.rank} on this level's board (fewest parts wins).</div> : null}
        {board?.kind === 'level' && <BoardView rows={board.rows} rank={board.rank} kind="level" />}
      </div>
    );
  }
  // Built-in levels are already for everyone; anything else (an AI level, a shared one) can be published.
  if (level && !level.gallery && level.slug !== 'shared') return null;
  return (
    <div className="after-solve">
      {published && typeof published === 'object' && 'title' in published
        ? <div className="muted small">🌍 Published “{published.title}”: it is in the community levels now.</div>
        : (
          <div className="mactions">
            <NameField />
            <button disabled={published === 'busy'} onClick={() => { setPublished('busy'); publish().then((m) => { setPublished({ title: m.title }); }, (err: unknown) => setPublished({ error: err instanceof Error ? err.message : String(err) })); }} title="Your winning build goes up with it: the server runs it before the level is listed">🌍 Publish this level</button>
          </div>
        )}
      {published && typeof published === 'object' && 'error' in published && <div className="mnote">{published.error}</div>}
    </div>
  );
}

/** A native illustration keeps the workshop's visual identity lightweight. */
function WorkshopSketch() {
  return <svg className="workshop-sketch" viewBox="0 0 360 240" aria-hidden="true">
    <defs><pattern id="sketch-grid" width="20" height="20" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1" fill="#648987" opacity=".3" /></pattern></defs>
    <rect x="0" y="0" width="360" height="240" rx="20" fill="url(#sketch-grid)" />
    <path d="M34 169 H326" stroke="#55746f" strokeWidth="2" />
    <path d="M42 111 V167 H145 Z" fill="#83c8be" stroke="#b0e1d8" strokeWidth="2" strokeLinejoin="round" />
    <circle cx="62" cy="98" r="13" fill="#ff9c78" stroke="#ffd0ba" strokeWidth="3" />
    <path d="M132 130 Q198 7 288 119" fill="none" stroke="#ffcd73" strokeWidth="2" strokeDasharray="5 7" />
    <path d="m279 112 10 9 2-14" fill="none" stroke="#ffcd73" strokeWidth="2" strokeLinecap="round" />
    <path d="M253 156h67l-8-17v-17c0-32-50-32-50 0v17z" fill="#ffcd73" stroke="#ffe4ac" strokeWidth="2" strokeLinejoin="round" />
    <circle cx="286" cy="91" r="5" fill="#ffcd73" /><path d="M278 164q8 12 16 0" fill="none" stroke="#ffcd73" strokeWidth="4" strokeLinecap="round" />
    <path d="m327 108 9-6m-9 26h12m-93-22-9-6" stroke="#b0e1d8" strokeWidth="2" strokeLinecap="round" />
    <text x="35" y="202" fill="#afc8c3" fontSize="11" fontFamily="inherit">A small nudge.</text>
    <text x="226" y="202" fill="#ffdd99" fontSize="11" fontFamily="inherit">A satisfying finish.</text>
  </svg>;
}

/** First visit has one clear creation path and an optional one-part lesson. */
function Welcome({ onClose, library = false }: { onClose: () => void; library?: boolean }) {
  const busy = useMachine((s) => s.ai.busy);
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const panel = dialog.current;
    panel?.querySelector<HTMLButtonElement>('button')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); }
      if (e.key !== 'Tab' || !panel) return;
      const items = [...panel.querySelectorAll<HTMLElement>('button:not(:disabled), summary, input')].filter((el) => el.getClientRects().length);
      const first = items[0], last = items.at(-1);
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="welcome" role="dialog" aria-modal="true" aria-label={library ? 'Puzzle library' : 'Welcome to Prompt Goldberg'} ref={dialog}>
      <div className={`welcome-card ${library ? 'library-card' : ''}`}>
        <button className="dialog-close" onClick={onClose} aria-label="Close welcome">×</button>
        <span className="eyebrow">THE CHAIN REACTION WORKSHOP</span>
        {library ? <><h1>Pick a little challenge.</h1><p className="tagline">The stage is set. The missing link is you.</p><button className="primary" onClick={() => { onClose(); void useMachine.getState().startTutorial(); }}>Learn with one part</button></> : <>
        <div className="welcome-hero"><div>
        <h1>Small idea.<br /><span>Big chain reaction.</span></h1>
        <p className="tagline">Give this little marble somewhere to go.<br />Place a part. Press Run. See what happens.</p>
        <div className="welcome-actions">
          <button className="primary" onClick={() => { onClose(); void useMachine.getState().startTutorial(); }} disabled={busy}>Show me how →</button>
          <button onClick={() => { useMachine.getState().setPromptMode('edit'); onClose(); }}>Explore this machine</button>
        </div>
        </div><WorkshopSketch /></div>
        <div className="welcome-steps"><span>01 · Place</span><span>02 · Run</span><span>03 · Make it yours</span></div>
        <details className="level-library"><summary>Or create a different machine from an idea</summary><CardDeck onPick={onClose} big /></details>
        </>}
        <details className="level-library" open={library || undefined}>
          <summary>Explore 10 ready-made puzzles & community levels</summary>
          <LevelStrip onPick={onClose} />
          <CommunityStrip onPick={onClose} />
        </details>
        <button className="text-button" onClick={onClose}>{library ? 'Back to the workshop' : 'Explore the sample first'}</button>
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
      <button className="primary" onClick={() => { useMachine.getState().setPromptMode('create'); inputRef.current?.focus(); }}>Write a mission</button>
    </div>
  );
}

/** Switch the current machine between replay and a resumable building challenge. */
function ModeSwitch() {
  const fix = useMachine((s) => s.fix);
  const busy = useMachine((s) => s.ai.busy || s.phase === 'simulating');
  if (!fix) return null;
  return <button disabled={busy} onClick={() => useMachine.getState().setPuzzle(false)} title="Return to the complete machine. Revealing an unsolved puzzle costs two tries.">← Workshop</button>;
}

function PromptBar({ inputRef }: { inputRef: React.RefObject<HTMLInputElement | null> }) {
  const ai = useMachine((s) => s.ai);
  const machine = useMachine((s) => s.machine);
  const promptMode = useMachine((s) => s.promptMode);
  const text = useMachine((s) => s.draft);
  const draftFocus = useMachine((s) => s.draftFocus);
  const notice = useMachine((s) => s.notice);
  const pending = useMachine((s) => s.pendingPart);
  const undo = useMachine((s) => !!s.lastEdit);
  const remix = useMachine((s) => s.remix);
  const { submitPrompt, setDraft, setPromptMode } = useMachine.getState();
  const [deck, setDeck] = useState(false);
  const editing = !!machine && (promptMode === 'edit' || isEditInstruction(text));
  const adding = !!machine && addedPart(text);
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
    void submitPrompt(t);
    if (adding) inputRef.current?.blur();
  };
  return (
    <div className="mprompt">
      <div className="prompt-heading">
        <span className="prompt-context">{editing ? 'Change this machine' : 'Create a different machine'}</span>
        <span className="prompt-help">{ai.busy ? 'Working on your change…' : editing ? machine?.title : 'Describe a whole new idea.'}</span>
        {!ai.busy && <button type="button" className="text-button new-machine" onClick={() => setPromptMode(editing ? 'create' : 'edit')}>{editing ? 'New machine…' : 'Back to this machine'}</button>}
        {ai.busy && <button type="button" className="text-button" onClick={() => useMachine.getState().stopAi()}>Cancel</button>}
      </div>
      {deck && !ai.busy && <CardDeck onPick={() => setDeck(false)} />}
      <form onSubmit={(e) => { e.preventDefault(); submit(); }}>
        {!editing && <button type="button" className={`lucky ${deck ? 'active' : ''}`} onClick={() => setDeck((d) => !d)} disabled={ai.busy} title="Pick a new machine idea">🎲</button>}
        <input
          ref={inputRef}
          value={text}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={editing ? 300 : 500}
          placeholder={editing ? 'Try “add a fan” or “paint the ramp pink”…' : 'e.g. Launch a marble over a river into a bucket'}
          disabled={ai.busy}
          aria-label={editing ? 'Describe your edit' : 'Describe your machine'}
        />
        <button className="primary" disabled={ai.busy || !text.trim()}>{ai.busy ? 'Working…' : adding ? 'Add part →' : editing ? 'Change it →' : 'Create →'}</button>
      </form>
      {ai.error && <div className="error-inline" role="alert">{ai.error}</div>}
      {remix && <div className="edit-notice remix-offer" role="alertdialog" aria-label="Make it your own copy?"><span>That change reshapes the puzzle itself (it passed the physics check). Make it your own copy? The scored run ends and the full machine shows.</span><button className="primary" onClick={() => void useMachine.getState().acceptRemix()}>Make it my copy</button><button onClick={() => useMachine.getState().declineRemix()}>Keep playing</button></div>}
      {notice && <div className="edit-notice" role="status"><span>{notice}</span>{pending && <><button onClick={() => useMachine.getState().rotatePicked()}>↻ Turn</button><button onClick={() => useMachine.getState().cancelPlacement()}>Cancel</button></>}{!pending && undo && <button disabled={ai.busy} onClick={() => useMachine.getState().undoEdit()}>Undo</button>}</div>}
      {!ai.busy && !editing && !deck && <div className="examples create-examples"><span>Try a little…</span>{CARDS.slice(0, 3).map((c) => <button key={c.title} onClick={() => { setDraft(c.prompt); inputRef.current?.focus(); }}>{c.emoji} {c.title}</button>)}<span className="prompt-key">Enter to create ↵</span></div>}
      {!ai.busy && editing && !deck && (
        <div className="examples">
          {editIdeas(machine!.parts).map((ex) => <button key={ex} onClick={() => { setDraft(ex); inputRef.current?.focus(); }}>{ex}</button>)}
        </div>
      )}
    </div>
  );
}

function AiLog() {
  const ai = useMachine((s) => s.ai);
  if (!ai.busy) return null;
  return (
    <div className="mlog" role="status">
      <div className="current">◌ {ai.lines.at(-1) ?? 'Contacting the AI designer…'}</div>
      {ai.progress > 0 && <div className="machine-bar"><div style={{ width: `${Math.round(ai.progress * 100)}%` }} /></div>}
    </div>
  );
}

const tries = (n: number) => `${n} ${n === 1 ? 'try' : 'tries'}`;

/** Copy a link to the level on screen (with the player's score once solved); the daily shares its result line. */
function ShareButton() {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const daily = useMachine((s) => s.daily);
  const share = async () => {
    const s = useMachine.getState();
    let text: string;
    if (daily.date) {
      text = `Prompt Goldberg daily ${daily.date}: ${daily.stage > DAILY_LADDER.length || (s.fix?.solved && daily.stage >= DAILY_LADDER.length) ? `all ${DAILY_LADDER.length} stages in ${tries(daily.tries)}` : `stage ${Math.min(daily.stage, DAILY_LADDER.length)}/${DAILY_LADDER.length}, ${tries(daily.tries)} so far`}. ${location.origin}${location.pathname}`;
    } else {
      const level = s.shareable();
      if (!level) return;
      const link = await shareLink(level);
      text = level.score
        ? `I solved “${level.spec.title}” in Prompt Goldberg ${'★'.repeat(level.score.stars)}${'☆'.repeat(3 - level.score.stars)} (${tries(level.score.tries)}, ${level.score.parts} parts). Can you beat it? ${link}`
        : `Can you build the route? “${level.spec.title}” in Prompt Goldberg: ${link}`;
    }
    const ok = await navigator.clipboard.writeText(text).then(() => true, () => false);
    setState(ok ? 'copied' : 'failed');
    setTimeout(() => setState('idle'), 2500);
  };
  return <button onClick={() => void share()} title="Copy a link to this level">{state === 'copied' ? '✓ Link copied' : state === 'failed' ? 'Copy failed' : daily.date ? '📋 Share result' : '🔗 Share'}</button>;
}

/** Someone shared a level with you: the sender's score, as the bar to beat. */
function SharedBanner() {
  const shared = useMachine((s) => s.sharedScore);
  const level = useMachine((s) => s.level);
  if (!shared || level?.slug !== 'shared') return null;
  return <p className="closest">🔗 A friend solved this {'★'.repeat(shared.stars)}{'☆'.repeat(3 - shared.stars)} in {tries(shared.tries)} with {shared.parts} parts. Beat it!</p>;
}
const starRow = (n: number) => '★'.repeat(n) + '☆'.repeat(3 - n);

/** The AI could not build the mission as asked: say so, plainly, instead of pretending. */
function Closest({ text }: { text?: string }) {
  if (!text) return null;
  return <p className="closest" title="The closest the AI could build with this kit">🤔 {text}</p>;
}

/** The game: something is wrong with the machine; put it right. */
function FixPanel() {
  const fix = useMachine((s) => s.fix)!;
  const tutorial = useMachine((s) => s.tutorial);
  const [tip, setTip] = useState(false);
  const phase = useMachine((s) => s.phase);
  const finished = fix.solved && phase === 'done';
  const result = useMachine((s) => s.result);
  const daily = useMachine((s) => s.daily);
  const { pick, clearPlaced, runFix, showHint, leaveFix, nextDailyStage, startFix } = useMachine.getState();
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
      if (useMachine.getState().pendingPart) return;
      if (e.key === 'r' || e.key === 'R') useMachine.getState().rotatePicked();
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); useMachine.getState().liftBy(e.key === 'ArrowUp' ? 1 : -1); }
      if (e.key === 'Escape') pick(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pick]);
  const par = parOf(fix.puzzle);
  return (
    <div className="mgoal mfix">
      <div className="mtitle">
        <span className="eyebrow">{tutorial ? 'YOUR FIRST CHAIN REACTION' : 'THE BUILD CHALLENGE'}</span>
        <h2>{tutorial ? 'One ramp. One big leap.' : `${stageLabel}${fix.puzzle.solution.title}`}</h2>
        {tutorial && <p className="tutorial-step">{finished ? 'You did it! Now give the same machine your own twist.' : fix.solved ? 'Follow the marble: down the ramp, into the cannon, across the river.' : fix.placed.length ? 'Step 2 · Press Run and watch the whole chain.' : 'Step 1 · Click the glowing ramp outline underneath the red marble.'}</p>}
        {tutorial && <ol className="learn-steps" aria-label="Learning progress"><li className={fix.placed.length ? 'complete' : 'current'}>Place the ramp</li><li className={fix.solved && phase === 'done' ? 'complete' : fix.placed.length ? 'current' : ''}>Run your machine</li><li className={fix.solved && phase === 'done' ? 'current' : ''}>Add your own twist</li></ol>}
        {level && <p className="mission">Mission: “{level.mission}”</p>}
        <Closest text={fix.puzzle.solution.closest} />
        {rulesLine(fix.puzzle.solution.rules) && <p className="challenge">🎯 {rulesLine(fix.puzzle.solution.rules)}</p>}
        <SharedBanner />
        {!tutorial && <p>{finished
          ? `${fix.kind === 'connect' ? 'Solved' : 'Fixed'} in ${tries(fix.tries)} with ${fix.placed.length} part${fix.placed.length === 1 ? '' : 's'}!${inDaily ? ` ${tries(daily.tries)} so far today.` : ''}`
          : fix.solved ? 'Watch the chain reach its finish…'
          : fix.puzzle.verified === false
            ? `The AI set the stage and picked the parts, but nobody has solved this level yet. Physics decides. Its own idea used ${par} of the ${fix.hand.length} parts in the tray.`
            : KIND_LABEL[fix.kind].blurb}</p>}
        {finished
          ? <p className="starline"><span className="stars big">{starRow(fix.stars)}</span>{fix.server === 'agrees' && <span className="badge ok" title="The server ran your build too and got the same run, bit for bit">✓ server agrees</span>} <span className="muted small">{fix.placed.length <= par ? `★ par ${par} parts or fewer` : `☆ par is ${par} parts`} · {fix.tries <= 3 ? '★ 3 tries or fewer' : '☆ 3 tries or fewer'}</span></p>
          : !tutorial && <p className="muted small">Par: {par} part{par === 1 ? '' : 's'} · {fix.hand.length - par} spare parts · solve in 3 tries for a bonus star</p>}
      </div>
      <ChainList goal={fix.puzzle.solution.goal} parts={fix.puzzle.solution.parts} />
      {!fix.solved && (
        <div className="mbin">
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
        <div className="part-guide">
          <b>{PART_ICON[fix.hand[fix.picking].kind]} {fix.hand[fix.picking].kind}</b>
          <span>{PART_TIP[fix.hand[fix.picking].kind]}</span>
          <small>
          {fix.hand[fix.picking].kind === 'platform'
            ? `Click the stage to put the shelf there, ${fix.lift ? `${fix.lift} cell${fix.lift > 1 ? 's' : ''} up` : 'on the floor'}. Arrow keys change the height, R turns it. Parts can stand on it.`
            : `Click the stage to drop the ${fix.hand[fix.picking].kind}. It lands on the floor or on a shelf. Turn it with R.`}
          </small>
        </div>
      )}
      {failed && !fix.solved && !tutorial && <button className="text-button" onClick={() => setTip((v) => !v)}>{tip ? 'Hide tip' : 'What should I try?'}</button>}
      {tip && failed && !fix.solved && <p className="part-guide">The route stopped before {partNames(fix.puzzle.solution.parts).get(fix.puzzle.solution.goal[failed.index]?.part) ?? 'the target'}. Follow the marble from the start. Check the last part it reached, then adjust the next part’s position or facing. You can test with only part of the route built.</p>}
      {failed && !fix.solved && <div className="mnote">✗ {failed.note}</div>}
      {phase === 'done' && !fix.solved && fix.broke?.map((b) => <div key={b} className="mnote">✗ It works, but: {b}</div>)}
      <div className="mactions">
        {!fix.solved && <button className="primary" onClick={() => void runFix()} disabled={!fix.placed.length || phase === 'simulating' || phase === 'playing'} title={allPlaced ? '' : 'You can test it before every part is down'}>▶ Run ({tries(fix.tries)})</button>}
        {!fix.solved && <button onClick={clearPlaced} disabled={!fix.placed.length}>Clear</button>}
        {!fix.solved && !fix.hint && fix.tries >= 2 && <button onClick={showHint} title={fix.puzzle.verified === false ? `Shows the AI's own idea; nobody has tested it. Costs ${HINT_COST} tries.` : `Shows where the parts go. Costs ${HINT_COST} tries.`}>{fix.puzzle.verified === false ? 'AI\'s idea' : 'Hint'} (+{HINT_COST} tries)</button>}
        {fix.solved && inDaily && !lastStage && <button className="primary" onClick={() => void nextDailyStage()} disabled={phase === 'simulating'}>Next: {KIND_LABEL[DAILY_LADDER[daily.stage]].name} →</button>}
        {fix.solved && inDaily && lastStage && <span className="badge ok">Daily done in {tries(daily.tries)}{daily.best[daily.date] ? ` · best ${daily.best[daily.date]}` : ''}</span>}
        {fix.solved && tutorial && phase === 'done' && <button className="primary" onClick={() => useMachine.getState().addPart('fan')}>Next: add a fan →</button>}
        {fix.solved && !tutorial && !inDaily && !breaking && <button onClick={() => setBreaking(true)}>Try another challenge</button>}
        {!tutorial && <ShareButton />}
        {!tutorial && <button onClick={leaveFix}>{fix.solved ? 'Replay my build' : `Watch solution${fix.hint ? '' : ` (+${HINT_COST} tries)`}`}</button>}
      </div>
      {finished && <AfterSolve inDaily={inDaily} lastStage={lastStage} />}
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

function GoalPanel({ example }: { example: boolean }) {
  const machine = useMachine((s) => s.machine);
  const result = useMachine((s) => s.result);
  const phase = useMachine((s) => s.phase);
  const proven = useMachine((s) => s.proven);
  const working = useMachine((s) => s.working);
  const mode = useMachine((s) => s.mode);
  const { startFix } = useMachine.getState();
  if (!machine) return null;
  if (mode === 'fix') return <FixPanel />;
  return (
    <div className="mgoal">
      <div className="mtitle">
        <span className="eyebrow">{example ? 'EXAMPLE MACHINE · READY TO TRY' : 'YOUR MACHINE · MAKE IT YOURS'}</span>
        <h2>{machine.title}</h2>
        {machine.caption && <p>{machine.caption}</p>}
        <Closest text={machine.closest} />
        {rulesLine(machine.rules) && <p className="challenge">{rulesLine(machine.rules)}</p>}
      </div>
      <ChainList goal={machine.goal} parts={machine.parts} />
      <div className="mbadges">
        {proven && <span className="badge ok">{phase === 'done' ? '✓ It works!' : phase === 'playing' ? 'Running…' : 'Ready to run'}</span>}
        {!proven && working && <span className="badge">◌ Proving it works…</span>}
        {!proven && !working && phase === 'done' && result && !result.success && <span className="badge warn">Not there yet. Try moving a part.</span>}
        {phase === 'simulating' && <span className="badge">Simulating…</span>}
      </div>
      <LookWorkshop machine={machine} />
      <details className="workshop-extra"><summary>Try a puzzle or share</summary><div className="mactions">
        {proven && !working && <button onClick={() => void startFix('connect')} disabled={phase === 'simulating'}>Rebuild this as a puzzle</button>}
        {proven && <ShareButton />}
      </div></details>
    </div>
  );
}

function StageControls({ onResetView, example }: { onResetView: () => void; example: boolean }) {
  const phase = useMachine((s) => s.phase);
  const time = useMachine((s) => s.time);
  const end = useMachine((s) => s.endTime);
  const run = useMachine((s) => s.run);
  const fix = useMachine((s) => s.fix);
  const busy = useMachine((s) => s.ai.busy);
  const machine = useMachine((s) => s.machine);
  const pending = useMachine((s) => s.pendingPart);
  const playing = phase === 'playing';
  const paused = phase === 'paused';
  const action = () => {
    if (playing) useMachine.setState({ phase: 'paused' });
    else if (paused) useMachine.setState({ phase: 'playing' });
    else useMachine.getState().play();
  };
  return <>
    <div className="stage-topbar">
      <div className="stage-mode"><span className={`status-dot ${playing ? 'running' : ''}`} /><span>{fix && !fix.solved ? 'BUILD YOUR ROUTE' : example ? 'EXAMPLE MACHINE' : 'THE WORKBENCH'}</span><span className="stage-count">{fix ? `${fix.placed.length} placed` : run ? `${run.spec.parts.length} parts` : ''}</span></div>
      <button className="fit-view" onClick={onResetView} title="Restore the view of the whole machine" aria-label="Fit whole machine in view">⤢ <span>Fit view</span></button>
    </div>
    <div className="stage-bottom">
      <div className="stage-transport">
        <button className="transport-button" onClick={action} disabled={!machine || !!pending || busy || phase === 'simulating' || (!!fix && !fix.solved && !fix.placed.length && !playing && !paused)} aria-label={playing ? 'Pause playback' : paused ? 'Continue playback' : 'Run machine'}>{playing ? 'Ⅱ' : phase === 'done' ? '↻' : '▶'}<span>{playing ? 'Pause' : paused ? 'Continue' : 'Run'}</span></button>
        <div className="transport-details"><span>{phase === 'simulating' ? 'Preparing the stage…' : playing ? 'Chain reaction in motion' : paused ? 'Paused · take a closer look' : phase === 'done' ? 'Ready for another run?' : 'Ready when you are'}</span><progress max={end || 1} value={Math.min(time, end || 1)} aria-label="Playback progress" /></div>
        <span className="transport-time">{time.toFixed(1)}<small>s</small></span>
      </div>
      <div className="camera-help">Drag a part to move · empty stage to orbit <span>· scroll to zoom</span></div>
    </div>
  </>;
}

function SoundToggle() {
  const [on, setOn] = useState(() => !isMuted());
  return <button onClick={() => { setMuted(on); setOn(!on); }} title={on ? 'Mute sound effects' : 'Enable sound effects'} aria-pressed={on}>{on ? '♫' : '♪'}<span className="label"> Sound</span></button>;
}

function DailyButton() {
  const daily = useMachine((s) => s.daily);
  const busy = useMachine((s) => s.ai.busy);
  const today = new Date().toISOString().slice(0, 10);
  const best = daily.best[today];
  return (
    <button onClick={() => void useMachine.getState().playDaily()} disabled={daily.loading || busy || !!daily.date} title="The same machine for everyone today, broken three ways">
      📅<span className="label">{daily.loading ? ' Loading…' : best ? ` Daily · best ${best}` : ' Daily puzzle'}</span>
    </button>
  );
}

export function MachineScreen() {
  const error = useMachine((s) => s.error);

  const [welcome, setWelcome] = useState<false | 'intro' | 'levels'>(false);
  const [showGuide, setShowGuide] = useState(() => !guideDismissed() && !location.hash.includes('pg='));
  const [guideVersion, setGuideVersion] = useState(0);
  const [exampleMachine, setExampleMachine] = useState<MachineSpec | null>(null);
  const machine = useMachine(s => s.machine);
  const example = !!machine && machine === exampleMachine;
  const [cameraReset, setCameraReset] = useState(0);
  const [settings, setSettings] = useState(false);
  const theme = useSettings((s) => s.theme);
  const inputRef = useRef<HTMLInputElement>(null);
  // A shared link opens its level at once; otherwise a sample machine runs until the visitor builds one.
  useEffect(() => {
    if (useMachine.getState().machine) return;
    let cancelled = false;
    void readShareLink().then((shared) => {
      if (cancelled || !shared) return;
      clearShareLink();
      setWelcome(false);
      useMachine.setState({ sharedScore: shared.score ?? null });
      void useMachine.getState().playLevel(sharedAsLevel(shared));
    });
    if (location.hash.includes('pg=')) return () => { cancelled = true; };
    const parsed = parseMachine({ ...demo, caption: 'A ready-made example. Run it, change it, then describe your own chain reaction.' });
    if (parsed.ok) { setExampleMachine(parsed.spec); void useMachine.getState().load(parsed.spec, { rank: 2, proven: true }); }
  }, []);
  const closeWelcome = () => { setFlag(WELCOME_KEY); setWelcome(false); };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!useMachine.getState().pendingPart || event.target instanceof HTMLInputElement) return;
      if (event.key.toLowerCase() === 'r') { event.preventDefault(); useMachine.getState().rotatePicked(); }
      if (event.key === 'Escape') { event.preventDefault(); useMachine.getState().cancelPlacement(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return (
    <div className="app play machine-screen" style={themeStyle(theme)}>
      <div className="machine-viewport"><MachineScene resetView={cameraReset} /><StageControls example={example} onResetView={() => setCameraReset((n) => n + 1)} /></div>
      <div className="hud-top">
        <div className="hud-left mbrand">
          <button className="brand" onClick={() => setWelcome('intro')} title="About the workshop"><span className="brand-mark" aria-hidden="true"><i /><i /><i /></span><span>Prompt <b>Goldberg</b></span></button>
          <span className="mtag">The chain reaction workshop</span>
        </div>
        <div className="hud-right"><ModeSwitch /><button onClick={() => { setWelcome(false); setGuideVersion(v => v + 1); setShowGuide(true); }}>?<span className="label"> How to play</span></button>{LEVELS.length > 0 && <button onClick={() => setWelcome('levels')} title="Example puzzles">🎮<span className="label"> Puzzles</span></button>}<details className="workshop-menu"><summary aria-label="More options">•••</summary><div><DailyButton /><SoundToggle /><button onClick={(e) => { (e.currentTarget.closest('details') as HTMLDetailsElement).open = false; setSettings(true); }} title="Stage size and theme">⚙<span className="label"> Settings</span></button></div></details></div>
      </div>
      <div className="mside">
        <GoalPanel example={example} />
        <AiLog />
        {error && <div className="error-inline">{error}</div>}
      </div>
      <PartsTray />
      <div className="hud-bottom">
        <MakeYourOwn inputRef={inputRef} />
        <PromptBar inputRef={inputRef} />
      </div>
      {welcome && <Welcome onClose={closeWelcome} library={welcome === 'levels'} />}
      {settings && <SettingsPanel onClose={() => setSettings(false)} />}
      {showGuide && !welcome && machine && <WorkshopGuide key={guideVersion} example={example} inputRef={inputRef} onClose={() => setShowGuide(false)} />}
    </div>
  );
}
