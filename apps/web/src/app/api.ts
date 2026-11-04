/** The workshop's connection to the server (through @pg/client) and to the browser physics worker. */
import { ApiError, createClient, type PlayEvent } from '@pg/client';
import type { MachineSpec, MachineStreamEvent, Puzzle } from '@pg/core';
import { makePuzzleInWorker } from '../platform/physicsWorker';
import { providerHeaders } from '../ui/providers';

export { simulateInWorker, type MachinePlayback } from '../platform/physicsWorker';
export type { MachineItem, Placed, Score, ServerVerdict } from '@pg/client';

export const api = createClient({ unreachable: 'The AI server is not reachable. Start it with "npm run dev:server".', headers: providerHeaders });

/** A working machine as a puzzle: the server does it in a fraction of a second; the worker is the fallback. */
export async function makePuzzle(solution: MachineSpec): Promise<Puzzle | null> {
  try {
    return await api.puzzle(solution);
  } catch (err) {
    // A refused request is the answer; a missing server falls back to the browser.
    if (err instanceof ApiError && err.status !== undefined && err.status < 500) throw err;
  }
  return makePuzzleInWorker(solution);
}

/** The server runs the same build; null when the server is not there. */
export const verifyOnServer = (machine: MachineSpec) => api.verify(machine).catch(() => null);
/** Today's shared machine (the same for everyone until midnight UTC). */
export const getDailyMachine = () => api.daily();

const KIND = { '/machine': 'create', '/machine/edit': 'edit', '/machine/solve': 'solve' } as const;
/** POST an AI request and read the event stream it returns. */
export function streamMachine(path: keyof typeof KIND, body: unknown, onEvent: (e: MachineStreamEvent) => void, signal?: AbortSignal): Promise<void> {
  return api.stream(KIND[path], body as never, onEvent, signal);
}

/** The workbench: a new part for the player from a few words. */
export const makeGadget = (text: string) => api.gadget(text);
export const listMachines = (sort: 'top' | 'new' = 'top') => api.listMachines(sort);
export const getMachine = (id: string) => api.getMachine(id);
export const publishMachine = (body: Parameters<typeof api.publishMachine>[0]) => api.publishMachine(body);
export const playedMachine = (id: string) => api.playedMachine(id).catch(() => undefined);
export const clearMachine = (id: string, body: Parameters<typeof api.clearMachine>[1]) => api.clearMachine(id, body);
export const dailyScores = () => api.dailyScores();
export const submitDaily = (body: Parameters<typeof api.submitDaily>[0]) => api.submitDaily(body);
/** How a play went. Fire and forget. */
export function logPlay(level: string, event: PlayEvent, tries: number, placed: number): void {
  void api.logPlay(level, event, tries, placed).catch(() => undefined);
}
