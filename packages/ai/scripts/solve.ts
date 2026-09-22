/**
 * Design one level from the command line (no server, no cache, no rate limits).
 *   npm run solve -w @og/ai -- "A comet swings past the gas giant and crashes into its moon" [--out level.json]
 */
import { writeFileSync } from 'node:fs';
import { createLevel } from '../src';

const args = process.argv.slice(2);
const outIdx = args.indexOf('--out');
const out = outIdx >= 0 ? args.splice(outIdx, 2)[1] : undefined;
const prompt = args.join(' ').trim();
if (!prompt) {
  console.error('usage: solve.ts "<prompt>" [--out level.json]');
  process.exit(1);
}
const started = Date.now();
const secs = () => ((Date.now() - started) / 1000).toFixed(1).padStart(5);
let lastProgress = 0;
const res = await createLevel({ prompt }, {
  onEvent: (e) => {
    if (e.type === 'stage') console.error(`${secs()}s [${e.stage} ${e.attempt}/${e.maxAttempts}] ${e.message}`);
    else if (e.type === 'progress' && Date.now() - lastProgress > 1000) {
      lastProgress = Date.now();
      console.error(`${secs()}s   evals ${e.evals}, best ${e.bestScore.toFixed(3)}/${e.goalLength}`);
    }
  },
});
console.error(`${secs()}s solved=${res.solved} attempts=${res.attempts} llm calls=${res.usage.length}`);
for (const n of res.notes) console.error(`  - ${n}`);
const json = JSON.stringify(res.level, null, 2);
if (out) writeFileSync(out, json + '\n');
else console.log(json);
