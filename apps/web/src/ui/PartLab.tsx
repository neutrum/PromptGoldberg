import { useEffect, useRef, useState } from 'react';
import { collides, type GadgetTest, type LandmarkShape, type Part } from '@pg/core';
import { api } from '../app/api';
import { useMachine } from '../app/game';

const VERDICT: Record<GadgetTest['verdict'], { icon: string; label: string; color: string }> = {
  through: { icon: '✓', label: 'The ball gets through', color: '#8fd18a' },
  stops: { icon: '■', label: 'The ball stops', color: '#f0b33e' },
  'falls-off': { icon: '↘', label: 'The ball falls off', color: '#e2603f' },
  misses: { icon: '∅', label: 'The ball never meets it', color: '#e2603f' },
};

/** Cells to pixels: along runs left to right; the second axis is up (side view) or across (top view). */
const S = 46, W = 6.4 * S, PAD = 14;

/** One view of the part with the ball's path drawn and a ball running along it. */
function View({ shapes, test, side, t }: { shapes: LandmarkShape[]; test: GadgetTest | null; side: boolean; t: number }) {
  const H = side ? 4.2 * S : 3.6 * S;
  const x = (along: number) => PAD + (along + 3.2) * S;
  const y = side ? (up: number) => PAD + H - up * S : (across: number) => PAD + H / 2 + across * S;
  const solid = shapes.filter((s) => collides(s, true));
  const pts = test?.path ?? [];
  const at = pts.length ? pts[Math.min(pts.length - 1, Math.floor(t * pts.length))] : null;
  return (
    <svg viewBox={`0 0 ${W + PAD * 2} ${H + PAD * 2}`} className="lab-view" role="img" aria-label={side ? 'Side view of the part and the ball’s path' : 'Top view of the part and the ball’s path'}>
      <text x={PAD} y={PAD - 2} className="lab-axis">{side ? 'SIDE' : 'TOP'} · along →</text>
      {side && <line x1={PAD} x2={W + PAD} y1={y(0)} y2={y(0)} className="lab-floor" />}
      {shapes.map((s, i) => {
        const [a, h, b] = s.size, drawn = !solid.includes(s);
        if (side) {
          if (s.shape !== 'box') return <rect key={i} x={x(s.at[0] - a / 2)} y={y(s.at[1] + (s.shape === 'sphere' ? a : h))} width={a * S} height={(s.shape === 'sphere' ? a : h) * S} rx={s.shape === 'sphere' ? a * S / 2 : 3} fill={s.color} opacity={drawn ? 0.35 : 0.9} />;
          // A box leans about the middle of its bottom face; a turned one is seen at an angle, so shorter and less steep.
          const turn = ((s.turn ?? 0) * Math.PI) / 180, long = Math.abs(a * Math.cos(turn)) + Math.abs(b * Math.sin(turn));
          const lean = (Math.atan(Math.tan(((s.tilt ?? 0) * Math.PI) / 180) * Math.cos(turn)) * 180) / Math.PI;
          return <rect key={i} x={x(s.at[0] - long / 2)} y={y(s.at[1] + h)} width={long * S} height={h * S} rx={2} fill={s.color} opacity={drawn ? 0.35 : 0.9} transform={`rotate(${lean} ${x(s.at[0])} ${y(s.at[1])})`} />;
        }
        return s.shape === 'box'
          ? <rect key={i} x={x(s.at[0] - a / 2)} y={y(s.at[2] - b / 2)} width={a * S} height={b * S} rx={2} fill={s.color} opacity={drawn ? 0.3 : 0.75} transform={`rotate(${s.turn ?? 0} ${x(s.at[0])} ${y(s.at[2])})`} />
          : <circle key={i} cx={x(s.at[0])} cy={y(s.at[2])} r={a * S / 2} fill={s.color} opacity={drawn ? 0.3 : 0.75} />;
      })}
      {pts.length > 1 && <polyline className="lab-path" points={pts.map((p) => `${x(p[0])},${y(side ? p[1] : p[2])}`).join(' ')} />}
      {test && <circle cx={x(test.drop[0])} cy={y(side ? test.drop[1] : test.drop[2])} r={6} className="lab-drop" />}
      {at && <circle cx={x(at[0])} cy={y(side ? at[1] : at[2])} r={0.32 * S} className="lab-ball" />}
    </svg>
  );
}

/** The workbench test lab for one kit part: drop a ball on it, watch, fix it in words, run it again. */
export function PartLab({ part, onClose }: { part: Part; onClose: () => void }) {
  const [shapes, setShapes] = useState<LandmarkShape[]>(part.build ?? []);
  const [test, setTest] = useState<GadgetTest | null>(null);
  const [busy, setBusy] = useState<string | null>('Dropping a ball on it…');
  const [error, setError] = useState<string | null>(null);
  const [change, setChange] = useState('');
  const [t, setT] = useState(0);
  const run = useRef(0);
  const name = part.label ?? 'part';

  const play = () => {
    const mine = ++run.current, start = performance.now();
    const tick = (now: number) => { if (mine !== run.current) return; const p = Math.min(1, (now - start) / 4000); setT(p); if (p < 1) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  };
  const check = async (s: LandmarkShape[]) => {
    setBusy('Dropping a ball on it…'); setError(null);
    try { const r = await api.labTest({ name, shapes: s }); setTest(r); setChange(r.suggestion ?? ''); play(); }
    catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(null); }
  };
  useEffect(() => { void check(shapes); return () => { run.current++; }; }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopImmediatePropagation(); onClose(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const fix = async () => {
    if (!change.trim() || busy) return;
    setBusy('The AI is changing the part, then the lab tests it…'); setError(null);
    try {
      const g = await api.fixPart({ name, shapes, change: change.trim(), ...(part.library ? { library: part.library } : {}) });
      setShapes(g.shapes);
      useMachine.getState().reshapeKitPart(part.id, g.shapes);
      if (g.test) { setTest(g.test); setChange(g.test.suggestion ?? ''); play(); }
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(null); }
  };

  const v = test && VERDICT[test.verdict];
  return (
    <div className="lab-backdrop" role="dialog" aria-modal="true" aria-label={`Test lab: ${name}`} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="lab">
        <button className="dialog-close" onClick={onClose} aria-label="Close">×</button>
        <span className="eyebrow">🧪 WORKBENCH TEST LAB</span>
        <h2>{name}</h2>
        <p className="lab-intro">A ball is dropped on the high end of the part. It passes when the ball comes out of the low end.</p>
        <div className="lab-views"><View shapes={shapes} test={test} side t={t} /><View shapes={shapes} test={test} side={false} t={t} /></div>
        {v && <div className="lab-verdict" style={{ borderColor: v.color }}><b style={{ color: v.color }}>{v.icon} {v.label}</b><span>{test!.message}</span></div>}
        {busy && <p className="lab-busy" role="status">◌ {busy}</p>}
        {error && <p className="mnote" role="alert">{error}</p>}
        <form className="lab-fix" onSubmit={(e) => { e.preventDefault(); void fix(); }}>
          <input value={change} onChange={(e) => setChange(e.target.value)} placeholder="Fix it in words, e.g. “add a rail on the left”" maxLength={200} disabled={!!busy} aria-label="Fix the part in words" />
          <button className="primary" disabled={!!busy || !change.trim()}>Fix it →</button>
        </form>
        <div className="lab-actions"><button type="button" onClick={() => void check(shapes)} disabled={!!busy}>↻ Drop the ball again</button><button type="button" onClick={play} disabled={!test}>▶ Watch it again</button></div>
      </div>
    </div>
  );
}
