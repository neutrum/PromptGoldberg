import { Level } from '@og/shared';
import slingshot from '@og/shared/fixtures/slingshot.json' with { type: 'json' };
import type { CompletionRequest, LlmBackend } from '../src';

export const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

export const levelReply = (spec: object = slingshot, extra: object = {}) =>
  '```json\n' + JSON.stringify({ ...spec, briefing: 'Swing past Jove and reach Rime.', tip: 'Lead your target.', player: 'probe', ...extra }) + '\n```';

/** Slingshot with a goal that cannot happen in the time given. */
export function impossibleSpec() {
  const s = clone(slingshot) as Record<string, unknown> & { sim: { duration: number } };
  s.goal = [{ type: 'collision', a: 'probe', b: 'rime' }];
  s.sim.duration = 0.05;
  return s;
}

type Reply = string | Error | ((req: CompletionRequest) => string);

export class FakeLlm implements LlmBackend {
  name = 'api' as const;
  requests: CompletionRequest[] = [];
  constructor(private replies: Reply[]) {}
  async complete(req: CompletionRequest) {
    this.requests.push(req);
    const next = this.replies.length > 1 ? this.replies.shift()! : this.replies[0];
    if (next instanceof Error) throw next;
    const text = typeof next === 'function' ? next(req) : next;
    // Stream it in a few chunks, like the API backend.
    for (let i = 0; i < text.length; i += 200) req.onText?.(text.slice(i, i + 200));
    return { text, backend: 'api' as const };
  }
}

/** The slingshot fixture as a level with its known solution. */
export function slingshotLevel(): Level {
  const probe = slingshot.bodies.find((b) => b.id === 'probe')!.placement as { speed: number; angle: number; time: number };
  return Level.parse({
    id: 'slingshot', title: 'Grand Tour', briefing: 'Swing past Jove and reach Rime.',
    spec: { ...clone(slingshot), tunables: [] }, player: 'probe',
    controls: [
      { path: 'bodies.probe.placement.speed', label: 'Power', min: 1.5, max: 3.5 },
      { path: 'bodies.probe.placement.angle', label: 'Aim', min: -40, max: 40 },
      { path: 'bodies.probe.placement.time', label: 'Launch time', min: 0, max: 1 },
    ],
    par: 4,
    solution: { values: [probe.speed, probe.angle, probe.time], pieces: [] },
  });
}
