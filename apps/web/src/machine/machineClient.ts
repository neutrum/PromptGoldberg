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

/** Break a working machine in the browser worker (slow on weak machines: dozens of runs). */
export function makePuzzleInWorker(solution: MachineSpec, kind: PuzzleKind, seed?: number): Promise<Puzzle | null> {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve: resolve as (r: unknown) => void, reject });
    get().postMessage({ id, spec: solution, puzzle: { kind, seed } } satisfies MachineWorkerRequest);
  });
}

/** Break a working machine: the server does it in a fraction of a second; the worker is the fallback. */
export async function makePuzzle(solution: MachineSpec, kind: PuzzleKind, seed: number): Promise<Puzzle | null> {
  try {
    const res = await fetch('/api/machine/puzzle', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ machine: solution, kind, seed }),
    });
    if (res.ok) return ((await res.json()) as { puzzle: Puzzle | null }).puzzle;
    if (res.status < 500) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? `Request failed (${res.status})`);
  } catch (err) {
    if (err instanceof Error && !/fetch|network|failed \(5/i.test(err.message) && !(err instanceof TypeError)) throw err;
  }
  return makePuzzleInWorker(solution, kind, seed);
}

const unreachable = 'The AI server is not reachable. Start it with "npm run dev:server".';

export interface ServerVerdict { success: boolean; failedAt: number | null; hash: string }

/** The server runs the same build; its trace hash must match the browser's. Null when the server is not there. */
export async function verifyOnServer(machine: MachineSpec): Promise<ServerVerdict | null> {
  try {
    const res = await fetch('/api/machine/verify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ machine }) });
    return res.ok ? ((await res.json()) as ServerVerdict) : null;
  } catch {
    return null;
  }
}

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
  path: '/machine' | '/machine/edit' | '/machine/solve',
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
    let event: MachineStreamEvent;
    try { event = JSON.parse(data) as MachineStreamEvent; }
    catch { return; }
    onEvent(event);
  };
  try {
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
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

/** A best build on a level's or the daily's board. */
export interface Score { name: string; parts: number; tries: number; at: string }
export interface MachineItem { id: string; title: string; mission: string; author: string; plays: number; clears: number; board: Score[]; createdAt: string }
export interface Placed { board: Score[]; rank: number }

async function api<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method: init?.method ?? 'GET',
      headers: init?.body !== undefined ? { 'content-type': 'application/json' } : undefined,
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
  } catch {
    throw new Error(unreachable);
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `Request failed (${res.status})`);
  return data as T;
}

/** Community levels, most played first. */
export const listMachines = (sort: 'top' | 'new' = 'top') => api<{ items: MachineItem[] }>(`/machines?sort=${sort}&limit=12`).then((r) => r.items);
export const getMachine = (id: string) => api<MachineItem & { machine: MachineSpec }>(`/machines/${encodeURIComponent(id)}`);
/** Publish a level with the build that solved it; the server runs it before it is listed. */
export const publishMachine = (body: { machine: MachineSpec; mission: string; author: string; tries: number; parts: number }) => api<MachineItem>('/machines', { method: 'POST', body });
export const playedMachine = (id: string) => api<unknown>(`/machines/${encodeURIComponent(id)}/play`, { method: 'POST' }).catch(() => undefined);
/** Send a winning build; the server re-runs it before it goes on the board. */
export const clearMachine = (id: string, body: { placed: unknown[]; tries: number; name: string }) => api<Placed>(`/machines/${encodeURIComponent(id)}/clear`, { method: 'POST', body });
export const dailyScores = () => api<{ date: string; board: Score[] }>('/machine/daily/scores');
export const submitDaily = (body: { date: string; name: string; tries: number; builds: unknown[][] }) => api<Placed & { date: string }>('/machine/daily/score', { method: 'POST', body });

/** How a play went, for finding the levels people give up on. Fire and forget. */
export function logPlay(level: string, event: 'start' | 'solve' | 'giveup' | 'hint', tries: number, placed: number): void {
  void api('/machine/event', { method: 'POST', body: { level, event, tries, placed } }).catch(() => undefined);
}
