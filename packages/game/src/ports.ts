/** What a game needs from the world it runs in. Only the server and the physics are required. */
import type { MachineResult, MachineRun, MachineSpec, MachineStreamEvent, Puzzle, Stage } from '@pg/core';
import type { DailyMachine, MachineItem, Placed, PlayEvent, ServerVerdict } from '@pg/client';

export interface MachinePlayback {
  run: MachineRun;
  result: MachineResult;
  /** Trace fingerprint, to compare with the server's run. */
  hash: string;
}

export interface GamePorts {
  /** The Prompt Goldberg server (usually through @pg/client). */
  api: {
    streamMachine(path: '/machine' | '/machine/edit' | '/machine/solve', body: unknown, onEvent: (e: MachineStreamEvent) => void, signal?: AbortSignal): Promise<void>;
    makePuzzle(solution: MachineSpec): Promise<Puzzle | null>;
    verifyOnServer(machine: MachineSpec): Promise<ServerVerdict | null>;
    getDailyMachine(): Promise<DailyMachine>;
    publishMachine(body: { machine: MachineSpec; mission: string; author: string; tries: number; parts: number }): Promise<MachineItem>;
    playedMachine(id: string): Promise<unknown>;
    clearMachine(id: string, body: { placed: unknown[]; tries: number; name: string }): Promise<Placed>;
    submitDaily(body: { date: string; name: string; tries: number; placed: unknown[] }): Promise<Placed & { date: string }>;
    logPlay(level: string, event: PlayEvent, tries: number, placed: number): void;
  };
  /** Runs a machine and returns its playback (a browser worker, or the physics in-process). */
  physics: { simulate(spec: MachineSpec): Promise<MachinePlayback> };
  sound?: { place(): void; success(): void; miss(): void };
  /** The stage size new levels are made on; undefined for the default. */
  stage?: () => Stage | undefined;
  /** Saved progress (stars, best daily, player name). */
  storage?: { get(key: string): string | null; set(key: string, value: string): void };
  /** Milliseconds, for pop-in timing. Defaults to Date.now. */
  now?: () => number;
}
