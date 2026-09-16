import type { SystemSpec, Tunable } from './schema';

/**
 * Resolve a tunable path like "bodies.probe.placement.speed". The segment after
 * "bodies" is a body id, not an array index.
 */
function resolve(spec: SystemSpec, path: string): { obj: Record<string, unknown>; key: string } | null {
  const parts = path.split('.');
  let cur: unknown = spec;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (cur === null || typeof cur !== 'object') return null;
    if (i === 1 && parts[0] === 'bodies') {
      cur = spec.bodies.find((b) => b.id === part);
    } else {
      cur = (cur as Record<string, unknown>)[part];
    }
  }
  const key = parts[parts.length - 1];
  if (cur === null || typeof cur !== 'object') return null;
  return { obj: cur as Record<string, unknown>, key };
}

export function getTunable(spec: SystemSpec, path: string): number | undefined {
  const r = resolve(spec, path);
  const v = r?.obj[r.key];
  return typeof v === 'number' ? v : undefined;
}

/** Returns a deep copy of the spec with the tunables set to `values`. */
export function applyTunables(spec: SystemSpec, tunables: Tunable[], values: number[]): SystemSpec {
  const copy: SystemSpec = JSON.parse(JSON.stringify(spec));
  tunables.forEach((t, i) => {
    const r = resolve(copy, t.path);
    if (r && typeof r.obj[r.key] === 'number') r.obj[r.key] = values[i];
  });
  return copy;
}

export function isValidTunable(spec: SystemSpec, t: Tunable): boolean {
  return getTunable(spec, t.path) !== undefined;
}
