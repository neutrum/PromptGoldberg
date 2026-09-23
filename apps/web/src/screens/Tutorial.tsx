import type { Level } from '@og/shared';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useGame } from '../game/gameStore';
import { padScreen } from '../scene/Aim';
import { isTouch } from '../ui/device';

type TutorialId = 'aim' | 'pieces';
type GameSnapshot = ReturnType<typeof useGame.getState>;

type Anchor = { pad: true } | { selector: string } | { center: true };

interface Step {
  text: ReactNode;
  anchor: Anchor;
  /** Where the bubble sits relative to the anchor. */
  side: 'above' | 'below' | 'left';
  /** Element that gets a pulsing outline. */
  highlight?: string;
  /** Advances by button when absent. */
  done?: (g: GameSnapshot, start: StartState) => boolean;
  button?: string;
  /** Step to go to instead of the next one. */
  then?: (g: GameSnapshot) => number | 'finish';
}

interface StartState {
  values: number[];
}

const AIM: Step[] = [
  {
    text: <>Up here is your <b>goal</b>: a chain reaction to trigger, step by step. Each step has a matching ring out in space.</>,
    anchor: { selector: '.chain' }, side: 'below', highlight: '.chain', button: 'Next',
  },
  {
    text: <>This glowing dot is your <b>probe</b>. <b>Drag back</b> from it, like a slingshot, to aim and set the power.</>,
    anchor: { pad: true }, side: 'below',
    done: (g, s) => g.values.some((v, i) => Math.abs(v - s.values[i]) > 1e-9),
  },
  {
    text: <>The <b>dashed line</b> shows how the flight starts. After that, gravity takes over, so point it toward the ring.</>,
    anchor: { pad: true }, side: 'below', button: 'Got it',
  },
  {
    text: isTouch ? <>Fire! Tap <b>LAUNCH</b>.</> : <>Fire! Press <b>LAUNCH</b> or <kbd>Space</kbd>.</>,
    anchor: { selector: '.launch' }, side: 'above', highlight: '.launch',
    done: (g) => g.phase === 'flying',
  },
  {
    text: <>Rings light up as each step happens, and time slows at close passes. {isTouch ? <><b>Skip</b></> : <kbd>Space</kbd>} skips ahead.</>,
    anchor: { selector: '.chain' }, side: 'below',
    done: (g) => g.phase === 'result',
    then: (g) => (g.outcome?.success ? 5 : 6),
  },
  {
    text: <>Chain complete! Finish within <b>par</b> shots for three stars. Try the next level when you’re ready.</>,
    anchor: { selector: '.result' }, side: 'above', button: 'Nice',
    then: () => 'finish',
  },
  {
    text: <>A miss tells you something: the red <b>✗</b> marks your closest pass, and this shot stays as a faint <b>ghost trail</b>. Adjust, then launch again.</>,
    anchor: { selector: '.result' }, side: 'above',
    done: (g) => g.phase === 'flying',
    then: () => 4,
  },
];

const PIECES: Step[] = [
  {
    text: <>This level needs a helper. <b>Pick a piece</b> here.</>,
    anchor: { selector: '.pieces' }, side: 'left', highlight: '.pieces',
    done: (g) => g.placing !== null || g.pieces.length > 0,
  },
  {
    text: <><b>{isTouch ? 'Tap' : 'Click'} anywhere in space</b> to drop it. It orbits the star from that spot, and its gravity bends the probe’s path.</>,
    anchor: { center: true }, side: 'below',
    done: (g) => g.pieces.length > 0,
  },
  {
    text: <>See the dashed preview bend? Remove a piece with <b>✕</b> or by {isTouch ? 'tapping' : 'clicking'} it, try other spots, then launch.</>,
    anchor: { selector: '.pieces' }, side: 'left',
    done: (g) => g.phase === 'flying',
    then: () => 'finish',
  },
];

const TUTORIALS: Record<TutorialId, Step[]> = { aim: AIM, pieces: PIECES };

const canDrag = (level: Level) => level.controls.some((c) => /\.(speed|angle)$/.test(c.path));

function wanted(level: Level, seen: Record<string, boolean>, off: boolean): TutorialId | null {
  if (off) return null;
  if (canDrag(level) && !seen.aim) return 'aim';
  if (level.pieces && !seen.pieces && (seen.aim || !canDrag(level))) return 'pieces';
  return null;
}

function anchorPoint(anchor: Anchor, side: Step['side']): { x: number; y: number } | null {
  if ('pad' in anchor) return padScreen.current;
  if ('center' in anchor) return { x: window.innerWidth / 2, y: window.innerHeight * 0.18 };
  const el = document.querySelector(anchor.selector);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (side === 'above') return { x: r.left + r.width / 2, y: r.top };
  if (side === 'below') return { x: r.left + r.width / 2, y: r.bottom };
  return { x: r.left, y: r.top + r.height / 2 };
}

/** Coach marks that react to what the player actually does. */
export function Tutorial({ level }: { level: Level }) {
  const seen = useGame((s) => s.progress.tutorial);
  const off = useGame((s) => s.progress.tutorialsOff);
  const phase = useGame((s) => s.phase);
  const [active, setActive] = useState<{ id: TutorialId; step: number; start: StartState } | null>(null);
  const bubble = useRef<HTMLDivElement>(null);

  // Start a tutorial when the player reaches a level that needs one.
  useEffect(() => {
    if (active || phase !== 'aiming') return;
    const id = wanted(level, seen, off);
    if (id) setActive({ id, step: 0, start: { values: [...useGame.getState().values] } });
  }, [level, seen, off, phase, active]);

  const finish = (id: TutorialId) => {
    useGame.getState().finishTutorial(id);
    setActive(null);
  };

  /** Moves on from `from` only; repeated triggers for the same step are ignored. */
  const advance = (g: GameSnapshot, from: number) => {
    setActive((a) => {
      if (!a || a.step !== from) return a;
      const step = TUTORIALS[a.id][a.step];
      const next = step.then ? step.then(g) : a.step + 1;
      if (next === 'finish' || next >= TUTORIALS[a.id].length) {
        queueMicrotask(() => finish(a.id));
        return null;
      }
      return { ...a, step: next, start: { values: [...g.values] } };
    });
  };

  // Condition-driven steps.
  useEffect(() => {
    if (!active) return;
    const step = TUTORIALS[active.id][active.step];
    if (!step.done) return;
    const check = (g: GameSnapshot) => { if (step.done!(g, active.start)) advance(g, active.step); };
    check(useGame.getState());
    return useGame.subscribe(check);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  // Follow the anchor every frame (the pad moves with the camera) and pulse the highlight.
  const step = active ? TUTORIALS[active.id][active.step] : null;
  useLayoutEffect(() => {
    if (!step) return;
    const target = step.highlight ? document.querySelector(step.highlight) : null;
    let raf = 0;
    const tick = () => {
      const el = bubble.current;
      const hl = step.highlight ? document.querySelector(step.highlight) : null;
      hl?.classList.add('tut-highlight');
      if (el) {
        const w = el.offsetWidth, h = el.offsetHeight, gap = 'pad' in step.anchor ? 40 : 18, m = 10;
        // On narrow screens a 'left' bubble would cover its anchor; sit above it instead.
        let side = step.side;
        let p = anchorPoint(step.anchor, side);
        if (side === 'left' && p && p.x - w - gap < m) {
          side = 'above';
          p = anchorPoint(step.anchor, side);
        }
        p ??= { x: window.innerWidth / 2, y: window.innerHeight / 2 };
        el.className = `tutorial side-${side}`;
        let x = side === 'left' ? p.x - w - gap : p.x - w / 2;
        let y = side === 'above' ? p.y - h - gap : side === 'below' ? p.y + gap : p.y - h / 2;
        x = Math.min(window.innerWidth - w - m, Math.max(m, x));
        y = Math.min(window.innerHeight - h - m, Math.max(m, y));
        el.style.transform = `translate(${x}px, ${y}px)`;
        el.style.setProperty('--arrow-x', `${Math.min(w - 16, Math.max(16, p.x - x))}px`);
        el.style.setProperty('--arrow-y', `${Math.min(h - 16, Math.max(16, p.y - y))}px`);
        el.dataset.pointing = anchorPoint(step.anchor, step.side) ? 'yes' : 'no';
      }
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => {
      cancelAnimationFrame(raf);
      target?.classList.remove('tut-highlight');
      document.querySelectorAll('.tut-highlight').forEach((e) => e.classList.remove('tut-highlight'));
    };
  }, [step]);

  if (!active || !step) return null;
  const steps = TUTORIALS[active.id];
  const shownSteps = active.id === 'aim' ? 5 : steps.length;

  return (
    <div ref={bubble} className={`tutorial side-${step.side}`} role="dialog" aria-live="polite">
      <div className="tutorial-text">{step.text}</div>
      <div className="tutorial-foot">
        <span className="muted">{Math.min(active.step + 1, shownSteps)}/{shownSteps}</span>
        <button className="link" onClick={() => finish(active.id)}>Skip tutorial</button>
        {step.button && <button className="primary" onClick={() => advance(useGame.getState(), active.step)}>{step.button}</button>}
      </div>
    </div>
  );
}
