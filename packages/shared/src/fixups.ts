import type { SystemSpec, Tunable } from './schema';
import { getTunable } from './tunables';

export interface FixupResult {
  spec: SystemSpec;
  /** Human-readable list of what was changed. */
  notes: string[];
}

const MAX_DURATION = 200;

/**
 * Deterministic repairs for a schema-valid spec: sensible numeric bounds and a
 * default set of tunables so the optimizer always has something to work with.
 */
export function fixupSpec(input: SystemSpec): FixupResult {
  const spec: SystemSpec = JSON.parse(JSON.stringify(input));
  const notes: string[] = [];

  if (spec.sim.duration > MAX_DURATION) {
    notes.push(`duration capped at ${MAX_DURATION} yr (was ${spec.sim.duration})`);
    spec.sim.duration = MAX_DURATION;
  }

  const valid: Tunable[] = [];
  for (const t of spec.tunables) {
    const v = getTunable(spec, t.path);
    if (v === undefined) {
      notes.push(`dropped tunable with unknown path "${t.path}"`);
      continue;
    }
    let { min, max } = t;
    if (min > max) [min, max] = [max, min];
    if (min === max) {
      min -= Math.abs(min) * 0.2 || 0.1;
      max += Math.abs(max) * 0.2 || 0.1;
    }
    if (v < min || v > max) {
      notes.push(`widened range of "${t.path}" to include its value ${v}`);
      min = Math.min(min, v);
      max = Math.max(max, v);
    }
    valid.push({ path: t.path, min, max });
  }
  spec.tunables = valid;

  const has = (path: string) => spec.tunables.some((t) => t.path === path);
  const add = (path: string, min: number, max: number) => {
    if (has(path)) return;
    spec.tunables.push({ path, min, max });
    notes.push(`added tunable "${path}" [${min.toFixed(3)}, ${max.toFixed(3)}]`);
  };

  // Every launched body gets its launch parameters tuned unless the design already chose some.
  for (const b of spec.bodies) {
    const p = b.placement;
    if (p.kind !== 'launch') continue;
    const prefix = `bodies.${b.id}.placement`;
    if (spec.tunables.some((t) => t.path.startsWith(prefix))) continue;
    add(`${prefix}.speed`, Math.max(0, p.speed * 0.5), p.speed * 1.5 + 0.5);
    add(`${prefix}.angle`, p.angle - 60, p.angle + 60);
    add(`${prefix}.time`, Math.max(0, p.time - 0.25 * spec.sim.duration), Math.min(spec.sim.duration * 0.75, p.time + 0.25 * spec.sim.duration));
  }

  return { spec, notes };
}
