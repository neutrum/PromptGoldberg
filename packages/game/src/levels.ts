import type { MachineSpec } from '@pg/core';

/**
 * Example levels: missions the AI built and the physics proved, kept as fixtures so they open at
 * once. Each file is a machine plus a `level` block (emoji, name, mission sentence, order).
 */
export interface Level {
  slug: string;
  emoji: string;
  name: string;
  /** The sentence that made it: what a player would type. */
  mission: string;
  order: number;
  spec: MachineSpec;
  /** False for a level nobody has run: played as the AI's idea plus spares. Built-in levels are verified. */
  verified?: boolean;
  /** A community level: clears go on its board on the server. */
  gallery?: boolean;
  /** One of the game's own levels (Levels): no hints or solving, and a "next level" when won. */
  builtIn?: boolean;
}

/** A level someone shared: the whole level travels in the link, so sharing needs no server. */
export interface SharedLevel {
  mission: string;
  spec: MachineSpec;
  /** False for a level nobody has run (the AI's idea only). */
  verified: boolean;
  /** The sender's result, for the "can you beat it?" line. */
  score?: { stars: number; tries: number; parts: number };
}
