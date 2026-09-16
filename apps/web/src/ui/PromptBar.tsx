import { useState } from 'react';
import { design } from '../api';
import { useStore } from '../store';

const EXAMPLES = [
  'A moon that eclipses its sun every 3 days.',
  'Send a probe to the outer planet using two slingshots.',
  'A rogue planet passes through and steals a moon.',
];

export function PromptBar() {
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const loadSpec = useStore((s) => s.loadSpec);

  const submit = async (text: string) => {
    if (!text.trim() || busy) return;
    setBusy(true);
    setMessage(null);
    setInfo(null);
    try {
      const res = await design(text);
      await loadSpec(res.spec, 'AI design', { replace: true });
      if (res.tuned) await loadSpec(res.tuned.spec, `Tuned (${res.tuned.evals} sims)`);
      const tokens = res.usage.reduce((sum, u) => sum + (u.inputTokens ?? 0) + (u.outputTokens ?? 0), 0);
      const outcome = res.goal.success ? 'goal reached as designed' : res.tuned?.goal.success ? 'goal reached after tuning' : 'goal not reached yet';
      setInfo(`${outcome} · ${res.usage.length} call(s) via ${res.usage[0]?.backend ?? '?'} · ${tokens.toLocaleString()} tokens${res.notes.length ? ` · ${res.notes.length} auto-fixes` : ''}`);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="prompt-bar">
      <form onSubmit={(e) => { e.preventDefault(); void submit(prompt); }}>
        <input
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Describe a cosmic chain reaction…"
          disabled={busy}
        />
        <button className="primary" disabled={busy || !prompt.trim()}>{busy ? 'Designing… (up to a minute)' : 'Build'}</button>
      </form>
      <div className="examples">
        {EXAMPLES.map((ex) => (
          <button key={ex} onClick={() => setPrompt(ex)}>{ex}</button>
        ))}
      </div>
      {message && <div className="prompt-message">{message}</div>}
      {info && <div className="prompt-info">{info}</div>}
    </div>
  );
}
