import { Level } from '../game/level';
import firstLight from './01-first-light.json';
import bullseye from './02-bullseye.json';
import launchWindow from './03-launch-window.json';
import gentlePull from './04-gentle-pull.json';
import slingshot from './05-slingshot.json';
import escapeVelocity from './06-escape-velocity.json';
import bankShot from './07-bank-shot.json';
import firstBounce from './08-first-bounce.json';
import moonThief from './09-moon-thief.json';
import buildASlingshot from './10-build-a-slingshot.json';
import throughTheGate from './11-through-the-gate.json';
import portalWorkshop from './12-portal-workshop.json';
import shadowRun from './13-shadow-run.json';

/**
 * The hand-made campaign, in play order. Every level is verified by test/levels.test.ts:
 * starting values miss, the stored solution hits (and piece levels need their pieces).
 * Check or re-solve one with scripts/solve-level.ts.
 */
export const CAMPAIGN: Level[] = [
  firstLight,
  bullseye,
  launchWindow,
  gentlePull,
  slingshot,
  escapeVelocity,
  bankShot,
  firstBounce,
  moonThief,
  buildASlingshot,
  throughTheGate,
  portalWorkshop,
  shadowRun,
].map((raw) => Level.parse(raw));
