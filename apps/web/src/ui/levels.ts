import { parseMachine, type MachineSpec } from '@pg/core';
import type { Level, SharedLevel } from '@pg/game';

export type { Level, SharedLevel } from '@pg/game';


interface LevelFile { level?: { emoji: string; name: string; mission: string; order?: number } }

async function squeeze(text: string): Promise<string> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  let bin = '';
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function unsqueeze(code: string): Promise<string> {
  const bin = atob(code.replace(/-/g, '+').replace(/_/g, '/'));
  const stream = new Blob([Uint8Array.from(bin, (c) => c.charCodeAt(0))]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Response(stream).text();
}

export async function shareLink(level: SharedLevel): Promise<string> {
  return `${location.origin}${location.pathname}#pg=${await squeeze(JSON.stringify(level))}`;
}

/** The level in the address bar's `#pg=` link, or null. */
export async function readShareLink(): Promise<SharedLevel | null> {
  const code = new URLSearchParams(location.hash.slice(1)).get('pg');
  if (!code) return null;
  try {
    const raw = JSON.parse(await unsqueeze(code)) as Partial<SharedLevel>;
    const parsed = parseMachine(raw.spec);
    if (!parsed.ok) return null;
    // The sender's score is drawn as stars and counts: only sane numbers, whatever the link says.
    const n = (v: unknown, max: number) => Math.max(0, Math.min(max, Math.round(Number(v)) || 0));
    const score = raw.score && { stars: n(raw.score.stars, 3), tries: n(raw.score.tries, 999), parts: n(raw.score.parts, 99) };
    return { mission: String(raw.mission ?? parsed.spec.title).slice(0, 300), spec: parsed.spec, verified: raw.verified !== false, score };
  } catch {
    return null;
  }
}

export function clearShareLink() {
  if (location.hash) history.replaceState(null, '', location.pathname + location.search);
}

/** A community level from the server, played like an example level (its slug is its id, "m-..."). */
export function galleryAsLevel(item: { id: string; title: string; mission: string; machine: MachineSpec }): Level {
  return { slug: item.id, emoji: '🌍', name: item.title, mission: item.mission || item.title, order: 0, spec: item.machine, verified: true, gallery: true };
}

/** A shared level, played like an example level. */
export function sharedAsLevel(shared: SharedLevel): Level {
  return { slug: 'shared', emoji: '🔗', name: shared.spec.title, mission: shared.mission, order: 0, spec: shared.spec, verified: shared.verified };
}

const files = import.meta.glob('../../../../packages/core/src/fixtures/levels/*.json', { eager: true, import: 'default' }) as Record<string, unknown>;

export const LEVELS: Level[] = Object.entries(files)
  .flatMap(([path, raw]) => {
    const meta = (raw as LevelFile).level;
    const parsed = parseMachine(raw);
    if (!meta || !parsed.ok) return [];
    return [{ slug: /([^/]+)\.json$/.exec(path)?.[1] ?? path, emoji: meta.emoji, name: meta.name, mission: meta.mission, order: meta.order ?? 99, spec: parsed.spec, builtIn: true }];
  })
  .sort((a, b) => a.order - b.order);
