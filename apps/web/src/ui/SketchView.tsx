import type { SketchBody } from '@og/shared';
import { useEffect, useState } from 'react';

const DEFAULT_COLOR: Record<string, string> = {
  star: '#ffd27a', planet: '#7aa8ff', moon: '#c9c9d6', asteroid: '#a89f91', comet: '#8ef0e0', probe: '#ffffff',
};
const SIZE: Record<string, number> = { star: 7, planet: 3.6, moon: 2, asteroid: 1.6, comet: 2, probe: 1.8 };

/** Seconds since mount, updated every animation frame. */
function useClock(): number {
  const [t, setT] = useState(0);
  useEffect(() => {
    const t0 = performance.now();
    let raf = 0;
    const tick = () => {
      setT((performance.now() - t0) / 1000);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  return t;
}

interface Node {
  body: SketchBody;
  children: Node[];
}

/**
 * The star system as Claude writes it: each body appears the moment its JSON is complete and
 * circles its parent (orbit radius on a square-root scale so inner and outer worlds both fit).
 */
export function SketchView({ bodies, title, thinking }: { bodies: SketchBody[]; title?: string; thinking?: boolean }) {
  const t = useClock();
  const nodes = new Map<string, Node>(bodies.map((b) => [b.id, { body: b, children: [] }]));
  const roots: Node[] = [];
  for (const n of nodes.values()) {
    const parent = n.body.parent ? nodes.get(n.body.parent) : undefined;
    if (parent && parent !== n) parent.children.push(n);
    else roots.push(n);
  }
  const stars = roots.filter((r) => r.body.type === 'star');
  const center = stars[0];
  const planets = [...(center?.children ?? []), ...roots.filter((r) => r !== center && r.body.type !== 'star')];
  const aMax = Math.max(1e-9, ...planets.map((p) => p.body.a ?? 1));
  const aMin = Math.max(1e-9, Math.min(...planets.map((p) => p.body.a ?? aMax)));
  const orbitR = (a = aMax) => 22 + 70 * Math.sqrt(a / aMax);
  const period = (a = aMax) => Math.min(140, Math.max(14, 16 * (a / aMin) ** 1.5));

  const orbits: React.ReactNode[] = [];
  const dots: React.ReactNode[] = [];
  const dot = (b: SketchBody, x: number, y: number) => {
    const color = b.color ?? DEFAULT_COLOR[b.type] ?? '#ffffff';
    const r = b.launched ? SIZE.probe : SIZE[b.type] ?? 3;
    dots.push(
      <g key={b.id} transform={`translate(${x.toFixed(2)} ${y.toFixed(2)})`}>
        <g className="sketch-pop">
          {b.type === 'star' && <circle r={r * 2.2} fill={color} opacity={0.18} />}
          <circle r={r} fill={color} className={b.launched ? 'sketch-probe' : undefined} />
          <text y={-r - 3} textAnchor="middle" className="sketch-label">{b.launched ? `${b.name} (you)` : b.name}</text>
        </g>
      </g>,
    );
  };
  /** A body at (x, y) with its moons and launched probe circling it. */
  const place = (n: Node, x: number, y: number) => {
    n.children.forEach((c, k) => {
      const ring = 7 + 5 * k;
      const ang = ((c.body.phase ?? k * 97) + (360 * t) / (8 + 3 * k)) * (Math.PI / 180);
      orbits.push(<circle key={`o-${c.body.id}`} cx={x} cy={y} r={ring} className="sketch-orbit" />);
      place(c, x + ring * Math.cos(ang), y - ring * Math.sin(ang));
    });
    dot(n.body, x, y);
  };

  planets.forEach((p, k) => {
    const r = orbitR(p.body.a);
    const ang = ((p.body.phase ?? k * 137) + (360 * t) / period(p.body.a)) * (Math.PI / 180);
    orbits.push(<circle key={`o-${p.body.id}`} r={r} className="sketch-orbit" />);
    place(p, r * Math.cos(ang), -r * Math.sin(ang));
  });
  if (center) dot(center.body, 0, 0);
  stars.slice(1).forEach((s, k) => place(s, 14 * (k + 1), 0));

  return (
    <div className="sketch">
      <svg viewBox="-100 -100 200 200" role="img" aria-label={title ? `Sketch of ${title}` : 'Star system sketch'}>
        {orbits}
        {dots}
        {!center && thinking && <circle r={7} className="sketch-thinking" />}
      </svg>
      <div className="sketch-caption">
        {title && <strong>{title}</strong>}
        <span className="muted">
          {bodies.length === 0
            ? (thinking ? 'Claude is imagining your system…' : '')
            : `Claude has placed ${bodies.length} bod${bodies.length === 1 ? 'y' : 'ies'}${thinking ? '…' : ''}`}
        </span>
      </div>
    </div>
  );
}
