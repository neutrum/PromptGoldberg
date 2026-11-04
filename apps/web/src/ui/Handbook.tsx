import { useEffect, useState, type ReactElement } from 'react';
import { KIT, kitKeys } from './kit';
import { PromptBook } from './PromptBook';

/*
 * The illustrated handbook: retro safety-poster cards starring Marbles, the workshop's ball.
 * All drawn here as SVG, so there are no image files and they stay sharp at any size.
 */

const INK = '#1d2a2e', PAPER = '#f3e3bf', RAY = '#ead2a0', BALL = '#e8743b', SHINE = '#ffd3ad', MUSTARD = '#f0b33e', TEAL = '#2f8a7e', RED = '#cf4f34';
const line = { stroke: INK, strokeWidth: 3, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, fill: 'none' };

type Pose = 'thumb' | 'point' | 'wave' | 'push' | 'shock';

/** A white cartoon glove; `thumb` raises the thumb. */
function Glove({ x, y, turn = 0, thumb = false }: { x: number; y: number; turn?: number; thumb?: boolean }) {
  return <g transform={`translate(${x} ${y}) rotate(${turn})`}>
    {thumb && <ellipse cx="-1" cy="-9" rx="3.2" ry="6" fill="#fff" stroke={INK} strokeWidth="2.4" />}
    <ellipse cx="0" cy="0" rx="7.5" ry="6.5" fill="#fff" stroke={INK} strokeWidth="2.4" />
    <path d="M -3 -2 L 4 -2 M -3 2 L 4 2" stroke={INK} strokeWidth="1.4" strokeLinecap="round" />
  </g>;
}

const ARMS: Record<Pose, { path: string; glove: [number, number, number, boolean] }[]> = {
  thumb: [{ path: 'M 24 2 C 36 -2 38 -12 39 -20', glove: [40, -24, 0, true] }, { path: 'M -24 6 C -36 8 -36 18 -27 20', glove: [-26, 20, 20, false] }],
  point: [{ path: 'M 24 2 C 34 0 40 -4 46 -6', glove: [50, -7, -10, false] }, { path: 'M -24 6 C -36 8 -36 18 -27 20', glove: [-26, 20, 20, false] }],
  wave: [{ path: 'M 22 -6 C 32 -14 34 -26 34 -34', glove: [34, -38, 10, false] }, { path: 'M -22 -6 C -32 -14 -34 -26 -34 -34', glove: [-34, -38, -10, false] }],
  push: [{ path: 'M 24 0 C 34 -4 40 -4 46 -4', glove: [50, -4, 90, false] }, { path: 'M 22 10 C 32 10 40 12 46 12', glove: [50, 12, 90, false] }],
  shock: [{ path: 'M 22 -8 C 30 -16 30 -26 28 -34', glove: [27, -38, 0, false] }, { path: 'M -22 -8 C -30 -16 -30 -26 -28 -34', glove: [-27, -38, 0, false] }],
};

/** Marbles: an orange marble with rubber-hose arms, white gloves and too much confidence. */
export function Mascot({ x = 0, y = 0, scale = 1, pose = 'thumb', turn = 0 }: { x?: number; y?: number; scale?: number; pose?: Pose; turn?: number }) {
  const shocked = pose === 'shock';
  return <g transform={`translate(${x} ${y}) scale(${scale})`}>
    <ellipse cx="0" cy="38" rx="24" ry="4" fill={INK} opacity=".18" />
    <g transform={`rotate(${turn})`}>
      <path d="M -9 22 L -11 33 M 9 22 L 11 33" {...line} strokeWidth={4} />
      <ellipse cx="-14" cy="34" rx="7" ry="4" fill={INK} /><ellipse cx="14" cy="34" rx="7" ry="4" fill={INK} />
      {ARMS[pose].map((a, i) => <path key={i} d={a.path} {...line} strokeWidth={4} />)}
      <circle r="26" fill={BALL} stroke={INK} strokeWidth="3" />
      <ellipse cx="-10" cy="-12" rx="7" ry="3.6" fill={SHINE} transform="rotate(-35 -10 -12)" />
      <ellipse cx="-8" cy="-4" rx="5.5" ry={shocked ? 8.5 : 7.5} fill="#fff" stroke={INK} strokeWidth="2" />
      <ellipse cx="8" cy="-4" rx="5.5" ry={shocked ? 8.5 : 7.5} fill="#fff" stroke={INK} strokeWidth="2" />
      <circle cx={shocked ? -8 : -6.5} cy="-2.5" r={shocked ? 2 : 2.8} fill={INK} /><circle cx={shocked ? 8 : 9.5} cy="-2.5" r={shocked ? 2 : 2.8} fill={INK} />
      <path d={shocked ? 'M -12 -15 Q -8 -19 -4 -15 M 4 -15 Q 8 -19 12 -15' : 'M -12 -14 Q -8 -16 -4 -13 M 4 -13 Q 8 -16 12 -14'} {...line} strokeWidth={2} />
      {shocked
        ? <ellipse cx="0" cy="13" rx="4.5" ry="5.5" fill="#4a1f15" stroke={INK} strokeWidth="2" />
        : <><path d="M -12 7 Q 0 22 12 7 Z" fill="#4a1f15" stroke={INK} strokeWidth="2" strokeLinejoin="round" /><path d="M -9 8.5 L 9 8.5" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" /></>}
      {ARMS[pose].map((a, i) => <Glove key={i} x={a.glove[0]} y={a.glove[1]} turn={a.glove[2]} thumb={a.glove[3]} />)}
    </g>
  </g>;
}

/** The retro sunburst behind the star of each card. */
function Rays({ x, y }: { x: number; y: number }) {
  return <g transform={`translate(${x} ${y})`}>
    {Array.from({ length: 12 }, (_, i) => <path key={i} d="M 0 0 L -14 -160 L 14 -160 Z" fill={RAY} transform={`rotate(${i * 30})`} />)}
  </g>;
}

const Ramp = ({ x, y, w = 64, h = 34 }: { x: number; y: number; w?: number; h?: number }) =>
  <path d={`M ${x} ${y} L ${x + w} ${y} L ${x} ${y - h} Z`} fill={MUSTARD} stroke={INK} strokeWidth="3" strokeLinejoin="round" />;
const Bucket = ({ x, y }: { x: number; y: number }) => <g transform={`translate(${x} ${y})`}>
  <path d="M -18 -26 L 18 -26 L 13 0 L -13 0 Z" fill={TEAL} stroke={INK} strokeWidth="3" strokeLinejoin="round" />
  <path d="M -18 -26 Q 0 -40 18 -26" {...line} strokeWidth={2.5} /><path d="M -15 -18 L 15 -18" stroke={INK} strokeWidth="1.6" opacity=".5" />
</g>;
const Star = ({ x, y, r = 11 }: { x: number; y: number; r?: number }) =>
  <path transform={`translate(${x} ${y})`} fill={MUSTARD} stroke={INK} strokeWidth="2.5" strokeLinejoin="round"
    d={Array.from({ length: 10 }, (_, i) => { const a = (i * Math.PI) / 5 - Math.PI / 2, k = i % 2 ? r * 0.45 : r; return `${i ? 'L' : 'M'} ${(Math.cos(a) * k).toFixed(1)} ${(Math.sin(a) * k).toFixed(1)}`; }).join(' ') + ' Z'} />;
const Key = ({ x, y, label }: { x: number; y: number; label: string }) => <g transform={`translate(${x} ${y})`}>
  <rect x="-11" y="-11" width="22" height="22" rx="4" fill="#fff8e6" stroke={INK} strokeWidth="2.5" />
  <text y="5" textAnchor="middle" fontSize="13" fontWeight="800" fill={INK}>{label}</text>
</g>;
const Speed = ({ x, y }: { x: number; y: number }) => <path d={`M ${x} ${y} l -22 0 M ${x - 4} ${y + 9} l -16 0 M ${x} ${y + 18} l -22 0`} {...line} strokeWidth={2.4} />;

/** One picture per lesson, 200 × 140. */
const SCENES: Record<string, () => ReactElement> = {
  sentence: () => <>
    <Rays x={60} y={92} />
    <path d="M 96 12 h 92 a 8 8 0 0 1 8 8 v 34 a 8 8 0 0 1 -8 8 h -66 l -14 12 l 2 -12 h -14 a 8 8 0 0 1 -8 -8 v -34 a 8 8 0 0 1 8 -8 z" fill="#fffaf0" stroke={INK} strokeWidth="2.5" />
    <text x="142" y="32" textAnchor="middle" fontSize="10" fontWeight="700" fill={INK}>“A pirate ship</text>
    <text x="142" y="46" textAnchor="middle" fontSize="10" fontWeight="700" fill={INK}>finds treasure!”</text>
    <ellipse cx="156" cy="122" rx="32" ry="7" fill={MUSTARD} stroke={INK} strokeWidth="2.5" />
    <path d="M 160 118 Q 158 98 166 86" {...line} />
    <path d="M 166 86 q -16 -4 -22 6 M 166 86 q 14 -6 20 4 M 166 86 q -2 -12 -12 -14 M 166 86 q 8 -10 18 -8" stroke={TEAL} strokeWidth="5" strokeLinecap="round" fill="none" />
    <path d="M 140 110 l 6 6 m 0 -6 l -6 6" stroke={RED} strokeWidth="3" strokeLinecap="round" />
    <Mascot x={60} y={90} pose="point" />
  </>,
  shape: () => <>
    <Rays x={70} y={86} />
    <g transform="translate(128 50)"><rect width="46" height="44" fill={MUSTARD} stroke={INK} strokeWidth="3" /><path d="M 0 0 L 46 44 M 46 0 L 0 44" stroke={INK} strokeWidth="2" opacity=".55" /></g>
    <path d="M 112 102 q 24 6 66 0" {...line} strokeWidth={2} strokeDasharray="4 5" />
    <Key x={118} y={124} label="←" /><Key x={144} y={124} label="R" /><Key x={170} y={124} label="→" />
    <Mascot x={70} y={84} pose="push" turn={8} />
  </>,
  send: () => <>
    <Rays x={62} y={90} />
    <g transform="translate(146 46) rotate(-10)">
      <path d="M -26 -8 q -18 -16 -30 -6 q 14 4 18 14 Z M 26 -8 q 18 -16 30 -6 q -14 4 -18 14 Z" fill="#fff" stroke={INK} strokeWidth="2.2" strokeLinejoin="round" />
      <rect x="-26" y="-17" width="52" height="34" rx="3" fill="#fffaf0" stroke={INK} strokeWidth="2.5" />
      <path d="M -26 -17 L 0 4 L 26 -17" {...line} strokeWidth={2.2} />
      <circle cx="0" cy="4" r="5" fill={RED} stroke={INK} strokeWidth="1.8" />
    </g>
    <path d="M 100 80 q 14 -10 20 -20" {...line} strokeWidth={2} strokeDasharray="3 5" />
    <Mascot x={62} y={88} pose="wave" />
  </>,
  pick: () => <>
    <Rays x={100} y={92} />
    <g transform="translate(0 -6)"><Ramp x={62} y={52} w={76} h={30} /></g>
    <path d="M 40 30 l 6 -6 M 160 30 l -6 -6 M 36 46 l 8 0 M 164 46 l -8 0" {...line} strokeWidth={2.4} />
    <Mascot x={100} y={92} pose="wave" />
  </>,
  run: () => <>
    <Rays x={170} y={110} />
    <Ramp x={8} y={128} w={120} h={58} />
    <Bucket x={170} y={128} />
    <Speed x={66} y={52} />
    <Mascot x={86} y={74} scale={0.62} pose="shock" turn={-25} />
    <text x="132" y="44" fontSize="16" fontWeight="900" fill={RED} transform="rotate(-8 132 44)">WHEE!</text>
  </>,
  stars: () => <>
    <Rays x={100} y={90} />
    <Star x={58} y={36} /><Star x={100} y={22} r={14} /><Star x={142} y={36} />
    <Mascot x={100} y={92} pose="thumb" />
  </>,
};

export function Scene({ name }: { name: string }) {
  const Draw = SCENES[name] ?? SCENES.stars;
  return <svg viewBox="0 0 200 140" role="img" aria-hidden="true"><rect width="200" height="140" fill={PAPER} /><Draw /></svg>;
}

interface Lesson { scene: string; title: string; text: string; joke: string }
export const LESSONS: Record<'design' | 'play', Lesson[]> = {
  design: [
    { scene: 'sentence', title: 'One sentence', text: 'Say a place, what rolls and where it has to go. The AI builds the world around it.', joke: 'Grammar optional. Pirates encouraged.' },
    { scene: 'shape', title: 'Shape it', text: 'Drag a thing to move it, arrows nudge it, R turns it. Or say it: “build a fence around the goal”.', joke: 'Every fence is a strong opinion.' },
    { scene: 'send', title: 'Test it, send it', text: 'Play your level the way a player will, then send the link. Anyone can open it.', joke: 'Friendships not guaranteed.' },
  ],
  play: [
    { scene: 'pick', title: 'Pick a part', text: 'Click a part in the tray, then click the stage. Or type it: “put a ramp next to the ball”.', joke: 'Ramps: the original slide.' },
    { scene: 'run', title: 'Run it', text: 'Press Run and watch. Move or turn a part, then run again. As often as you like.', joke: 'Physics is never wrong. You might be.' },
    { scene: 'stars', title: 'Collect stars', text: 'Fewer parts and fewer tries win more stars. Stuck? “Solve it for me” builds the AI’s idea.', joke: 'No stars, no shame. Some shame.' },
  ],
};

export function LessonCard({ lesson, n }: { lesson: Lesson; n?: number }) {
  return <article className="lesson">
    <header>{n !== undefined && <span>LESSON {n}</span>}<h3>{lesson.title}</h3></header>
    <Scene name={lesson.scene} />
    <p>{lesson.text}</p>
    <small>{lesson.joke}</small>
  </article>;
}

/** "How to play": both roles as three illustrated cards each; "Show me" brings back the on-screen hints. */
export type HandbookTab = 'play' | 'design' | 'parts' | 'prompts';

/** Every kit part: its picture, what it does, the keys that work on it and a sentence to type. */
function PartsCatalog() {
  return <>
    <p className="kit-intro">Pick a part in the tray (or type a sentence in the Build box), click the stage to put it down, Esc puts it back. Click a placed part to pick it up again.</p>
    <div className="kit-catalog">{KIT.filter((k) => !k.level).map((k) => (
      <article key={k.kind} className="kit-entry">
        <img src={`/models/kit-v1/thumbs/${k.kind}.webp`} alt="" width="128" height="96" />
        <div>
          <h3>{k.name} <small>{k.hint}</small></h3>
          <p>{k.tip}</p>
          <ul className="kit-keys">{kitKeys(k.kind).map((key) => <li key={key}>{key}</li>)}</ul>
          {k.say && <p className="kit-say">Or type: <q>{k.say}</q></p>}
        </div>
      </article>))}
    </div>
    <h2 className="kit-level-heading">Already on the stage</h2>
    <div className="kit-catalog">{KIT.filter((k) => k.level).map((k) => (
      <article key={k.kind} className="kit-entry small">
        <img src={`/models/kit-v1/thumbs/${k.kind}.webp`} alt="" width="96" height="72" />
        <div><h3>{k.name} <small>{k.hint}</small></h3><p>{k.tip}</p></div>
      </article>))}
    </div>
  </>;
}

export function Handbook({ tab = 'play', onClose, onShowHints, onLevel = onClose }: { tab?: HandbookTab; onClose: () => void; onShowHints: () => void; /** A level started from the prompt ideas: everything over the stage closes. */ onLevel?: () => void }) {
  const [role, setRole] = useState<HandbookTab>(tab);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return <div className="welcome handbook" role="dialog" aria-modal="true" aria-label="How to play" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
    <div className="welcome-card handbook-card">
      <button className="dialog-close" onClick={onClose} aria-label="Close">×</button>
      <span className="eyebrow">THE WORKSHOP HANDBOOK</span>
      <h1>How it works</h1>
      <div className="handbook-tabs" role="tablist">
        <button role="tab" aria-selected={role === 'play'} className={role === 'play' ? 'on' : ''} onClick={() => setRole('play')}>🧩 Solve a level</button>
        <button role="tab" aria-selected={role === 'design'} className={role === 'design' ? 'on' : ''} onClick={() => setRole('design')}>🎨 Make a level</button>
        <button role="tab" aria-selected={role === 'prompts'} className={role === 'prompts' ? 'on' : ''} onClick={() => setRole('prompts')}>✍️ Prompt ideas</button>
        <button role="tab" aria-selected={role === 'parts'} className={role === 'parts' ? 'on' : ''} onClick={() => setRole('parts')}>📦 All parts</button>
      </div>
      {role === 'parts' ? <PartsCatalog /> : role === 'prompts' ? <PromptBook onDone={onLevel} /> : <div className="lessons">{LESSONS[role].map((l, i) => <LessonCard key={l.scene} lesson={l} n={i + 1} />)}</div>}
      <div className="handbook-actions"><button className="primary" onClick={onClose}>Got it</button><button onClick={() => { onShowHints(); onClose(); }}>Show me on the screen</button></div>
    </div>
  </div>;
}

/** A loading-screen card while a level builds: a new lesson every few seconds. */
export function BuildTip() {
  const all = [...LESSONS.design, ...LESSONS.play];
  const [i, setI] = useState(() => Math.floor(Math.random() * all.length));
  useEffect(() => { const t = setInterval(() => setI((n) => (n + 1) % all.length), 6000); return () => clearInterval(t); }, [all.length]);
  return <div className="build-tip"><LessonCard lesson={all[i]} /></div>;
}
