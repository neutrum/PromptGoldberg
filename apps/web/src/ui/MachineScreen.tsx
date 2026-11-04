import { useEffect, useRef, useState } from 'react';
import { isGadget, onPosts, parseMachine, partNames, rulesLine, type Part, type PartKind } from '@pg/core';
import { CARDS, dealCards } from './cards';
import { clearShareLink, galleryAsLevel, LEVELS, readShareLink, sharedAsLevel, shareLink } from './levels';
import { getMachine, listMachines, type MachineItem, type Score } from '../app/api';
import { MachineScene } from '../scene/MachineScene';
import { isMuted, setMuted, sfx } from '../platform/audio';
import { BUILD_STEPS, HINT_COST, parOf, useMachine } from '../app/game';
import { PartsTray } from './PartsTray';
import { resetHints, WorkshopGuide } from './WorkshopGuide';
import { BuildTip, Handbook, Scene, type HandbookTab } from './Handbook';
import { kitName, kitTip } from './kit';
import { SettingsPanel } from './SettingsPanel';
import { logPrompt, settlePrompt, usePromptLog, type PromptBox } from './promptLog';
import { themeStyle, useSettings } from './settings';

const PART_ICON: Record<PartKind, string> = { ball: '🔴', ramp: '📐', platform: '▬', wall: '🧱', dominoes: '🁢', seesaw: '⚖️', fan: '🌀', trampoline: '🛏️', cannon: '💣', bucket: '🪣', bell: '🔔', track: '🛤️', curve: '↪️', descent: '↘️', ascent: '↗️' };

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
        return <li key={i} className={state}><span className="chain-number" aria-hidden="true">{state === 'done' ? '✓' : state === 'failed' ? '!' : String(i + 1).padStart(2, '0')}</span><span>{label(g)}</span></li>;
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

/** Best builds, fewest parts first: a community level's or today's daily. */
function BoardView({ rows, rank }: { rows: Score[]; rank?: number }) {
  if (!rows.length) return null;
  return (
    <ol className="board">
      {rows.slice(0, 5).map((r, i) => (
        <li key={r.name} className={rank === i + 1 ? 'me' : ''}>
          <span>{i + 1}. {r.name}</span>
          <span className="muted">{`${r.parts} parts · ${tries(r.tries)}`}</span>
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
function AfterSolve({ inDaily }: { inDaily: boolean }) {
  const board = useMachine((s) => s.board);
  const level = useMachine((s) => s.level);
  const { postDaily, publish } = useMachine.getState();
  const [published, setPublished] = useState<{ title: string } | { error: string } | 'busy' | null>(null);
  if (inDaily) {
    const posted = board?.kind === 'daily' && board.rank;
    return (
      <div className="after-solve">
        {!posted && <div className="mactions"><NameField /><button className="primary" disabled={board?.busy} onClick={() => void postDaily()}>🏆 Post to today's board</button></div>}
        {board?.kind === 'daily' && board.error && <div className="mnote">{board.error}</div>}
        {board?.kind === 'daily' && <BoardView rows={board.rows} rank={board.rank} />}
      </div>
    );
  }
  if (level?.gallery) {
    return (
      <div className="after-solve">
        {board?.busy && <div className="muted small">◌ The server is checking your build…</div>}
        {board?.error && <div className="mnote">{board.error}</div>}
        {board?.kind === 'level' && board.rank ? <div className="muted small">Your build is #{board.rank} on this level's board (fewest parts wins).</div> : null}
        {board?.kind === 'level' && <BoardView rows={board.rows} rank={board.rank} />}
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

/** A won built-in level (from Levels): the stars, and the next one. Other levels keep their own panel. */
function SolvedCard({ onHome }: { onHome: () => void }) {
  const fix = useMachine((s) => s.fix);
  const phase = useMachine((s) => s.phase);
  const level = useMachine((s) => s.level);
  const [closed, setClosed] = useState<unknown>(null);
  if (!fix?.solved || phase !== 'done' || fix.assisted || closed === fix.puzzle || !level?.builtIn) return null;
  const sorted = [...LEVELS].sort((a, b) => a.order - b.order);
  const at = sorted.findIndex((l) => l.slug === level.slug);
  const next = sorted[at + 1];
  const play = (l: typeof LEVELS[number]) => void useMachine.getState().playLevel(l);
  return (
    <div className="solved-card" role="dialog" aria-label="Level solved">
      <button className="dialog-close" onClick={() => setClosed(fix.puzzle)} aria-label="Close">×</button>
      <span className="eyebrow">LEVEL SOLVED</span>
      <div className="solved-stars" aria-label={`${fix.stars} of 3 stars`}>{starRow(fix.stars)}</div>
      <p>{fix.puzzle.solution.title}: {tries(fix.tries)} with {fix.placed.length} part{fix.placed.length === 1 ? '' : 's'}.</p>
      <div className="mactions">
        {next
          ? <button className="primary" onClick={() => play(next)}>Next level → <span className="solved-next">{next.emoji} {next.name}</span></button>
          : <span className="muted small">That was the last level. Now make your own!</span>}
        <button onClick={() => play(sorted[at])}>↻ Play again</button>
        <button className={next ? '' : 'primary'} onClick={onHome}>🎨 Make your own level</button>
      </div>
    </div>
  );
}

/** The start: two doors. Make a level from one sentence (then test it and send it), or solve one. */
function Home({ onClose, onHandbook }: { onClose: () => void; onHandbook: (tab?: HandbookTab) => void }) {
  const busy = useMachine((s) => s.ai.busy);
  const [idea, setIdea] = useState('');
  const make = (text: string) => { if (!text.trim() || busy) return; onClose(); void useMachine.getState().create(text.trim()); };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="welcome home" role="dialog" aria-modal="true" aria-label="Prompt Goldberg">
      <div className="welcome-card home-card">
        <button className="dialog-close" onClick={onClose} aria-label="Close">×</button>
        <span className="eyebrow">THE CHAIN REACTION WORKSHOP</span>
        <h1>One sentence makes a level.<br /><span>Someone else solves it.</span></h1>
        <div className="home-doors">
          <section className="home-door make">
            <h2>🎨 Make a level</h2>
            <p>Say where, what rolls, and where it has to go. The AI builds the world; you shape it, test it and send it.</p>
            <form onSubmit={(e) => { e.preventDefault(); make(idea); }}>
              <input autoFocus value={idea} onChange={(e) => setIdea(e.target.value)} maxLength={500} placeholder="e.g. A snowball races down the High Tatras into a cave" aria-label="Describe a level" />
              <button className="primary" disabled={busy || !idea.trim()}>Create →</button>
            </form>
            <div className="examples">{CARDS.slice(0, 3).map((c) => <button key={c.title} onClick={() => make(c.prompt)} title={c.prompt}>{c.emoji} {c.title}</button>)}</div>
          </section>
          <section className="home-door solve">
            <h2>🧩 Solve a level</h2>
            <p>The stage is set. Get the ball to the goal with a few parts: click them in or say where they go.</p>
            <div className="mactions">
              <button className="primary" disabled={busy} onClick={() => { onClose(); void useMachine.getState().playLevel(LEVELS[0]); }}>Start with level 1 →</button>
              <button disabled={busy} onClick={() => { onClose(); void useMachine.getState().playDaily(); }}>📅 Today's puzzle</button>
            </div>
            <details className="level-library"><summary>All levels & levels other players made</summary><LevelStrip onPick={onClose} /><CommunityStrip onPick={onClose} /></details>
          </section>
        </div>
        <div className="home-guides" aria-label="The handbook">
          <button onClick={() => onHandbook('play')}><span className="guide-pic"><Scene name="run" /></span><strong>📖 How it works</strong><small>Six picture lessons, a minute to read</small></button>
          <button onClick={() => onHandbook('prompts')}><span className="guide-pic"><img src="/handbook/paris.webp" alt="" /></span><strong>✍️ Prompt ideas</strong><small>12 levels the AI made, with the sentence that made each</small></button>
          <button onClick={() => onHandbook('parts')}><span className="guide-pic parts"><img src="/models/kit-v1/thumbs/ramp.webp" alt="" /><img src="/models/kit-v1/thumbs/cannon.webp" alt="" /><img src="/models/kit-v1/thumbs/fan.webp" alt="" /><img src="/models/kit-v1/thumbs/trampoline.webp" alt="" /></span><strong>📦 All parts</strong><small>What each part does and how to place it</small></button>
        </div>
      </div>
    </div>
  );
}

function PromptBar({ inputRef, onIdeas }: { inputRef: React.RefObject<HTMLInputElement | null>; onIdeas: () => void }) {
  const ai = useMachine((s) => s.ai);
  const promptMode = useMachine((s) => s.promptMode);
  const text = useMachine((s) => s.draft);
  const draftFocus = useMachine((s) => s.draftFocus);
  const notice = useMachine((s) => s.notice);
  const { submitPrompt, setDraft, setPromptMode } = useMachine.getState();
  const [deck, setDeck] = useState(false);
  // A level in play: words build with the tray (or change the level, for its designer); otherwise they make a new level.
  const fix = useMachine((s) => s.fix);
  const role = useMachine((s) => s.role);
  const playable = !!fix && !fix.solved;
  const building = playable && promptMode === 'edit';
  // The designer's box changes the level; the player's builds with the tray.
  const designing = building && role === 'design';
  const ballName = fix?.puzzle.spec.parts.find((p) => p.kind === 'ball')?.label ?? 'ball';
  const goalName = fix?.puzzle.spec.parts.find((p) => p.kind === 'bucket' || p.kind === 'bell')?.label ?? 'goal';
  const tray = [...new Set(fix?.hand.filter((h) => !fix.placed.some((p) => p.id === h.id)).map((h) => (h.kind === 'platform' ? 'shelf' : h.kind)))];
  const levelIdeas = [`build a fence around the ${goalName}`, `put a castle next to the ${ballName}`, 'make it night'];
  const buildIdeas = tray.length ? [`put a ${tray[0]} next to the ${ballName}`, `add a ${tray[1] ?? tray[0]} 3 cells east of the ${ballName}`, `turn the ${tray[0]} toward the ${goalName}`] : [`move the ${fix?.placed[0]?.kind ?? 'ramp'} 1 cell north`];
  // A thing clicked on the stage lands in the box; put the caret right after its name.
  useEffect(() => {
    const el = inputRef.current;
    if (!draftFocus || !el) return;
    el.focus();
    const at = useMachine.getState().promptTarget.caret ?? el.value.length;
    el.setSelectionRange(at, at);
  }, [draftFocus, inputRef]);
  const track = (e: React.SyntheticEvent<HTMLInputElement>) => useMachine.getState().setPromptTarget(e.currentTarget.selectionStart ?? undefined);
  const submit = async () => {
    const t = text.trim();
    if (!t || ai.busy) return;
    const id = logPrompt(t, designing ? 'level' : building ? 'build' : 'new');
    const before = useMachine.getState();
    await submitPrompt(t);
    // How it went, in the words the player already saw: the error, the notice, or the new level's title.
    // Only what this request changed counts: words built without the AI leave an older error in place.
    const s = useMachine.getState();
    const failed = (s.ai !== before.ai ? s.ai.error : null) ?? (s.error !== before.error ? s.error : null);
    // Words the game did not act on stay in the box, with the reason as the notice.
    const refused = !failed && s.draft.trim() === t && !!s.notice;
    settlePrompt(id, failed || refused ? 'failed' : 'done', failed ?? s.notice ?? (designing || building ? undefined : s.machine?.title));
  };
  return (
    <div className="mprompt">
      <div className="prompt-heading">
        <span className="prompt-context">{designing ? 'Design your level' : building ? 'Solve it' : 'Describe a new level'}</span>
        <span className="prompt-help">{ai.busy ? (ai.creating ? 'Building your level…' : 'Working on your change…') : designing ? 'Change the place with words: add, move or remove things, the ground, the time of day.' : building ? `Use the parts in your tray to get the ${ballName} to the ${goalName}.` : 'A place, a ball and a goal: the AI sets the stage, a player solves it.'}</span>
        {!ai.busy && <button type="button" className="ideas-button" onClick={onIdeas} title="Example prompts with pictures of the levels they made">💡 Prompt ideas</button>}
        {!ai.busy && playable && <button type="button" className="text-button new-machine" onClick={() => setPromptMode(building ? 'create' : 'edit')}>{building ? 'New level…' : 'Back to this level'}</button>}
        {ai.busy && <button type="button" className="text-button" onClick={() => useMachine.getState().stopAi()}>Cancel</button>}
      </div>
      {deck && !ai.busy && <CardDeck onPick={() => setDeck(false)} />}
      <form onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        {designing && <span className="prompt-tag level" title="Changes the level itself: scenery, ground, the world">🌍 Level</span>}
        {building && !designing && <span className="prompt-tag" title="Adds, moves and turns parts that help the ball">🔧 Build</span>}
        {!building && <button type="button" className={`lucky ${deck ? 'active' : ''}`} onClick={() => setDeck((d) => !d)} disabled={ai.busy} title="Pick a new machine idea">🎲</button>}
        <input
          ref={inputRef}
          value={text}
          onChange={(e) => setDraft(e.target.value)}
          onFocus={track} onSelect={track}
          maxLength={building ? 300 : 500}
          placeholder={designing ? `Try “build a fence around the ${goalName}”, “remove” + click a thing, or “make it night”…` : building ? `Try “add a fan next to the ${ballName} facing the ${goalName}”…` : 'e.g. A snowball races down the High Tatras into a cave'}
          disabled={ai.busy}
          aria-label={designing ? 'Change the level' : building ? 'Build with words' : 'Describe a new level'}
        />
        <button className="primary" disabled={ai.busy || !text.trim()}>{ai.busy ? 'Working…' : designing ? 'Change level →' : building ? 'Build →' : 'Create →'}</button>
      </form>
      {ai.error && <div className="error-inline" role="alert">{ai.error}</div>}
      {notice && <div className="edit-notice" role="status"><span>{notice}</span></div>}
      {!ai.busy && !building && !deck && <div className="examples create-examples"><span>Try a little…</span>{CARDS.slice(0, 3).map((c) => <button key={c.title} onClick={() => { setDraft(c.prompt); inputRef.current?.focus(); }}>{c.emoji} {c.title}</button>)}<span className="prompt-key">Enter to create ↵</span></div>}
      {!ai.busy && building && !deck && (
        <div className="examples">
          {(designing ? levelIdeas : buildIdeas).map((ex) => <button key={ex} onClick={() => { setDraft(ex); inputRef.current?.focus(); }}>{ex}</button>)}
        </div>
      )}
    </div>
  );
}

/** The left column's title, always on top: a pulsing dot while the AI works. */
const FeedHeader = ({ idle = false }: { idle?: boolean }) => <div className="feed-header"><span className={`feed-dot${idle ? ' idle' : ''}`} aria-hidden="true" />Activity feed</div>;

const BOX_TAG: Record<PromptBox, string> = { new: '✨ New level', level: '🌍 Level', build: '🔧 Build' };

/** Everything typed this visit, newest first (the last few unless opened); a click puts the words back in the box. */
function PromptHistory() {
  const entries = usePromptLog((s) => s.entries);
  const [all, setAll] = useState(false);
  if (!entries.length) return null;
  return (
    <div className="mlog prompt-history">
      <span className="eyebrow">YOU TYPED</span>
      <ol>
        {(all ? entries : entries.slice(0, 3)).map((e) => (
          <li key={e.id} className={e.status}>
            <button type="button" onClick={() => useMachine.getState().setDraft(e.text)} title="Put these words back in the box">
              <span className="history-tag">{BOX_TAG[e.box]}</span>
              <span className="history-text">{e.text}</span>
              <span className="history-note" title={e.note}>{e.status === 'working' ? '◌ working…' : `${e.status === 'failed' ? '✕' : '✓'}${e.note ? ` ${e.note}` : ''}`}</span>
            </button>
          </li>
        ))}
      </ol>
      {entries.length > 3 && <button type="button" className="text-button history-more" onClick={() => setAll((a) => !a)}>{all ? 'Show the last 3' : `Show all ${entries.length}`}</button>}
    </div>
  );
}

function AiLog() {
  const ai = useMachine((s) => s.ai);
  if (!ai.busy) return null;
  // A new level: the steps tick off while the scene builds up behind them.
  if (ai.creating) return (
    <div className="mlog build-steps" role="status" aria-live="polite">
      <span className="eyebrow">BUILDING YOUR LEVEL</span>
      <ol>
        {BUILD_STEPS.map((label, i) => (
          <li key={label} className={i < ai.step ? 'done' : i === ai.step ? 'current' : ''}>
            <span className="step-mark" aria-hidden="true">{i < ai.step ? '✓' : i === ai.step ? '' : String(i + 1)}</span>
            <span>{label}{i === 1 && ai.world && i <= ai.step ? <span className="muted"> · {ai.world.name}</span> : null}</span>
          </li>
        ))}
      </ol>
      <div className="build-detail">{ai.lines.at(-1) ?? 'Reading your idea…'}</div>
      <BuildTip />
    </div>
  );
  return (
    <div className="mlog" role="status">
      {ai.lines.slice(-4, -1).map((line, i) => <div key={i} className="feed-line">✓ {line}</div>)}
      <div className="current">◌ {ai.lines.at(-1) ?? 'Contacting the AI designer…'}</div>
      {ai.progress > 0 && <div className="machine-bar"><div style={{ width: `${Math.round(ai.progress * 100)}%` }} /></div>}
    </div>
  );
}

const tries = (n: number) => `${n} ${n === 1 ? 'try' : 'tries'}`;

/** Copy a link to the level on screen (with the player's score once solved); the daily shares its result line. */
function ShareButton({ send = false }: { send?: boolean }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const daily = useMachine((s) => s.daily);
  const share = async () => {
    const s = useMachine.getState();
    let text: string;
    if (daily.date) {
      const done = s.fix?.solved ? `solved in ${tries(s.fix.tries)} with ${s.fix.placed.length} parts` : 'still building';
      text = `Prompt Goldberg, today's level ${daily.date}: ${done}. ${location.origin}${location.pathname}`;
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
  return <button onClick={() => void share()} title="Copy a link to this level">{state === 'copied' ? '✓ Link copied: send it to a player' : state === 'failed' ? 'Copy failed' : daily.date ? '📋 Share result' : send ? '📨 Send to a player' : '🔗 Share'}</button>;
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
/** A run's note in the level's own words: part ids ("vampiretomb") become their names ("vampire tomb"). */
function named(note: string, parts: Part[]): string {
  const names = partNames(parts);
  let out = note;
  const byId = new Map(parts.map((p) => [p.id, names.get(p.id) ?? p.label ?? p.kind]));
  out = out.replace(/[A-Za-z0-9_-]+/g, (word) => byId.get(word) ?? word);
  return out.replace(/^the ball\b/, `the ${parts.find((p) => p.kind === 'ball')?.label ?? 'ball'}`);
}

/** The designer's selected thing: what it is and buttons for what the keys do (turn, remove), for mice, touch and the curious. */
function SelectedThing() {
  const fix = useMachine((s) => s.fix);
  const busy = useMachine((s) => s.ai.busy);
  const part = fix?.selected ? fix.puzzle.spec.parts.find((p) => p.id === fix.selected) : undefined;
  if (!fix || !part) return null;
  const name = partNames(fix.puzzle.spec.parts).get(part.id) ?? part.label ?? part.kind;
  const s = useMachine.getState();
  return (
    <div className="selected-thing" role="group" aria-label={`Selected: ${name}`}>
      <span><b>{name}</b> <span className="muted small">selected · arrow keys nudge it</span></span>
      <span className="mactions">
        <button onClick={() => { if (!s.shiftLevelPart({ turn: true })) sfx.miss(); }} title="Turn it a quarter (R)">↻ Turn</button>
        {!['ball', 'bucket', 'bell'].includes(part.kind) && <button disabled={busy} onClick={() => { s.pick(null); void s.changeLevel(`remove the ${name}`); }} title="Take it off the stage">🗑 Remove</button>}
        <button onClick={() => s.pick(null)} title="Let go of it (Esc)">Done</button>
      </span>
    </div>
  );
}

function FixPanel() {
  const fix = useMachine((s) => s.fix)!;
  const busy = useMachine((s) => s.ai.busy);
  const [tip, setTip] = useState(false);
  const phase = useMachine((s) => s.phase);
  const finished = fix.solved && phase === 'done';
  const noHelp = useMachine((s) => s.noHelp());
  const result = useMachine((s) => s.result);
  const daily = useMachine((s) => s.daily);
  const { pick, clearPlaced, runFix, showHint } = useMachine.getState();
  const allPlaced = fix.puzzle.missing.every((m) => fix.placed.some((p) => p.id === m.id));
  const failed = phase === 'done' && result && !result.success ? result.steps.find((s) => !s.satisfied) : null;
  const level = useMachine((s) => s.level);
  const inDaily = !!daily.date;
  // R turns the part in hand; up/down raise or lower a shelf; Escape puts it down.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      const s = useMachine.getState();
      if (e.key === 'r' || e.key === 'R') {
        if (s.role !== 'design') s.rotatePicked();
        else if (s.fix?.selected && !s.shiftLevelPart({ turn: true })) sfx.miss();
      }
      // The designer's arrows nudge the selected level thing a cell; the player's raise or lower a shelf.
      const step = { ArrowLeft: { dx: -1 }, ArrowRight: { dx: 1 }, ArrowUp: { dz: -1 }, ArrowDown: { dz: 1 } }[e.key];
      if (step && s.role === 'design' && s.fix?.selected) { e.preventDefault(); if (!s.shiftLevelPart(step)) sfx.miss(); }
      else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); s.liftBy(e.key === 'ArrowUp' ? 1 : -1); }
      if (e.key === 'Escape') pick(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pick]);
  const par = parOf(fix.puzzle);
  const role = useMachine((s) => s.role);
  const own = useMachine((s) => s.ownLevel());
  if (role === 'design' && !fix.solved) return (
    <div className="mgoal mfix">
      <div className="mtitle">
        <span className="eyebrow">LEVEL DESIGNER</span>
        <h2>{fix.puzzle.solution.title}</h2>
        <Closest text={fix.puzzle.solution.closest} />
        <p className="muted small">Drag a thing on the stage to move it. The player gets {fix.hand.length} parts · par {par}.</p>
      </div>
      <ChainList goal={fix.puzzle.solution.goal} parts={fix.puzzle.solution.parts} />
      <SelectedThing />
      <div className="mactions design-actions">
        <button className="primary" onClick={() => useMachine.getState().setRole('play')} title="Play your level the way a player will">▶ Test it as a player</button>
        <ShareButton send />
      </div>
    </div>
  );
  return (
    <div className="mgoal mfix">
      <div className="mtitle">
        <span className="eyebrow">{inDaily ? `TODAY'S LEVEL · ${daily.date}` : own ? 'TESTING YOUR LEVEL' : 'THE BUILD CHALLENGE'}</span>
        <h2>{fix.puzzle.solution.title}</h2>
        {level && <p className="mission">Mission: “{level.mission}”</p>}
        <Closest text={fix.puzzle.solution.closest} />
        {rulesLine(fix.puzzle.solution.rules) && <p className="challenge">🎯 {rulesLine(fix.puzzle.solution.rules)}</p>}
        <SharedBanner />
        <p>{finished && fix.assisted
          ? 'The AI solved this one for you. Clear the board and find your own way for the stars.'
          : finished
          ? `Solved in ${tries(fix.tries)} with ${fix.placed.length} part${fix.placed.length === 1 ? '' : 's'}!${inDaily && daily.best[daily.date] ? ` Your best today: ${tries(daily.best[daily.date])}.` : ''}`
          : fix.solved ? 'Watch the chain reach its finish…'
          : fix.puzzle.verified === false
            ? `The AI set the stage and picked the parts, but nobody has solved this level yet. Physics decides. Its own idea used ${par} of the ${fix.hand.length} parts in the tray.`
            : 'The ball, the goal and the scenery are where they are. Build the route between them from the Parts tray. Any build that works counts.'}</p>
        {finished && fix.assisted ? null : finished
          ? <p className="starline"><span className="stars big">{starRow(fix.stars)}</span>{fix.server === 'agrees' && <span className="badge ok" title="The server ran your build too and got the same run, bit for bit">✓ server agrees</span>} <span className="muted small">{fix.placed.length <= par ? `★ par ${par} parts or fewer` : `☆ par is ${par} parts`} · {fix.tries <= 3 ? '★ 3 tries or fewer' : '☆ 3 tries or fewer'}</span></p>
          : <p className="muted small">Par: {par} part{par === 1 ? '' : 's'} · {fix.hand.length - par} spare parts · solve in 3 tries for a bonus star</p>}
      </div>
      <ChainList goal={fix.puzzle.solution.goal} parts={fix.puzzle.solution.parts} />
      {!fix.solved && (
        <div className="mbin">
          {fix.picking !== null && <button onClick={() => useMachine.getState().rotatePicked()} title="Turn the part in hand (R)">↻ Turn</button>}
          {fix.picking !== null && onPosts(fix.hand[fix.picking].kind) && (
            <span className="lift" title="Height (arrow keys)">
              <button onClick={() => useMachine.getState().liftBy(-1)} disabled={fix.lift <= 0}>▼</button>
              height {fix.lift}
              <button onClick={() => useMachine.getState().liftBy(1)}>▲</button>
            </span>
          )}
        </div>
      )}
      {!fix.solved && fix.picking !== null && (
        <div className="part-guide">
          <b>{isGadget(fix.hand[fix.picking]) ? '🛠' : PART_ICON[fix.hand[fix.picking].kind]} {kitName(fix.hand[fix.picking])}</b>
          <span>{kitTip(fix.hand[fix.picking])}</span>
          <small>
          {onPosts(fix.hand[fix.picking].kind)
            ? `Click the stage to put the ${kitName(fix.hand[fix.picking]).toLowerCase()} there, ${fix.lift ? `${fix.lift} cell${fix.lift > 1 ? 's' : ''} up` : 'on the floor'}. Arrow keys change the height, R turns it.${fix.hand[fix.picking].kind === 'platform' ? ' Parts can stand on it.' : ''}`
            : `Click the stage to drop the ${kitName(fix.hand[fix.picking]).toLowerCase()}. It lands on the floor or on a shelf. Turn it with R.`}
          </small>
        </div>
      )}
      {failed && !fix.solved && <button className="text-button" onClick={() => setTip((v) => !v)}>{tip ? 'Hide tip' : 'What should I try?'}</button>}
      {tip && failed && !fix.solved && <p className="part-guide">The route stopped before {partNames(fix.puzzle.solution.parts).get(fix.puzzle.solution.goal[failed.index]?.part) ?? 'the target'}. Follow the marble from the start. Check the last part it reached, then adjust the next part’s position or facing. You can test with only part of the route built.</p>}
      {failed && !fix.solved && fix.tries > 0 && <div className="mnote soft">Not there yet: {named(failed.note, fix.puzzle.solution.parts)}. Move or turn a part and run it again.</div>}
      {phase === 'done' && !fix.solved && fix.broke?.map((b) => <div key={b} className="mnote">✗ It works, but: {b}</div>)}
      <div className="mactions">
        {!fix.solved && <button className="primary" onClick={() => void runFix()} disabled={phase === 'simulating' || phase === 'playing'} title={allPlaced ? '' : 'Run it any time, with as many parts as you like'}>▶ Run ({tries(fix.tries)})</button>}
        {!fix.solved && <button onClick={clearPlaced} disabled={!fix.placed.length}>Clear</button>}
        {/* While the AI looks for a way, or its way is running, the same button stops it: the board goes back to the player. */}
        {!fix.solved && !noHelp && (busy
          ? <button onClick={() => useMachine.getState().stopAi()} title="Stop the AI looking for a way">✕ Stop solving</button>
          : fix.assisted && (phase === 'simulating' || phase === 'playing')
            ? <button onClick={() => useMachine.getState().tryMyself()} title="Stop the AI's run and put its parts back in the tray">✕ Stop solving</button>
            : <button onClick={() => void useMachine.getState().solveForMe()} disabled={phase === 'simulating' || phase === 'playing'} title="Only when you want it: the AI puts its own parts down and runs them. No stars for that run.">🤖 Solve it for me</button>)}
        {!fix.solved && !noHelp && !fix.hint && fix.puzzle.missing.length > 0 && <button onClick={showHint} title={fix.puzzle.verified === false ? `Shows the AI's own idea; nobody has tested it. Costs ${HINT_COST} tries.` : `Shows where the parts go. Costs ${HINT_COST} tries.`}>{fix.puzzle.verified === false ? 'AI\'s idea' : 'Hint'} (+{HINT_COST} tries)</button>}
        {finished && fix.assisted && <button className="primary" onClick={() => useMachine.getState().tryMyself()}>Try it myself</button>}
        {own && !fix.solved && <button onClick={() => useMachine.getState().setRole('design')} title="Back to shaping the level">✏️ Edit level</button>}
        <ShareButton send={own} />
      </div>
      {finished && <AfterSolve inDaily={inDaily} />}
    </div>
  );
}

function StageControls({ onResetView }: { onResetView: () => void }) {
  const phase = useMachine((s) => s.phase);
  const time = useMachine((s) => s.time);
  const end = useMachine((s) => s.endTime);
  const run = useMachine((s) => s.run);
  const fix = useMachine((s) => s.fix);
  const busy = useMachine((s) => s.ai.busy);
  const machine = useMachine((s) => s.machine);
  const role = useMachine((s) => s.role);
  const playing = phase === 'playing';
  const paused = phase === 'paused';
  const designing = role === 'design' && !!fix && !fix.solved;
  const action = () => {
    if (playing) useMachine.setState({ phase: 'paused' });
    else if (paused) useMachine.setState({ phase: 'playing' });
    else useMachine.getState().play();
  };
  return <>
    <div className="stage-topbar">
      <div className="stage-mode"><span className={`status-dot ${playing ? 'running' : ''}`} /><span>{fix && !fix.solved ? (role === 'design' ? 'LEVEL DESIGNER' : 'BUILD YOUR ROUTE') : 'THE WORKBENCH'}</span>{!designing && <span className="stage-count">{fix ? `${fix.placed.length} placed` : run ? `${run.spec.parts.length} parts` : ''}</span>}</div>
      <button className="fit-view" onClick={onResetView} title="Restore the view of the whole machine" aria-label="Fit whole machine in view">⤢ <span>Fit view</span></button>
    </div>
    <div className="stage-bottom">
      {/* The designer tests the level as a player; a bare run would only drop the ball. */}
      {!designing && <div className="stage-transport">
        <button className="transport-button" onClick={action} disabled={!machine || busy || phase === 'simulating'} aria-label={playing ? 'Pause playback' : paused ? 'Continue playback' : 'Run machine'}>{playing ? 'Ⅱ' : phase === 'done' ? '↻' : '▶'}<span>{playing ? 'Pause' : paused ? 'Continue' : 'Run'}</span></button>
        <div className="transport-details"><span>{phase === 'simulating' ? 'Preparing the stage…' : playing ? 'Chain reaction in motion' : paused ? 'Paused · take a closer look' : phase === 'done' ? 'Ready for another run?' : 'Ready when you are'}</span><progress max={end || 1} value={Math.min(time, end || 1)} aria-label="Playback progress" /></div>
        <span className="transport-time">{time.toFixed(1)}<small>s</small></span>
      </div>}
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
    <button onClick={() => void useMachine.getState().playDaily()} disabled={daily.loading || busy || !!daily.date} title="The same level for everyone today">
      📅<span className="label">{daily.loading ? ' Loading…' : best ? ` Today's level · best ${tries(best)}` : " Today's level"}</span>
    </button>
  );
}

export function MachineScreen() {
  const error = useMachine((s) => s.error);

  // The start screen opens first, unless a shared link opens its level straight away.
  const [home, setHome] = useState(() => !location.hash.includes('pg='));
  const [guideVersion, setGuideVersion] = useState(0);
  const fix = useMachine(s => s.fix);
  const [cameraReset, setCameraReset] = useState(0);
  const [settings, setSettings] = useState(false);
  const [handbook, setHandbook] = useState<HandbookTab | null>(null);
  const theme = useSettings((s) => s.theme);
  const designing = useMachine((s) => s.role === 'design' && !!s.fix && !s.fix.solved);
  const aiBusy = useMachine((s) => s.ai.busy);
  const inputRef = useRef<HTMLInputElement>(null);
  // A shared link opens its level at once; otherwise the start screen asks what to do.
  useEffect(() => {
    if (useMachine.getState().machine) return;
    let cancelled = false;
    void readShareLink().then((shared) => {
      if (cancelled || !shared) return;
      clearShareLink();
      setHome(false);
      useMachine.setState({ sharedScore: shared.score ?? null });
      void useMachine.getState().playLevel(sharedAsLevel(shared));
    });
    return () => { cancelled = true; };
  }, []);
  return (
    <div className="app play machine-screen" style={themeStyle(theme)}>
      <div className="machine-viewport"><MachineScene resetView={cameraReset} /><StageControls onResetView={() => setCameraReset((n) => n + 1)} /><SolvedCard onHome={() => setHome(true)} /></div>
      <div className="hud-top">
        <div className="hud-left mbrand">
          <button className="brand" onClick={() => setHome(true)} title="Make a level or solve one"><span className="brand-mark" aria-hidden="true"><i /><i /><i /></span><span>Prompt <b>Goldberg</b></span></button>
          <span className="mtag">The chain reaction workshop</span>
          <nav className="help-icons" aria-label="The handbook">
            <button onClick={() => setHandbook(designing ? 'design' : 'play')} title="How it works: picture lessons" aria-label="How it works">📖</button>
            <button onClick={() => setHandbook('prompts')} title="Prompt ideas: levels the AI made, with their sentences" aria-label="Prompt ideas">💡</button>
            <button onClick={() => setHandbook('parts')} title="All parts: what each one does" aria-label="All parts">📦</button>
          </nav>
        </div>
        <div className="hud-right"><button className="hud-handbook" onClick={() => setHandbook(designing ? 'design' : 'play')} title="The handbook: lessons, prompt ideas, all parts">📖<span className="label">{designing ? ' How to design' : ' How to play'}</span></button><button onClick={() => setHome(true)} title="Make a level or solve one">🎮<span className="label"> Levels</span></button><details className="workshop-menu"><summary aria-label="More options">•••</summary><div><DailyButton /><SoundToggle /><button onClick={(e) => { (e.currentTarget.closest('details') as HTMLDetailsElement).open = false; setSettings(true); }} title="Stage size and theme">⚙<span className="label"> Settings</span></button><a className="menu-link" href="/docs" target="_blank" rel="noopener" title="How it is built, the API and the results">📄<span className="label"> Docs &amp; API</span></a><a className="menu-link" href="/rube" target="_blank" rel="noopener" title="A tribute to Rube Goldberg">🎩<span className="label"> Rube Goldberg</span></a></div></details></div>
      </div>
      <div className="mside">
        <FeedHeader idle={!aiBusy} />
        <PromptHistory />
        {fix && <FixPanel />}
        <AiLog />
        {error && <div className="error-inline">{error}</div>}
      </div>
      <PartsTray onCatalog={() => setHandbook('parts')} />
      <div className="hud-bottom">
        <PromptBar inputRef={inputRef} onIdeas={() => setHandbook('prompts')} />
      </div>
      {settings && <SettingsPanel onClose={() => setSettings(false)} />}
      {home && <Home onClose={() => setHome(false)} onHandbook={(t) => setHandbook(t ?? 'play')} />}
      {handbook && <Handbook tab={handbook} onClose={() => setHandbook(null)} onShowHints={() => { resetHints(); setGuideVersion(v => v + 1); setHome(false); }} onLevel={() => { setHandbook(null); setHome(false); }} />}
      <WorkshopGuide key={guideVersion} hidden={home || settings || !!handbook} />
    </div>
  );
}
