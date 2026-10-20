/**
 * Built-in levels, made the way a player's are: each mission sentence goes through the AI's
 * route graph and the compiler, and the first layout that works is kept with its level block.
 *   npx tsx --env-file-if-exists=../../.env scripts/gen-levels.ts [--only slug]
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { compileRoute, initPhysics, makeConnectPuzzle, spread } from '@og/machine';
import { createLlm } from '../src';
import { designRoute } from '../src/machine/route';

const MISSIONS = [
  { slug: 'first-shot', emoji: '🎯', name: 'First Shot', order: 1, mission: 'An easy one: fire the ball over the river into the bucket on the far bank' },
  { slug: 'windy-alley', emoji: '🌬️', name: 'Windy Alley', order: 2, mission: 'A windy alley: the ball hits the fence and a fan blows it round the corner to ring the bell' },
  { slug: 'ramp-run', emoji: '🛝', name: 'Ramp Run', order: 3, mission: 'Drop the ball onto a ramp that turns it round the corner into a row of dominoes' },
  { slug: 'bounce-house', emoji: '🏀', name: 'Bounce House', order: 4, mission: 'Fire the ball out of a cannon onto a trampoline that bounces it on to ring the bell' },
  { slug: 'castle-siege', emoji: '🏰', name: 'Castle Siege', order: 5, mission: 'A hard one: fire over the moat, then a gust of wind carries the ball round the castle to ring the alarm bell' },
];

const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : undefined;
const dir = join(import.meta.dirname, '../../machine/src/fixtures/levels');
await initPhysics();
const llm = createLlm()!;
for (const m of MISSIONS) {
  if (only && m.slug !== only) continue;
  let done = false;
  for (let round = 0; round < 3 && !done; round++) {
    const graph = await designRoute(llm, m.mission, []);
    for (let seed = 1; seed <= 6 && !done; seed++) {
      const r = compileRoute(graph, { seed: seed + round * 10 });
      if (!r) continue;
      const puzzle = makeConnectPuzzle(r.spec);
      if (!puzzle) continue;
      writeFileSync(join(dir, `${m.slug}.json`), JSON.stringify({ ...r.spec, level: { emoji: m.emoji, name: m.name, mission: m.mission, order: m.order } }, null, 2) + '\n');
      console.log(`✓ ${m.slug}: ${graph.links.map((l) => `${l.via} ${l.turn}`).join(', ')} -> ${graph.end}${r.adapted ? ` (adapted to ${r.adapted})` : ''}, spread ${spread(r.spec)}, bin ${puzzle.missing.map((p) => p.kind).join(' ')} + ${(puzzle.spares ?? []).map((p) => p.kind).join(' ')}, "${r.spec.title}"`);
      done = true;
    }
  }
  if (!done) console.log(`✗ ${m.slug}: no layout`);
}
