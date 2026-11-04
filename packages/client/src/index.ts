/**
 * @pg/client: the Prompt Goldberg API from any JavaScript runtime (browser, Node, a test).
 * Typed requests, the server-sent event stream for AI work, and one error message when the
 * server is not there. No UI, no state: a game, a CLI or another front end builds on it.
 *
 *   const api = createClient({ baseUrl: 'https://prompt-goldberg.example' });
 *   await api.stream('create', { prompt: 'a snowball into a cave' }, (e) => console.log(e.type));
 */
import type { GadgetTest, Landmark, MachineSpec, MachineStreamEvent, Puzzle, Stage } from '@pg/core';
import { readEventStream } from './sse';

export { readEventStream } from './sse';

/** A best build on a level's or the daily's board. */
export interface Score { name: string; parts: number; tries: number; at: string }
export interface MachineItem { id: string; title: string; mission: string; author: string; plays: number; clears: number; board: Score[]; createdAt: string }
export interface Placed { board: Score[]; rank: number }
export interface ServerVerdict { success: boolean; failedAt: number | null; hash: string }
export interface DailyMachine { date: string; prompt: string; machine: MachineSpec; generated: boolean }
export type PlayEvent = 'start' | 'solve' | 'giveup' | 'hint';
/** What the settings screen shows for a provider a player can bring a key for. */
export interface ProviderInfo { id: string; name: string; kind: 'text' | 'mesh'; keyUrl: string; keyHint: string; defaultModel?: string; models?: string[]; needsUrl?: boolean; note?: string }
/** A 3D model on its way: running (maybe under a new task id), failed, or done with its URL on this server. */
/** A part made on the workbench: its shapes, its id in the workbench library, and its 3D look once made. */
export type WorkbenchPart = Landmark & { library?: string; model?: string; test?: GadgetTest };

export type MeshProgress = { status: 'running'; progress?: number; task?: string } | { status: 'failed'; error: string } | { status: 'done'; model: string };

/** The AI requests, by what they do: a new level, a change to one, a solution on request. */
export type AiRequest =
  | { kind: 'create'; body: { prompt: string; stage?: Stage } }
  | { kind: 'edit'; body: { machine: MachineSpec; instruction: string } }
  | { kind: 'solve'; body: { machine: MachineSpec } };
const AI_PATH: Record<AiRequest['kind'], string> = { create: '/machine', edit: '/machine/edit', solve: '/machine/solve' };

export interface ClientOptions {
  /** Where the server is; '' (the default) is the page's own origin. */
  baseUrl?: string;
  fetch?: typeof fetch;
  /** Shown when the server cannot be reached. */
  unreachable?: string;
  /** Extra headers on every request: the player's own provider keys (x-pg-text-*, x-pg-mesh-*). */
  headers?: () => Record<string, string>;
}

export class ApiError extends Error {
  constructor(message: string, readonly status?: number) { super(message); }
}

export function createClient(opts: ClientOptions = {}) {
  const base = (opts.baseUrl ?? '').replace(/\/$/, '');
  const doFetch = opts.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const unreachable = opts.unreachable ?? 'The Prompt Goldberg server is not reachable.';

  async function json<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
    let res: Response;
    try {
      res = await doFetch(`${base}/api${path}`, {
        method: init?.method ?? 'GET',
        headers: { ...opts.headers?.(), ...(init?.body !== undefined ? { 'content-type': 'application/json' } : {}) },
        body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
      });
    } catch {
      throw new ApiError(unreachable);
    }
    if (res.status === 204) return undefined as T;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError((data as { error?: string }).error ?? (res.status >= 500 ? unreachable : `Request failed (${res.status})`), res.status);
    return data as T;
  }

  return {
    /** Run an AI request and get its events as they stream in (stages, the world, drafts, the result). */
    async stream<K extends AiRequest['kind']>(kind: K, body: Extract<AiRequest, { kind: K }>['body'], onEvent: (e: MachineStreamEvent) => void, signal?: AbortSignal): Promise<void> {
      let res: Response;
      try {
        res = await doFetch(`${base}/api${AI_PATH[kind]}`, {
          method: 'POST',
          headers: { ...opts.headers?.(), 'content-type': 'application/json', accept: 'text/event-stream' },
          body: JSON.stringify(body),
          signal,
        });
      } catch {
        if (signal?.aborted) return;
        throw new ApiError(unreachable);
      }
      const isStream = (res.headers.get('content-type') ?? '').includes('text/event-stream');
      if ((!res.ok && !isStream) || !res.body) {
        const data = await res.json().catch(() => ({}));
        throw new ApiError((data as { error?: string }).error ?? (res.status >= 500 ? unreachable : `Request failed (${res.status})`), res.status);
      }
      await readEventStream<MachineStreamEvent>(res.body, onEvent);
    },
    /** A working machine as a puzzle: its route parts go to the player's hand (pure physics on the server). */
    puzzle: (machine: MachineSpec) => json<{ puzzle: Puzzle | null }>('/machine/puzzle', { method: 'POST', body: { machine } }).then((r) => r.puzzle),
    /** The workbench: a new part for the player, built from the words (the AI's, or a known one). */
    gadget: (text: string) => json<{ gadget: WorkbenchPart & { closest?: string } }>('/workbench', { method: 'POST', body: { text } }).then((r) => r.gadget),
    /** Every part made on the workbench so far, newest first. */
    workbenchParts: () => json<{ items: (WorkbenchPart & { library: string })[] }>('/workbench/parts').then((r) => r.items),
    /** The test lab: a ball dropped on the part's high end, and what became of it (physics only, no AI). */
    labTest: (part: { name: string; shapes: Landmark['shapes'] }) => json<{ test: GadgetTest }>('/workbench/test', { method: 'POST', body: part }).then((r) => r.test),
    /** The part changed in words and tested again; a kept part's library entry takes the new shape when the ball gets through. */
    fixPart: (body: { name: string; shapes: Landmark['shapes']; change: string; library?: string }) => json<{ gadget: WorkbenchPart }>('/workbench/fix', { method: 'POST', body }).then((r) => r.gadget),
    /** The AI providers a player can bring a key for, and whether the server has its own AI. */
    providers: () => json<{ server: string | null; mesh?: { left: number } | null; providers: ProviderInfo[] }>('/providers'),
    /** A tiny call on the player's own text provider: does the key work? */
    testProvider: () => json<{ ok: boolean; ms: number }>('/providers/test', { method: 'POST', body: {} }),
    /** A 3D model of the words on the player's mesh provider: start it, then check until it is done. */
    meshStart: (prompt: string) => json<{ task: string }>('/mesh', { method: 'POST', body: { prompt } }).then((r) => r.task),
    /** With the part's library id, the finished look is kept with the part in the workbench library. */
    meshCheck: (task: string, part?: string) => json<MeshProgress>(`/mesh/${encodeURIComponent(task)}${part ? `?part=${encodeURIComponent(part)}` : ''}`),
    /** The server runs a build too; its trace hash must match the caller's. */
    verify: (machine: MachineSpec) => json<ServerVerdict>('/machine/verify', { method: 'POST', body: { machine } }),
    /** Today's level, the same for everyone. */
    daily: () => json<DailyMachine>('/machine/daily'),
    dailyScores: () => json<{ date: string; board: Score[] }>('/machine/daily/scores'),
    submitDaily: (body: { date: string; name: string; tries: number; placed: unknown[] }) => json<Placed & { date: string }>('/machine/daily/score', { method: 'POST', body }),
    /** Community levels, most played first. */
    listMachines: (sort: 'top' | 'new' = 'top') => json<{ items: MachineItem[] }>(`/machines?sort=${sort}&limit=12`).then((r) => r.items),
    getMachine: (id: string) => json<MachineItem & { machine: MachineSpec }>(`/machines/${encodeURIComponent(id)}`),
    /** Publish a level with the build that solved it; the server runs it before it is listed. */
    publishMachine: (body: { machine: MachineSpec; mission: string; author: string; tries: number; parts: number }) => json<MachineItem>('/machines', { method: 'POST', body }),
    playedMachine: (id: string) => json<unknown>(`/machines/${encodeURIComponent(id)}/play`, { method: 'POST' }),
    /** A winning build; the server re-runs it before it goes on the board. */
    clearMachine: (id: string, body: { placed: unknown[]; tries: number; name: string }) => json<Placed>(`/machines/${encodeURIComponent(id)}/clear`, { method: 'POST', body }),
    /** How a play went, for finding the levels people give up on. */
    logPlay: (level: string, event: PlayEvent, tries: number, placed: number) => json<void>('/machine/event', { method: 'POST', body: { level, event, tries, placed } }),
    health: () => json<{ ok: boolean; llm: string | null; solver: string; llmCallsToday: number; dailyLlmCallCap: number }>('/health'),
  };
}

export type Client = ReturnType<typeof createClient>;
