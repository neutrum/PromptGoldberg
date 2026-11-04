import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, PerspectiveCamera, View } from '@react-three/drei';
import { CELL, landmarkSize, type CatalogItem, type LibraryRecipe, type RecipeStatus } from '@pg/core';
import { Recipe } from '../scene/Recipe3D';
import './review.css';

type Item = CatalogItem & { recipe?: LibraryRecipe };
type Filter = 'all' | RecipeStatus | 'missing';
const PAGE = 36;

async function call<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, body === undefined ? undefined : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
  return json as T;
}

/** The model on a 6 by 6 cell tile with the game's ball beside it for scale, framed to fit. */
function Model({ item, spin }: { item: Item; spin: boolean }) {
  const shapes = item.recipe!.shapes;
  const top = Math.max(1, ...shapes.map((s) => s.at[1] + (s.shape === 'sphere' ? s.size[0] : s.size[1]))) * CELL;
  const [w, d] = landmarkSize(shapes).map((c) => c * CELL);
  const reach = Math.max(top, w, d, 1.2);
  return (
    <>
      <PerspectiveCamera makeDefault position={[reach * 1.5, top * 0.6 + reach * 0.7, reach * 1.15]} fov={35} />
      <OrbitControls target={[0, top * 0.4, 0]} autoRotate={spin} autoRotateSpeed={2.5} enablePan={false} makeDefault />
      <ambientLight intensity={0.7} />
      <directionalLight position={[4, 8, 3]} intensity={1.6} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.002, 0]}><planeGeometry args={[6 * CELL, 6 * CELL]} /><meshStandardMaterial color="#2c3550" /></mesh>
      <gridHelper args={[6 * CELL, 6, '#56618a', '#3a4466']} position={[0, 0.001, 0]} />
      {/* The kit's ball (0.32 m), for scale. */}
      <mesh position={[0, 0.16, 1.7 * CELL]}><sphereGeometry args={[0.16, 16, 12]} /><meshStandardMaterial color="#f2f2f2" /></mesh>
      <Recipe shapes={shapes} unit={[CELL, CELL, CELL]} />
    </>
  );
}

function Card({ item, onChange, ai }: { item: Item; onChange: (it: Item) => void; ai: boolean }) {
  const [note, setNote] = useState(item.recipe?.note ?? '');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [spin, setSpin] = useState(false);
  const status = item.recipe?.status;
  const act = async (what: string, run: () => Promise<{ item: Item }>) => {
    setBusy(what); setError(null);
    try { onChange((await run()).item); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(null); }
  };
  const review = (s: RecipeStatus) => act(s, () => call(`/recipes/${item.id}/review`, { status: s, note: s === 'bad' ? note : undefined }));
  const redo = () => act('redo', () => call(`/recipes/${item.id}/redo`, { note }));
  return (
    <article className={`rcard ${status ?? 'missing'}`} onMouseEnter={() => setSpin(true)} onMouseLeave={() => setSpin(false)}>
      <header>
        <strong>{item.name}</strong>
        <span className="rgroup">{item.group}</span>
        <span className={`rbadge ${status ?? 'missing'}`}>{status ?? 'no recipe'}</span>
      </header>
      {item.recipe ? <View className="rview"><Model item={item} spin={spin} /></View> : <div className="rview empty">{busy === 'redo' ? 'Composing…' : 'Not composed yet'}</div>}
      <p className="rwords" title={item.words.join(', ')}>{item.words.slice(1).join(', ') || ' '}</p>
      <div className="ractions">
        <button className="good" disabled={!item.recipe || !!busy} onClick={() => review('good')} title="Keep it (G)">👍 Good</button>
        <button className="bad" disabled={!item.recipe || !!busy} onClick={() => review('bad')} title="Leave it out of the game (B)">👎 Bad</button>
        <button disabled={!ai || !!busy} onClick={redo} title="Compose again with the note">{busy === 'redo' ? '…' : item.recipe ? '↻ Redo' : '✨ Make'}</button>
      </div>
      <input className="rnote" value={note} onChange={(e) => setNote(e.target.value)} placeholder="What to fix: “longer neck”, “add the clock face”" maxLength={300}
        onKeyDown={(e) => { if (e.key === 'Enter' && note.trim()) void redo(); }} />
      {error && <p className="rerror">{error}</p>}
      {item.recipe && <p className="rmeta">{item.recipe.shapes.length} shapes · {landmarkSize(item.recipe.shapes).join(' × ')} cells</p>}
    </article>
  );
}

type Job = { running: boolean; total: number; done: number; failed: string[]; seconds: number; error?: string } | null;

/** Composing in the background: start it here, watch it fill in, stop it. The page reloads the library as batches land. */
function FillBar({ missing, bad, ai, onProgress }: { missing: number; bad: number; ai: boolean; onProgress: () => void }) {
  const [job, setJob] = useState<Job>(null);
  const seen = useRef(0);
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      const r = await call<{ job: Job }>('/recipes/fill').catch(() => null);
      if (!alive || !r) return;
      setJob(r.job);
      if (r.job && r.job.done !== seen.current) { seen.current = r.job.done; onProgress(); }
    };
    void tick();
    const t = setInterval(tick, job?.running ? 4000 : 15000);
    return () => { alive = false; clearInterval(t); };
  }, [job?.running, onProgress]);
  const start = (bad: boolean) => call<{ job: Job }>('/recipes/fill', { bad }).then((r) => setJob(r.job)).catch(() => {});
  if (job?.running) {
    const left = job.done > 0 ? Math.round((job.seconds / job.done) * (job.total - job.done) / 60) : null;
    return (
      <div className="rfill">
        <span>Composing {job.done} of {job.total}{left !== null ? ` · about ${left} min left` : ''}…</span>
        <progress max={job.total || 1} value={job.done} />
        <button onClick={() => void call('/recipes/fill/stop', {}).then(() => setJob({ ...job, running: false }))}>Stop</button>
      </div>
    );
  }
  return (
    <div className="rfill">
      {ai && missing > 0 && <button className="primary" onClick={() => void start(false)}>✨ Compose the {missing} missing</button>}
      {ai && bad > 0 && <button onClick={() => void start(true)}>↻ Redo the {bad} bad ones (with their notes)</button>}
      {job && !job.running && job.total > 0 && <span>Last run: {job.done} of {job.total} composed in {Math.round(job.seconds / 60)} min{job.failed.length ? `; ${job.failed.length} failed (${job.failed.slice(0, 6).join(', ')}…)` : ''}.</span>}
      {!ai && <span>No AI backend on the server: compose with <code>npm run recipes</code>.</span>}
    </div>
  );
}

/** The recipe library's review page (#recipes): every thing, its 3D recipe, keep, reject or redo with a note. */
export function RecipeReview() {
  const [items, setItems] = useState<Item[] | null>(null);
  const [info, setInfo] = useState<{ enabled: boolean; ai: boolean }>({ enabled: false, ai: false });
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('new');
  const [group, setGroup] = useState('all');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const container = useRef<HTMLDivElement>(null!);

  const load = useCallback(() => call<{ enabled: boolean; ai: boolean; items: Item[] }>('/recipes').then((r) => { setItems(r.items); setInfo(r); }).catch((e) => setError(String(e.message ?? e))), []);
  useEffect(() => { void load(); }, [load]);

  const groups = useMemo(() => [...new Set(items?.map((i) => i.group))], [items]);
  const count = (f: Filter) => items?.filter((i) => (f === 'all' ? true : f === 'missing' ? !i.recipe : i.recipe?.status === f)).length ?? 0;
  const shown = useMemo(() => (items ?? []).filter((i) =>
    (filter === 'all' || (filter === 'missing' ? !i.recipe : i.recipe?.status === filter))
    && (group === 'all' || i.group === group)
    && (!query || i.words.some((w) => w.includes(query.toLowerCase())))), [items, filter, group, query]);
  const pages = Math.max(1, Math.ceil(shown.length / PAGE));
  const visible = shown.slice(page * PAGE, page * PAGE + PAGE);
  // Keep the card's place while it moves to another filter: the list refreshes when the page changes.
  const replace = (it: Item) => setItems((all) => all && all.map((x) => (x.id === it.id ? it : x)));
  useEffect(() => setPage(0), [filter, group, query]);
  const keepPage = async () => {
    for (const it of visible.filter((i) => i.recipe?.status === 'new')) {
      const r = await call<{ item: Item }>(`/recipes/${it.id}/review`, { status: 'good' }).catch(() => null);
      if (r) replace(r.item);
    }
  };

  return (
    <div className="review" ref={container}>
      <header className="rtop">
        <a href="#" className="rback">← Prompt Goldberg</a>
        <h1>Recipe library</h1>
        <p>Every common thing as a shape recipe. Words in a prompt find them with no AI call. Keep the good ones, reject the bad ones, or redo one with a note.</p>
        {!info.enabled && items && <p className="rerror">Reviewing is off on this server (production). Run the dev server to review.</p>}
        {error && <p className="rerror">{error} Is the API server running (npm run dev:server)?</p>}
        <div className="rfilters">
          {(['new', 'good', 'bad', 'missing', 'all'] as Filter[]).map((f) => (
            <button key={f} className={`rtab ${filter === f ? 'active' : ''}`} onClick={() => setFilter(f)}>{f} <span>{count(f)}</span></button>
          ))}
          <select value={group} onChange={(e) => setGroup(e.target.value)}>
            <option value="all">every group</option>
            {groups.map((g) => <option key={g}>{g}</option>)}
          </select>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find…" />
          <button onClick={() => void load()} title="Read the library file again">⟳</button>
          {info.enabled && visible.some((i) => i.recipe?.status === 'new') && (
            <button onClick={() => void keepPage()} title="Mark every new recipe on this page good">👍 Keep all new on this page</button>
          )}
        </div>
        {info.enabled && <FillBar missing={count('missing')} bad={count('bad')} ai={info.ai} onProgress={load} />}
      </header>
      <section className="rgrid">
        {visible.map((it) => <Card key={`${it.id}-${it.recipe?.shapes.length ?? 0}-${JSON.stringify(it.recipe?.shapes[0] ?? '')}`} item={it} onChange={replace} ai={info.ai && info.enabled} />)}
        {items && !visible.length && <p className="rempty">Nothing here.</p>}
      </section>
      {pages > 1 && (
        <nav className="rpages">
          <button disabled={page === 0} onClick={() => setPage(page - 1)}>‹</button>
          <span>{page + 1} / {pages}</span>
          <button disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>›</button>
        </nav>
      )}
      <Canvas className="rcanvas" eventSource={container} style={{ position: 'fixed', inset: 0, pointerEvents: 'none' }} dpr={[1, 1.5]}>
        <View.Port />
      </Canvas>
    </div>
  );
}
