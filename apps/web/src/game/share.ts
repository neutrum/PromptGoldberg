import { parseLevel, type Level } from '@og/shared';

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): string {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

/** A link that carries the whole level, so sharing needs no server. */
export function levelLink(level: Level): string {
  return `${location.origin}${location.pathname}#level=${toBase64Url(JSON.stringify(level))}`;
}

export function galleryLink(id: string): string {
  return `${location.origin}${location.pathname}#gallery=${encodeURIComponent(id)}`;
}

export type HashTarget = { kind: 'level'; level: Level } | { kind: 'gallery'; id: string } | null;

/** `?tutorial=off` (or `#tutorial=off`) turns the coach marks off for this browser. */
export function readTutorialSwitch(): boolean | null {
  const value = new URLSearchParams(location.search).get('tutorial')
    ?? new URLSearchParams(location.hash.slice(1)).get('tutorial');
  return value === null ? null : value !== 'off';
}

export function readHash(): HashTarget {
  const params = new URLSearchParams(location.hash.slice(1));
  try {
    const raw = params.get('level');
    if (raw) {
      const parsed = parseLevel(JSON.parse(fromBase64Url(raw)));
      return parsed.ok ? { kind: 'level', level: parsed.level } : null;
    }
    const id = params.get('gallery');
    if (id) return { kind: 'gallery', id };
  } catch {
    return null;
  }
  return null;
}

export function clearHash() {
  if (location.hash) history.replaceState(null, '', location.pathname + location.search);
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
