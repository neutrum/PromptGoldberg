import { useEffect, useState } from 'react';
import type { ProviderInfo } from '@pg/client';
import { api } from '../app/api';
import { useProviders } from './providers';

/** One kind of provider: pick it, paste a key, and (for text) a model and a test. */
function ProviderPick({ kind, list, fallback }: { kind: 'text' | 'mesh'; list: ProviderInfo[]; fallback: string }) {
  const choice = useProviders((s) => s[kind]);
  const choose = useProviders((s) => s.choose);
  const [test, setTest] = useState<string | null>(null);
  const info = list.find((p) => p.id === choice?.provider);
  const set = (patch: Partial<NonNullable<typeof choice>>) => { setTest(null); choose(kind, { provider: choice?.provider ?? '', key: '', ...choice, ...patch }); };
  const run = async () => {
    setTest('Testing…');
    try { const r = await api.testProvider(); setTest(r.ok ? `✓ The key works (${(r.ms / 1000).toFixed(1)} s).` : 'It answered, but not as asked: levels may fail with this model.'); }
    catch (err) { setTest(`✗ ${err instanceof Error ? err.message : String(err)}`); }
  };
  return (
    <div className="provider-pick">
      <select value={choice?.provider ?? ''} onChange={(e) => { setTest(null); choose(kind, e.target.value ? { provider: e.target.value, key: '' } : null); }} aria-label={kind === 'text' ? 'AI for levels' : 'AI for 3D models'}>
        <option value="">{fallback}</option>
        {list.filter((p) => p.kind === kind).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      {info && <>
        {info.note && <p className="settings-note">{info.note}</p>}
        <label><span>Key <a href={info.keyUrl} target="_blank" rel="noreferrer">get one →</a></span>
          <input type="password" autoComplete="off" spellCheck={false} value={choice?.key ?? ''} placeholder={info.keyHint} onChange={(e) => set({ key: e.target.value })} />
        </label>
        {info.needsUrl && <label>API address<input value={choice?.url ?? ''} placeholder="https://openrouter.ai/api/v1" onChange={(e) => set({ url: e.target.value })} /></label>}
        {kind === 'text' && <label>Model
          <input list={`models-${info.id}`} value={choice?.model ?? ''} placeholder={info.defaultModel || (info.needsUrl ? 'the provider’s model name' : 'the game’s choice')} onChange={(e) => set({ model: e.target.value })} />
          <datalist id={`models-${info.id}`}>{info.models?.map((m) => <option key={m} value={m} />)}</datalist>
        </label>}
        {kind === 'text' && <div className="chip-row"><button type="button" disabled={!choice?.key || test === 'Testing…'} onClick={() => void run()}>Test the key</button>{test && <span className="settings-note" role="status">{test}</span>}</div>}
      </>}
    </div>
  );
}

/** Bring your own keys: which AI designs levels and which makes 3D looks for workbench parts. */
export function ProvidersSettings() {
  const [list, setList] = useState<{ server: string | null; providers: ProviderInfo[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { api.providers().then(setList, (err: unknown) => setError(err instanceof Error ? err.message : String(err))); }, []);
  return (
    <section>
      <h3>AI providers</h3>
      <p className="settings-note">Use your own key. It stays in this browser and goes to this game’s server with each request, which uses it for that request only and never stores it. Use on your key is billed to you by the provider.</p>
      {error && <p className="settings-note">{error}</p>}
      {list && <>
        <h4>Levels and workbench parts</h4>
        <ProviderPick kind="text" list={list.providers} fallback={list.server ? 'The game’s own AI' : 'None: levels are built from the words, without AI'} />
        <h4>3D looks for workbench parts</h4>
        <ProviderPick kind="mesh" list={list.providers} fallback="Off: parts are drawn as their shapes" />
      </>}
    </section>
  );
}
