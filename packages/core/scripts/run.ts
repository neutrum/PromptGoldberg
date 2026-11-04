/**
 * Run a machine file and print what happened; --nudge lets the optimizer fix it.
 *   npx tsx packages/core/scripts/run.ts packages/core/src/fixtures/ramp-dominoes-bell.json [--nudge] [--write]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { evaluateMachine, initPhysics, nudgeMachine, parseMachine, simulateSync, traceHash, CELL } from '../src';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
if (!file) throw new Error('usage: run.ts <machine.json> [--nudge] [--write]');
const parsed = parseMachine(JSON.parse(readFileSync(file, 'utf8')));
if (!parsed.ok) {
  console.error(parsed.issues.map((i) => `${i.path}: ${i.message}`).join('\n'));
  process.exit(1);
}
await initPhysics();
const spec = parsed.spec;
const run = simulateSync(spec, { record: true });
const result = evaluateMachine(spec.goal, run);
console.log(`${spec.title}: ${run.bodies.length} bodies, ${run.stats.steps} steps in ${run.stats.ms} ms, hash ${traceHash(run)}`);
for (const e of run.events) console.log(`  ${e.t.toFixed(2)}s ${e.type}${'part' in e ? ` ${e.part}` : ''}`);
console.log(`  ball ends at ${run.ballEnd.map((v) => (v / CELL).toFixed(1)).join(', ')} cells`);
console.log(result.success ? 'WORKS' : `FAILS at step ${result.failedAt}: score ${result.score.toFixed(2)}`);
for (const s of result.steps) console.log(`  ${s.satisfied ? '✓' : '✗'} ${s.note}`);

if (args.includes('--nudge') && !result.success) {
  const started = Date.now();
  const n = nudgeMachine(spec, { budget: 200, timeLimitMs: 15_000 });
  console.log(`nudge: ${n.solved ? 'SOLVED' : 'unsolved'} after ${n.evals} runs in ${Date.now() - started} ms; moved ${n.moved.map((m) => `${m.id} ${m.cells}`).join(', ') || 'nothing'}`);
  for (const s of n.result.steps) console.log(`  ${s.satisfied ? '✓' : '✗'} ${s.note}`);
  if (args.includes('--write') && n.solved) writeFileSync(file, JSON.stringify(n.spec, null, 2) + '\n');
}
