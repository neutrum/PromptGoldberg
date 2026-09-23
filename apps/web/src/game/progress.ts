/** Per-viewer progress in localStorage. Every access is guarded: storage can be missing or blocked. */
export interface LevelRecord {
  stars: number;
  bestShots: number;
}

export interface Progress {
  levels: Record<string, LevelRecord>;
  daily: Record<string, { stars: number; shots: number }>;
  endlessBest: number;
  muted: boolean;
  author: string;
  /** Tutorials already finished, by id ('aim', 'pieces'). */
  tutorial: Record<string, boolean>;
  /** Coach marks switched off entirely (start-screen toggle or ?tutorial=off). */
  tutorialsOff: boolean;
  /** Hide the predicted path and aim by feel (only the first part of the flight is shown). */
  blindAim: boolean;
}

const KEY = 'orbital-goldberg:progress:v1';

const empty = (): Progress => ({ levels: {}, daily: {}, endlessBest: 0, muted: false, author: '', tutorial: {}, tutorialsOff: false, blindAim: false });

export function loadProgress(): Progress {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...empty(), ...JSON.parse(raw) } : empty();
  } catch {
    return empty();
  }
}

export function saveProgress(p: Progress): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    // Progress simply is not remembered.
  }
}

/** Keep the better of the old and new record. */
export function mergeRecord(old: LevelRecord | undefined, stars: number, shots: number): LevelRecord {
  if (!old) return { stars, bestShots: shots };
  return { stars: Math.max(old.stars, stars), bestShots: Math.min(old.bestShots, shots) };
}

export const todayKey = (d = new Date()) => d.toISOString().slice(0, 10);
