// Tune a hand-written fixture with the optimizer and print (or write back) the solved values.
// Usage: npx tsx packages/shared/scripts/tune-fixture.ts <fixture.json> [--write] [--budget N] [--seed N]
import { readFileSync, writeFileSync } from 'node:fs';
import { SystemSpec, evaluateGoal, getTunable, optimize, simulate } from '../src';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
if (!file) throw new Error('fixture path required');
const flag = (name: string, def: number) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? Number(args[i + 1]) : def;
};

const raw = JSON.parse(readFileSync(file, 'utf8'));
const spec = SystemSpec.parse(raw);

const before = simulate(spec, { record: false });
const r0 = evaluateGoal(spec.goal, before.trace);
console.log(`before: score ${r0.score.toFixed(3)} success=${r0.success} (${before.steps} steps, ${before.substeps} substeps)`);
r0.events.forEach((e) => console.log(`  [${e.index}] ${e.satisfied ? 'OK ' : '...'} ${e.note}`));

const t0 = Date.now();
const res = optimize(spec, {
  budget: flag('budget', 400),
  timeLimitMs: flag('time', 120_000),
  seed: flag('seed', 1),
  onProgress: (p) => console.log(`  eval ${p.evals}: score ${p.bestScore.toFixed(3)} values ${p.bestValues.map((v) => v.toFixed(4)).join(', ')}`),
});
console.log(`after ${res.evals} evals in ${((Date.now() - t0) / 1000).toFixed(1)}s: score ${res.result.score.toFixed(3)} solved=${res.solved}`);
res.result.events.forEach((e) => console.log(`  [${e.index}] ${e.satisfied ? 'OK ' : '...'} ${e.note}`));

if (args.includes('--write') && res.solved) {
  // Write only the tuned numbers back into the original JSON to keep its formatting choices.
  for (const t of spec.tunables) {
    const v = getTunable(res.spec, t.path);
    const parts = t.path.split('.');
    let cur = raw;
    for (let i = 0; i < parts.length - 1; i++) {
      cur = i === 1 && parts[0] === 'bodies' ? cur.find((b: { id: string }) => b.id === parts[i]) : cur[parts[i]];
    }
    cur[parts[parts.length - 1]] = Number(v!.toPrecision(6));
  }
  writeFileSync(file, JSON.stringify(raw, null, 2) + '\n');
  console.log(`wrote ${file}`);
}
