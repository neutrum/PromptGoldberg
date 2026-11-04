/**
 * The providers a player can bring a key for. Adding one is one file and one line here (or a
 * host calls registerProvider at start-up); the settings screen lists whatever is registered.
 */
import { LlmError, type LlmBackend } from '../llm/client';
import { anthropic } from './anthropic';
import { meshy } from './meshy';
import { compatible, openai } from './openai';
import { tripo } from './tripo';
import { infoOf, type MeshMaker, type MeshProvider, type Provider, type ProviderConfig, type ProviderInfo, type TextProvider } from './types';

export * from './types';
export { chatCompletions, publicEndpoint } from './openai';

const registry = new Map<string, Provider>();
export function registerProvider(p: Provider): void {
  registry.set(p.id, p);
}
for (const p of [anthropic, openai, compatible, tripo, meshy]) registerProvider(p);

export const listProviders = (): ProviderInfo[] => [...registry.values()].map(infoOf);

function find<K extends Provider['kind']>(kind: K, id: string): Extract<Provider, { kind: K }> {
  const p = registry.get(id);
  if (!p || p.kind !== kind) throw new LlmError(`Unknown ${kind === 'text' ? 'AI' : '3D model'} provider “${id.slice(0, 40)}”.`);
  return p as Extract<Provider, { kind: K }>;
}

/** A text backend on the player's key. */
export function textBackend(id: string, config: ProviderConfig): LlmBackend {
  if (!config.key) throw new LlmError('Add your key for this provider in Settings.');
  return (find('text', id) as TextProvider).create(config);
}

/** A mesh maker on the player's key, and where its finished models may be fetched from. */
export function meshMaker(id: string, config: ProviderConfig): MeshMaker & { provider: MeshProvider } {
  if (!config.key) throw new LlmError('Add your key for this provider in Settings.');
  const provider = find('mesh', id) as MeshProvider;
  return { ...provider.create(config), provider };
}

/** The biggest model a part may be drawn with. */
const MAX_GLB = 25 * 1024 * 1024;

/** Fetches a finished model from the provider's own HTTPS hosts (without the key) and checks it is a GLB. */
export async function downloadMesh(provider: MeshProvider, url: string, signal?: AbortSignal): Promise<Uint8Array> {
  const u = new URL(url);
  if (u.protocol !== 'https:' || !provider.downloadHosts.test(u.hostname)) throw new Error(`${provider.name} sent a model from an unexpected place.`);
  const res = await fetch(u, { signal: signal ?? AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`Could not fetch the model (${res.status}).`);
  if (Number(res.headers.get('content-length') ?? 0) > MAX_GLB) throw new Error('The model is too big.');
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.length > MAX_GLB) throw new Error('The model is too big.');
  if (new TextDecoder().decode(bytes.slice(0, 4)) !== 'glTF') throw new Error('The model is not a GLB file.');
  return bytes;
}
