/**
 * Check the built-in levels: each one must work as stored (its route is the proof a player can
 * win) and leave a bin to build with. --fix nudges a failing one with a big budget and writes it.
 *   npx tsx packages/machine/scripts/levels.ts [--fix] [dir]
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { evaluateMachine, initPhysics, makeConnectPuzzle, nudgeMachine, parseMachine, simulateSync, spread } from '../src';

const args = process.argv.slice(2);
const fix = args.includes('--fix');
const dir = args.find((a) => !a.startsWith('--')) ?? join(import.meta.dirname, '../src/fixtures/levels');

await initPhysics();
let bad = 0;
for (const name of readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
  const file = join(dir, name);
  const raw = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
  const parsed = parseMachine(raw);
  if (!parsed.ok) {
    console.log(`✗ ${name}: invalid: ${parsed.issues[0]?.message}`);
    bad++;
    continue;
  }
  let spec = parsed.spec;
  let result = evaluateMachine(spec.goal, simulateSync(spec, { record: false }));
  if (!result.success && fix) {
    const n = nudgeMachine(spec, { budget: 600, timeLimitMs: 60_000 });
    if (n.solved) {
      spec = n.spec;
      result = n.result;
      writeFileSync(file, JSON.stringify({ ...raw, parts: spec.parts }, null, 2) + '\n');
      console.log(`  ${name}: nudged ${n.moved.map((m) => m.id).join(', ')} and wrote it`);
    }
  }
  const puzzle = result.success ? makeConnectPuzzle(spec) : null;
  const ok = result.success && !!puzzle;
  if (!ok) bad++;
  console.log(`${ok ? '✓' : '✗'} ${name}: ${result.success ? 'works' : `fails at ${result.steps.find((s) => !s.satisfied)?.note}`}, spread ${spread(spec)}, bin ${puzzle ? puzzle.missing.map((p) => p.kind).join(' ') : '-'}${spec.spares?.length ? ` + spares ${spec.spares.map((s) => s.kind).join(' ')}` : ''}`);
}
process.exit(bad ? 1 : 0);
