/** Tiny WebAudio synth: every sound is generated, so there are no audio assets to license. */
let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let muted = false;

function ac(): AudioContext | null {
  if (muted) return null;
  try {
    if (!ctx) {
      ctx = new AudioContext();
      master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

export function setMuted(m: boolean) {
  muted = m;
  if (m && ctx) void ctx.suspend();
}

function tone(freq: number, start: number, dur: number, type: OscillatorType = 'sine', gain = 0.3, slideTo?: number) {
  const c = ac();
  if (!c || !master) return;
  const t0 = c.currentTime + start;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(gain, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(master);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

function noise(start: number, dur: number, gain: number, from: number, to: number) {
  const c = ac();
  if (!c || !master) return;
  const t0 = c.currentTime + start;
  const buf = c.createBuffer(1, Math.ceil(c.sampleRate * dur), c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource();
  src.buffer = buf;
  const filter = c.createBiquadFilter();
  filter.type = 'bandpass';
  filter.Q.value = 0.8;
  filter.frequency.setValueAtTime(from, t0);
  filter.frequency.exponentialRampToValueAtTime(to, t0 + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(filter).connect(g).connect(master);
  src.start(t0);
}

const SCALE = [523.25, 587.33, 659.25, 783.99, 880, 1046.5, 1174.66, 1318.51];

let lastTick = 0;

export const sfx = {
  tick: () => {
    const now = performance.now();
    if (now - lastTick < 40) return;
    lastTick = now;
    tone(1400, 0, 0.03, 'square', 0.025);
  },
  launch: () => { noise(0, 0.7, 0.5, 300, 3000); tone(120, 0, 0.5, 'sawtooth', 0.08, 480); },
  /** Rising chime; `step` climbs the scale so a chain sounds like a melody. */
  checkpoint: (step: number) => {
    const f = SCALE[Math.min(step * 2, SCALE.length - 1)];
    tone(f, 0, 0.7, 'triangle', 0.25);
    tone(f * 2, 0.04, 0.45, 'sine', 0.08);
  },
  success: () => [0, 2, 4, 5, 7].forEach((k, i) => tone(SCALE[k], i * 0.09, 0.8, 'triangle', 0.2)),
  miss: () => { tone(392, 0, 0.25, 'triangle', 0.18, 330); tone(311, 0.22, 0.5, 'triangle', 0.18, 220); },
  crash: () => { noise(0, 1.2, 0.9, 2000, 60); tone(70, 0, 0.8, 'sine', 0.4, 35); },
  escape: () => tone(300, 0, 1.2, 'sine', 0.2, 1800),
  star: (i: number) => tone(880 * Math.pow(1.26, i), 0, 0.35, 'sine', 0.2),
  place: () => tone(220, 0, 0.25, 'sine', 0.3, 440),
  click: () => tone(660, 0, 0.06, 'triangle', 0.08),
  // Prompt Goldberg's parts: a baked sample when one is loaded (see loadSamples), else a synth stand-in.
  cannon: () => sample('cannon') || (noise(0, 0.35, 0.8, 1800, 80), tone(90, 0, 0.3, 'sine', 0.4, 40)),
  boing: () => sample('boing') || tone(180, 0, 0.35, 'sine', 0.3, 520),
  ding: () => sample('ding') || (tone(1318.5, 0, 1.2, 'sine', 0.25), tone(2637, 0, 0.6, 'sine', 0.06)),
  plop: () => sample('plop') || tone(300, 0, 0.18, 'sine', 0.3, 120),
  clack: () => sample('clack') || noise(0, 0.05, 0.4, 3000, 1500),
  whoosh: () => sample('whoosh') || noise(0, 0.6, 0.35, 400, 1600),
};

/** Sound effects baked once (ElevenLabs, see CREDITS.md) and served from /sfx; missing files fall back to the synth. */
const SAMPLE_NAMES = ['cannon', 'boing', 'ding', 'plop', 'clack', 'whoosh'] as const;
const samples = new Map<string, AudioBuffer>();
const lastPlayed = new Map<string, number>();
let loading: Promise<void> | null = null;

export function loadSamples(): Promise<void> {
  return (loading ??= (async () => {
    const c = ac();
    if (!c) return;
    await Promise.all(SAMPLE_NAMES.map(async (name) => {
      try {
        const res = await fetch(`/sfx/${name}.mp3`);
        if (!res.ok) return;
        samples.set(name, await c.decodeAudioData(await res.arrayBuffer()));
      } catch {
        // No sample: the synth plays instead.
      }
    }));
  })());
}

/** Play a baked sample; false when there is none (or it just played: a domino row is one clatter, not twenty). */
function sample(name: string): boolean {
  const c = ac();
  const buf = samples.get(name);
  if (!c || !master || !buf) {
    if (c && !loading) void loadSamples();
    return false;
  }
  const now = performance.now();
  if (now - (lastPlayed.get(name) ?? 0) < 90) return true;
  lastPlayed.set(name, now);
  const src = c.createBufferSource();
  src.buffer = buf;
  const g = c.createGain();
  g.gain.value = 0.8;
  src.connect(g).connect(master);
  src.start();
  return true;
}

/**
 * The engineer: short spoken lines at the moments that matter (a level starts, a run fails or
 * works, a hint). Baked once with ElevenLabs (see CREDITS.md) into /voice/<moment>-<n>.mp3,
 * fetched on first use, one line at a time, and off with the speech toggle.
 */
export const VOICE_LINES = {
  start: 4, build: 2, miss: 6, solve: 6, stars: 3, hint: 3, broke: 2, giveup: 2, daily: 1, board: 1, publish: 1,
} as const;
export type VoiceMoment = keyof typeof VOICE_LINES;

const VOICE_KEY = 'pg.voice';
let voiceOn = (() => { try { return localStorage.getItem(VOICE_KEY) !== '0'; } catch { return true; } })();
const voiceCache = new Map<string, Promise<AudioBuffer | null>>();
const lastLine = new Map<VoiceMoment, number>();
let speakingUntil = 0;

export const voice = {
  get on() { return voiceOn; },
  set(on: boolean) {
    voiceOn = on;
    try { localStorage.setItem(VOICE_KEY, on ? '1' : '0'); } catch { /* private mode */ }
  },
  /** Say a line for this moment (never the same one twice running, never over another line). */
  say(moment: VoiceMoment, delayS = 0) {
    const c = ac();
    if (!voiceOn || !c || !master) return;
    if (c.currentTime < speakingUntil) return;
    const n = VOICE_LINES[moment];
    let k = 1 + Math.floor(Math.random() * n);
    if (n > 1 && k === lastLine.get(moment)) k = (k % n) + 1;
    lastLine.set(moment, k);
    const name = `${moment}-${k}`;
    if (!voiceCache.has(name)) {
      voiceCache.set(name, fetch(`/voice/${name}.mp3`).then((r) => (r.ok ? r.arrayBuffer() : null)).then((b) => (b ? c.decodeAudioData(b) : null)).catch(() => null));
    }
    // Hold the slot while the line loads, so two moments in a row do not talk over each other.
    speakingUntil = c.currentTime + 1;
    void voiceCache.get(name)!.then((buf) => {
      if (!buf || !master || !voiceOn) return;
      const at = Math.max(c.currentTime, c.currentTime + delayS);
      speakingUntil = at + buf.duration;
      const src = c.createBufferSource();
      src.buffer = buf;
      const g = c.createGain();
      g.gain.value = 1.4;
      src.connect(g).connect(master);
      src.start(at);
    });
  },
};
