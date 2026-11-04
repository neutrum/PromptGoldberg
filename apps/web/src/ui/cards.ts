/**
 * Mission cards: a goal and a place, the way a player should write one. The AI makes the level
 * from it (targets, scenery, a hidden route) and the player builds the route. They skip the
 * blank-page moment and show what to type.
 */
export interface PromptCard {
  emoji: string;
  title: string;
  prompt: string;
}

export const CARDS: PromptCard[] = [
  { emoji: '🍕', title: 'Pizza express', prompt: 'Fire a pizza marble from a cannon over a river into an oven bucket' },
  { emoji: '🌬️', title: 'A little wind', prompt: 'A fan blows the marble round a corner to ring a bell' },
  { emoji: '🏰', title: 'Domino castle', prompt: 'A cannon launches the marble past a castle wall to topple dominoes and ring a bell' },
  { emoji: '🐱', title: 'Wake the cat', prompt: 'Ring the bell beside a sleeping cat, using a ramp to turn the marble round a corner' },
  { emoji: '🏀', title: 'Big bounce', prompt: 'A trampoline bounces a falling marble onward to a bell' },
  { emoji: '🔔', title: 'Double chime', prompt: 'Use a fan to send the marble round a corner and ring the bell twice' },
  { emoji: '⚖️', title: 'Tipping point', prompt: 'A seesaw tips a falling marble onward to a bell' },
  { emoji: '🧩', title: 'Travel light', prompt: 'Use only three parts to ring the bell round a corner' },
  { emoji: '🚂', title: 'Domino train', prompt: 'A cannon launches a marble into a long domino chain that rings the departure bell' },
];

/** `n` cards starting at `offset`, wrapping around the deck. */
export function dealCards(offset: number, n = 3): PromptCard[] {
  return Array.from({ length: n }, (_, k) => CARDS[(offset + k) % CARDS.length]);
}
