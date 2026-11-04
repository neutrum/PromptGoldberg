import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useMachine } from '../app/game';
import { kitName } from './kit';

/** Hints already seen, per role, kept in this browser. */
const SEEN_KEY = (role: 'design' | 'play') => `pg.hints.${role}`;
const seen = (role: 'design' | 'play') => { try { return localStorage.getItem(SEEN_KEY(role)) === 'done'; } catch { return false; } };
const markSeen = (role: 'design' | 'play') => { try { localStorage.setItem(SEEN_KEY(role), 'done'); } catch { /* private mode */ } };
/** "How to play": show the hints of both roles again. */
export const resetHints = () => { try { localStorage.removeItem(SEEN_KEY('design')); localStorage.removeItem(SEEN_KEY('play')); } catch { /* private mode */ } };

/** What a hint can name: the part in hand and the level's ball. */
interface Words { inHand?: string; ball: string; /** A built-in level: no hints or solving to point at. */ noHelp: boolean }
/** A hint sits above its control, to the left of the tray, or in the stage's top corner when its control is low in the level card. */
interface Step { anchor: string; title: string; text: string | ((w: Words) => string); ok?: string; side?: 'left' | 'stage' }
const STEPS: Record<'design' | 'play', Step[]> = {
  design: [
    { anchor: '.mprompt', title: 'You are the designer', text: 'This is your level. Change it with words: “put a castle by the goal”, “make it night”, or type “remove” and click a thing on the stage. Drag a thing to move it; arrows nudge it, R turns it.' },
    { anchor: '.design-actions', title: 'Test it, then send it', text: 'Play your level the way a player will. “Send to a player” copies a link anyone can open to solve it.', ok: 'Got it' },
  ],
  play: [
    { anchor: '.parts-heading', side: 'left', title: 'Put a part down', text: (w) => w.inHand ? `The ${w.inHand} is in your hand. Click the stage to put it down where you think it helps the ${w.ball}. R turns it.` : `Pick a part from the tray and click the stage, or say it below: “put a ramp next to the ${w.ball}”.` },
    { anchor: '.stage-transport', title: 'Run it', text: (w) => `Press Run and watch where the ${w.ball} goes. You don't need the whole route to try.` },
    { anchor: '.mfix .mnote.soft', side: 'stage', title: 'Not there yet', text: (w) => `Press ↻ to watch the ${w.ball} again and see where it went wrong. Drag a part to move it or press R to turn it, then run again.` },
    { anchor: '.mfix .mactions', side: 'stage', title: 'Stuck?', text: (w) => w.noHelp ? `Watch where the ${w.ball} stops, then move or turn the part before it. Every run tells you something.` : 'A hint shows where the parts go. “Solve it for me” builds a way with your own parts, with no stars.', ok: 'Got it' },
  ],
};

/** A few hints beside the control in use, the first time each role is played; they move on as you do it. */
export function WorkshopGuide({ hidden: covered }: { hidden: boolean }) {
  const role = useMachine((s) => s.role);
  const fix = useMachine((s) => s.fix);
  const busy = useMachine((s) => s.ai.busy);
  const phase = useMachine((s) => s.phase);
  const [step, setStep] = useState(0);
  const [done, setDone] = useState(() => ({ design: seen('design'), play: seen('play') }));
  const start = useRef<{ role: string; level: unknown; placed: number; tries: number } | null>(null);
  const bubble = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ top: 90, left: 20 });

  // Each role starts at its first hint.
  useEffect(() => { setStep(0); start.current = fix ? { role, level: fix.puzzle.spec, placed: fix.placed.length, tries: fix.tries } : null; }, [role, !!fix]); // eslint-disable-line react-hooks/exhaustive-deps
  const finish = () => { markSeen(role); setDone((d) => ({ ...d, [role]: true })); };
  // Doing what a hint says moves on to the next one.
  useEffect(() => {
    const was = start.current;
    if (!fix || !was) return;
    // The level itself changed (not the kit: a workbench part is not the change the hint asks for).
    if (role === 'design' && step === 0 && fix.puzzle.spec !== was.level) setStep(1);
    if (role === 'play' && step === 0 && fix.placed.length > was.placed) setStep(1);
    if (role === 'play' && step === 1 && fix.tries > was.tries) { setStep(2); was.tries = fix.tries; }
    else if (role === 'play' && step === 2 && fix.tries > was.tries) setStep(3);
    if (fix.solved) finish();
  }, [fix, role, step]); // eslint-disable-line react-hooks/exhaustive-deps

  const steps = STEPS[role];
  const current = steps[Math.min(step, steps.length - 1)];
  const inHand = fix?.picking != null ? fix.hand[fix.picking] : undefined;
  const noHelp = useMachine((s) => s.noHelp());
  const words: Words = { inHand: inHand && kitName(inHand).toLowerCase(), ball: fix?.puzzle.spec.parts.find((p) => p.kind === 'ball')?.label ?? 'ball', noHelp };
  const text = typeof current.text === 'string' ? current.text : current.text(words);
  const hidden = covered || done[role] || !fix || fix.solved || busy || phase === 'playing' || phase === 'simulating';
  useLayoutEffect(() => {
    if (hidden) return;
    const target = document.querySelector<HTMLElement>(current.anchor), card = bubble.current;
    if (!target || !card) return;
    target.classList.add('guide-target');
    // The level card scrolls: bring the control the hint talks about into view.
    target.scrollIntoView({ block: 'nearest' });
    const place = () => {
      const r = target.getBoundingClientRect(), h = card.offsetHeight, w = card.offsetWidth;
      // A phone has no free corner: the hint sits on top of the stage, never on the buttons it talks about.
      if (innerWidth <= 700) { setPosition({ left: 10, top: 56 }); return; }
      const stage = document.querySelector('.machine-viewport')?.getBoundingClientRect();
      if (current.side === 'stage' && stage) { setPosition({ left: stage.left + 16, top: stage.top + 64 }); return; }
      // Well clear of the control it points at, so the control and what is around it stay in view.
      const left = current.side === 'left' ? r.left - w - 44 : r.left;
      let top = current.side ? r.top : r.top - h - 30;
      if (top < 76) top = r.bottom + 26;
      setPosition({ left: Math.max(10, Math.min(innerWidth - w - 10, left)), top: Math.max(76, Math.min(innerHeight - h - 10, top)) });
    };
    place(); const observer = new ResizeObserver(place); observer.observe(target); observer.observe(card);
    window.addEventListener('resize', place); window.addEventListener('scroll', place, true);
    return () => { observer.disconnect(); target.classList.remove('guide-target'); window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [current, hidden, text]);

  if (hidden) return null;
  return <div ref={bubble} className={`workshop-guide${current.side ? ' beside' : ''}`} style={position} role="region" aria-label={role === 'design' ? 'Designer hints' : 'Player hints'}>
    <div className="guide-top"><span>{role === 'design' ? 'DESIGNER' : 'PLAYER'} · {Math.min(step, steps.length - 1) + 1} / {steps.length}</span><button aria-label="Hide hints" onClick={finish}>×</button></div>
    <div aria-live="polite"><h3>{current.title}</h3><p>{text}</p></div>
    <div className="guide-actions">
      {current.ok && <button className="primary" onClick={finish}>{current.ok}</button>}
      <button className="guide-skip" onClick={finish}>Skip the hints</button>
    </div>
  </div>;
}
