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
  { emoji: '🐱', title: 'Wake the cat', prompt: 'Wake the cat asleep on the top shelf by ringing the bell next to it' },
  { emoji: '🍕', title: 'Pizza delivery', prompt: 'Get the pizza into the oven, but there is a guard wall in the way' },
  { emoji: '⛪', title: 'Church bell', prompt: 'Ring the church bell from across the river' },
  { emoji: '🏰', title: 'Castle siege', prompt: 'Knock over the dominoes hiding behind the castle wall' },
  { emoji: '🌬️', title: 'Windy alley', prompt: 'A windy alley: the ball has to be blown sideways into a bucket' },
  { emoji: '🏀', title: 'Rooftop', prompt: 'Bounce the ball up onto a rooftop ledge behind a wall and ring the bell there' },
  { emoji: '⚖️', title: 'The drawbridge', prompt: 'A seesaw drawbridge drops the ball down past a wall into the moat bucket round the corner' },
  { emoji: '🚀', title: 'Launch day', prompt: 'A rocket launch: fire the ball over the hangar wall into the landing bucket far away' },
  { emoji: '🔔', title: 'Double ring', prompt: 'Ring the bell twice in a temple with a wall around it' },
  { emoji: '🎳', title: 'Strike!', prompt: 'Knock over two rows of dominoes in a bowling alley with a divider wall' },
  { emoji: '🧀', title: 'Mouse trap', prompt: 'Get the cheese ball to the mouse in the far corner of the kitchen, past the counter wall' },
  { emoji: '🛗', title: 'Going down', prompt: 'A parking garage: the ball goes down ramp by ramp, round the corners, into a bucket at the bottom' },
  { emoji: '🏔️', title: 'Mountain pass', prompt: 'Carry the ball over the mountain wall and down into the village bell' },
  { emoji: '🧪', title: 'The lab', prompt: 'A mad lab: the ball must cross the room, dodge the bench wall, and ring the alarm bell' },
  { emoji: '🎪', title: 'Circus act', prompt: 'A circus act: the ball flies over the lion wall into the clown bucket on the other side of the ring' },
  { emoji: '🧩', title: 'Tiny level', prompt: 'The fewest parts you can to ring a bell round a corner, behind a wall' },
];

/** `n` cards starting at `offset`, wrapping around the deck. */
export function dealCards(offset: number, n = 3): PromptCard[] {
  return Array.from({ length: n }, (_, k) => CARDS[(offset + k) % CARDS.length]);
}

/** Changes to the mechanism; the ball and the goal parts are fixed, so none of these touch them. */
export const EDIT_IDEAS = ['make it longer', 'swap the fan for a cannon', 'add a trampoline', 'make it ring the bell twice', 'add a seesaw before the dominoes'];
