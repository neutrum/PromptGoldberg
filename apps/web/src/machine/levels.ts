import { parseMachine, type MachineSpec } from '@og/machine';

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
}

interface LevelFile { level?: { emoji: string; name: string; mission: string; order?: number } }

const files = import.meta.glob('../../../../packages/machine/src/fixtures/levels/*.json', { eager: true, import: 'default' }) as Record<string, unknown>;

export const LEVELS: Level[] = Object.entries(files)
  .flatMap(([path, raw]) => {
    const meta = (raw as LevelFile).level;
    const parsed = parseMachine(raw);
    if (!meta || !parsed.ok) return [];
    return [{ slug: /([^/]+)\.json$/.exec(path)?.[1] ?? path, emoji: meta.emoji, name: meta.name, mission: meta.mission, order: meta.order ?? 99, spec: parsed.spec }];
  })
  .sort((a, b) => a.order - b.order);
