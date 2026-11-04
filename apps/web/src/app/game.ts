/**
 * The workshop's game, wired to the browser: the server through @pg/client, physics in a worker,
 * sound, the stage setting and localStorage. The rules themselves live in @pg/game.
 */
import { createGame, type MachineState } from '@pg/game';
import { useStore } from 'zustand';
import * as client from './api';
import { sfx } from '../platform/audio';
import { requestedStage } from '../ui/settings';

export * from '@pg/game';

const game = createGame({
  // Through the module, so a test that mocks machineClient reaches the game.
  api: {
    streamMachine: (...a) => client.streamMachine(...a),
    makePuzzle: (...a) => client.makePuzzle(...a),
    verifyOnServer: (...a) => client.verifyOnServer(...a),
    getDailyMachine: () => client.getDailyMachine(),
    publishMachine: (...a) => client.publishMachine(...a),
    playedMachine: (...a) => client.playedMachine(...a),
    clearMachine: (...a) => client.clearMachine(...a),
    submitDaily: (...a) => client.submitDaily(...a),
    logPlay: (...a) => client.logPlay(...a),
  },
  physics: { simulate: (spec) => client.simulateInWorker(spec) },
  sound: { place: () => sfx.place(), success: () => sfx.success(), miss: () => sfx.miss() },
  stage: requestedStage,
  storage: { get: (k) => localStorage.getItem(k), set: (k, v) => localStorage.setItem(k, v) },
  now: () => performance.now(),
});

/** The game as a React hook (with a selector), plus its getState / setState / subscribe. */
export const useMachine = Object.assign(<T,>(selector: (s: MachineState) => T): T => useStore(game, selector), game);

// Dev only: lets headless browser checks drive the screen.
if (import.meta.env.DEV) (window as unknown as { __machine: typeof useMachine }).__machine = useMachine;
