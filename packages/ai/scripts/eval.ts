/**
 * AI level-design eval: runs the prompt -> level pipeline on a fixed prompt set with the
 * production defaults and reports solve rate, speed and level quality.
 *   npm run eval -w @og/ai -- [--only 1,4] [--edits] [--out results.json]
 * --edits also applies a talk-to-edit instruction to each solved level.
 * Targets (TODO.md): 8/10 levels proven solvable within 3 designs, first level in under 60 s.
 */
import { writeFileSync } from 'node:fs';
import { checkShot, controlValues, mulberry32, type Level } from '@og/shared';
import { createLevel, type LlmUsage } from '../src';

const PROMPTS: { prompt: string; curveball?: boolean }[] = [
  { prompt: 'A comet swings past the gas giant and crashes into its moon' },
  { prompt: 'Thread the needle between twin planets, then escape the system' },
  { prompt: "Hit the tiny moon of a red dwarf's only planet" },
  { prompt: 'Slingshot around two giants in a row, then reach the ice world at the edge' },
  { prompt: 'Rescue mission: fly past the scorched inner planet, then get captured by the blue world' },
  { prompt: 'Binary stars dance; slip past them and fly by the outer planet' },
  { prompt: 'An easy level for a kid: just hit the big planet' },
  { prompt: 'Hard: three flybys in a row, each one closer to the star' },
  { prompt: 'pizza', curveball: true },
  { prompt: 'my cat knocking things off the table', curveball: true },
];

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const only = flag('only')?.split(',').map(Number);
const out = flag('out');
const withEdits = args.includes('--edits');
const EDITS = ['make it harder', 'add a small moon to hit at the very end', 'make the biggest planet twice as heavy'];

/** Share of random control settings that clear the level (too high = trivial). */
function randomRate(level: Level, samples = 40): number {
  const rand = mulberry32(7);
  let hits = 0;
  for (let s = 0; s < samples; s++) {
    if (checkShot(level, level.controls.map((c) => c.min + rand() * (c.max - c.min))).goal.success) hits++;
  }
  return hits / samples;
}

/** Share of ±0.5%-of-range nudges around the solution that still clear it (too low = fragile). */
function robustness(level: Level): number | null {
  const sol = level.solution?.values;
  if (!sol) return null;
  let ok = 0, n = 0;
  level.controls.forEach((c, i) => {
    for (const sg of [-1, 1]) {
      const v = [...sol];
      v[i] += sg * 0.005 * (c.max - c.min);
      n++;
      if (checkShot(level, v).goal.success) ok++;
    }
  });
  return ok / n;
}

const maxAttempts = 3;
const results: Record<string, unknown>[] = [];
const pct = (x: number | null) => (x === null ? '  -' : `${Math.round(100 * x)}%`.padStart(4));

console.error(`model=${process.env.CLAUDE_MODEL ?? 'default'} attempts=${maxAttempts}`);
const llmSecs = (u: LlmUsage[]) => Math.round(u.reduce((s, c) => s + c.ms, 0) / 100) / 10;
let backend = '';
for (const [idx, { prompt, curveball }] of PROMPTS.entries()) {
  if (only && !only.includes(idx + 1)) continue;
  const started = Date.now();
  try {
    const event = await createLevel({ prompt }, {
      maxAttempts,
      onEvent: (e) => {
        if (e.type === 'stage') console.error(`  ${((Date.now() - started) / 1000).toFixed(0).padStart(4)}s ${e.stage} ${e.attempt}/${e.maxAttempts}`);
      },
    });
    const level = event.level;
    const ms = Date.now() - started;
    backend = event.usage[0]?.backend ?? backend;
    const startMisses = !checkShot(level, controlValues(level)).goal.success;
    const r = {
      n: idx + 1, prompt, curveball: !!curveball, ok: true,
      solved: event.solved, designs: event.attempts, llmCalls: event.usage.length,
      seconds: Math.round(ms / 100) / 10, llmSeconds: llmSecs(event.usage),
      costUsd: event.usage.reduce((s, c) => s + (c.costUsd ?? 0), 0),
      outputTokens: event.usage.reduce((s, c) => s + (c.outputTokens ?? 0), 0),
      title: level.title, briefing: level.briefing, goal: level.spec.goal.map((g) => g.type),
      bodies: level.spec.bodies.length, controls: level.controls.length, duration: level.spec.sim.duration,
      startMisses, randomRate: randomRate(level), robustness: robustness(level),
      notes: event.notes,
      level,
      edit: undefined as Record<string, unknown> | undefined,
    };
    if (withEdits && event.solved) {
      const instruction = EDITS[idx % EDITS.length];
      const t = Date.now();
      try {
        const ed = await createLevel({ level, instruction }, { maxAttempts });
        r.edit = {
          instruction, solved: ed.solved, designs: ed.attempts, seconds: Math.round((Date.now() - t) / 100) / 10,
          goal: ed.level.spec.goal.map((g) => g.type), bodies: ed.level.spec.bodies.length,
          randomRate: randomRate(ed.level), robustness: robustness(ed.level), briefing: ed.level.briefing,
        };
      } catch (err) {
        r.edit = { instruction, error: err instanceof Error ? err.message : String(err) };
      }
      console.error(`   edit "${instruction}": ${JSON.stringify(r.edit)}`);
    }
    results.push(r);
    console.error(`#${r.n} ${r.solved ? 'SOLVED' : 'unsolved'} designs=${r.designs} ${r.seconds}s (llm ${r.llmSeconds}s) random=${pct(r.randomRate)} robust=${pct(r.robustness)} startMisses=${startMisses} "${r.title}" [${r.goal.join(' > ')}]`);
  } catch (err) {
    const r = { n: idx + 1, prompt, curveball: !!curveball, ok: false, error: err instanceof Error ? err.message : String(err), seconds: (Date.now() - started) / 1000 };
    results.push(r);
    console.error(`#${r.n} ERROR ${r.error}`);
  }
  if (out) writeFileSync(out, JSON.stringify(results, null, 2) + '\n');
}

const done = results.filter((r) => r.ok);
const solved = done.filter((r) => r.solved);
const fast = solved.filter((r) => (r.seconds as number) < 60);
const secs = done.map((r) => r.seconds as number).sort((a, b) => a - b);
console.log('\n| # | prompt | solved | designs | time (LLM) | random wins | nudge holds | goal | title |');
console.log('|---|---|---|---|---|---|---|---|---|');
for (const r of results) {
  if (!r.ok) { console.log(`| ${r.n} | ${r.prompt} | error | | ${r.seconds}s | | | | ${r.error} |`); continue; }
  console.log(`| ${r.n} | ${r.prompt} | ${r.solved ? 'yes' : 'no'} | ${r.designs} | ${r.seconds}s (${r.llmSeconds}s) | ${pct(r.randomRate as number).trim()} | ${pct(r.robustness as number | null).trim()} | ${(r.goal as string[]).join(' → ')} | ${r.title} |`);
}
console.log(`\nSolved within ${maxAttempts} designs: ${solved.length}/${results.length} (target 8/10)`);
console.log(`Solved in under 60 s: ${fast.length}/${results.length}; median time ${secs[Math.floor(secs.length / 2)] ?? '-'}s`);
if (backend === 'cli') console.log('Note: CLI backend; timings include Claude Code start-up and differ from the API.');
