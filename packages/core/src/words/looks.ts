/**
 * Looks by words, with no AI: "make it night", "sunset", "make it snowy", "autumn". Only when that
 * is the whole request; anything more ("night, and add a castle") goes to the AI as a change.
 * The world's colours change; its parts, the ball, the goal and the player's parts do not.
 */
import { Landscape, type LandscapeInput } from '../landscape';

type Look = 'night' | 'day' | 'sunset' | 'snow' | 'autumn' | 'spring';

const LOOKS: [RegExp, Look][] = [
  [/^(night|night ?time|midnight|dark|evening|after dark)$/, 'night'],
  [/^(day|day ?time|daylight|morning|noon|midday|sunny|light|bright)$/, 'day'],
  [/^(sunset|sundown|dusk|golden hour|sunrise|dawn)$/, 'sunset'],
  [/^(snowy|snow|winter|wintry|wintery|frosty|icy)$/, 'snow'],
  [/^(autumn|autumnal|fall)$/, 'autumn'],
  [/^(spring|summer|green|lush)$/, 'spring'],
];
const NOTE: Record<Look, string> = {
  night: 'Night falls.', day: 'Daylight again.', sunset: 'The sun is setting.', snow: 'Snow has fallen.', autumn: 'Autumn colours.', spring: 'Green and fresh.',
};

/** A level with no world of its own gets this plain one to change. */
const PLAIN: LandscapeInput = {
  name: 'Open field', sky: '#8ec5e8', ground: '#d9a86a', land: '#8fae6a', rock: '#8a8f98', water: '#3a8fc0', foliage: '#3f7a4a', accent: '#e2603f',
  features: [{ kind: 'bushes', amount: 'few' }],
};

const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const hex = (c: number[]) => `#${c.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('')}`;
/** Every channel times k: night darkens by 0.5, day undoes it. */
const scale = (h: string, k: number) => hex(rgb(h).map((v) => v * k));
/** Part of the way toward another colour. */
const mix = (h: string, to: string, t: number) => { const a = rgb(h), b = rgb(to); return hex(a.map((v, i) => v + (b[i] - v) * t)); };

/** What the words ask for, when they are only a look: "make it night", "turn it snowy", "sunset please". */
export function lookIn(text: string): Look | null {
  const words = text.toLowerCase().trim().replace(/[.!?]+$/, '')
    .replace(/^(please\s+)?(make|set|turn|change|switch)\s+(it|this|the (level|world|scene|place|map|board))?\s*(to|into)?\s*/, '')
    .replace(/^(it'?s|it is)\s+/, '')
    .replace(/\s+please$/, '')
    .replace(/^(at|a|an|the)\s+/, '')
    .replace(/\s+(time|scene|world|theme|look|mode)$/, '')
    .trim();
  return LOOKS.find(([re]) => re.test(words))?.[1] ?? null;
}

/** The world after a look by words, or null when the words are more than a look. */
export function looksFromWords(text: string, world: LandscapeInput | undefined): { landscape: Landscape; note: string } | null {
  const look = lookIn(text);
  if (!look) return null;
  const w = Landscape.parse(world ?? PLAIN);
  const has = (k: string) => w.features.some((f) => f.kind === k);
  const add = (k: Landscape['features'][number]['kind']) => (has(k) || w.features.length >= 8 ? w.features : [...w.features, { kind: k, amount: 'some' as const }]);
  const each = (f: (h: string) => string) => ({ ground: f(w.ground), land: f(w.land), rock: f(w.rock), water: f(w.water), foliage: f(w.foliage) });
  const next: Landscape = (() => {
    switch (look) {
      case 'night': return { ...w, ...each((h) => scale(h, 0.5)), sky: '#121a30', features: add('lanterns') };
      case 'day': return { ...w, ...(rgb(w.sky).reduce((a, b) => a + b) < 200 ? each((h) => scale(h, 2)) : {}), sky: '#8ec5e8' };
      case 'sunset': return { ...w, ...each((h) => mix(h, '#ff9a4a', 0.18)), sky: '#f0905a' };
      case 'snow': return { ...w, land: '#eef3f6', ground: mix(w.ground, '#ffffff', 0.45), rock: mix(w.rock, '#ffffff', 0.3), sky: '#c9d8e4', snow: true, features: add('snowdrifts') };
      case 'autumn': return { ...w, foliage: '#d9822b', land: mix(w.land, '#b07a3a', 0.5) };
      case 'spring': return { ...w, foliage: '#4caf50', land: mix(w.land, '#7cc35a', 0.5), snow: false };
    }
  })();
  return { landscape: Landscape.parse(next), note: NOTE[look] };
}
