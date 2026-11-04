/**
 * The player's own AI keys: which provider designs levels (text) and which makes 3D looks for
 * workbench parts (mesh). Kept in this browser and sent to this game's server with each request,
 * which uses them for that request only.
 */
import { create } from 'zustand';

export interface ProviderChoice { provider: string; key: string; model?: string; url?: string }

interface Providers {
  text: ProviderChoice | null;
  mesh: ProviderChoice | null;
  /** This server makes 3D looks on its own key today (it says so in /api/providers). */
  serverMesh: boolean;
  choose(kind: 'text' | 'mesh', choice: ProviderChoice | null): void;
}

const KEY = 'pg.providers';
const clean = (v: unknown): ProviderChoice | null => {
  const c = v as Partial<ProviderChoice> | null;
  if (!c || typeof c.provider !== 'string' || typeof c.key !== 'string') return null;
  const str = (s: unknown, max: number) => (typeof s === 'string' && s.trim() ? s.trim().slice(0, max) : undefined);
  return { provider: c.provider.slice(0, 40), key: c.key.trim().slice(0, 400), model: str(c.model, 100), url: str(c.url, 300) };
};

function load(): Pick<Providers, 'text' | 'mesh'> {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    return { text: clean(saved?.text), mesh: clean(saved?.mesh) };
  } catch { return { text: null, mesh: null }; }
}

export const useProviders = create<Providers>((set, get) => ({
  ...load(),
  serverMesh: false,
  choose(kind, choice) {
    set({ [kind]: choice && clean(choice) } as Partial<Providers>);
    const { text, mesh } = get();
    try { localStorage.setItem(KEY, JSON.stringify({ text, mesh })); } catch { /* private mode */ }
  },
}));

/** The headers that carry the player's keys; none for a provider without a key. */
export function providerHeaders(): Record<string, string> {
  const out: Record<string, string> = {};
  const { text, mesh } = useProviders.getState();
  for (const [kind, c] of [['text', text], ['mesh', mesh]] as const) {
    if (!c?.key) continue;
    out[`x-pg-${kind}-provider`] = c.provider;
    out[`x-pg-${kind}-key`] = c.key;
    if (c.model) out[`x-pg-${kind}-model`] = c.model;
    if (c.url) out[`x-pg-${kind}-url`] = c.url;
  }
  return out;
}

/** Whether a workbench part can get a 3D look: on the player's key, or the server's. */
export const hasMeshProvider = () => { const s = useProviders.getState(); return !!s.mesh?.key || s.serverMesh; };
