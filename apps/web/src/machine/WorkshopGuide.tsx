import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { useMachine } from './machineStore';

export const GUIDE_KEY = 'pg.workshop-guide.v1';
export const guideDismissed = () => { try { return localStorage.getItem(GUIDE_KEY) === 'done'; } catch { return false; } };

/** Action-driven help beside the control in use; never blocks the stage or resets a build. */
export function WorkshopGuide({ example, inputRef, onClose }: { example: boolean; inputRef: RefObject<HTMLInputElement | null>; onClose: () => void }) {
  const [step, setStep] = useState<0 | 1 | 2 | 3>(0);
  const phase = useMachine(s => s.phase);
  const machine = useMachine(s => s.machine);
  const pending = useMachine(s => s.pendingPart);
  const lastEdit = useMachine(s => s.lastEdit);
  const builds = useMachine(s => s.builds);
  const busy = useMachine(s => s.ai.busy);
  const promptMode = useMachine(s => s.promptMode);
  const fix = useMachine(s => s.fix);
  const initialBuilds = useRef(builds);
  const initialMachine = useRef(machine);
  const lastPhase = useRef(phase);
  const bubble = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ top: 90, left: 20 });
  const close = () => { try { localStorage.setItem(GUIDE_KEY, 'done'); } catch { /* private mode */ } onClose(); };

  useEffect(() => {
    if (builds > initialBuilds.current) { close(); return; }
    if (promptMode === 'create') setStep(3);
    else if (step === 0 && phase === 'done' && lastPhase.current !== 'done') setStep(1);
    else if (step <= 1 && lastEdit && machine !== initialMachine.current && !pending) setStep(2);
    else if (step === 2 && phase === 'done' && lastPhase.current !== 'done') setStep(3);
    lastPhase.current = phase;
  }, [builds, promptMode, step, phase, lastEdit, machine, pending]);

  const hidden = !machine || !!fix || busy || phase === 'playing' || phase === 'simulating';
  const anchor = step === 0 || step === 2 ? '.stage-transport' : step === 1 ? '.parts-heading' : '.mprompt';
  useLayoutEffect(() => {
    if (hidden) return;
    const target = document.querySelector<HTMLElement>(anchor), card = bubble.current;
    if (!target || !card) return;
    target.classList.add('guide-target');
    const place = () => {
      const r = target.getBoundingClientRect(), h = card.offsetHeight, w = card.offsetWidth;
      const mobile = innerWidth <= 700;
      let left = step === 1 && !mobile ? r.left - w - 24 : r.left;
      let top = step === 1 && !mobile ? r.top : r.top - h - 14;
      if (top < 76) top = r.bottom + 12;
      setPosition({ left: Math.max(10, Math.min(innerWidth - w - 10, left)), top: Math.max(76, Math.min(innerHeight - h - 10, top)) });
    };
    place(); const observer = new ResizeObserver(place); observer.observe(target); observer.observe(card);
    window.addEventListener('resize', place); window.addEventListener('scroll', place, true);
    return () => { observer.disconnect(); target.classList.remove('guide-target'); window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [anchor, hidden, step, pending]);

  if (hidden) return null;
  const titles = [example ? 'This is an example' : 'Start with a run', pending ? 'Place your part' : 'Make one small change', 'That change is yours', 'Now give the AI your idea'];
  const copy = [example ? 'A ready-made machine, here for you to try. Press Run and follow the marble to the bell.' : 'Press Run to see this machine in motion. Your build stays here while you explore.',
    pending ? 'Click a clear spot on the stage. Once placed, drag the part to move it. Undo is always there for your last change.' : 'Pick a fan from the Parts tray, then click the stage to place it. Your example stays here.',
    'Press Run to test your change. A missed goal is part of experimenting: move the part or Undo and try again.',
    'Describe a new chain reaction. The AI builds and checks it; you press Run. Start with our suggestion or write your own.'];
  return <div ref={bubble} className={`workshop-guide guide-step-${step}`} style={position} role="region" aria-label="Workshop guide">
    <div className="guide-top"><span>QUICK START · {step + 1} / 4</span><button aria-label="Dismiss quick start" onClick={close}>×</button></div>
    <div aria-live="polite"><h3>{titles[step]}</h3><p>{copy[step]}</p></div>
    <div className="guide-actions">
      {(step === 0 || step === 2) && <button className="primary" disabled={!!pending} onClick={() => useMachine.getState().play()}>{step === 0 && example ? 'Run the example' : 'Run my machine'} ▶</button>}
      {step === 1 && !pending && <button className="primary" onClick={() => useMachine.getState().addPart('fan')}>Pick a fan</button>}
      {step === 3 && <button className="primary" onClick={() => { const s = useMachine.getState(); s.setPromptMode('create'); if (!s.draft.trim()) s.setDraft('Fire a marble from a cannon over a river into a bucket'); inputRef.current?.focus(); }}>Write an idea</button>}
      <button className="guide-skip" onClick={close}>Explore on my own</button>
    </div>
  </div>;
}
