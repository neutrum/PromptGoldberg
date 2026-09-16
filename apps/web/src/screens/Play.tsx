import { CAMPAIGN, PIECE_BODIES, type Control, type Level } from '@og/shared';
import { useEffect, useMemo, useState } from 'react';
import { sfx } from '../game/audio';
import { useGame, type Source } from '../game/gameStore';
import { GOAL_ICON, goalShort } from '../game/hints';
import { copyText, galleryLink, levelLink } from '../game/share';
import { formatTime } from '../format';
import { GameScene } from '../scene/GameScene';
import { Tutorial } from './Tutorial';

function sourceLabel(source: Source | null): string {
  switch (source?.kind) {
    case 'campaign': return `Campaign ${source.index + 1} / ${CAMPAIGN.length}`;
    case 'daily': return `Daily challenge · ${source.date}`;
    case 'endless': return `Endless · system ${source.stage}`;
    case 'ai': return 'AI-built level';
    case 'gallery': return 'Community level';
    case 'shared': return 'Shared level';
    default: return '';
  }
}

function formatControl(c: Control, v: number): string {
  if (/\.angle$/.test(c.path)) return `${v.toFixed(1)}°`;
  if (/\.time$/.test(c.path)) return formatTime(v);
  if (/\.speed$/.test(c.path)) return `${Math.round((100 * (v - c.min)) / (c.max - c.min))}%`;
  if (/phase$/.test(c.path)) return `${v.toFixed(0)}°`;
  return v.toPrecision(3);
}

function Stars({ count, animate = false }: { count: number; animate?: boolean }) {
  useEffect(() => {
    if (!animate) return;
    const timers = Array.from({ length: count }, (_, i) => setTimeout(() => sfx.star(i), 350 + i * 260));
    return () => timers.forEach(clearTimeout);
  }, [count, animate]);
  return (
    <div className={`stars ${animate ? 'animate' : ''}`}>
      {[0, 1, 2].map((i) => (
        <span key={i} className={i < count ? 'on' : 'off'} style={{ animationDelay: `${350 + i * 260}ms` }}>★</span>
      ))}
    </div>
  );
}

function GoalChain({ level }: { level: Level }) {
  const celebrated = useGame((s) => s.celebrated);
  const phase = useGame((s) => s.phase);
  const outcome = useGame((s) => s.outcome);
  const flight = useGame((s) => s.flight);
  const names = useMemo(() => new Map(level.spec.bodies.map((b) => [b.id, b.name])), [level]);
  const n = (id: string) => names.get(id) ?? id;
  const failedAt = phase === 'result' && outcome && !outcome.success ? flight?.goal.failedAt ?? null : null;
  return (
    <div className="chain">
      {level.spec.goal.map((g, i) => {
        const st = i === failedAt ? 'failed' : (phase === 'result' && outcome?.success) || (phase !== 'aiming' && i < celebrated) ? 'done' : 'todo';
        return (
          <div key={i} className="chain-step-wrap">
            {i > 0 && <span className="chain-arrow">→</span>}
            <div className={`chain-step ${st}`}>
              <span className="chain-num">{st === 'done' ? '✓' : st === 'failed' ? '✗' : i + 1}</span>
              <span className="chain-icon">{GOAL_ICON[g.type]}</span>
              {goalShort(g, level.player, n)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ControlsPanel({ level }: { level: Level }) {
  const values = useGame((s) => s.values);
  const phase = useGame((s) => s.phase);
  const setValue = useGame((s) => s.setValue);
  const launch = useGame((s) => s.launch);
  const endless = useGame((s) => s.endless);
  const source = useGame((s) => s.source);
  const disabled = phase === 'flying' || phase === 'loading';
  const outOfShots = source?.kind === 'endless' && endless !== null && endless.shotsLeft <= 0;

  return (
    <div className="panel controls">
      {level.controls.map((c, i) => (
        <label key={c.path} className="control">
          <span className="control-label">{c.label}</span>
          <input
            type="range"
            min={c.min}
            max={c.max}
            step={(c.max - c.min) / 1000}
            value={values[i] ?? c.min}
            disabled={disabled}
            onChange={(e) => setValue(i, Number(e.target.value))}
          />
          <span className="control-value">{formatControl(c, values[i] ?? c.min)}</span>
        </label>
      ))}
      <button className="launch" disabled={disabled || outOfShots} onClick={() => void launch()} title="Space">
        {phase === 'flying' ? 'In flight…' : 'LAUNCH'}
      </button>
    </div>
  );
}

function PiecesPanel({ level }: { level: Level }) {
  const pieces = useGame((s) => s.pieces);
  const placing = useGame((s) => s.placing);
  const setPlacing = useGame((s) => s.setPlacing);
  const removePiece = useGame((s) => s.removePiece);
  const phase = useGame((s) => s.phase);
  if (!level.pieces) return null;
  const full = pieces.length >= level.pieces.max;
  return (
    <div className="panel pieces">
      <div className="panel-title">Build <span className="muted">{pieces.length}/{level.pieces.max}</span></div>
      <div className="piece-row">
        {level.pieces.kinds.map((k) => (
          <button
            key={k}
            className={placing === k ? 'active' : ''}
            disabled={phase === 'flying' || (full && placing !== k)}
            onClick={() => setPlacing(placing === k ? null : k)}
            title="Click in space to place it on an orbit"
          >
            <span className="piece-dot" style={{ background: PIECE_BODIES[k].color }} /> {k === 'giant' ? 'Gas giant' : 'Planet'}
          </button>
        ))}
      </div>
      {placing && <div className="muted">Click in space to drop it. It orbits the star from there.</div>}
      {pieces.map((p, i) => (
        <div key={i} className="piece-item">
          <span className="piece-dot" style={{ background: PIECE_BODIES[p.kind].color }} /> {p.kind} at {p.r.toFixed(2)} AU
          <button disabled={phase === 'flying'} onClick={() => removePiece(i)}>✕</button>
        </div>
      ))}
    </div>
  );
}

function Assist({ level }: { level: Level }) {
  const machine = useGame((s) => s.machine);
  const raceMachine = useGame((s) => s.raceMachine);
  const stopMachine = useGame((s) => s.stopMachine);
  const showHint = useGame((s) => s.showHint);
  const usedHint = useGame((s) => s.usedHint);
  const shots = useGame((s) => s.shots);
  const source = useGame((s) => s.source);

  return (
    <div className="panel assist">
      {level.controls.length > 0 && <div className="panel-title">Race the machine</div>}
      {level.controls.length > 0 && machine.status === 'idle' && (
        <button onClick={() => void raceMachine()} title="The optimizer tries to solve this level by brute force while you play">🤖 Start the machine</button>
      )}
      {level.controls.length > 0 && machine.status !== 'idle' && (
        <div className="machine">
          <div className="machine-bar"><div style={{ width: `${Math.round(machine.best * 100)}%` }} /></div>
          <div className="muted">
            {machine.status === 'running' && <>thinking… {machine.evals} simulations · best {Math.round(machine.best * 100)}%</>}
            {machine.status === 'done' && <>solved after <strong>{machine.evals}</strong> simulations. You: {shots.length} shot{shots.length === 1 ? '' : 's'}.</>}
            {machine.status === 'failed' && <>gave up after {machine.evals} simulations (best {Math.round(machine.best * 100)}%).</>}
          </div>
          {machine.status === 'running' && <button onClick={stopMachine}>Stop</button>}
        </div>
      )}
      {level.solution && source?.kind !== 'endless' && (
        <button className="hint-btn" disabled={usedHint} onClick={() => void showHint()} title="Shows a known solution path; costs one star">
          {usedHint ? '✨ Solution path shown (−1★)' : '✨ Show a solution path (−1★)'}
        </button>
      )}
    </div>
  );
}

function ResultCard({ level }: { level: Level }) {
  const outcome = useGame((s) => s.outcome);
  const shots = useGame((s) => s.shots);
  const source = useGame((s) => s.source);
  const endless = useGame((s) => s.endless);
  const machine = useGame((s) => s.machine);
  const { aimAgain, next, replay, restartLevel, go, showToast, publish } = useGame.getState();
  const [publishedId, setPublishedId] = useState<string | null>(null);
  if (!outcome) return null;

  const share = async () => {
    const link = publishedId ? galleryLink(publishedId) : source?.kind === 'gallery' ? galleryLink(source.id) : levelLink(level);
    showToast((await copyText(link)) ? 'Link copied. Send it to a friend!' : link);
  };
  const shareDaily = async () => {
    const text = `Orbital Goldberg daily ${source?.kind === 'daily' ? source.date : ''}: ${'★'.repeat(outcome.stars)}${'☆'.repeat(3 - outcome.stars)} in ${shots.length} shot${shots.length === 1 ? '' : 's'}\n${location.origin}`;
    showToast((await copyText(text)) ? 'Result copied!' : text);
  };
  const doPublish = async () => {
    const id = await publish();
    if (id) {
      setPublishedId(id);
      showToast('Published to the community gallery!');
    }
  };

  if (outcome.gameOver) {
    return (
      <div className="result panel fail big">
        <h2>Out of shots</h2>
        <p>You cleared <strong>{endless?.cleared ?? 0}</strong> system{endless?.cleared === 1 ? '' : 's'}.{outcome.newBest ? ' New personal best!' : ''}</p>
        <div className="result-actions">
          <button className="primary" onClick={restartLevel}>New run</button>
          <button onClick={() => go('menu')}>Menu</button>
        </div>
      </div>
    );
  }

  if (!outcome.success) {
    return (
      <div className="result panel fail">
        <div className="result-title">✗ {outcome.summary}</div>
        {outcome.fate && <div className="muted">{outcome.fate}</div>}
        {(outcome.coachTip || outcome.hint) && <div className="coach">💡 {outcome.coachTip ?? outcome.hint}</div>}
        <div className="result-actions">
          <button className="primary" onClick={aimAgain}>Aim again <kbd>Space</kbd></button>
          <button onClick={replay}>Replay</button>
        </div>
      </div>
    );
  }

  const canPublish = source?.kind === 'ai' || source?.kind === 'shared';
  return (
    <div className="result panel win big">
      <h2>Chain complete!</h2>
      <Stars count={outcome.stars} animate />
      <p>
        {shots.length} shot{shots.length === 1 ? '' : 's'} · par {level.par}
        {outcome.newBest && <span className="new-best"> · new best!</span>}
      </p>
      {machine.status === 'done' && <p className="muted">The machine needed {machine.evals} simulations.</p>}
      {source?.kind === 'endless' && endless && <p className="muted">+{level.par} shots · {endless.shotsLeft} left</p>}
      <div className="result-actions">
        <button className="primary" onClick={next}>
          {source?.kind === 'campaign' && source.index + 1 >= CAMPAIGN.length ? 'Campaign done!' : source?.kind === 'endless' ? 'Next system ▶' : source?.kind === 'campaign' ? 'Next level ▶' : 'Continue ▶'} <kbd>Enter</kbd>
        </button>
        <button onClick={replay}>Replay</button>
        {source?.kind === 'daily' && <button onClick={() => void shareDaily()}>Share result</button>}
        {source?.kind !== 'endless' && source?.kind !== 'daily' && <button onClick={() => void share()}>Share level</button>}
        {canPublish && !publishedId && <button onClick={() => void doPublish()}>Publish to community</button>}
      </div>
    </div>
  );
}

function AiEdit() {
  const editWithAi = useGame((s) => s.editWithAi);
  const [text, setText] = useState('');
  return (
    <form className="ai-edit" onSubmit={(e) => { e.preventDefault(); if (text.trim()) void editWithAi(text.trim()); }}>
      <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Change it: “make the giant heavier”, “add a moon”…" maxLength={300} />
      <button disabled={!text.trim()}>Remix</button>
    </form>
  );
}

export function PlayScreen() {
  const level = useGame((s) => s.level);
  const phase = useGame((s) => s.phase);
  const loadingText = useGame((s) => s.loadingText);
  const error = useGame((s) => s.error);
  const source = useGame((s) => s.source);
  const shots = useGame((s) => s.shots);
  const endless = useGame((s) => s.endless);
  const usedHint = useGame((s) => s.usedHint);
  const progress = useGame((s) => s.progress);
  const { go, toggleMute, replayTutorials } = useGame.getState();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input[type=text], input:not([type]), textarea, select')) return;
      const g = useGame.getState();
      if (!g.level) return;
      const fine = e.shiftKey ? 0.2 : 1;
      const idx = (suffix: string) => g.level!.controls.findIndex((c) => c.path.endsWith(suffix));
      const nudge = (i: number, f: number) => { if (i >= 0) { e.preventDefault(); g.nudge(i, f * fine); } };
      switch (e.code) {
        case 'Space':
          e.preventDefault();
          if (g.phase === 'aiming') void g.launch();
          else if (g.phase === 'flying') g.skipFlight();
          else if (g.phase === 'result' && !g.outcome?.success) g.aimAgain();
          break;
        case 'Enter':
          if (g.phase === 'result' && g.outcome?.success) { e.preventDefault(); g.next(); }
          break;
        case 'ArrowLeft': nudge(idx('.angle') >= 0 ? idx('.angle') : 0, -0.01); break;
        case 'ArrowRight': nudge(idx('.angle') >= 0 ? idx('.angle') : 0, 0.01); break;
        case 'ArrowUp': nudge(idx('.speed') >= 0 ? idx('.speed') : 1, 0.01); break;
        case 'ArrowDown': nudge(idx('.speed') >= 0 ? idx('.speed') : 1, -0.01); break;
        case 'KeyQ': nudge(idx('.time'), -0.01); break;
        case 'KeyE': nudge(idx('.time'), 0.01); break;
        case 'Escape': g.setPlacing(null); break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const liveStars = level ? (shots.length < level.par ? 3 : shots.length < 2 * level.par ? 2 : 1) - (usedHint ? 1 : 0) : 0;

  return (
    <div className="app play">
      <GameScene />
      {(phase === 'loading' || !level) && (
        <div className="loading">
          {error ? <><p className="error-inline">{error}</p><button onClick={() => go('menu')}>Back to menu</button></> : <><div className="spinner" /><p>{loadingText || 'Loading…'}</p></>}
        </div>
      )}
      {level && (
        <>
          <header className="hud-top">
            <div className="hud-left">
              <button className="icon" onClick={() => go('menu')} title="Menu">☰</button>
              <div>
                <div className="muted">{sourceLabel(source)}</div>
                <h1 className="level-title">{level.title}</h1>
                <div className="briefing">{level.briefing}</div>
              </div>
            </div>
            <GoalChain level={level} />
            <div className="hud-right">
              <div className="shots">
                <span className="big-num">{shots.length}</span> shot{shots.length === 1 ? '' : 's'} · par {level.par}
                {source?.kind !== 'endless' && <Stars count={Math.max(1, liveStars)} />}
              </div>
              {endless && source?.kind === 'endless' && <div className="endless-left"><span className="big-num">{endless.shotsLeft}</span> shots left · {endless.cleared} cleared</div>}
              <button className="icon" onClick={replayTutorials} title="How to play (replay the tutorial)">?</button>
              <button className="icon" onClick={toggleMute} title="Sound">{progress.muted ? '🔇' : '🔊'}</button>
            </div>
          </header>

          <aside className="hud-side">
            <PiecesPanel level={level} />
            <Assist level={level} />
            {(source?.kind === 'ai' || source?.kind === 'shared' || source?.kind === 'gallery') && <AiEdit />}
          </aside>

          <footer className="hud-bottom">
            {phase === 'result' && <ResultCard level={level} />}
            {phase === 'flying' && <div className="skip muted">Space to skip</div>}
            {error && phase !== 'loading' && <div className="error-inline">{error}</div>}
            <ControlsPanel level={level} />
            <div className="keys muted">
              {level.controls.length === 0
                ? 'The shot is fixed: build the machine with pieces, then launch'
                : 'Drag back from the glowing probe to aim · ←→ aim · ↑↓ power · Q/E timing · Shift for fine steps'}
            </div>
          </footer>
          {phase !== 'loading' && <Tutorial key={level.id + level.title} level={level} />}
        </>
      )}
    </div>
  );
}
