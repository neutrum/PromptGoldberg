/// <reference lib="webworker" />
import { evaluateMachine, initPhysics, parseMachine, simulateSync, traceHash, type MachineResult, type MachineRun } from '@og/machine';

export type MachineWorkerRequest = { id: number; spec: unknown };
export type MachineWorkerResponse =
  | { id: number; ok: true; run: MachineRun; result: MachineResult; hash: string }
  | { id: number; ok: false; error: string };

const ready = initPhysics();

self.onmessage = async (e: MessageEvent<MachineWorkerRequest>) => {
  const { id, spec } = e.data;
  const parsed = parseMachine(spec);
  if (!parsed.ok) {
    self.postMessage({ id, ok: false, error: parsed.issues.map((i) => `${i.path}: ${i.message}`).join('\n') } satisfies MachineWorkerResponse);
    return;
  }
  try {
    await ready;
    const run = simulateSync(parsed.spec, { record: true });
    const result = evaluateMachine(parsed.spec.goal, run);
    self.postMessage({ id, ok: true, run, result, hash: traceHash(run) } satisfies MachineWorkerResponse, [run.frames.buffer]);
  } catch (err) {
    self.postMessage({ id, ok: false, error: err instanceof Error ? err.message : String(err) } satisfies MachineWorkerResponse);
  }
};
