import type { MachineResult, MachineRun, MachineSpec, MachineStreamEvent, Puzzle, PuzzleKind } from '@og/machine';
import type { MachineWorkerRequest, MachineWorkerResponse } from './machine.worker';

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
  const w = new Worker(new URL('./machine.worker.ts', import.meta.url), { type: 'module' });
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

/** Break a working machine for the player to repair: a part missing, two missing, or one moved. */
export function makePuzzleInWorker(solution: MachineSpec, kind: PuzzleKind, seed?: number): Promise<Puzzle | null> {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve: resolve as (r: unknown) => void, reject });
    get().postMessage({ id, spec: solution, puzzle: { kind, seed } } satisfies MachineWorkerRequest);
  });
}

const unreachable = 'The AI server is not reachable. Start it with "npm run dev:server".';

export interface DailyMachine {
  date: string;
  prompt: string;
  machine: MachineSpec;
  generated: boolean;
}

/** Today's shared machine (the same for everyone until midnight UTC). */
export async function getDailyMachine(): Promise<DailyMachine> {
  let res: Response;
  try {
    res = await fetch('/api/machine/daily');
  } catch {
    throw new Error(unreachable);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? (res.status >= 500 ? unreachable : `Request failed (${res.status})`));
  return data as DailyMachine;
}

/** POST a machine request and read the server-sent event stream it returns. */
export async function streamMachine(
  path: '/machine' | '/machine/edit',
  body: unknown,
  onEvent: (e: MachineStreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
      body: JSON.stringify(body),
      signal,
    });
  } catch {
    if (signal?.aborted) return;
    throw new Error(unreachable);
  }
  const isStream = (res.headers.get('content-type') ?? '').includes('text/event-stream');
  if ((!res.ok && !isStream) || !res.body) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? (res.status >= 500 ? unreachable : `Request failed (${res.status})`));
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  const flush = (chunk: string) => {
    const data = chunk.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trimStart()).join('\n');
    if (!data) return;
    try {
      onEvent(JSON.parse(data) as MachineStreamEvent);
    } catch {
      // Ignore malformed chunks.
    }
  };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    let m: RegExpMatchArray | null;
    while ((m = buffer.match(/\r?\n\r?\n/)) && m.index !== undefined) {
      flush(buffer.slice(0, m.index));
      buffer = buffer.slice(m.index + m[0].length);
    }
  }
  if (buffer.trim()) flush(buffer);
}
