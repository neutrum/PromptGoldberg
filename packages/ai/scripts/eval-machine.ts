/**
 * Prompt Goldberg eval: prompt -> machine on a fixed prompt set with the production defaults.
 *   npm run eval:machine -w @pg/ai -- [--only 1,4] [--out results.json]
 * Measures verified outcomes and checkable prompt requirements. Enjoyment needs human playtests.
 */
import { writeFileSync } from 'node:fs';
import { createMachine, type LlmUsage } from '../src';
import { missionProblems } from '../src/machine/intent';

const PROMPTS: { prompt: string; curveball?: boolean }[] = [
  { prompt: 'Get the ball into the bucket using dominoes and a fan' },
  { prompt: 'The slowest possible machine that rings the bell' },
  { prompt: 'Launch the ball with a cannon over a wall into a bucket' },
  { prompt: 'A seesaw, then a trampoline, then dominoes that ring a bell' },
  { prompt: 'Ring the bell twice' },
  { prompt: 'A machine with only three parts' },
  { prompt: 'Use every part in the kit at least once' },
  { prompt: 'The ball bounces on two trampolines before landing in the bucket' },
  { prompt: 'pizza delivery', curveball: true },
  { prompt: 'my cat knocking things off the shelf', curveball: true },
  { prompt: 'Get the pizza into the oven past the guard wall' },
  { prompt: 'A windy alley: the ball has to be blown sideways into a bucket' },
  { prompt: 'an elephant rings the dinner gong', curveball: true },
  { prompt: 'make it rain', curveball: true },
  { prompt: 'a really hard level with lava and a castle', curveball: true },
  { prompt: 'A long domino chain across the station rings the departure bell' },
];

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const only = flag('only')?.split(',').map(Number);
const out = flag('out');
if (args.includes('--puzzle')) console.error('--puzzle is obsolete: the app now always verifies generated machines.');
const results: Record<string, unknown>[] = [];
const llmSecs = (u: LlmUsage[]) => Math.round(u.reduce((s, c) => s + c.ms, 0) / 100) / 10;

console.error(`model=${process.env.CLAUDE_MACHINE_MODEL ?? 'claude-sonnet-5-5'}`);
for (const [idx, { prompt, curveball }] of PROMPTS.entries()) {
  if (only && !only.includes(idx + 1)) continue;
  const started = Date.now();
  let firstDraftMs: number | undefined;
  try {
    const res = await createMachine({ prompt }, {
      onEvent: (e) => {
        if (e.type === 'stage') console.error(`  ${((Date.now() - started) / 1000).toFixed(0).padStart(4)}s ${e.stage} ${e.attempt}/${e.maxAttempts}: ${e.message}`);
        if (e.type === 'draft' && firstDraftMs === undefined) firstDraftMs = Date.now() - started;
      },
    });
    const ms = Date.now() - started;
    const r = {
      n: idx + 1, prompt, curveball: !!curveball, ok: true,
      solved: res.solved, verified: res.verified, unmetRequirements: missionProblems(prompt, res.machine), designs: res.attempts, llmCalls: res.usage.length,
      seconds: Math.round(ms / 100) / 10, firstDraftSeconds: firstDraftMs === undefined ? null : Math.round(firstDraftMs / 100) / 10, llmSeconds: llmSecs(res.usage),
      inputTokens: res.usage.reduce((s, c) => s + (c.inputTokens ?? 0), 0),
      outputTokens: res.usage.reduce((s, c) => s + (c.outputTokens ?? 0), 0),
      path: res.notes.some((n) => n.startsWith('Route graph')) ? 'route' : 'full', closest: res.machine.closest,
      title: res.machine.title, caption: res.machine.caption, parts: res.machine.parts.length,
      kinds: [...new Set(res.machine.parts.map((p) => p.kind))].join(' '),
      goal: res.machine.goal.map((g) => g.type), moved: res.moved, notes: res.notes, machine: res.machine,
    };
    results.push(r);
    console.error(`#${r.n} [${r.path}] ${r.solved ? 'WORKS' : 'fails'} designs=${r.designs} ${r.seconds}s (first draft ${r.firstDraftSeconds}s, llm ${r.llmSeconds}s) parts=${r.parts} [${r.kinds}] "${r.title}"`);
  } catch (err) {
    const r = { n: idx + 1, prompt, curveball: !!curveball, ok: false, error: err instanceof Error ? err.message : String(err), seconds: (Date.now() - started) / 1000 };
    results.push(r);
    console.error(`#${r.n} ERROR ${r.error}`);
  }
  if (out) writeFileSync(out, JSON.stringify(results, null, 2) + '\n');
}

const done = results.filter((r) => r.ok);
const solved = done.filter((r) => r.solved);
console.log('\n| # | prompt | works | designs | time (first draft) | parts | goal | title |');
console.log('|---|---|---|---|---|---|---|---|');
for (const r of results) {
  if (!r.ok) { console.log(`| ${r.n} | ${r.prompt} | error | | ${r.seconds}s | | | ${r.error} |`); continue; }
  console.log(`| ${r.n} | ${r.prompt} | ${r.solved ? 'yes' : 'no'} | ${r.designs} | ${r.seconds}s (${r.firstDraftSeconds}s) | ${r.parts} | ${(r.goal as string[]).join(' → ')} | ${r.title} |`);
}
console.log(`\nWorking machines: ${solved.length}/${results.length} (physics and explicit requirements; enjoyment not measured)`);

