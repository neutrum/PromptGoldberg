/**
 * The game's side of the emotional shell (public/shell.js, shared with /docs and /rube): watching a
 * run or the AI at work keeps the colour, and Settings can turn the effect off.
 */
import { create } from 'zustand';
import { useMachine } from '../app/game';

interface Shell { wake(): void; always(): boolean; setAlways(on: boolean): void }
const shell = () => (window as unknown as { pgShell?: Shell }).pgShell;

export const useColour = create<{ always: boolean }>(() => ({ always: shell()?.always() ?? false }));
export const setAlwaysColour = (on: boolean) => { shell()?.setAlways(on); useColour.setState({ always: on }); };

/** A run playing out, or the AI working, is not idle: the colour stays. */
export function startColour() {
  setInterval(() => {
    const game = useMachine.getState();
    if (game.phase === 'playing' || game.phase === 'simulating' || game.ai.busy) shell()?.wake();
  }, 1000);
}
