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
};
