/**
 * What the command line does, as plain functions: the same packages as the browser game, used
 * by a completely different program. Level from a sentence (@pg/ai, or a server via @pg/client),
 * play it with words (@pg/game, headless), solve it on request.
 */
import { createMachine, createMachineOffline, createPhysics, type Physics } from '@pg/ai';
import { createClient } from '@pg/client';
import { parseMachine, type MachineSpec, type MachineStreamEvent } from '@pg/core';
import { createGame, inProcessPhysics, noServer } from '@pg/game';

export interface Source {
  /** A running Prompt Goldberg server (its URL); otherwise the AI runs in this process. */
  server?: string;
  /** No AI at all: the level is set from the sentence's words. */
  offline?: boolean;
  physics?: Physics;
  onEvent?: (e: MachineStreamEvent) => void;
}

/** The final machine of an AI stream, or its error. */
async function fromServer(server: string, kind: 'create' | 'solve', body: { prompt: string } | { machine: MachineSpec }, onEvent?: Source['onEvent']) {
  let done: Extract<MachineStreamEvent, { type: 'machine' }> | null = null;
  let failed: string | null = null;
  await createClient({ baseUrl: server }).stream(kind, body as never, (e) => {
    onEvent?.(e);
    if (e.type === 'machine') done = e;
    if (e.type === 'error') failed = e.error;
  });
  if (failed) throw new Error(failed);
  if (!done) throw new Error('The server ended the stream without a level.');
  return done as Extract<MachineStreamEvent, { type: 'machine' }>;
}

/** A level from a sentence. */
export async function makeLevel(prompt: string, src: Source = {}): Promise<MachineSpec> {
  if (src.server) return (await fromServer(src.server, 'create', { prompt }, src.onEvent)).machine;
  const physics = src.physics ?? createPhysics('inline');
  const res = src.offline
    ? await createMachineOffline(prompt, { physics, onEvent: src.onEvent })
    : await createMachine({ prompt }, { physics, onEvent: src.onEvent });
  return res.machine;
}

/** The AI looks for a way through, only because it was asked. */
export async function solveLevel(level: MachineSpec, src: Source = {}): Promise<{ solved: boolean; added: MachineSpec['parts']; notes: string[] }> {
  const res = src.server
    ? await fromServer(src.server, 'solve', { machine: level }, src.onEvent)
    : await createMachine({ solve: level }, { physics: src.physics ?? createPhysics('inline'), onEvent: src.onEvent });
  return { solved: res.solved, added: res.machine.parts.filter((p) => !level.parts.some((q) => q.id === p.id)), notes: res.notes };
}

export interface PlayReport {
  solved: boolean;
  /** What each sentence did, in order. */
  log: string[];
  /** The player's parts on the board. */
  placed: MachineSpec['parts'];
  /** The level as it ended up (with the scenery the words added). */
  level: MachineSpec;
  /** How the run went: the goal's first unmet step, if any. */
  note?: string;
}

/**
 * Play a level headless: change the level and build with words, then run it once. Sentences
 * starting with "level:" change the level ("level: build a fence around the cave"); the rest build.
 */
export async function playLevel(level: MachineSpec, sentences: string[]): Promise<PlayReport> {
  const game = createGame({ api: noServer('Level changes beyond scenery need the AI: use the browser or a server.'), physics: inProcessPhysics() });
  if (!(await game.getState().startLevel(level))) throw new Error(game.getState().error ?? 'This level has nothing to build with.');
  const log: string[] = [];
  for (const raw of sentences) {
    const text = raw.trim();
    const levelChange = /^level:\s*/i.test(text);
    const words = text.replace(/^(level|build):\s*/i, '');
    game.setState({ notice: null });
    if (levelChange) await game.getState().changeLevel(words);
    else if (!game.getState().buildByWords(words)) game.setState({ notice: `Not a building move: "${words}".` });
    log.push(`${levelChange ? 'level' : 'build'} "${words}" -> ${game.getState().notice ?? 'done'}`);
  }
  await game.getState().runFix();
  const s = game.getState();
  const failed = s.result?.steps.find((step) => !step.satisfied);
  return { solved: !!s.fix?.solved, log, placed: s.fix?.placed ?? [], level: s.fix!.puzzle.spec, note: failed?.note };
}

/** A level file, checked. */
export function readLevel(json: string): MachineSpec {
  const parsed = parseMachine(JSON.parse(json));
  if (!parsed.ok) throw new Error(`Not a valid level: ${parsed.issues.slice(0, 3).map((i) => `${i.path}: ${i.message}`).join('; ')}`);
  return parsed.spec;
}

/** One prompt of the judge set: what a judge might type, and words the level should show if the request was honoured. */
export interface JudgePrompt { id: string; group: string; prompt: string; expect: string[]; /** A level made before (replaying a run): no AI call. */ level?: MachineSpec }

export interface JudgeResult {
  id: string; group: string; prompt: string;
  ok: boolean; ms: number; error?: string;
  title?: string; world?: string; hero?: string; parts?: number; tray?: string[]; par?: number; notes?: string[];
  /** The server proved it fair at creation: a build from the kit reaches the goal. */
  fair?: boolean;
  /** Expected words the level does not show anywhere. */
  missed?: string[];
  /** Only with solving on: was a way through found (with the player's kit, or by the AI with any parts). */
  solved?: boolean; solveMs?: number; solveError?: string; solution?: string;
  level?: MachineSpec;
}

/** Run one judge prompt through the real pipeline and check what came back. */
export async function judgeOne(p: JudgePrompt, src: Source, solve: 'kit' | 'ai' | null): Promise<JudgeResult> {
  const started = Date.now();
  const base = { id: p.id, group: p.group, prompt: p.prompt };
  let notes: string[] = [];
  let level: MachineSpec;
  try {
    level = p.level ?? await makeLevel(p.prompt, { ...src, onEvent: (e) => { if (e.type === 'machine') notes = e.notes; src.onEvent?.(e); } });
  } catch (err) {
    return { ...base, ok: false, ms: Date.now() - started, error: err instanceof Error ? err.message : String(err) };
  }
  const ms = Date.now() - started;
  const text = JSON.stringify(level).toLowerCase();
  const res: JudgeResult = {
    ...base, ok: true, ms, title: level.title, world: level.landscape?.name, hero: level.landscape?.hero ?? level.landscape?.landmark?.name,
    fair: notes.some((n) => n.startsWith('Fair:')), parts: level.parts.length, tray: (level.spares ?? []).map((s) => s.label ?? s.kind), par: level.par, notes,
    missed: p.expect.filter((e) => !new RegExp(`\\b(${e})`, 'i').test(text)),
  };
  if (solve === 'kit') {
    // The server's own search: worker threads side by side.
    const r = await (src.physics ??= createPhysics('auto')).kitSolve(level, { budgetMs: 20_000 });
    Object.assign(res, { solved: !!r?.solved, solveMs: r?.ms ?? 0, solution: r ? r.placed.map((q) => `${q.label ?? q.kind} ${q.x},${q.z}`).join('; ') : 'no puzzle' });
  } else if (solve === 'ai') {
    const t = Date.now();
    try { res.solved = (await solveLevel(level, src)).solved; } catch (err) { res.solved = false; res.solveError = err instanceof Error ? err.message : String(err); }
    res.solveMs = Date.now() - t;
  }
  return { ...res, level };
}
