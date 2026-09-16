// Generation stats for the procedural level generator.
// Usage: npx tsx packages/shared/scripts/procgen-report.ts [--seeds 20] [--difficulties 1,3,5,7,10] [--samples 40]
import { checkShot, controlValues, generateLevel, mulberry32 } from '../src';

const args = process.argv.slice(2);
const flag = (name: string, def: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const seeds = Number(flag('seeds', '20'));
const difficulties = flag('difficulties', '1,3,5,7,10').split(',').map(Number);
const samples = Number(flag('samples', '40'));

const pad = (s: string | number, n: number) => String(s).padStart(n);
console.log(`${pad('diff', 4)} ${pad('ok', 6)} ${pad('mean ms', 8)} ${pad('max ms', 7)} ${pad('attempts', 8)} ${pad('evals', 6)} ${pad('rand solve', 10)} ${pad('tolerance', 9)}  goals`);

for (const d of difficulties) {
  let ok = 0, ms = 0, maxMs = 0, attempts = 0, evals = 0, randSolved = 0, randTotal = 0, tolOk = 0, tolTotal = 0;
  const goals = new Map<string, number>();
  for (let s = 1; s <= seeds; s++) {
    const seed = Math.imul(s, 2654435761) >>> 0;
    const t0 = Date.now();
    const r = generateLevel(seed, d);
    const dtMs = Date.now() - t0;
    ms += dtMs; maxMs = Math.max(maxMs, dtMs); attempts += r.attempts; evals += r.evals;
    const { level } = r;
    const sol = level.solution!.values;
    const solves = checkShot(level, sol).goal.success;
    const startMisses = !checkShot(level, controlValues(level)).goal.success;
    if (solves && startMisses) ok++;
    const typeOf = (id: string) => level.spec.bodies.find((b) => b.id === id)?.type;
    const key = level.spec.goal
      .map((g) => (g.type === 'flyby' && typeOf(g.target) === 'moon' ? 'moonflyby' : g.type))
      .join('>');
    goals.set(key, (goals.get(key) ?? 0) + 1);

    // Independent random-play sample.
    const rand = mulberry32(seed ^ 0xbeef);
    for (let i = 0; i < samples; i++) {
      const vals = level.controls.map((c) => c.min + rand() * (c.max - c.min));
      if (checkShot(level, vals).goal.success) randSolved++;
      randTotal++;
    }
    // Tolerance: nudge each control by ±0.5% of its range around the solution.
    level.controls.forEach((c, i) => {
      for (const sg of [-1, 1]) {
        const vals = [...sol];
        vals[i] += sg * 0.005 * (c.max - c.min);
        if (checkShot(level, vals).goal.success) tolOk++;
        tolTotal++;
      }
    });
  }
  const goalStr = [...goals].map(([k, v]) => `${k}:${v}`).join(' ');
  console.log(`${pad(d, 4)} ${pad(`${ok}/${seeds}`, 6)} ${pad(Math.round(ms / seeds), 8)} ${pad(maxMs, 7)} ${pad((attempts / seeds).toFixed(1), 8)} ${pad(Math.round(evals / seeds), 6)} ${pad(`${((100 * randSolved) / randTotal).toFixed(1)}%`, 10)} ${pad(`${((100 * tolOk) / tolTotal).toFixed(0)}%`, 9)}  ${goalStr}`);
}
