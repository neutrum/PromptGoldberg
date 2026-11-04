/**
 * What the player typed, newest first, with how it went: the activity feed's history. Kept for this
 * visit only; a click on one puts its words back in the box.
 */
import { create } from 'zustand';

export type PromptBox = 'new' | 'level' | 'build';
export interface PromptEntry { id: number; text: string; box: PromptBox; status: 'working' | 'done' | 'failed'; note?: string }

const KEEP = 30;
let next = 1;

export const usePromptLog = create<{ entries: PromptEntry[] }>(() => ({ entries: [] }));

export function logPrompt(text: string, box: PromptBox): number {
  const id = next++;
  usePromptLog.setState((s) => ({ entries: [{ id, text, box, status: 'working' as const }, ...s.entries].slice(0, KEEP) }));
  return id;
}

export function settlePrompt(id: number, status: 'done' | 'failed', note?: string) {
  usePromptLog.setState((s) => ({ entries: s.entries.map((e) => (e.id === id ? { ...e, status, note } : e)) }));
}
