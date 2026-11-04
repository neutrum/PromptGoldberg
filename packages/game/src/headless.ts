/** Ports for running a game with no browser: physics in this process, and no server unless one is given. */
import { evaluateMachine, initPhysics, simulateSync, traceHash } from '@pg/core';
import type { GamePorts } from './ports';

/** Physics in this process (Node or a worker of your own), not a browser worker. */
export function inProcessPhysics(): GamePorts['physics'] {
  return {
    async simulate(spec) {
      await initPhysics();
      const run = simulateSync(spec, { record: true });
      return { run, result: evaluateMachine(spec.goal, run), hash: traceHash(run) };
    },
  };
}

/** A server that is not there: AI requests fail with a clear message, scores and logs are dropped. */
export function noServer(message = 'No server in this game: pass an api port for AI requests.'): GamePorts['api'] {
  const refuse = async (): Promise<never> => { throw new Error(message); };
  return {
    streamMachine: refuse,
    makePuzzle: async () => null,
    verifyOnServer: async () => null,
    getDailyMachine: refuse,
    publishMachine: refuse,
    playedMachine: async () => undefined,
    clearMachine: refuse,
    submitDaily: refuse,
    logPlay: () => {},
  };
}
