// Check a campaign level: starting values must miss, estimate difficulty by random sampling,
// then search for a solution with the optimizer (using the level's solution pieces, if any).
// Usage: npx tsx packages/shared/scripts/solve-level.ts <level.json> [--samples N] [--budget N] [--seed N]
//        [--no-pieces] [--write]
import { readFileSync, writeFileSync } from 'node:fs';
import { checkShot, controlValues, parseLevel, solveLevel, type Piece } from '../src';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--') && !/^-?[\d.]+$/.test(a));
if (!file) throw new Error('level path required');
const flag = (name: string, def: number) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? Number(args[i + 1]) : def;
};

const raw = JSON.parse(readFileSync(file, 'utf8'));
const parsed = parseLevel(raw);
if (!parsed.ok) {
  console.error(`invalid level:\n  ${parsed.issues.join('\n  ')}`);
  process.exit(1);
}
const level = parsed.level;
const pieces: Piece[] = args.includes('--no-pieces') ? [] : level.solution?.pieces ?? [];
const fmt = (vs: number[]) => vs.map((v) => Number(v.toPrecision(5))).join(', ');
const printEvents = (r: ReturnType<typeof checkShot>) =>
  r.goal.events.forEach((e) => console.log(`    [${e.index}] ${e.satisfied ? 'OK ' : '...'} ${e.note}`));

console.log(`${level.id}: "${level.title}"  controls: ${level.controls.map((c) => `${c.label} [${c.min}, ${c.max}]`).join(' | ')}`);
console.log(`pieces used: ${pieces.length ? JSON.stringify(pieces) : 'none'}`);

const start = controlValues(level);
const r0 = checkShot(level, start, pieces);
console.log(`start values (${fmt(start)}): ${r0.goal.success ? 'SOLVES (bad: starting values must miss)' : 'miss (good)'} score ${r0.goal.score.toFixed(3)}`);
printEvents(r0);

if (level.solution) {
  const rs = checkShot(level, level.solution.values, pieces);
  console.log(`stored solution (${fmt(level.solution.values)}): ${rs.goal.success ? 'solves' : 'MISSES'}`);
  if (!rs.goal.success) printEvents(rs);
}

// Difficulty: uniform random samples over the control ranges.
const samples = flag('samples', 400);
let seed = flag('seed', 1) * 7919;
const rand = () => {
  seed = (seed * 16807) % 2147483647;
  return (seed - 1) / 2147483646;
};
let hits = 0;
const hitValues: number[][] = [];
const t0 = Date.now();
for (let k = 0; k < samples; k++) {
  const values = level.controls.map((c) => c.min + rand() * (c.max - c.min));
  if (checkShot(level, values, pieces).goal.success) {
    hits++;
    hitValues.push(values);
  }
}
console.log(`random sampling: ${hits}/${samples} = ${((100 * hits) / samples).toFixed(1)}% success (${Date.now() - t0} ms)`);

const budget = flag('budget', 400);
const t1 = Date.now();
const res = solveLevel(level, pieces, { budget, seed: flag('seed', 1), timeLimitMs: 300_000 });
console.log(`solveLevel: solved=${res.solved} after ${res.evals} evals (${Date.now() - t1} ms) values ${fmt(res.values)} score ${res.goal.score.toFixed(3)}`);
res.goal.events.forEach((e) => console.log(`    [${e.index}] ${e.satisfied ? 'OK ' : '...'} ${e.note}`));

// Prefer a robust solution: one whose small nudges (about 1.5% of each range) still succeed, away from range edges.
if (res.solved) hitValues.push(res.values);
const edgeGap = (vs: number[]) => Math.min(...level.controls.map((c, i) => Math.min(vs[i] - c.min, c.max - vs[i]) / (c.max - c.min)));
const robustness = (vs: number[]) => {
  let ok = 0;
  const trials = 16;
  for (let k = 0; k < trials; k++) {
    const nudged = vs.map((v, i) => v + (rand() - 0.5) * 0.03 * (level.controls[i].max - level.controls[i].min));
    if (checkShot(level, nudged, pieces).goal.success) ok++;
  }
  return ok / trials;
};
let best: { values: number[]; score: number } | null = null;
for (const vs of hitValues.slice(-60)) {
  const score = robustness(vs) + Math.min(edgeGap(vs), 0.1);
  if (!best || score > best.score) best = { values: vs, score };
}
if (best) console.log(`most robust solution: ${fmt(best.values)} (robustness+edge score ${best.score.toFixed(2)})`);

if (res.solved) {
  const edge = level.controls.filter((c, i) => Math.abs(res.values[i] - c.min) < 0.03 * (c.max - c.min) || Math.abs(c.max - res.values[i]) < 0.03 * (c.max - c.min));
  if (edge.length) console.log(`warning: solution sits near the range edge of ${edge.map((c) => c.label).join(', ')}`);
}

if (args.includes('--write')) {
  if (!best) {
    console.log('not writing: no solution found');
  } else {
    raw.solution = { values: best.values.map((v) => Number(v.toPrecision(6))), pieces };
    writeFileSync(file, JSON.stringify(raw, null, 2) + '\n');
    console.log(`wrote solution to ${file}`);
  }
}
