import { readFileSync } from 'node:fs';
import { checkShot, Level } from '@og/shared';
import { loosen } from './packages/ai/src/forgiving';
const level = Level.parse(JSON.parse(readFileSync(process.argv[2], 'utf8')));
const sol = level.solution!.values;
console.log('controls', level.controls.map((c) => `${c.label} [${c.min.toFixed(3)}, ${c.max.toFixed(3)}]`).join(' | '), 'sol', sol.map((v) => v.toFixed(4)).join(', '));
console.log('goal', JSON.stringify(level.spec.goal));
for (const f of [1, 3, 10]) {
  const l = f === 1 ? level : loosen(level, f);
  console.log(`-- loosen x${f}: solution ok=${checkShot(l, sol).goal.success}`);
  level.controls.forEach((c, i) => {
    for (const d of [-0.005, -0.001, 0.001, 0.005]) {
      const v = [...sol]; v[i] += d * (c.max - c.min);
      const g = checkShot(l, v).goal;
      console.log(`  ${c.label} ${d > 0 ? '+' : ''}${(d * 100).toFixed(1)}%: ${g.success ? 'WIN' : 'miss'}  ${g.events.map((e) => (e.satisfied ? '✓' : '✗') + ' ' + e.note).join(' | ')}`);
    }
  });
}
