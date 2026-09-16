/** Fixed-window counters per key: a per-minute and a per-day window. In memory; resets on restart. */
export class RateLimiter {
  private minute = new Map<string, { start: number; count: number }>();
  private day = new Map<string, { start: number; count: number }>();

  constructor(
    readonly perMinute: number,
    readonly perDay: number,
    private now: () => number = Date.now,
  ) {}

  /** Consume one unit for `key`. Returns null when allowed, else a reason and retry delay. */
  take(key: string): { error: string; retryAfterS: number } | null {
    const t = this.now();
    const m = window(this.minute, key, t, 60_000);
    const d = window(this.day, key, t, 86_400_000);
    if (d.count >= this.perDay) {
      return { error: `Daily limit reached (${this.perDay} requests per day). Try again tomorrow.`, retryAfterS: Math.ceil((d.start + 86_400_000 - t) / 1000) };
    }
    if (m.count >= this.perMinute) {
      return { error: `Slow down: at most ${this.perMinute} requests per minute.`, retryAfterS: Math.ceil((m.start + 60_000 - t) / 1000) };
    }
    m.count++;
    d.count++;
    if (this.day.size > 10_000) this.prune(t);
    return null;
  }

  private prune(t: number) {
    for (const [k, v] of this.minute) if (t - v.start >= 60_000) this.minute.delete(k);
    for (const [k, v] of this.day) if (t - v.start >= 86_400_000) this.day.delete(k);
  }
}

function window(map: Map<string, { start: number; count: number }>, key: string, t: number, span: number) {
  let w = map.get(key);
  if (!w || t - w.start >= span) {
    w = { start: t, count: 0 };
    map.set(key, w);
  }
  return w;
}

/** Global cap on LLM calls per UTC day. */
export class DailyCap {
  private dayKey = '';
  private count = 0;

  constructor(readonly cap: number, private now: () => number = Date.now) {}

  private roll() {
    const key = new Date(this.now()).toISOString().slice(0, 10);
    if (key !== this.dayKey) {
      this.dayKey = key;
      this.count = 0;
    }
  }

  get used(): number {
    this.roll();
    return this.count;
  }

  /** Returns false (and does not count) when the cap is reached. */
  take(): boolean {
    this.roll();
    if (this.count >= this.cap) return false;
    this.count++;
    return true;
  }
}
