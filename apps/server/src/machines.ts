/**
 * The game around Prompt Goldberg levels: a community gallery of solved levels with a best-build
 * board per level, a daily leaderboard, and a log of how plays end (where players give up).
 * Every score comes with the build that earned it, and the server runs that build itself.
 */
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { handOf, isSupported, Part, ruleProblems, withPlacements, type MachineResult, type MachineSpec, type Puzzle } from '@og/machine';
import type { Physics } from '@og/ai';
import { cleanText } from './gallery';
import { readJson, writeFileAtomic } from './files';

export const MACHINE_LIMITS = { title: 60, mission: 300, name: 24, entries: 1000, board: 10, daily: 50 };

/** One build that solved a level: who, how many parts, how many tries. */
export interface Score { name: string; parts: number; tries: number; at: string }

export interface MachineItem {
  id: string;
  title: string;
  mission: string;
  author: string;
  plays: number;
  clears: number;
  /** Best builds, fewest parts then fewest tries. */
  board: Score[];
  createdAt: string;
}
interface StoredMachine extends MachineItem { machine: MachineSpec }

const fewestParts = (a: Score, b: Score) => a.parts - b.parts || a.tries - b.tries || a.at.localeCompare(b.at);
const fewestTries = (a: Score, b: Score) => a.tries - b.tries || a.parts - b.parts || a.at.localeCompare(b.at);
export const playerName = (v: unknown) => (typeof v === 'string' && cleanText(v, MACHINE_LIMITS.name)) || 'Anonymous';

/** A board keeps one row per name, that name's best. */
function onBoard(board: Score[], s: Score, size: number, order: (a: Score, b: Score) => number): Score[] {
  const mine = board.find((b) => b.name === s.name);
  if (mine && order(mine, s) <= 0) return board;
  return [...board.filter((b) => b.name !== s.name), s].sort(order).slice(0, size);
}

export type Checked = { ok: true; result: MachineResult; build: MachineSpec; parts: number } | { ok: false; error: string };

/**
 * Run a player's build of a puzzle on the server. The placed parts must come from the hand (same
 * kind and length, each once) and stand on something; the run must meet the goal and the rules.
 */
export async function checkBuild(physics: Physics, puzzle: Puzzle, placedIn: unknown): Promise<Checked> {
  if (!Array.isArray(placedIn) || placedIn.length > 12) return { ok: false, error: 'placed must be a list of parts' };
  const placed: Part[] = [];
  for (const raw of placedIn) {
    const p = Part.safeParse(raw);
    if (!p.success) return { ok: false, error: 'a placed part is invalid' };
    placed.push(p.data);
  }
  const hand = handOf(puzzle);
  const ids = new Set<string>();
  for (const p of placed) {
    const h = hand.find((m) => m.id === p.id);
    if (!h || h.kind !== p.kind || (h.length ?? null) !== (p.length ?? null) || ids.has(p.id)) return { ok: false, error: `${p.id} is not a part from the bin` };
    ids.add(p.id);
  }
  const build = withPlacements(puzzle, placed);
  if (!placed.every((p) => isSupported(build.parts, p, build.terrain))) return { ok: false, error: 'a placed part is floating' };
  const { result } = await physics.check(build);
  if (!result.success) return { ok: false, error: 'the build does not work' };
  const broke = ruleProblems(puzzle.solution.rules, result, placed.length);
  if (broke.length) return { ok: false, error: broke[0] };
  return { ok: true, result, build, parts: placed.length };
}

interface MachinesFile { version: 1; entries: StoredMachine[] }

/** Community levels in one JSON file, each proven solvable when it was published. */
export class MachineGallery {
  private entries: StoredMachine[] = [];
  private chain: Promise<void> = Promise.resolve();
  private constructor(private file: string) {}

  static async open(dir: string): Promise<MachineGallery> {
    const g = new MachineGallery(join(dir, 'machines.json'));
    const data = await readJson<MachinesFile>(g.file);
    g.entries = Array.isArray(data?.entries) ? data.entries : [];
    return g;
  }

  list(sort: 'new' | 'top' = 'top', limit = 24): MachineItem[] {
    const rank = (e: MachineItem) => e.plays + 3 * e.clears;
    return [...this.entries]
      .sort((a, b) => (sort === 'top' ? rank(b) - rank(a) : 0) || b.createdAt.localeCompare(a.createdAt))
      .slice(0, Math.max(1, Math.min(100, limit)))
      .map(({ machine: _m, ...item }) => item);
  }

  get(id: string): StoredMachine | undefined {
    return this.entries.find((e) => e.id === id);
  }

  /** Store a level; `first` is the publisher's own winning build, the first row of its board. */
  async publish(machine: MachineSpec, mission: unknown, author: unknown, first?: Omit<Score, 'at' | 'name'>, now = new Date()): Promise<MachineItem> {
    const at = now.toISOString();
    const entry: StoredMachine = {
      id: `m-${randomBytes(5).toString('hex')}`,
      title: cleanText(machine.title, MACHINE_LIMITS.title) || 'Untitled level',
      mission: typeof mission === 'string' ? cleanText(mission, MACHINE_LIMITS.mission) : '',
      author: playerName(author),
      plays: 0,
      clears: 0,
      board: first ? [{ ...first, name: playerName(author), at }] : [],
      createdAt: at,
      machine,
    };
    this.entries.push(entry);
    if (this.entries.length > MACHINE_LIMITS.entries) {
      const victim = [...this.entries].sort((a, b) => a.plays - b.plays || a.createdAt.localeCompare(b.createdAt))[0];
      this.entries = this.entries.filter((e) => e !== victim);
    }
    await this.save();
    const { machine: _m, ...item } = entry;
    return item;
  }

  async played(id: string): Promise<boolean> {
    const e = this.get(id);
    if (!e) return false;
    e.plays++;
    await this.save();
    return true;
  }

  async cleared(id: string, score: Omit<Score, 'at'>, now = new Date()): Promise<{ board: Score[]; rank: number } | undefined> {
    const e = this.get(id);
    if (!e) return undefined;
    e.clears++;
    const s: Score = { ...score, name: playerName(score.name), at: now.toISOString() };
    e.board = onBoard(e.board, s, MACHINE_LIMITS.board, fewestParts);
    await this.save();
    return { board: e.board, rank: e.board.findIndex((b) => b.name === s.name) + 1 };
  }

  private save(): Promise<void> {
    const snapshot = JSON.stringify({ version: 1, entries: this.entries } satisfies MachinesFile);
    this.chain = this.chain.then(() => writeFileAtomic(this.file, snapshot));
    return this.chain;
  }
}

/** The daily leaderboard: fewest total tries over the day's ladder (parts break ties), one row per name. */
export class DailyBoard {
  private days: Record<string, Score[]> = {};
  private chain: Promise<void> = Promise.resolve();
  private constructor(private file: string) {}

  static async open(dir: string): Promise<DailyBoard> {
    const b = new DailyBoard(join(dir, 'daily-scores.json'));
    b.days = (await readJson<Record<string, Score[]>>(b.file)) ?? {};
    return b;
  }

  top(date: string): Score[] {
    return this.days[date] ?? [];
  }

  async add(date: string, score: Omit<Score, 'at'>, now = new Date()): Promise<{ board: Score[]; rank: number }> {
    const s: Score = { ...score, name: playerName(score.name), at: now.toISOString() };
    const board = onBoard(this.days[date] ?? [], s, MACHINE_LIMITS.daily, fewestTries);
    this.days[date] = board;
    // Two weeks of boards are plenty.
    for (const d of Object.keys(this.days).sort().slice(0, -14)) delete this.days[d];
    const snapshot = JSON.stringify(this.days);
    this.chain = this.chain.then(() => writeFileAtomic(this.file, snapshot));
    await this.chain;
    return { board, rank: board.findIndex((b) => b.name === s.name) + 1 };
  }
}

export const PLAY_EVENTS = ['start', 'solve', 'giveup', 'hint'] as const;
export type PlayEvent = (typeof PLAY_EVENTS)[number];
export interface PlayRecord { t: string; level: string; event: PlayEvent; tries: number; placed: number }

/** How plays end: one JSON line per event, a file per day, nothing that identifies the player. */
export class PlayLog {
  constructor(private dir: string) {}

  private file(date: string) { return join(this.dir, `${date}.jsonl`); }

  async add(rec: Omit<PlayRecord, 't'>, now = new Date()): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    await appendFile(this.file(now.toISOString().slice(0, 10)), JSON.stringify({ t: now.toISOString(), ...rec }) + '\n');
  }

  /** Per level over the last `days` days: starts, solves, give-ups, hints, the give-up rate and median tries. */
  async stats(days = 7, now = new Date()) {
    type Tally = { starts: number; solves: number; giveups: number; hints: number; giveupTries: number[]; solveTries: number[] };
    const per = new Map<string, Tally>();
    for (let k = 0; k < days; k++) {
      const date = new Date(now.getTime() - k * 86_400_000).toISOString().slice(0, 10);
      let text = '';
      try { text = await readFile(this.file(date), 'utf8'); } catch { continue; }
      for (const line of text.split('\n')) {
        if (!line) continue;
        let r: PlayRecord;
        try { r = JSON.parse(line) as PlayRecord; } catch { continue; }
        const s = per.get(r.level) ?? { starts: 0, solves: 0, giveups: 0, hints: 0, giveupTries: [], solveTries: [] };
        if (r.event === 'start') s.starts++;
        if (r.event === 'solve') { s.solves++; s.solveTries.push(r.tries); }
        if (r.event === 'giveup') { s.giveups++; s.giveupTries.push(r.tries); }
        if (r.event === 'hint') s.hints++;
        per.set(r.level, s);
      }
    }
    const median = (xs: number[]) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : null);
    return [...per.entries()]
      .map(([level, s]) => ({
        level, starts: s.starts, solves: s.solves, giveups: s.giveups, hints: s.hints,
        giveupRate: s.starts ? Math.round((s.giveups / s.starts) * 100) / 100 : 0,
        medianGiveupTries: median(s.giveupTries), medianSolveTries: median(s.solveTries),
      }))
      .sort((a, b) => b.giveups - a.giveups || b.starts - a.starts);
  }
}
