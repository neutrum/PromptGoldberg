/**
 * Run the prompt -> level pipeline from the command line (no HTTP, no cache, no rate limits).
 *   npm run solve -w @og/server -- "A comet swings past the gas giant and crashes into its moon" [--out level.json]
 */
import { writeFileSync } from 'node:fs';
import { generateLevel } from '../src/game/pipeline';
import { createSolver } from '../src/game/solver';
import { createLlm } from '../src/llm/client';

const args = process.argv.slice(2);
const outIdx = args.indexOf('--out');
const out = outIdx >= 0 ? args.splice(outIdx, 2)[1] : undefined;
const prompt = args.join(' ').trim();
if (!prompt) {
  console.error('usage: solve.ts "<prompt>" [--out level.json]');
  process.exit(1);
}
const llm = createLlm();
if (!llm) {
  console.error('No LLM backend: set ANTHROPIC_API_KEY or LLM_BACKEND=cli.');
  process.exit(1);
}
const solver = createSolver('auto');
const started = Date.now();
const secs = () => ((Date.now() - started) / 1000).toFixed(1).padStart(5);
let lastProgress = 0;
const event = await generateLevel(
  { llm, solver, maxAttempts: 3, budget: 600, timeLimitMs: 12_000 },
  prompt,
  (e) => {
    if (e.type === 'stage') console.error(`${secs()}s [${e.stage} ${e.attempt}/${e.maxAttempts}] ${e.message}`);
    else if (e.type === 'progress' && Date.now() - lastProgress > 1000) {
      lastProgress = Date.now();
      console.error(`${secs()}s   evals ${e.evals}, best ${e.bestScore.toFixed(3)}/${e.goalLength}`);
    }
  },
);
console.error(`${secs()}s solved=${event.solved} attempts=${event.attempts} solver=${solver.mode}`);
for (const n of event.notes) console.error(`  - ${n}`);
const json = JSON.stringify(event.level, null, 2);
if (out) writeFileSync(out, json + '\n');
else console.log(json);
