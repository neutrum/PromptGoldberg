import { Level } from '../game/level';
import firstLight from './01-first-light.json';
import bullseye from './02-bullseye.json';
import launchWindow from './03-launch-window.json';
import slingshot from './04-slingshot.json';
import escapeVelocity from './05-escape-velocity.json';
import moonThief from './06-moon-thief.json';
import buildASlingshot from './07-build-a-slingshot.json';
import shadowRun from './08-shadow-run.json';

/**
 * The hand-made campaign, in play order. Every level is verified by test/levels.test.ts:
 * starting values miss, the stored solution hits (and piece levels need their pieces).
 * Check or re-solve one with scripts/solve-level.ts.
 */
export const CAMPAIGN: Level[] = [
  firstLight,
  bullseye,
  launchWindow,
  slingshot,
  escapeVelocity,
  moonThief,
  buildASlingshot,
  shadowRun,
].map((raw) => Level.parse(raw));
