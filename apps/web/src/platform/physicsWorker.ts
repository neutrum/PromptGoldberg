/** Physics in a browser worker: playback traces and puzzles without blocking the page. */
import type { MachineResult, MachineRun, MachineSpec, Puzzle } from '@pg/core';
import type { MachineWorkerRequest, MachineWorkerResponse } from './physics.worker';

export interface MachinePlayback {
  run: MachineRun;
  result: MachineResult;
  /** Trace fingerprint, to compare with the server's run. */
  hash: string;
}

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, { resolve: (r: MachinePlayback | Puzzle | null) => void; reject: (e: Error) => void }>();

function get(): Worker {
  if (worker) return worker;
  const w = new Worker(new URL('./physics.worker.ts', import.meta.url), { type: 'module' });
  w.onmessage = (e: MessageEvent<MachineWorkerResponse>) => {
    const msg = e.data;
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    if (!msg.ok) p.reject(new Error(msg.error));
    else if ('puzzle' in msg) p.resolve(msg.puzzle);
    else p.resolve({ run: msg.run, result: msg.result, hash: msg.hash });
  };
  w.onerror = (e) => {
    for (const p of pending.values()) p.reject(new Error(e.message || 'physics worker failed'));
    pending.clear();
    worker = null;
  };
  return (worker = w);
}

/** Simulate a machine off the main thread and get the playback trace. */
export function simulateInWorker(spec: MachineSpec): Promise<MachinePlayback> {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve: resolve as (r: unknown) => void, reject });
    get().postMessage({ id, spec } satisfies MachineWorkerRequest);
  });
}

/** A working machine as a puzzle, in the browser worker (one run). */
export function makePuzzleInWorker(solution: MachineSpec): Promise<Puzzle | null> {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve: resolve as (r: unknown) => void, reject });
    get().postMessage({ id, spec: solution, puzzle: true } satisfies MachineWorkerRequest);
  });
}
