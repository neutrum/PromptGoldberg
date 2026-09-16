import { useEffect, useState } from 'react';
import { useCurrentAttempt, useStore } from '../store';

/** Raw JSON editing of the current system; each run becomes a new attempt. */
export function SpecEditor({ onClose }: { onClose: () => void }) {
  const attempt = useCurrentAttempt();
  const loadSpec = useStore((s) => s.loadSpec);
  const error = useStore((s) => s.error);
  const status = useStore((s) => s.status);
  const [text, setText] = useState('');
  const [parseError, setParseError] = useState<string | null>(null);

  useEffect(() => {
    if (attempt) setText(JSON.stringify(attempt.run.spec, null, 2));
  }, [attempt]);

  const run = () => {
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch (err) {
      setParseError(err instanceof Error ? err.message : String(err));
      return;
    }
    setParseError(null);
    void loadSpec(json, 'Manual edit');
  };

  return (
    <div className="panel spec-editor">
      <div className="panel-title">
        System JSON
        <button onClick={onClose} title="Close">✕</button>
      </div>
      <textarea spellCheck={false} value={text} onChange={(e) => setText(e.target.value)} />
      {(parseError || (status === 'error' && error)) && <pre className="error">{parseError ?? error}</pre>}
      <button className="primary" onClick={run} disabled={status === 'simulating'}>
        {status === 'simulating' ? 'Simulating…' : 'Run as new attempt'}
      </button>
    </div>
  );
}
