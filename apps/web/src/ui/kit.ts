import { isGadget, onPosts, type Part, type PartKind } from '@pg/core';

/** One kit part as the player meets it: tray card, hand tip and the catalog all read from here. */
export interface KitEntry {
  kind: PartKind;
  name: string;
  /** A few words for the tray card. */
  hint: string;
  /** How to use it, shown while it is in hand. */
  tip: string;
  /** A sentence the Build box understands. */
  say?: string;
  /** Only the level has it: the player does not get one. */
  level?: true;
}

export const KIT: KitEntry[] = [
  { kind: 'ramp', name: 'Ramp', hint: 'Roll downhill', tip: 'Put the high end under the marble. It rolls down toward the low end.', say: 'put a ramp under the marble facing the goal' },
  { kind: 'platform', name: 'Shelf', hint: 'Support the route', tip: 'A shelf supports other parts. Use ↑ and ↓ to choose its height.', say: 'add a shelf 3 cells east of the marble' },
  { kind: 'fan', name: 'Fan', hint: 'Blow the marble forward', tip: 'Blows a nearby marble forward. Point it in the direction you want to go.', say: 'put a fan next to the marble facing the goal' },
  { kind: 'cannon', name: 'Cannon', hint: 'Launch across a gap', tip: 'Catches a marble at its base and fires it along the barrel. It fires automatically.', say: 'add a cannon next to the marble facing the goal' },
  { kind: 'trampoline', name: 'Trampoline', hint: 'Bounce upward', tip: 'Catches a falling marble and bounces it upward.', say: 'put a trampoline 2 cells east of the marble' },
  { kind: 'seesaw', name: 'Seesaw', hint: 'Tip and roll', tip: 'A falling marble tips the plank and rolls off the other end.', say: 'add a seesaw next to the marble' },
  { kind: 'dominoes', name: 'Dominoes', hint: 'Start a falling chain', tip: 'Hit the first domino from behind to start the row falling.', say: 'put dominoes next to the marble facing the goal' },
  { kind: 'wall', name: 'Wall', hint: 'Block or redirect', tip: 'A wall blocks the marble or redirects it.', say: 'add a wall 2 cells north of the marble' },
  { kind: 'track', name: 'Track', hint: 'Coaster track, one cell', tip: 'One cell of coaster track. Line pieces up end to end; use ↑ and ↓ for its height.', say: 'add a coaster track 3 cells east of the marble' },
  { kind: 'curve', name: 'Curve', hint: 'A quarter turn', tip: 'A quarter turn. Press R until it turns the way you want.', say: 'add a curved track next to the marble' },
  { kind: 'descent', name: 'Descent', hint: 'Track down one level', tip: 'Two cells of track down one level: put its high end where the track comes in.', say: 'add a descent next to the marble' },
  { kind: 'ascent', name: 'Ascent', hint: 'Chain lift up one level', tip: 'A chain lift: it pulls the marble up one level over two cells.', say: 'put a chain lift next to the marble' },
  { kind: 'ball', name: 'Marble', hint: 'One start marble per machine', tip: 'Gravity starts the marble moving.', level: true },
  { kind: 'bucket', name: 'Bucket', hint: 'Catch the marble', tip: 'Catch the marble inside the open top.', level: true },
  { kind: 'bell', name: 'Bell', hint: 'Ring on contact', tip: 'Touch the bell with the marble or a falling domino.', level: true },
];

export const kitEntry = (kind: PartKind) => KIT.find((k) => k.kind === kind)!;

/** The keys that work on this part in hand, besides click to put it down and Esc to put it back. */
export const kitKeys = (kind: PartKind) => ['R turns it', ...(onPosts(kind) ? ['↑ ↓ raise or lower it'] : [])];

/** What a hand part is called: its kit name, or the name it got on the workbench. */
export const kitName = (p: Part) => (isGadget(p) ? p.label ?? 'Workbench part' : kitEntry(p.kind).name);
/** How to use a hand part. */
export const kitTip = (p: Part) => (isGadget(p) ? 'Made on the workbench. Its slopes run down toward the arrow: R turns it.' : kitEntry(p.kind).tip);
