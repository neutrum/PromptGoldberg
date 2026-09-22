import {
  CAMPAIGN, controlValues, dailySeed, endlessDifficulty, getTunable, parseLevel, shotSpec, starsFor,
  clampControl, type Level, type LevelStreamEvent, type Piece, type PieceKind, type SketchBody,
} from '@og/shared';
import { create } from 'zustand';
import { computePool, generateInWorker, runPreview, runSimulation, solveInWorker, type RunData } from '../simClient';
import { useStore } from '../store';
import { setMuted, sfx } from './audio';
import { directionalHint, missSummary, pieceHint, playerFate } from './hints';
import { coach, publishLevel, reportGalleryResult, streamLevel } from './net';
import { loadProgress, mergeRecord, saveProgress, todayKey, type Progress } from './progress';

export type Screen = 'menu' | 'campaign' | 'play' | 'create' | 'gallery' | 'sandbox';

export type Source =
  | { kind: 'campaign'; index: number }
  | { kind: 'daily'; date: string }
  | { kind: 'endless'; stage: number; seed: number }
  | { kind: 'ai'; prompt: string }
  | { kind: 'gallery'; id: string }
  | { kind: 'shared' };

export type Phase = 'loading' | 'aiming' | 'flying' | 'result';

export interface Shot {
  values: number[];
  pieces: Piece[];
  run: RunData;
}

export interface ShotOutcome {
  success: boolean;
  stars: number;
  summary: string;
  fate: string | null;
  hint: string | null;
  coachTip: string | null;
  gameOver?: boolean;
  newBest?: boolean;
}

export interface MachineState {
  status: 'idle' | 'running' | 'done' | 'failed';
  evals: number;
  best: number;
  values: number[] | null;
}

export interface EndlessState {
  seed: number;
  stage: number;
  shotsLeft: number;
  cleared: number;
}

export interface AiLog {
  busy: boolean;
  lines: string[];
  progress: number;
  error: string | null;
  /** Bodies Claude has written so far for the design in progress. */
  sketch: { attempt: number; title?: string; bodies: SketchBody[] } | null;
}

/** How far the AI level on screen got: 0 = designed (not proven yet), 1 = proven solvable, 2 = final. */
export type AiRank = 0 | 1 | 2;

/** The AI level being played while newer versions may still arrive. */
export interface AiLive {
  /** Versions are still arriving. */
  working: boolean;
  /** Design attempt and rank of the version on screen. */
  attempt: number;
  rank: AiRank;
  /** The version on screen has a proven solution. */
  proven: boolean;
  /** A better version of a different design, offered instead of swapped in under an active player. */
  pending: { level: Level; attempt: number; rank: AiRank } | null;
}

interface GameState {
  screen: Screen;
  progress: Progress;

  level: Level | null;
  source: Source | null;
  phase: Phase;
  loadingText: string;
  error: string | null;

  values: number[];
  pieces: Piece[];
  placing: PieceKind | null;
  preview: RunData | null;
  shots: Shot[];
  flight: RunData | null;
  /** Goal steps already celebrated during the current flight. */
  celebrated: number;
  outcome: ShotOutcome | null;
  hint: RunData | null;
  usedHint: boolean;
  machine: MachineState;
  endless: EndlessState | null;
  ai: AiLog;
  aiLive: AiLive | null;
  toast: string | null;
  /** Outcome to restore when a replayed flight ends (replays never re-score). */
  replayOutcome: ShotOutcome | null;

  go: (screen: Screen) => void;
  toggleMute: () => void;
  setAuthor: (name: string) => void;
  finishTutorial: (id: string) => void;
  replayTutorials: () => void;
  showToast: (text: string) => void;

  openLevel: (level: Level, source: Source) => void;
  playCampaign: (index: number) => void;
  playDaily: () => Promise<void>;
  startEndless: () => Promise<void>;
  loadEndlessStage: (e: EndlessState) => Promise<void>;
  createWithAi: (prompt: string) => Promise<void>;
  editWithAi: (instruction: string) => Promise<void>;
  /** Switch to the better AI version that was offered. */
  acceptAiVersion: () => void;
  dismissAiVersion: () => void;

  setValue: (index: number, value: number) => void;
  nudge: (index: number, fraction: number) => void;
  setPlacing: (kind: PieceKind | null) => void;
  placePiece: (piece: Piece) => void;
  removePiece: (index: number) => void;
  refreshPreview: () => void;

  launch: () => Promise<void>;
  celebrate: (step: number) => void;
  finishFlight: () => void;
  replay: () => void;
  skipFlight: () => void;
  aimAgain: () => void;
  next: () => void;
  restartLevel: () => void;

  showHint: () => Promise<void>;
  raceMachine: () => Promise<void>;
  stopMachine: () => void;
  publish: () => Promise<string | null>;
}

const idleMachine: MachineState = { status: 'idle', evals: 0, best: 0, values: null };
const idleAi: AiLog = { busy: false, lines: [], progress: 0, error: null, sketch: null };

const ENDLESS_START_SHOTS = 8;

/** Time the player launches at (the planets are shown where they are at that moment). */
export function launchTime(level: Level, values: number[]): number {
  const i = level.controls.findIndex((c) => c.path === `bodies.${level.player}.placement.time`);
  if (i >= 0) return values[i];
  return getTunable(level.spec, `bodies.${level.player}.placement.time`) ?? 0;
}

let previewBusy = false;
let previewDirty = false;
let aiAbort: AbortController | null = null;

export const useGame = create<GameState>((set, get) => {
  const saveP = (mut: (p: Progress) => void) => {
    const p = structuredClone(get().progress);
    mut(p);
    saveProgress(p);
    set({ progress: p });
  };

  const resetForLevel = (level: Level, source: Source) => {
    get().stopMachine();
    set({
      level, source, phase: 'aiming', error: null, loadingText: '',
      values: controlValues(level), pieces: [], placing: null, preview: null, shots: [], flight: null,
      celebrated: 0, outcome: null, hint: null, usedHint: false, machine: idleMachine, screen: 'play', replayOutcome: null,
    });
    const pb = useStore.getState();
    pb.setPlaying(false);
    pb.setFocus(null);
    pb.setTime(launchTime(level, get().values));
    get().refreshPreview();
  };

  /**
   * Show an AI level version. Levels arrive progressively (draft, proven, final), so the player
   * starts on the first playable draft. Later versions of the same design update it in place
   * (keeping the player's shots and slider moves); a different design is swapped in only while
   * nothing has been fired yet, otherwise it is offered. A version never replaces a better one.
   */
  const showAiVersion = (level: Level, attempt: number, rank: AiRank, source: Source) => {
    const g = get();
    const live = g.aiLive;
    const proven = !!level.solution;
    const current = g.level;
    if (!live || g.source?.kind !== 'ai' || !current) {
      resetForLevel(level, source);
      set({ aiLive: { working: true, attempt, rank, proven, pending: null } });
      return;
    }
    if (attempt === live.attempt) {
      if (rank < live.rank) return;
      if (g.phase === 'flying') {
        // Never change the rules mid-flight: apply once the shot is over.
        const unsub = useGame.subscribe((s) => {
          if (s.phase === 'flying') return;
          unsub();
          showAiVersion(level, attempt, rank, source);
        });
        return;
      }
      const untouched = g.values.every((v, i) => v === controlValues(current)[i]);
      set({
        level,
        values: untouched ? controlValues(level) : g.values,
        hint: null,
        aiLive: { ...live, rank, proven },
      });
      if (untouched) useStore.getState().setTime(launchTime(level, get().values));
      get().refreshPreview();
      return;
    }
    if (rank < live.rank || (rank === live.rank && !proven && live.proven)) return;
    const untouched = g.values.every((v, i) => v === controlValues(current)[i]) && g.pieces.length === 0;
    if (g.shots.length === 0 && untouched && g.phase === 'aiming' && g.screen === 'play') {
      resetForLevel(level, source);
      set({ aiLive: { ...live, attempt, rank, proven, pending: null } });
      g.showToast('The AI swapped in a fairer version of this level.');
    } else {
      set({ aiLive: { ...live, pending: { level, attempt, rank } } });
    }
  };

  const aiStream = async (path: '/level' | '/edit', body: unknown, source: (level: Level) => Source) => {
    aiAbort?.abort();
    aiAbort = new AbortController();
    set({ ai: { busy: true, lines: [], progress: 0, error: null, sketch: null }, aiLive: null });
    const log = (line: string) => set((s) => ({ ai: { ...s.ai, lines: [...s.ai.lines, line].slice(-8) } }));
    let delivered = false;
    const accept = (raw: Level, attempt: number, rank: AiRank): boolean => {
      const parsed = parseLevel(raw);
      if (!parsed.ok) {
        set((s) => ({ ai: { ...s.ai, error: `The level came back broken: ${parsed.issues[0]}` } }));
        return false;
      }
      delivered = true;
      showAiVersion(parsed.level, attempt, rank, source(parsed.level));
      return true;
    };
    try {
      await streamLevel(path, body, (e: LevelStreamEvent) => {
        switch (e.type) {
          case 'stage':
            log(e.message || `${e.stage}…`);
            break;
          case 'progress':
            set((s) => ({ ai: { ...s.ai, progress: e.goalLength ? e.bestScore / e.goalLength : 0 } }));
            break;
          case 'sketch':
            set((s) => ({ ai: { ...s.ai, sketch: { attempt: e.attempt, title: e.title, bodies: e.bodies } } }));
            break;
          case 'draft':
            if (accept(e.level, e.attempt, e.status === 'solved' ? 1 : 0)) {
              log(e.status === 'solved' ? 'Proven solvable. Checking it is fair to aim at…' : 'Design ready: play it while the AI proves it.');
            }
            break;
          case 'level': {
            if (!accept(e.level, e.attempt ?? get().aiLive?.attempt ?? 1, 2)) return;
            log(e.solved ? `Verified solvable${e.cached ? ' (cached)' : ''}.` : 'Could not prove it solvable; playable anyway.');
            set((s) => ({ ai: { ...idleAi }, aiLive: s.aiLive && { ...s.aiLive, working: false } }));
            break;
          }
          case 'error':
            set((s) => ({ ai: { ...s.ai, error: e.error }, aiLive: s.aiLive && { ...s.aiLive, working: false } }));
            break;
        }
      }, aiAbort.signal);
      if (!delivered) set((s) => ({ ai: { ...s.ai, busy: false, error: s.ai.error ?? 'The AI did not return a level.' } }));
      set((s) => ({ ai: { ...s.ai, busy: false }, aiLive: s.aiLive && { ...s.aiLive, working: false } }));
    } catch (err) {
      set((s) => ({ ai: { ...s.ai, busy: false, error: err instanceof Error ? err.message : String(err) }, aiLive: s.aiLive && { ...s.aiLive, working: false } }));
    }
  };

  const initial = loadProgress();
  setMuted(initial.muted);

  return {
    screen: 'menu',
    progress: initial,
    level: null,
    source: null,
    phase: 'loading',
    loadingText: '',
    error: null,
    values: [],
    pieces: [],
    placing: null,
    preview: null,
    shots: [],
    flight: null,
    celebrated: 0,
    outcome: null,
    hint: null,
    usedHint: false,
    machine: idleMachine,
    endless: null,
    ai: idleAi,
    aiLive: null,
    toast: null,
    replayOutcome: null,

    go(screen) {
      if (screen !== 'play') get().stopMachine();
      // Leaving for anything but the AI level itself stops the AI.
      if (screen !== 'create' && screen !== 'play') {
        aiAbort?.abort();
        set({ ai: idleAi, aiLive: null });
      }
      set({ screen });
    },
    toggleMute() {
      saveP((p) => { p.muted = !p.muted; });
      setMuted(get().progress.muted);
    },
    finishTutorial(id) {
      saveP((p) => { p.tutorial = { ...p.tutorial, [id]: true }; });
    },
    replayTutorials() {
      saveP((p) => { p.tutorial = {}; });
      const { level, source } = get();
      if (level && source && get().phase === 'result') get().aimAgain();
    },
    setAuthor(name) {
      saveP((p) => { p.author = name.slice(0, 32); });
    },
    showToast(text) {
      set({ toast: text });
      setTimeout(() => { if (get().toast === text) set({ toast: null }); }, 2600);
    },

    openLevel: resetForLevel,

    playCampaign(index) {
      const level = CAMPAIGN[index];
      if (level) resetForLevel(level, { kind: 'campaign', index });
    },

    async playDaily() {
      const date = todayKey();
      set({ screen: 'play', phase: 'loading', level: null, loadingText: 'Generating today’s system…', error: null });
      try {
        const { level } = await generateInWorker(dailySeed(new Date()), 4);
        resetForLevel({ ...level, title: `Daily: ${level.title}` }, { kind: 'daily', date });
      } catch (err) {
        set({ error: err instanceof Error ? err.message : String(err) });
      }
    },

    async startEndless() {
      const e: EndlessState = { seed: (Math.random() * 2 ** 31) | 0, stage: 1, shotsLeft: ENDLESS_START_SHOTS, cleared: 0 };
      await get().loadEndlessStage(e);
    },

    async loadEndlessStage(e) {
      set({ endless: e, screen: 'play', phase: 'loading', level: null, loadingText: `Charting system ${e.stage}…`, error: null });
      try {
        const { level } = await generateInWorker((e.seed + e.stage * 7919) >>> 0, Math.min(8, endlessDifficulty(e.stage)));
        if (get().endless !== e) return;
        resetForLevel({ ...level, title: `${e.stage}. ${level.title}` }, { kind: 'endless', stage: e.stage, seed: e.seed });
      } catch (err) {
        set({ error: err instanceof Error ? err.message : String(err) });
      }
    },

    createWithAi: (prompt) => aiStream('/level', { prompt }, () => ({ kind: 'ai', prompt })),

    acceptAiVersion() {
      const { aiLive, source } = get();
      if (!aiLive?.pending || source?.kind !== 'ai') return;
      const { level, attempt, rank } = aiLive.pending;
      resetForLevel(level, source);
      set({ aiLive: { ...aiLive, attempt, rank, proven: !!level.solution, pending: null } });
    },

    dismissAiVersion() {
      set((s) => ({ aiLive: s.aiLive && { ...s.aiLive, pending: null } }));
    },

    async editWithAi(instruction) {
      const { level, source } = get();
      if (!level) return;
      set({ screen: 'create' });
      await aiStream('/edit', { level, instruction }, () => (source?.kind === 'ai' ? source : { kind: 'ai', prompt: instruction }));
    },

    setValue(index, value) {
      const { level, values, phase } = get();
      if (!level || (phase !== 'aiming' && phase !== 'result')) return;
      const v = clampControl(level.controls[index], value);
      if (v === values[index]) return;
      const next = [...values];
      next[index] = v;
      set({ values: next });
      if (phase === 'result') get().aimAgain();
      useStore.getState().setTime(launchTime(level, next));
      sfx.tick();
      get().refreshPreview();
    },

    nudge(index, fraction) {
      const { level, values } = get();
      if (!level) return;
      const c = level.controls[index];
      get().setValue(index, values[index] + fraction * (c.max - c.min));
    },

    setPlacing: (kind) => set({ placing: kind }),

    placePiece(piece) {
      const { level, pieces } = get();
      if (!level?.pieces || pieces.length >= level.pieces.max) return;
      set({ pieces: [...pieces, piece], placing: pieces.length + 1 >= level.pieces.max ? null : get().placing });
      if (get().phase === 'result') get().aimAgain();
      sfx.place();
      get().refreshPreview();
    },

    removePiece(index) {
      set({ pieces: get().pieces.filter((_, i) => i !== index) });
      if (get().phase === 'result') get().aimAgain();
      sfx.click();
      get().refreshPreview();
    },

    refreshPreview() {
      if (previewBusy) {
        previewDirty = true;
        return;
      }
      const { level, values, pieces } = get();
      if (!level) return;
      previewBusy = true;
      previewDirty = false;
      runPreview(shotSpec(level, values, pieces))
        .then((run) => {
          if (get().level === level) set({ preview: run });
        })
        .catch((err) => set({ error: err instanceof Error ? err.message : String(err) }))
        .finally(() => {
          previewBusy = false;
          if (previewDirty) get().refreshPreview();
        });
    },

    async launch() {
      const { level, values, pieces, phase, endless } = get();
      if (!level || (phase !== 'aiming' && phase !== 'result')) return;
      if (endless && endless.shotsLeft <= 0) return;
      set({ phase: 'flying', outcome: null, placing: null, celebrated: 0 });
      sfx.launch();
      try {
        const run = await runSimulation(shotSpec(level, values, pieces));
        const shot: Shot = { values: [...values], pieces: [...pieces], run };
        set((s) => ({
          flight: run,
          shots: [...s.shots, shot],
          endless: s.endless ? { ...s.endless, shotsLeft: s.endless.shotsLeft - 1 } : null,
        }));
        const pb = useStore.getState();
        pb.setTime(Math.max(0, (run.trace.launches[level.player] ?? 0)));
        pb.setPlaying(true);
      } catch (err) {
        set({ phase: 'aiming', error: err instanceof Error ? err.message : String(err) });
      }
    },

    celebrate(step) {
      if (step < get().celebrated) return;
      set({ celebrated: step + 1 });
      sfx.checkpoint(step);
    },

    finishFlight() {
      const { level, flight, shots, usedHint, source, endless, values, pieces } = get();
      if (!level || !flight || get().phase !== 'flying') return;
      useStore.getState().setPlaying(false);
      const replayed = get().replayOutcome;
      if (replayed) {
        set({ phase: 'result', outcome: replayed, replayOutcome: null });
        return;
      }
      const names = new Map(flight.spec.bodies.map((b) => [b.id, b.name]));
      const success = flight.goal.success;
      const stars = starsFor(success, shots.length, level.par, usedHint);
      const outcome: ShotOutcome = {
        success,
        stars,
        summary: missSummary(level, flight.goal, names),
        fate: success ? null : playerFate(level, flight.events, names),
        hint: success || shots.length < 2 ? null : (level.controls.length ? directionalHint(level, values) : pieceHint(level, pieces)) ?? level.tip ?? null,
        coachTip: null,
      };

      if (success) {
        sfx.success();
        if (source?.kind === 'campaign' || source?.kind === 'gallery' || source?.kind === 'ai' || source?.kind === 'shared') {
          const old = get().progress.levels[level.id];
          outcome.newBest = !old || stars > old.stars || shots.length < old.bestShots;
          saveP((p) => { p.levels[level.id] = mergeRecord(p.levels[level.id], stars, shots.length); });
        }
        if (source?.kind === 'daily') {
          saveP((p) => {
            const old = p.daily[source.date];
            if (!old || stars > old.stars || (stars === old.stars && shots.length < old.shots)) p.daily[source.date] = { stars, shots: shots.length };
          });
        }
        if (source?.kind === 'endless' && endless) {
          const cleared = endless.cleared + 1;
          set({ endless: { ...endless, cleared, shotsLeft: endless.shotsLeft + level.par } });
          if (cleared > get().progress.endlessBest) {
            outcome.newBest = true;
            saveP((p) => { p.endlessBest = cleared; });
          }
        }
        if (source?.kind === 'gallery') void reportGalleryResult(source.id, true, shots.length);
      } else {
        sfx.miss();
        if (endless && endless.shotsLeft <= 0) outcome.gameOver = true;
      }
      set({ phase: 'result', outcome });

      if (!success && shots.length >= 2) {
        void coach({ level, values, pieces, shots: shots.length, goal: flight.goal, events: flight.events })
          .then(({ tip }) => {
            if (get().flight === flight && tip) set((s) => ({ outcome: s.outcome && { ...s.outcome, coachTip: tip } }));
          })
          .catch(() => undefined);
      }
    },

    replay() {
      const { level, flight, outcome } = get();
      if (!level || !flight || get().phase !== 'result' || !outcome) return;
      set({ phase: 'flying', celebrated: 0, replayOutcome: outcome, outcome: null });
      const pb = useStore.getState();
      pb.setTime(flight.trace.launches[level.player] ?? 0);
      pb.setPlaying(true);
    },

    skipFlight() {
      const { level, flight, phase } = get();
      if (!level || !flight || phase !== 'flying') return;
      const n = flight.goal.events.length;
      for (let i = get().celebrated; i < n; i++) if (flight.goal.events[i].satisfied) get().celebrate(i);
      get().finishFlight();
    },

    aimAgain() {
      const { level, values, phase, outcome } = get();
      if (!level || (phase !== 'result' && phase !== 'flying')) return;
      if (outcome?.gameOver) return;
      if (outcome?.success) return;
      const pb = useStore.getState();
      pb.setPlaying(false);
      pb.setTime(launchTime(level, values));
      set({ phase: 'aiming', outcome: null, flight: null });
    },

    next() {
      const { source, endless } = get();
      if (source?.kind === 'campaign') {
        if (source.index + 1 < CAMPAIGN.length) get().playCampaign(source.index + 1);
        else set({ screen: 'campaign' });
      } else if (source?.kind === 'endless' && endless) {
        void get().loadEndlessStage({ ...endless, stage: endless.stage + 1 });
      } else if (source?.kind === 'gallery') {
        set({ screen: 'gallery' });
      } else if (source?.kind === 'ai') {
        set({ screen: 'create' });
      } else {
        set({ screen: 'menu' });
      }
    },

    restartLevel() {
      const { level, source } = get();
      if (source?.kind === 'endless') {
        void get().startEndless();
        return;
      }
      if (level && source) resetForLevel(level, source);
    },

    async showHint() {
      const { level } = get();
      if (!level?.solution) return;
      set({ usedHint: true });
      try {
        const run = await runSimulation(shotSpec(level, level.solution.values, level.solution.pieces));
        if (get().level === level) set({ hint: run });
      } catch {
        // Hint is best effort.
      }
    },

    async raceMachine() {
      const { level, pieces, machine } = get();
      if (!level || machine.status === 'running') return;
      set({ machine: { status: 'running', evals: 0, best: 0, values: null } });
      const goalLen = Math.max(1, level.spec.goal.length);
      const usePieces = pieces.length ? pieces : level.solution?.pieces ?? [];
      try {
        const res = await solveInWorker(level, usePieces, (p) => {
          if (get().level !== level) return;
          set((s) => ({ machine: { ...s.machine, evals: p.evals, best: Math.min(1, p.bestScore / goalLen) } }));
        });
        if (get().level !== level) return;
        set({ machine: { status: res.solved ? 'done' : 'failed', evals: res.evals, best: Math.min(1, res.goal.score / goalLen), values: res.values } });
      } catch {
        if (get().machine.status === 'running') set({ machine: idleMachine });
      }
    },

    stopMachine() {
      if (get().machine.status === 'running') computePool.terminate();
      set({ machine: idleMachine });
    },

    async publish() {
      const { level, shots, progress } = get();
      if (!level) return null;
      const winning = [...shots].reverse().find((s) => s.run.goal.success);
      const toPublish: Level = winning
        ? { ...level, solution: { values: winning.values, pieces: winning.pieces } }
        : level;
      try {
        const { id } = await publishLevel(toPublish, progress.author);
        return id;
      } catch (err) {
        get().showToast(err instanceof Error ? err.message : String(err));
        return null;
      }
    },
  };
});
