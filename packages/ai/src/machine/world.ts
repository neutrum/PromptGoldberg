/** How every prompt describes the world around the board, so the designer, the route writer and the editor agree. */
import { HEROES, LANDSCAPE_FEATURES, OBSTACLE_PROPS, PROP_LENGTH } from '@og/machine';

const lying = Object.entries(PROP_LENGTH).map(([k, n]) => `${k} (${n} cells)`).join(', ');

export const WORLD_BRIEF = `the world around the board, whenever the request names a place, a mood or a look. Be imaginative and true to the request: pick the closest shapes and colours even for unusual places (a dragon's lair: crystals, boulders, craters, red "water" for lava, lanterns).
  - name: a few words. setting: "outdoor" (land all round), or "tabletop" when the machine stands on a table, desk, workbench or counter in a real-size room, so it reads as a miniature (giant tools, pencils and mugs around it).
  - palette, six-digit hex: sky (indoors: the room), ground (the floor under the machine), land (around the board; tabletop: the table top), rock (tabletop: the room's floor), water (red or orange for lava), foliage, accent (the world's bright colour).
  - features, 3 to 6, each with amount few, some or many: ${LANDSCAPE_FEATURES.join(', ')}. "pegboard" and "lamp" are one big backdrop each, for workshops and desks.
  - hero: the one big landmark lying on the board itself, so the board is never empty: ${HEROES.join(', ')}. Pick the one the request names or suits it best (a dragon's lair gets the dragon, a pirate cove the ship, a desk the teapot); leave it out only when none fits.
  - obstacles, 1 to 4 kinds that stand in the ball's way on the board in the world's style: ${OBSTACLE_PROPS.join(', ')}. Tools lie along their facing: ${lying}. A workbench gets tools, a cave crystals, ruins columns.
  The surroundings are looks only. The hero and the obstacles stand on the board with real collisions; the game places them off the ball's way and keeps only what still works. Ground the ball has to deal with belongs in "terrain".`;
