import type { PartKind } from '@og/machine';
import { useMachine } from './machineStore';

const CATALOG: { kind: PartKind; name: string; hint: string }[] = [
  { kind: 'ramp', name: 'Ramp', hint: 'Roll downhill' },
  { kind: 'platform', name: 'Shelf', hint: 'Support the route' },
  { kind: 'fan', name: 'Fan', hint: 'Blow the marble forward' },
  { kind: 'cannon', name: 'Cannon', hint: 'Launch across a gap' },
  { kind: 'trampoline', name: 'Trampoline', hint: 'Bounce upward' },
  { kind: 'seesaw', name: 'Seesaw', hint: 'Tip and roll' },
  { kind: 'dominoes', name: 'Dominoes', hint: 'Start a falling chain' },
  { kind: 'wall', name: 'Wall', hint: 'Block or redirect' },
  { kind: 'bucket', name: 'Bucket', hint: 'Catch the marble' },
  { kind: 'bell', name: 'Bell', hint: 'Ring on contact' },
  { kind: 'ball', name: 'Marble', hint: 'One start marble per machine' },
];

/** Still renders of the shipped models: the tray adds no WebGL contexts or animation. */
export function PartsTray() {
  const machine = useMachine(s => s.machine);
  const fix = useMachine(s => s.fix);
  const pending = useMachine(s => s.pendingPart);
  const busy = useMachine(s => s.ai.busy || s.working);
  const phase = useMachine(s => s.phase);
  const inventory = fix && !fix.solved ? fix : null;
  const blocked = !machine || busy || phase === 'simulating' || (phase === 'playing' && (!inventory || inventory.tries > 0));
  const entries = inventory
    ? inventory.hand.map((part, index) => ({ ...CATALOG.find(p => p.kind === part.kind)!, id: part.id, index,
      placed: inventory.placed.some(p => p.id === part.id), selected: inventory.picking === index }))
    : CATALOG.map(part => ({ ...part, id: part.kind, index: -1, placed: false, selected: pending?.kind === part.kind }));
  const selected = pending?.kind ?? (inventory?.picking != null ? inventory.hand[inventory.picking]?.kind : null);
  return <aside className="parts-tray" aria-labelledby="parts-title">
    <div className="parts-heading"><h2 id="parts-title">Parts</h2><span>{inventory ? `${inventory.hand.length - inventory.placed.length} in hand` : 'Ready to use'}</span></div>
    <p className="parts-intro">{inventory ? 'Your pieces for this puzzle.' : 'Pick a part. Click the stage.'}</p>
    <div className="parts-catalog">
      {entries.map(part => <button key={part.id} type="button" className={`part-card${part.selected ? ' selected' : ''}${part.placed ? ' placed' : ''}`}
        aria-label={`${part.kind === 'ball' ? 'Starting marble' : inventory ? part.placed ? 'Move' : 'Place' : 'Add'} ${part.kind === 'ball' ? 'already in the scene' : part.name.toLowerCase()}`}
        aria-pressed={!!part.selected} disabled={blocked || (!inventory && part.kind === 'ball')}
        title={part.kind === 'ball' ? part.hint : `${part.name} · ${part.hint}${part.placed ? '. Click to pick it up again.' : ''}`}
        onClick={() => {
          const s = useMachine.getState();
          if (inventory) { if (part.placed) s.pickPlaced(part.id); else s.pick(part.index); }
          else if (part.kind !== 'ball') s.addPart(part.kind);
        }}>
        <span className="part-thumbnail"><img src={`/models/kit-v1/thumbs/${part.kind}.webp`} alt="" width="128" height="96" draggable={false} /></span>
        <span className="part-card-copy"><strong>{part.name}</strong><small>{part.placed ? 'On stage · pick up' : part.hint}</small></span>
        {part.selected && <span className="part-selected" aria-hidden="true">✓</span>}
      </button>)}
    </div>
    <div className="parts-footer" aria-live="polite">{selected ? <><strong>{CATALOG.find(p => p.kind === selected)?.name} in hand</strong><span>Click to place · R to turn · Esc to cancel</span></> : <><strong>Make it yours</strong><span>Drag a placed part to move it. Run to see what happens.</span></>}</div>
  </aside>;
}
