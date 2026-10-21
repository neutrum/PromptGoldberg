/**
 * Compile route graphs and report: success rate, simulations and time per level.
 *   npx tsx packages/machine/scripts/compile.ts [--out dir]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { compileRoute, initPhysics, routeParts, spread, type RouteGraphInput } from '../src';

const GRAPHS: RouteGraphInput[] = [
  { title: 'Cannon to bucket', links: [{ via: 'cannon', turn: 'right' }], end: 'bucket' },
  { title: 'Cannon to bell', links: [{ via: 'cannon', turn: 'left' }], end: 'bell' },
  { title: 'Cannon dominoes', links: [{ via: 'cannon', turn: 'right' }], end: 'dominoes' },
  { title: 'Ramp turn bell', links: [{ via: 'ramp', turn: 'right' }], end: 'bell' },
  { title: 'Ramp turn dominoes', links: [{ via: 'ramp', turn: 'left' }], end: 'dominoes' },
  { title: 'Trampoline then cannon', links: [{ via: 'trampoline' }, { via: 'cannon', turn: 'right' }], end: 'bucket' },
  { title: 'Fan push bell', links: [{ via: 'fan', turn: 'right' }], end: 'bell' },
  { title: "Windy alley left", links: [{ via: "fan", turn: "left" }], end: "dominoes" },
  { title: "Cannon then fan", links: [{ via: "cannon", turn: "right" }, { via: "fan", turn: "left" }], end: "bell" },
  { title: 'Ramp to pit bucket', links: [{ via: 'ramp', turn: 'right' }], end: 'bucket' },
  { title: 'Hill cannon', start: 'hill', links: [{ via: 'cannon', turn: 'left' }], end: 'bucket' },
  { title: 'Cannon then trampoline', links: [{ via: 'cannon', turn: 'right' }, { via: 'trampoline' }], end: 'bell' },
  { title: 'Seesaw then ramp bell', links: [{ via: 'seesaw' }, { via: 'ramp', turn: 'right' }], end: 'bell' },
  { title: 'Seesaw straight', links: [{ via: 'seesaw', turn: 'straight' }, { via: 'fan', turn: 'left' }], end: 'dominoes' },
  { title: 'Cannon onto seesaw', links: [{ via: 'cannon', turn: 'left' }, { via: 'seesaw' }], end: 'bell' },
  { title: 'Ring it twice', links: [{ via: 'ramp', turn: 'right' }], end: 'bell', rings: 2 },
  { title: 'Fan ring twice', links: [{ via: 'fan', turn: 'left' }], end: 'bell', rings: 2 },
  { title: 'Long domino chain', links: [{ via: 'cannon', turn: 'right' }], end: 'dominoes', row: 14 },
  { title: 'Ramp long chain', links: [{ via: 'ramp', turn: 'left' }], end: 'dominoes', row: 10 },
];
const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : undefined;
const out = process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : undefined;
await initPhysics();
let ok = 0;
for (const [i, g] of GRAPHS.entries()) {
  if (only && !g.title.toLowerCase().includes(only.toLowerCase())) continue;
  for (const seed of [1, 2, 3]) {
    const t0 = Date.now();
    const r = compileRoute(g, { seed });
    const ms = Date.now() - t0;
    if (r) ok++;
    console.log(`${r ? '✓' : '✗'} ${g.title} seed ${seed}: ${ms} ms${r ? `, ${r.tries} layouts, ${r.sims} sims, spread ${spread(r.spec)}, bin ${routeParts(r.spec).map((p) => p.kind).join(' ')} + ${r.spec.spares?.map((s) => s.kind).join(' ')}, ground ${(r.spec.terrain ?? []).map((t) => t.name).join(' ') || '-'}, walls ${r.spec.parts.filter((p) => p.fixed && p.kind === 'wall').length}` : ''}`);
    if (r && out) { mkdirSync(out, { recursive: true }); writeFileSync(join(out, `${i + 1}-${seed}.json`), JSON.stringify(r.spec, null, 2)); }
  }
}
console.log(`${ok}/${GRAPHS.filter((g) => !only || g.title.toLowerCase().includes(only.toLowerCase())).length * 3} compiled`);
