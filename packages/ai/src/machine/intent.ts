import { rulesOf, type MachineSpec, type PartKind } from '@og/machine';

const KINDS = ['cannon', 'fan', 'trampoline', 'seesaw', 'ramp', 'dominoes'] as const;
const counts: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4 };

/** Explicit, checkable requests supplement the model's interpretation; they never relax it. */
export function missionProblems(prompt: string, spec: MachineSpec): string[] {
  const problems: string[] = [];
  const text = prompt.toLowerCase();
  for (const kind of KINDS) {
    const word = kind === 'dominoes' ? 'domino(?:es)?' : `${kind}s?`;
    if (!new RegExp(`\\b${word}\\b`).test(text)) continue;
    const forbidden = new RegExp(`\\b(?:no|without|avoid) (?:any |a |an )?${word}\\b`).test(text);
    const actual = spec.parts.filter((p) => p.kind === kind).length;
    if (forbidden) { if (actual) problems.push(`The request excludes ${kind}.`); continue; }
    // "dominoes" counts individual blocks; only an explicit row request constrains row count.
    const amount = new RegExp(`\\b(one|two|three|four|[1-9]) ${kind === 'dominoes' ? 'rows? of dominoes' : word}\\b`).exec(text)?.[1];
    const required = amount ? counts[amount] ?? Number(amount) : 1;
    if (actual < required) problems.push(`The request needs ${required} ${kind}${kind === 'dominoes' ? ' row(s)' : '(s)'}, but this design has ${actual}.`);
    if (actual && !spec.goal.some((g) => spec.parts.find((p) => p.id === g.part)?.kind === kind)) {
      // Ramps also provide the launch, so they need not be a separate checkpoint.
      if (kind !== 'ramp') problems.push(`The ${kind} must participate in the route, not just decorate the scene.`);
    }
  }
  const target: PartKind | undefined = /\b(bucket|basket|oven)\b/.test(text) ? 'bucket' : /\b(bell|gong|alarm|chime)\b/.test(text) ? 'bell' : undefined;
  if (target && !spec.goal.some((g) => g.type === target)) problems.push(`The requested finish is a ${target}.`);
  const rings = /\b(thrice|three times|3 times)\b/.test(text) ? 3 : /\b(twice|two times|2 times)\b/.test(text) ? 2 : 1;
  if (target === 'bell' && !spec.goal.some((g) => g.type === 'bell' && (g.times ?? 1) >= rings)) problems.push(`The bell must ring ${rings} times.`);
  const requested = rulesOf(prompt);
  if (requested?.maxParts !== undefined && spec.rules?.maxParts !== requested.maxParts) problems.push('Keep the requested parts limit.');
  if (requested?.minSeconds !== undefined && spec.rules?.minSeconds !== requested.minSeconds) problems.push('Keep the requested minimum duration.');
  return problems;
}

export function unsupportedRequest(prompt: string): string | null {
  if (/\b(two|three|four|[2-9]|both|multiple) (balls|marbles)\b/i.test(prompt)) return 'This workshop routes one marble at a time. Try a single marble with several mechanisms.';
  const seconds = /\b(\d+)\s*(?:seconds?|secs?)\b/i.exec(prompt);
  if (seconds && Number(seconds[1]) > 14) return 'This kit supports timed challenges up to 14 seconds. Try a shorter route with dominoes.';
  return null;
}

/** Check measurable edit requests against both the previous and the proposed build. */
export function editProblems(instruction: string, original: MachineSpec, edited: MachineSpec): string[] {
  const problems: string[] = [];
  const text = instruction.toLowerCase();
  for (const kind of KINDS) {
    const word = kind === 'dominoes' ? 'domino(?:es)?' : `${kind}s?`;
    const addition = new RegExp(`\\b(?:add|insert) (?:another |a |an |one |two |three |[1-3] )?${word}\\b`).exec(text);
    const removal = new RegExp(`\\b(?:remove|delete) (?:the |a |an |one )?${word}\\b`).test(text);
    const before = original.parts.filter((p) => p.kind === kind).length;
    const after = edited.parts.filter((p) => p.kind === kind).length;
    if (addition) {
      const amount = /\b(two|three|[1-3])\b/.exec(addition[0])?.[1];
      const n = amount ? counts[amount] ?? Number(amount) : 1;
      if (after < before + n) problems.push(`Add ${n} ${kind} to the current build.`);
      if (kind !== 'ramp' && !edited.goal.some((g) => edited.parts.some((p) => p.id === g.part && p.kind === kind && !original.parts.some((o) => o.id === p.id)))) problems.push(`The new ${kind} must participate in the route.`);
    }
    if (removal && after >= before) problems.push(`Remove the requested ${kind}.`);
  }
  if (/\b(?:bell|gong|ring)\b/.test(text)) {
    const n = /\b(?:thrice|three times|3 times)\b/.test(text) ? 3 : /\b(?:twice|two times|2 times)\b/.test(text) ? 2 : null;
    if (n && !edited.goal.some((g) => g.type === 'bell' && g.times >= n)) problems.push(`The edited goal must require ${n} bell rings.`);
  }
  const signature = (s: MachineSpec) => JSON.stringify({
    parts: [...s.parts].sort((a, b) => a.id.localeCompare(b.id)).map((p) => [p.id, p.kind, p.x, p.y, p.z, p.yaw ?? 0, p.length ?? (p.kind === 'platform' ? 3 : p.kind === 'dominoes' ? 5 : null), p.color, p.label]),
    goal: s.goal.map((g) => [g.type, g.part, g.type === 'bell' ? g.times ?? 1 : null]), terrain: s.terrain ?? [], stage: s.stage ?? null, landscape: s.landscape ?? null, rules: s.rules ?? {},
  });
  if (signature(original) === signature(edited)) problems.push('The requested edit did not change any parts, goals, ground or world. Try changing a mechanism, its color, its name, the ground, or the world around it.');
  return problems;
}
