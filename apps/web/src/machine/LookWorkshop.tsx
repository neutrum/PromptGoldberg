import { useCallback, useEffect, useState } from 'react';
import { assemblePart, LOOK_KINDS, partNames, type LookKind, type MachineSpec } from '@og/machine';
import { ModelPreview, shapeSize } from './ModelVisual';
import { useMachine } from './machineStore';

interface Look { id: string; kind: LookKind; prompt: string; status: 'queued' | 'generating' | 'ready' | 'failed'; progress: number; error?: string; reused?: boolean }
interface Catalog { enabled: boolean; looks: Look[] }
async function request<T>(path: string, body?: object, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/api/looks${path}`, { method: body ? 'POST' : 'GET', headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined, signal });
  const data = await response.json(); if (!response.ok) throw Error(data.error ?? 'Custom looks are unavailable.'); return data;
}

export function LookWorkshop({ machine }: { machine: MachineSpec }) {
  const [open, setOpen] = useState(false);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const eligible = machine.parts.filter(p => (LOOK_KINDS as readonly string[]).includes(p.kind));
  const [selected, setSelected] = useState('');
  const part = eligible.find(p => p.id === selected) ?? eligible.find(p => p.kind === 'bell') ?? eligible[0];
  const [prompt, setPrompt] = useState('');
  const [job, setJob] = useState<Look | null>(null);
  const [target, setTarget] = useState<{ machine: MachineSpec; id: string } | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  const phase = useMachine(s => s.phase), editing = useMachine(s => s.ai.busy), pending = useMachine(s => s.pendingPart);
  const canApply = !editing && !pending && !['playing', 'simulating'].includes(phase);
  const names = partNames(machine.parts);
  useEffect(() => {
    if (!open) return;
    const abort = new AbortController();
    void request<Catalog>('', undefined, abort.signal).then(setCatalog).catch(() => { if (!abort.signal.aborted) setError('Custom looks are unavailable right now.'); });
    return () => abort.abort();
  }, [open]);
  useEffect(() => {
    if (!job || !['queued', 'generating'].includes(job.status)) return;
    const abort = new AbortController(); let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try { const next = await request<Look>(`/${job.id}`, undefined, abort.signal); setJob(next); setError('');
        if (next.status === 'ready') { const updated = await request<Catalog>('', undefined, abort.signal); setCatalog(updated); }
        else if (next.status === 'queued' || next.status === 'generating') timer = setTimeout(poll, 3000);
      } catch { if (!abort.signal.aborted) { setError('Connection interrupted. Checking again shortly…'); timer = setTimeout(poll, 6000); } }
    };
    timer = setTimeout(poll, 1500);
    return () => { abort.abort(); clearTimeout(timer); };
  }, [job?.id, job?.status]);
  const previewState = useCallback((loaded: boolean, message?: string) => { setReady(loaded); if (message) setError(message); }, []);
  if (!part) return null;
  const inProgress = busy || !!job && ['queued', 'generating'].includes(job.status);
  const choose = (look: Look) => { setJob({ ...look, reused: true }); setTarget({ machine, id: part.id }); setReady(false); setError(''); };
  const generate = async () => {
    setBusy(true); setError(''); setReady(false); setJob(null); setTarget({ machine, id: part.id });
    try { setJob(await request<Look>('', { kind: part.kind, prompt: prompt.trim() })); }
    catch (e) { setError(e instanceof Error ? e.message : 'Generation failed.'); }
    finally { setBusy(false); }
  };
  const previewPart = target?.machine.parts.find(p => p.id === target.id);
  const previewBody = previewPart && assemblePart(previewPart).bodies.find(b => !b.sensor);
  const changedScene = !!target && target.machine !== machine;
  return <details className="workshop-extra look-workshop" open={open} onToggle={e => setOpen(e.currentTarget.open)}>
    <summary>Give a part a new look</summary>
    {open && <div className="look-form">
      <p>Describe a new look for a part. It keeps its place and behavior in your machine.</p>
      <label>Choose a part<select value={part.id} disabled={inProgress} onChange={e => { setSelected(e.target.value); setJob(null); setTarget(null); setError(''); }}>
        {eligible.map(p => <option key={p.id} value={p.id}>{names.get(p.id)} · {p.kind === 'ball' ? 'marble' : p.kind}</option>)}
      </select></label>
      {catalog?.looks.some(look => look.kind === part.kind) && <label>Saved looks<select aria-label="Saved looks" value="" disabled={inProgress} onChange={e => { const look = catalog.looks.find(l => l.id === e.target.value); if (look) choose(look); }}>
        <option value="">Choose a saved look…</option>{catalog.looks.filter(l => l.kind === part.kind).map(l => <option key={l.id} value={l.id}>{l.prompt}</option>)}
      </select></label>}
      <form onSubmit={e => { e.preventDefault(); void generate(); }}>
        <label>Describe its appearance<textarea maxLength={280} rows={3} value={prompt} disabled={inProgress} onChange={e => setPrompt(e.target.value)} placeholder={part.kind === 'bell' ? 'A brass bell with a red wooden knob, like a handmade toy' : `A playful ${part.kind} made of warm wood and brass`} /></label>
        <button className="primary" disabled={!catalog?.enabled || inProgress || prompt.trim().length < 4}>Generate a look</button>
      </form>
      {catalog && !catalog.enabled && <p className="muted">New custom looks are unavailable right now. You can still use saved looks.</p>}
      {inProgress && <div role="status"><progress max={100} value={job?.progress ?? 0} /><p>Making your look{job?.progress ? ` · ${job.progress}%` : '…'}. Keep playing while it finishes.</p></div>}
      {job?.status === 'failed' && <p className="error-inline" role="alert">{job.error} Your current part is still here.</p>}
      {error && <p className="error-inline" role="alert">{error}</p>}
      {job?.status === 'ready' && previewBody && <>
        {job.reused && <p className="muted">Saved look reused — ready to try.</p>}
        <ModelPreview id={job.id} size={shapeSize(previewBody.shape)} onState={previewState} />
        <p className="muted">Drag the preview to inspect it. It still behaves like a {job.kind === 'ball' ? 'marble' : job.kind === 'dominoes' ? 'domino' : job.kind}.</p>
        {changedScene && <p>Your machine changed while this look was being made. Choose it from Saved looks to apply it to the current part.</p>}
        <div className="mactions"><button className="primary" disabled={!ready || !canApply || changedScene} onClick={() => {
          if (target && useMachine.getState().applyLook(target.id, job.id, target.machine)) { setJob(null); setTarget(null); }
        }}>Use this look</button><button onClick={() => { setJob(null); setTarget(null); setError(''); }}>Keep original</button></div>
      </>}
      {part.look && <button disabled={!canApply || inProgress} onClick={() => useMachine.getState().applyLook(part.id, null, machine)}>Restore original look</button>}
    </div>}
  </details>;
}
