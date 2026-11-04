import { useEffect, useState } from 'react';
import { parseMachine, type MachineSpec } from '@pg/core';
import { useMachine } from '../app/game';

/** Levels the AI made from the judge prompt set (apps/cli/judge-prompts.json), with a picture of each. */
interface Example { id: string; group: 'place' | 'story' | 'home' | 'wild'; prompt: string; title: string; world?: string; spec: MachineSpec }

const GROUPS: { id: Example['group']; name: string }[] = [
  { id: 'place', name: 'Real places' },
  { id: 'story', name: 'Stories and legends' },
  { id: 'home', name: 'Around the house' },
  { id: 'wild', name: 'Wild cards' },
];

/** The four things a good prompt says, in the colours the example sentence uses. */
const SLOTS = [
  { key: 'rolls', name: 'What rolls', say: 'a snowball', tip: 'The ball becomes it: a pizza, a pearl, a croissant.' },
  { key: 'where', name: 'Where', say: 'races down the High Tatras', tip: 'Name a real place and its landmark stands on the board.' },
  { key: 'goal', name: 'The goal', say: 'into a mountain hut', tip: 'The goal becomes it: a toy box, a cauldron, a nest.' },
  { key: 'twist', name: 'A twist', say: 'past the frozen lake', tip: 'Rivers, walls, guards: they stand in the way.' },
];

const TIPS = [
  'Any language works, and so do emoji and typos: “guľa sa kotúľa z Tatier do chaty”, “🐉🏰🔥”.',
  'One word works too (“fun”), but the more you say, the more the world looks like what you meant.',
  'Long stories are fine: the AI picks out what rolls, where, and where it must go.',
  'The AI only sets the stage. Solving it is up to whoever plays your level.',
];

/** One example's picture over everything: fitted to the screen, a click shows it at full size (scroll to look around). */
function Lightbox({ example: x, onClose }: { example: Example; onClose: () => void }) {
  const [full, setFull] = useState(false);
  useEffect(() => {
    // Esc closes the picture, not the handbook under it.
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopImmediatePropagation(); onClose(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);
  return <div className={`lightbox ${full ? 'full' : ''}`} role="dialog" aria-modal="true" aria-label={x.prompt} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
    <button className="dialog-close" onClick={onClose} aria-label="Close">×</button>
    <img src={`/handbook/${x.id}.webp`} alt={`The level made from: ${x.prompt}`} onClick={() => setFull((f) => !f)} title={full ? 'Click to fit the screen' : 'Click to see it bigger'} />
    <p><q>{x.prompt}</q> made “{x.title}”{x.world ? `, ${x.world}` : ''}</p>
  </div>;
}

export function PromptBook({ onDone }: { onDone: () => void }) {
  const [examples, setExamples] = useState<Example[] | null>(null);
  const [failed, setFailed] = useState(false);
  const busy = useMachine((s) => s.ai.busy);
  const [zoom, setZoom] = useState<Example | null>(null);
  useEffect(() => {
    fetch('/handbook/examples.json').then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status))))).then(setExamples, () => setFailed(true));
  }, []);
  const play = (x: Example) => {
    const parsed = parseMachine(x.spec);
    if (!parsed.ok) return;
    onDone();
    void useMachine.getState().playLevel({ slug: `handbook-${x.id}`, emoji: '📖', name: x.title, mission: x.prompt, order: 0, spec: parsed.spec, verified: false });
  };
  const make = (prompt: string) => { onDone(); void useMachine.getState().create(prompt); };
  return <>
    <p className="kit-intro">A level starts as one sentence. Say these four things and the AI builds a world around them:</p>
    <div className="prompt-formula">
      {SLOTS.map((s) => <div key={s.key} className={`slot ${s.key}`}><strong>{s.name}</strong><small>{s.tip}</small></div>)}
    </div>
    <p className="prompt-sample"><q>{SLOTS.map((s, i) => <span key={s.key} className={s.key}>{s.say}{i < SLOTS.length - 1 ? ' ' : ''}</span>)}</q>
      <button type="button" disabled={busy} onClick={() => make(SLOTS.map((s) => s.say).join(' '))}>Make it →</button></p>
    <ul className="prompt-tips">{TIPS.map((t) => <li key={t}>{t}</li>)}</ul>
    {failed && <p className="kit-intro">The examples did not load. Try again later.</p>}
    {examples && GROUPS.map((g) => {
      const list = examples.filter((x) => x.group === g.id);
      return list.length ? <section key={g.id}>
        <h2 className="kit-level-heading">{g.name}</h2>
        <div className="prompt-examples">{list.map((x) => (
          <article key={x.id} className="prompt-example">
            <button type="button" className="example-pic" onClick={() => setZoom(x)} title="See it bigger"><img src={`/handbook/${x.id}.webp`} alt={`The level made from: ${x.prompt}`} width="640" height="527" loading="lazy" /><span aria-hidden="true">⤢</span></button>
            <q>{x.prompt}</q>
            <small>made “{x.title}”{x.world ? `, ${x.world}` : ''}</small>
            <div className="chip-row">
              <button type="button" className="primary" disabled={busy} onClick={() => play(x)} title="Opens this level as it was made: no waiting">▶ Solve this one</button>
              <button type="button" disabled={busy} onClick={() => make(x.prompt)} title="The AI makes a new level from the same sentence">🎨 Make my own</button>
            </div>
          </article>))}
        </div>
      </section> : null;
    })}
    {zoom && <Lightbox example={zoom} onClose={() => setZoom(null)} />}
  </>;
}
