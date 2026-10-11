/**
 * Prompt cards: a sentence the AI reliably turns into a fun machine, with a face for the deck.
 * They skip the blank-page moment; the player edits by talking afterwards.
 */
export interface PromptCard {
  emoji: string;
  title: string;
  prompt: string;
}

export const CARDS: PromptCard[] = [
  { emoji: '🐱', title: 'Cat on a shelf', prompt: 'My cat knocks the ball off a high shelf and it lands in a bucket' },
  { emoji: '🍕', title: 'Pizza delivery', prompt: 'A pizza delivery: the ball rolls down a ramp, a cannon fires it over a wall, and it lands in the bucket' },
  { emoji: '⏰', title: 'Wake-up call', prompt: 'An alarm clock machine: dominoes fall one by one and the last one rings the bell' },
  { emoji: '🐢', title: 'The lazy one', prompt: 'The slowest machine you can build that still rings the bell' },
  { emoji: '🎪', title: 'Circus act', prompt: 'A trampoline act: the ball bounces twice, then lands in a bucket' },
  { emoji: '🚀', title: 'Rocket launch', prompt: 'Launch the ball with a cannon over a wall into a bucket' },
  { emoji: '🌬️', title: 'Windy day', prompt: 'A fan blows the ball off a shelf into a bucket far below' },
  { emoji: '⚖️', title: 'Seesaw drama', prompt: 'A seesaw tips the ball onto dominoes that ring a bell' },
  { emoji: '🔔', title: 'Double ring', prompt: 'Ring the bell twice' },
  { emoji: '🧩', title: 'Tiny machine', prompt: 'A machine with only three parts that rings the bell' },
  { emoji: '🏗️', title: 'The big one', prompt: 'The longest chain you can: ramp, seesaw, fan, trampoline, cannon, dominoes, bell' },
  { emoji: '🌧️', title: 'Rainy day', prompt: 'Everything happens under a shelf: ramp, dominoes, and a bell' },
  { emoji: '🏀', title: 'Slam dunk', prompt: 'A trampoline bounces the ball into a bucket on a high shelf' },
  { emoji: '🎳', title: 'Strike!', prompt: 'Knock over two rows of dominoes, then ring the bell' },
  { emoji: '🏰', title: 'Castle siege', prompt: 'A cannon shoots the ball over a tall wall; behind it dominoes topple and a bell rings' },
  { emoji: '🛗', title: 'Going down', prompt: 'The ball drops from shelf to shelf, four shelves, and lands in a bucket at the bottom' },
];

/** `n` cards starting at `offset`, wrapping around the deck. */
export function dealCards(offset: number, n = 3): PromptCard[] {
  return Array.from({ length: n }, (_, k) => CARDS[(offset + k) % CARDS.length]);
}

export const EDIT_IDEAS = ['make it longer', 'swap the fan for a cannon', 'add a trampoline', 'make it ring the bell twice', 'end in a bucket instead'];
