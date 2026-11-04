import { useEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import type { WorkbenchPart } from '@pg/client';
import { isGadget, isSolidShape, onPosts, type Part } from '@pg/core';
import { KIT_MAX, useMachine } from '../app/game';
import { api, makeGadget } from '../app/api';
import { hasMeshProvider, useProviders } from './providers';
import { KIT as CATALOG, kitName } from './kit';
import { PartLab } from './PartLab';

/** A hand part's card face: the kit's still render, or the workbench mark for a part made there. */
function Thumb({ part }: { part: Part }) {
  return <span className="part-thumbnail">{isGadget(part) ? <span className="gadget-mark" aria-hidden="true">🛠</span> : <img src={`/models/kit-v1/thumbs/${part.kind}.webp`} alt="" width="128" height="96" draggable={false} />}</span>;
}

const IDEAS = ['a chute with rails', 'a ski jump', 'a spinning sweeper'];

/**
 * A 3D look for a workbench part on the player's mesh provider: a minute or a few. The part is
 * in the kit already, drawn as its shapes; the model replaces the drawing when it arrives.
 */
async function makeLook(id: string, name: string, words: string, spins: boolean, library: string | undefined, onProgress: (text: string) => void, live: () => boolean) {
  // A part that spins gets a model of its still base; its spinning shapes are drawn on it, turning.
  const what = spins ? `${name}: ${words}. Only its still stand, post or frame, without the arms, paddles or blades that turn (they are added separately). One low-poly toy object, a part of a wooden marble run, bright colours, no background.`
    : `${name}: ${words}. One low-poly toy object, a part of a wooden marble run, bright colours, no base or background.`;
  let task = await api.meshStart(what);
  const until = Date.now() + 8 * 60_000;
  while (live() && Date.now() < until) {
    await new Promise((r) => setTimeout(r, 4000));
    if (!live()) return;
    const r = await api.meshCheck(task, library);
    if (r.status === 'failed') throw new Error(r.error);
    if (r.status === 'done') { useMachine.getState().lookKitPart(id, r.model); return; }
    if (r.task) task = r.task;
    onProgress(`◌ Making its 3D look… ${r.progress ? `${Math.round(r.progress)}%` : ''}`);
  }
  if (live()) throw new Error('The 3D look took too long; the part keeps its shapes.');
}

/** Whether workbench parts get a 3D look, remembered in this browser. Off until the player asks: a look takes a minute and the free ones are few a day. Off, a part shows its plain shapes: what the ball meets. */
const LOOK_KEY = 'pg.workbench.look';
const useLookOn = create<{ on: boolean }>(() => {
  try { return { on: localStorage.getItem(LOOK_KEY) === '1' }; } catch { return { on: false }; }
});
const setLookOn = (on: boolean) => { try { localStorage.setItem(LOOK_KEY, on ? '1' : '0'); } catch { /* private mode */ } useLookOn.setState({ on }); };

const addPart = (g: WorkbenchPart) => useMachine.getState().addToKit({ kind: 'wall', label: g.name, build: g.shapes, ...(g.model && useLookOn.getState().on ? { model: g.model } : {}), ...(g.library ? { library: g.library } : {}) });

/** Parts made on the workbench before, by anyone: one click hands one out again. */
function KeptParts({ full }: { full: boolean }) {
  const [parts, setParts] = useState<WorkbenchPart[] | null>(null);
  useEffect(() => { api.workbenchParts().then(setParts, () => setParts([])); }, []);
  if (!parts?.length) return null;
  return <>{parts.slice(0, 24).map((g) => <button key={g.library} type="button" disabled={full} onClick={() => addPart(g)} title={g.model ? 'Made on the workbench, with a 3D look' : 'Made on the workbench'}>🛠 {g.name}</button>)}</>;
}

/** The designer's workbench: describe a new part, the AI builds it, it goes into the player's kit. */
function Workbench({ full, onLab }: { full: boolean; onLab: (part: Part) => void }) {
  const [text, setText] = useState('');
  const [state, setState] = useState<{ busy?: boolean; note?: string; error?: string; lab?: string }>({});
  const ask = useRef(0);
  const [look, setLook] = useState<string | null>(null);
  const looking = useRef(0);
  useEffect(() => () => { looking.current++; }, []);
  const lookOn = useLookOn((s) => s.on), canLook = useProviders((s) => !!s.mesh?.key || s.serverMesh);
  // Whether the server makes 3D looks on its own key today.
  useEffect(() => { api.providers().then((r) => useProviders.setState({ serverMesh: (r.mesh?.left ?? 0) > 0 }), () => {}); }, []);
  const make = async (words: string) => {
    const t = words.trim();
    if (!t || state.busy || full) return;
    const mine = ++ask.current;
    setState({ busy: true });
    try {
      const g = await makeGadget(t);
      if (mine !== ask.current) return;
      const id = addPart(g);
      setText('');
      const tested = g.test ? (g.test.verdict === 'through' ? ' ✓ The lab dropped a ball on it: it gets through.' : ` ⚠ Lab: ${g.test.message}`) : '';
      setState({ note: (g.closest ?? `“${g.name}” is in the player's kit and the workbench library.`) + tested, lab: g.test && g.test.verdict !== 'through' && id ? id : undefined });
      // A part from the library may have its look already: no new one, no credits.
      const spins = g.shapes.some((s) => s.spin), base = g.shapes.some((s) => isSolidShape(s) && !s.spin);
      if (id && !g.model && (!spins || base) && hasMeshProvider() && useLookOn.getState().on) {
        const mine = ++looking.current, live = () => mine === looking.current;
        setLook('◌ Making its 3D look…');
        makeLook(id, g.name, t, spins, g.library, (p) => live() && setLook(p), live).then(() => live() && setLook(null), (err: unknown) => live() && setLook(`3D look: ${err instanceof Error ? err.message : String(err)}`));
      }
    } catch (err) {
      if (mine === ask.current) setState({ error: err instanceof Error ? err.message : String(err) });
    }
  };
  return (
    <form className="workbench" onSubmit={(e) => { e.preventDefault(); void make(text); }}>
      <strong title="The AI builds it from shapes: the ball rolls over it or bounces off it, and a shape can spin to push the ball.">🛠 Workbench <span className="muted small">a new part, by AI</span></strong>
      <input value={text} onChange={(e) => setText(e.target.value)} maxLength={120} placeholder="e.g. a chute with rails" disabled={state.busy || full} aria-label="Describe a new part" />
      {state.busy
        ? <span className="workbench-busy">◌ Building it… <button type="button" className="text-button" onClick={() => { ask.current++; setState({}); }}>Cancel</button></span>
        : <button className="primary" disabled={!text.trim() || full}>{full ? `Kit full (${KIT_MAX})` : 'Make it →'}</button>}
      <label className="workbench-look" title={canLook ? 'A 3D model drawn over the part. The ball still rolls on its shapes.' : 'Add a 3D model key in ⚙ Settings → AI providers'}>
        <input type="checkbox" checked={lookOn && canLook} disabled={!canLook} onChange={(e) => setLookOn(e.target.checked)} /> 🎨 3D look
      </label>
      {!canLook && <span className="muted small">A 3D look needs a 3D model key in ⚙ Settings.</span>}
      {!state.busy && !text && !full && <span className="workbench-ideas">{IDEAS.map((i) => <button key={i} type="button" onClick={() => void make(i)}>{i}</button>)}</span>}
      {state.note && <span className="muted small" role="status">{state.note}{state.lab && <> <button type="button" className="text-button" onClick={() => { const p = useMachine.getState().fix?.hand.find((h) => h.id === state.lab); if (p) onLab(p); }}>🧪 Open the test lab</button></>}</span>}
      {look && <span className="muted small" role="status">{look}</span>}
      {state.error && <span className="mnote" role="alert">{state.error}</span>}
    </form>
  );
}

/** Still renders of the shipped models: the tray adds no WebGL contexts or animation. */
export function PartsTray({ onCatalog }: { onCatalog: () => void }) {
  const fix = useMachine(s => s.fix);
  const busy = useMachine(s => s.ai.busy || s.working);
  const phase = useMachine(s => s.phase);
  // The designer chooses the parts the player will get.
  const designing = useMachine(s => s.role === 'design' && !!s.fix && !s.fix.solved);
  const [adding, setAdding] = useState(false);
  const [lab, setLab] = useState<Part | null>(null);
  const inventory = fix && !fix.solved ? fix : null;
  const blocked = !inventory || busy || designing || phase === 'simulating' || (phase === 'playing' && (!inventory || inventory.tries > 0));
  const entries = inventory
    ? inventory.hand.map((part, index) => ({ ...CATALOG.find(p => p.kind === part.kind)!, ...(isGadget(part) ? { name: part.label ?? 'Workbench part', hint: 'Made on the workbench' } : {}),
      part, id: part.id, index, placed: inventory.placed.some(p => p.id === part.id), selected: inventory.picking === index }))
    : CATALOG.map(part => ({ ...part, part: { id: part.kind, kind: part.kind, x: 0, y: 0, z: 0, yaw: 0 } as Part, id: part.kind, index: -1, placed: false, selected: false }));
  const inHand = inventory?.picking != null ? inventory.hand[inventory.picking] : null;
  const full = (fix?.puzzle.spares?.length ?? 0) >= KIT_MAX;
  if (designing) return (
    <aside className="parts-tray designing" aria-labelledby="parts-title">
      <div className="parts-heading"><h2 id="parts-title">Player's kit</h2><span>{inventory!.hand.length} parts</span></div>
      <p className="parts-intro">What the player gets to solve it with. <button type="button" className="text-button parts-all" onClick={onCatalog}>📦 All parts</button></p>
      <div className="parts-catalog">
        {entries.map(e => (
          <div key={e.id} className="part-card kit-card">
            <Thumb part={e.part} />
            <span className="part-card-copy"><strong>{e.name}</strong><small>{e.hint}</small></span>
            {isGadget(e.part) && <button type="button" className="kit-lab" onClick={() => setLab(e.part)} title={`Test the ${e.name.toLowerCase()} in the lab: drop a ball on it`} aria-label={`Test ${e.name} in the lab`}>🧪</button>}
            <button type="button" className="kit-remove" onClick={() => useMachine.getState().removeFromKit(e.id)} title={`Take the ${e.name.toLowerCase()} out of the kit`} aria-label={`Remove ${e.name}`}>×</button>
          </div>
        ))}
      </div>
      {/* Always in view under the list: adding parts and making new ones. */}
      <div className="kit-tools">
        {adding
          ? <div className="kit-add">{CATALOG.filter(k => !k.level).map(k => <button key={k.kind} type="button" disabled={full} onClick={() => { useMachine.getState().addToKit({ kind: k.kind as Exclude<Part['kind'], 'ball'> }); }} title={k.hint}>{k.name}</button>)}<KeptParts full={full} /><button type="button" className="text-button" onClick={() => setAdding(false)}>Done</button></div>
          : <button type="button" className="kit-add-open" disabled={full} onClick={() => setAdding(true)}>{full ? `Kit full (${KIT_MAX} parts)` : '+ Add a kit part'}</button>}
        <Workbench full={full} onLab={setLab} />
      </div>
      {lab && <PartLab part={inventory?.hand.find((h) => h.id === lab.id) ?? lab} onClose={() => setLab(null)} />}
    </aside>
  );
  return <aside className="parts-tray" aria-labelledby="parts-title">
    <div className="parts-heading"><h2 id="parts-title">Parts</h2><span>{inventory ? `${inventory.hand.length - inventory.placed.length} in hand` : 'Ready to use'}</span></div>
    <p className="parts-intro">{inventory ? 'Your pieces for this puzzle.' : 'The kit every level is built from.'} <button type="button" className="text-button parts-all" onClick={onCatalog}>📦 All parts</button></p>
    <div className="parts-catalog">
      {entries.map(part => <button key={part.id} type="button" className={`part-card${part.selected ? ' selected' : ''}${part.placed ? ' placed' : ''}`}
        aria-label={`${part.kind === 'ball' ? 'Starting marble' : inventory ? part.placed ? 'Move' : 'Place' : 'Add'} ${part.kind === 'ball' ? 'already in the scene' : part.name.toLowerCase()}`}
        aria-pressed={!!part.selected} disabled={blocked || (!inventory && part.kind === 'ball')}
        title={part.kind === 'ball' ? part.hint : `${part.name} · ${part.hint}${part.placed ? '. Click to pick it up again.' : ''}`}
        onClick={() => {
          const s = useMachine.getState();
          if (!inventory) return;
          if (part.placed) s.pickPlaced(part.id); else s.pick(part.index);
        }}>
        <Thumb part={part.part} />
        <span className="part-card-copy"><strong>{part.name}</strong><small>{part.placed ? 'On stage · pick up' : part.hint}</small></span>
        {part.selected && <span className="part-selected" aria-hidden="true">✓</span>}
      </button>)}
    </div>
    <div className="parts-footer" aria-live="polite">{inHand ? <><strong>{kitName(inHand)} in hand</strong><span>Click to place · R to turn{onPosts(inHand.kind) ? ' · ↑ ↓ height' : ''} · Esc to cancel</span></> : <><strong>Make it yours</strong><span>Drag a placed part to move it. Run to see what happens.</span></>}</div>
  </aside>;
}
