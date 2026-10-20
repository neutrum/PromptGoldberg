import { join } from 'node:path';
import { MachineSpec, parseMachine } from '@og/machine';
import sample from '@og/machine/fixtures/seesaw-cannon-bell.json' with { type: 'json' };
import type { CreateMachineResult, MachineRequest } from '@og/ai';
import { readJson, writeFileAtomic } from './files';

/** One generation per UTC day, shared by everyone; the client turns it into the fix-it puzzle. */
export interface DailyMachine {
  date: string;
  prompt: string;
  machine: MachineSpec;
  /** False when the AI was unavailable and a built-in machine stood in. */
  generated: boolean;
}

/** Day-indexed prompts; a failed design falls through to the next one. */
export const DAILY_PROMPTS = [
  'A long chain that ends with the bell ringing',
  'Get the ball into the bucket using a cannon and a trampoline',
  'A seesaw tips the ball into a row of dominoes that ring a bell',
  'The ball bounces twice before it lands in the bucket',
  'A fan pushes the ball off a high shelf into a bucket far below',
  'Knock over two rows of dominoes, then ring the bell',
  'Cannon, wall, bucket: the ball has to go over the wall',
  'The slowest machine you can build that still works',
  'A ramp, a seesaw, a fan and a bucket, in that order',
  'Ring the bell, then land in the bucket next to it',
  'Two trampolines and a cannon, ending in the bucket',
  'A machine for a rainy day: everything happens under a shelf',
  'Dominoes on a high shelf fall onto a bell below',
  'The ball visits a trampoline, a cannon and a seesaw before the bucket',
];

export const todayUtc = (now = new Date()) => now.toISOString().slice(0, 10);

const dayIndex = (date: string) => Math.floor(Date.parse(date) / 86_400_000);

export class DailyStore {
  private inflight = new Map<string, Promise<DailyMachine>>();

  /** `playable` says whether a machine can be turned into the day's puzzles; a machine that cannot is skipped. */
  constructor(
    private dir: string,
    private create: ((request: MachineRequest) => Promise<CreateMachineResult>) | null,
    private playable: (machine: MachineSpec) => Promise<boolean> = async () => true,
    /** Builds a level with no AI (the route compiler, from the prompt's words): the day still gets its own machine. */
    private offline: ((prompt: string) => Promise<CreateMachineResult>) | null = null,
  ) {}

  private file(date: string) {
    return join(this.dir, `${date}.json`);
  }

  /** Today's machine: from disk, else generated once (concurrent callers share the generation). */
  get(date = todayUtc()): Promise<DailyMachine> {
    const running = this.inflight.get(date);
    if (running) return running;
    const p = this.load(date).finally(() => this.inflight.delete(date));
    this.inflight.set(date, p);
    return p;
  }

  private async load(date: string): Promise<DailyMachine> {
    const cached = await readJson<DailyMachine>(this.file(date)).catch(() => undefined);
    if (cached && parseMachine(cached.machine).ok) return cached;
    const daily = await this.generate(date);
    if (daily.generated) await writeFileAtomic(this.file(date), JSON.stringify(daily)).catch(() => undefined);
    return daily;
  }

  private async generate(date: string): Promise<DailyMachine> {
    const start = dayIndex(date) % DAILY_PROMPTS.length;
    if (this.create) {
      for (let k = 0; k < 3; k++) {
        const prompt = DAILY_PROMPTS[(start + k) % DAILY_PROMPTS.length];
        try {
          const res = await this.create({ prompt });
          if (res.solved && (await this.playable(res.machine))) return { date, prompt, machine: res.machine, generated: true };
        } catch {
          // Try the next prompt; the fallback below always works.
        }
      }
    }
    if (this.offline) {
      try {
        const prompt = DAILY_PROMPTS[start];
        const res = await this.offline(prompt);
        if (res.solved && (await this.playable(res.machine))) {
          // Kept for the day like an AI one, so everyone gets the same machine.
          const daily = { date, prompt, machine: res.machine, generated: false };
          await writeFileAtomic(this.file(date), JSON.stringify(daily)).catch(() => undefined);
          return daily;
        }
      } catch {
        // The classic below always works.
      }
    }
    const machine = MachineSpec.parse({ ...sample, caption: 'The AI is resting today, so here is a classic.' });
    return { date, prompt: DAILY_PROMPTS[start], machine, generated: false };
  }
}
