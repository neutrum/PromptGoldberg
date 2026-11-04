/**
 * pg: Prompt Goldberg on the command line.
 *
 *   npm run pg -- level "a snowball races down the High Tatras into a cave" --out tatras.json
 *   npm run pg -- level "ring the bell across the river" --offline
 *   npm run pg -- play tatras.json "level: build a fence around the cave" "add a fan next to the snowball"
 *   npm run pg -- solve tatras.json --server http://localhost:8787
 *   npm run pg -- judge --server http://localhost:8787 --jobs 3 --solve   the judge prompt set, scored
 *   npm run pg -- recipes --jobs 4                 compose every library thing still without a recipe
 *   npm run pg -- recipes --only giraffe,taj-mahal --note "longer neck"
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createLlm, createPhysics, fillLibrary } from '@pg/ai';
import { CATALOG } from '@pg/core';
import { judgeOne, makeLevel, playLevel, readLevel, solveLevel, type JudgePrompt, type JudgeResult, type Source } from './commands';

const USAGE = `pg level "<sentence>" [--offline] [--server URL] [--out file.json]
pg play <level.json> ["<words>" ...]      words starting with "level:" change the level, the rest build
pg solve <level.json> [--server URL] [--out file.json]
pg judge [--server URL] [--only id,id] [--group name] [--jobs 3] [--solve | --ai-solve] [--from report.json] [--out file.json]
pg recipes [--only id,id] [--group name] [--redo] [--bad] [--note "..."] [--batch 5] [--jobs 3]`;

function args(argv: string[]) {
  const flags: Record<string, string | true> = {};
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) flags[a.slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') && !['--offline', '--redo', '--bad', '--solve', '--ai-solve'].includes(a) ? argv[++i] : true;
    else rest.push(a);
  }
  return { flags, rest };
}

async function main(argv: string[]) {
  const [command, ...more] = argv;
  const { flags, rest } = args(more);
  const src: Source = {
    server: typeof flags.server === 'string' ? flags.server : undefined,
    offline: flags.offline === true,
    onEvent: (e) => { if (e.type === 'stage') process.stderr.write(`  ${e.message}\n`); },
  };
  const out = (data: unknown) => {
    const text = JSON.stringify(data, null, 2);
    if (typeof flags.out === 'string') { writeFileSync(flags.out, text); process.stderr.write(`wrote ${flags.out}\n`); }
    else process.stdout.write(text + '\n');
  };
  switch (command) {
    case 'level': {
      if (!rest[0]) throw new Error(USAGE);
      const level = await makeLevel(rest.join(' '), src);
      const tray = (level.spares ?? []).map((s) => s.kind).join(', ');
      process.stderr.write(`"${level.title}": ${level.parts.length} parts on the board; tray: ${tray || 'none'}${level.landscape ? `; world: ${level.landscape.name}` : ''}\n`);
      out(level);
      return;
    }
    case 'play': {
      if (!rest[0]) throw new Error(USAGE);
      const report = await playLevel(readLevel(readFileSync(rest[0], 'utf8')), rest.slice(1));
      for (const line of report.log) process.stderr.write(`  ${line}\n`);
      process.stderr.write(report.solved ? 'Solved!\n' : `Not yet${report.note ? `: ${report.note}` : ''}.\n`);
      if (typeof flags.out === 'string') out(report.level);
      return;
    }
    case 'solve': {
      if (!rest[0]) throw new Error(USAGE);
      const res = await solveLevel(readLevel(readFileSync(rest[0], 'utf8')), src);
      process.stderr.write(res.solved ? `The AI found a way with ${res.added.length} parts: ${res.added.map((p) => `${p.kind} at ${p.x},${p.z}`).join('; ')}\n` : 'The AI found no way through this level.\n');
      out(res);
      return;
    }
    case 'judge': {
      const str = (k: string) => (typeof flags[k] === 'string' ? (flags[k] as string) : undefined);
      const only = str('only')?.split(',');
      const set = (JSON.parse(readFileSync(new URL('../judge-prompts.json', import.meta.url), 'utf8')) as JudgePrompt[])
        .filter((p) => (!only || only.includes(p.id)) && (!str('group') || p.group === str('group')));
      // --from an earlier report: its levels again, only the checks re-run.
      const before = str('from') ? (JSON.parse(readFileSync(str('from')!, 'utf8')) as JudgeResult[]) : null;
      if (before) for (const p of set) p.level = before.find((r) => r.id === p.id)?.level;
      if (before) set.splice(0, set.length, ...set.filter((p) => p.level));
      const quiet: Source = { ...src, onEvent: undefined, physics: createPhysics('auto') };
      const results: JudgeResult[] = [];
      let next = 0;
      const started = Date.now();
      const worker = async () => {
        while (next < set.length) {
          const r = await judgeOne(set[next++], quiet, flags.solve === true ? 'kit' : flags['ai-solve'] === true ? 'ai' : null);
          results.push(r);
          process.stderr.write(`${r.ok ? (r.missed?.length ? '~' : '✓') : '✗'} ${r.id.padEnd(11)} ${(r.ms / 1000).toFixed(0).padStart(3)} s  ${r.ok ? `"${r.title}" · ${r.world ?? 'no world'} · ${r.hero ?? 'no centrepiece'} · tray ${r.tray?.length}${r.fair ? ' · fair' : ''}${r.missed?.length ? ` · missed: ${r.missed.join(', ')}` : ''}${r.solved === undefined ? '' : r.solved ? ' · solved' + (r.solution ? ` (${r.solution})` : '') : ` · NOT solved${r.solveError ? ` (${r.solveError.slice(0, 80)})` : ''}`}` : r.error}
`);
        }
      };
      await Promise.all(Array.from({ length: Number(str('jobs') ?? 3) }, worker));
      const ok = results.filter((r) => r.ok);
      const times = ok.map((r) => r.ms).sort((a, b) => a - b);
      const solvedRuns = ok.filter((r) => r.solved !== undefined);
      const pct = (n: number, of: number) => `${n}/${of} (${of ? Math.round((100 * n) / of) : 0}%)`;
      process.stderr.write(`
Levels made:  ${pct(ok.length, results.length)}
Honoured:     ${pct(ok.filter((r) => !r.missed?.length).length, ok.length)} (every expected word shows in the level)
Fair:         ${pct(ok.filter((r) => r.fair).length, ok.length)} (proven at creation: a build from the kit reaches the goal)
Time:         median ${((times[times.length >> 1] ?? 0) / 1000).toFixed(1)} s, worst ${((times.at(-1) ?? 0) / 1000).toFixed(1)} s${solvedRuns.length ? `
Solved:       ${pct(solvedRuns.filter((r) => r.solved).length, solvedRuns.length)}` : ''}
Wall time:    ${((Date.now() - started) / 60000).toFixed(1)} min
`);
      const file = str('out') ?? (() => { const dir = new URL('../../../data/judge/', import.meta.url); mkdirSync(dir, { recursive: true }); return new URL(`${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.json`, dir); })();
      writeFileSync(file, JSON.stringify(results.sort((a, b) => set.findIndex((p) => p.id === a.id) - set.findIndex((p) => p.id === b.id)), null, 2));
      process.stderr.write(`wrote ${file instanceof URL ? file.pathname : file}
`);
      // The physics workers would keep the process alive.
      process.exit(0);
    }
    case 'recipes': {
      const llm = createLlm();
      if (!llm) throw new Error('No AI backend: set ANTHROPIC_API_KEY, or LLM_BACKEND=cli for local development.');
      const str = (k: string) => (typeof flags[k] === 'string' ? (flags[k] as string) : undefined);
      const started = Date.now();
      let done = 0;
      process.stderr.write(`Composing recipes with the ${llm.name} backend (${CATALOG.length} things in the catalog)…
`);
      const res = await fillLibrary(llm, {
        ids: str('only')?.split(',').map((x) => x.trim()), group: str('group'), note: str('note'),
        redo: flags.redo === true, bad: flags.bad === true,
        batch: Number(str('batch') ?? 5), jobs: Number(str('jobs') ?? 3),
        onBatch: (b) => {
          done += b.ids.length;
          process.stderr.write(`  ${(b.ms / 1000).toFixed(0)} s: ${b.ids.join(', ') || '-'}${b.missing.length ? ` (missing: ${b.missing.join(', ')})` : ''}${b.error ? ` error: ${b.error.slice(0, 160)}` : ''} [${done} done]
`);
        },
      });
      process.stderr.write(`Composed ${res.composed} in ${((Date.now() - started) / 60000).toFixed(1)} min${res.failed.length ? `; failed: ${res.failed.join(', ')}` : ''}.
`);
      return;
    }
    default:
      process.stderr.write(`${USAGE}\n`);
      process.exitCode = command ? 1 : 0;
  }
}

main(process.argv.slice(2)).catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exitCode = 1;
});
