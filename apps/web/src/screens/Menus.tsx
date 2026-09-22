import { CAMPAIGN } from '@og/shared';
import { useEffect, useState } from 'react';
import { useGame } from '../game/gameStore';
import { getGalleryLevel, listGallery, type GalleryEntry } from '../game/net';
import { todayKey } from '../game/progress';
import { galleryLink, copyText } from '../game/share';
import { HomeScene } from '../scene/HomeScene';
import { SketchView } from '../ui/SketchView';

function Backdrop() {
  return <div className="backdrop" aria-hidden />;
}

/** Prompt box + live sketch of the level the AI is writing + progress log. Used on the start and create screens. */
function CreatePanel({ hero = false }: { hero?: boolean }) {
  const ai = useGame((s) => s.ai);
  const { createWithAi } = useGame.getState();
  const [prompt, setPrompt] = useState('');
  const submit = () => { if (prompt.trim() && !ai.busy) void createWithAi(prompt.trim()); };

  return (
    <div className={`create-panel ${hero ? 'hero' : ''}`}>
      <form onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } }}
          rows={hero ? 2 : 3}
          maxLength={600}
          placeholder="Describe a cosmic chain reaction… e.g. a comet swings past the gas giant and crashes into its moon"
          disabled={ai.busy}
          aria-label="Describe your level"
        />
        <button className="launch create-btn" disabled={ai.busy || !prompt.trim()}>{ai.busy ? 'Creating…' : '✨ Create'}</button>
      </form>
      {!ai.busy && (
        <div className="examples">
          {EXAMPLES.map((ex) => <button key={ex} onClick={() => setPrompt(ex)}>{ex}</button>)}
        </div>
      )}
      {(ai.busy || ai.sketch) && (
        <div className="create-live">
          <SketchView bodies={ai.sketch?.bodies ?? []} title={ai.sketch?.title} thinking={ai.busy} />
          <div className="ai-log">
            {ai.lines.map((l, i) => <div key={i} className={i === ai.lines.length - 1 && ai.busy ? 'current' : ''}>{i === ai.lines.length - 1 && ai.busy ? '◌ ' : '✓ '}{l}</div>)}
            {ai.busy && ai.lines.length === 0 && <div className="current">◌ Contacting the AI designer…</div>}
            {ai.busy && ai.progress > 0 && <div className="machine-bar"><div style={{ width: `${Math.round(ai.progress * 100)}%` }} /></div>}
          </div>
        </div>
      )}
      {ai.error && <div className="error-inline">{ai.error}</div>}
    </div>
  );
}

/** A few community creations, so visitors see what people make with the AI. */
function CommunityStrip() {
  const { go, openLevel, showToast } = useGame.getState();
  const [items, setItems] = useState<GalleryEntry[]>([]);
  useEffect(() => {
    listGallery('top').then((all) => setItems(all.slice(0, 4))).catch(() => setItems([]));
  }, []);
  if (!items.length) return null;
  const play = async (id: string) => {
    try {
      const { level } = await getGalleryLevel(id);
      openLevel(level, { kind: 'gallery', id });
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err));
    }
  };
  return (
    <section className="home-section">
      <div className="section-head">
        <h3>Made by players with AI</h3>
        <button className="link" onClick={() => go('gallery')}>See all →</button>
      </div>
      <div className="level-grid">
        {items.map((it) => (
          <button key={it.id} className="level-card" onClick={() => void play(it.id)}>
            <span className="level-name">{it.title}</span>
            <span className="level-brief">{it.briefing}</span>
            <span className="muted">by {it.author || 'anonymous'} · {it.plays} plays</span>
          </button>
        ))}
      </div>
    </section>
  );
}

export function MenuScreen() {
  const progress = useGame((s) => s.progress);
  const { go, playDaily, startEndless, toggleMute } = useGame.getState();
  const campaignStars = CAMPAIGN.reduce((sum, l) => sum + (progress.levels[l.id]?.stars ?? 0), 0);
  const daily = progress.daily[todayKey()];
  const newPlayer = campaignStars === 0;

  return (
    <div className="app menu home">
      <HomeScene />
      <div className="menu-inner">
        <h1 className="logo">Orbital<span>Goldberg</span></h1>
        <p className="tagline">
          Describe any cosmic chain reaction. <strong>AI builds the star system</strong>, real physics proves it can be won, and you play it.
        </p>
        <CreatePanel hero />
        <ol className="how-it-works" aria-label="How it works">
          <li><b>You describe</b> any idea, even “pizza”</li>
          <li><b>The AI designs</b> the planets, orbits and goal chain</li>
          <li><b>The optimizer proves</b> it can be won and is fair to aim at</li>
          <li><b>You play it</b>, remix it by talking, and share it</li>
        </ol>

        <section className="home-section">
          <h3>More ways to play</h3>
          <div className="menu-grid compact">
            <button className="menu-card" onClick={() => (newPlayer ? useGame.getState().playCampaign(0) : go('campaign'))}>
              <span className="menu-icon">🪐</span>
              <span className="menu-name">{newPlayer ? 'Learn to play' : 'Campaign'}</span>
              <span className="menu-sub">{CAMPAIGN.length} handmade levels · {campaignStars}/{CAMPAIGN.length * 3} ★</span>
            </button>
            <button className="menu-card" onClick={() => void playDaily()}>
              <span className="menu-icon">📅</span>
              <span className="menu-name">Daily challenge</span>
              <span className="menu-sub">{daily ? `Today: ${'★'.repeat(daily.stars)} in ${daily.shots} shots` : 'Same system for everyone today'}</span>
            </button>
            <button className="menu-card" onClick={() => void startEndless()}>
              <span className="menu-icon">♾️</span>
              <span className="menu-name">Endless</span>
              <span className="menu-sub">Generated systems, limited shots · best {progress.endlessBest}</span>
            </button>
            <button className="menu-card" onClick={() => go('gallery')}>
              <span className="menu-icon">🌌</span>
              <span className="menu-name">Community</span>
              <span className="menu-sub">Play what others created</span>
            </button>
          </div>
        </section>

        <CommunityStrip />

        <div className="menu-footer">
          <button className="icon" onClick={toggleMute}>{progress.muted ? '🔇 Sound off' : '🔊 Sound on'}</button>
          <button className="link" onClick={() => go('sandbox')}>Sandbox (raw simulator)</button>
        </div>
      </div>
    </div>
  );
}

export function CampaignScreen() {
  const progress = useGame((s) => s.progress);
  const { go, playCampaign } = useGame.getState();
  return (
    <div className="app menu">
      <Backdrop />
      <div className="menu-inner">
        <div className="screen-head">
          <button onClick={() => go('menu')}>← Menu</button>
          <h2>Campaign</h2>
        </div>
        <div className="level-grid">
          {CAMPAIGN.map((l, i) => {
            const rec = progress.levels[l.id];
            const unlocked = i === 0 || !!progress.levels[CAMPAIGN[i - 1].id];
            return (
              <button key={l.id} className={`level-card ${rec ? 'cleared' : ''}`} disabled={!unlocked} onClick={() => playCampaign(i)}>
                <span className="level-num">{i + 1}</span>
                <span className="level-name">{unlocked ? l.title : '🔒 Locked'}</span>
                {unlocked && <span className="level-brief">{l.briefing}</span>}
                <span className="level-stars">
                  {[0, 1, 2].map((k) => <span key={k} className={k < (rec?.stars ?? 0) ? 'on' : 'off'}>★</span>)}
                  {rec && <span className="muted"> best {rec.bestShots}</span>}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

const EXAMPLES = [
  'A comet swings past the gas giant and crashes into its icy moon.',
  'Send a probe to the outer planet using two slingshots.',
  'Thread a probe between twin planets and escape the system.',
  'A rogue planet passes through and steals a moon.',
];

export function CreateScreen() {
  const ai = useGame((s) => s.ai);
  const level = useGame((s) => s.level);
  const source = useGame((s) => s.source);
  const { go } = useGame.getState();

  return (
    <div className="app menu">
      <Backdrop />
      <div className="menu-inner narrow">
        <div className="screen-head">
          <button onClick={() => go('menu')}>← Menu</button>
          <h2>Create with AI</h2>
          {source?.kind === 'ai' && level && !ai.busy && <button onClick={() => go('play')}>Back to “{level.title}”</button>}
        </div>
        <p className="muted">Describe a cosmic chain reaction. The AI designs the star system, then a physics optimizer fires hundreds of test shots to prove it can be won and is fair to aim at, and asks for a redesign when it isn’t. You can start playing as soon as the design is ready.</p>
        <CreatePanel />
      </div>
    </div>
  );
}

export function GalleryScreen() {
  const { go, openLevel, showToast } = useGame.getState();
  const progress = useGame((s) => s.progress);
  const [sort, setSort] = useState<'new' | 'top'>('top');
  const [items, setItems] = useState<GalleryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [author, setAuthor] = useState(progress.author);

  useEffect(() => {
    setItems(null);
    setError(null);
    listGallery(sort).then(setItems).catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [sort]);

  const play = async (id: string) => {
    try {
      const { level } = await getGalleryLevel(id);
      openLevel(level, { kind: 'gallery', id });
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="app menu">
      <Backdrop />
      <div className="menu-inner">
        <div className="screen-head">
          <button onClick={() => go('menu')}>← Menu</button>
          <h2>Community levels</h2>
          <div className="tabs">
            <button className={sort === 'top' ? 'active' : ''} onClick={() => setSort('top')}>Most played</button>
            <button className={sort === 'new' ? 'active' : ''} onClick={() => setSort('new')}>Newest</button>
          </div>
        </div>
        <label className="author muted">
          Your creator name:{' '}
          <input value={author} maxLength={32} onChange={(e) => setAuthor(e.target.value)} onBlur={() => useGame.getState().setAuthor(author)} placeholder="anonymous" />
        </label>
        {error && <div className="error-inline">{error}</div>}
        {!items && !error && <div className="muted">Loading…</div>}
        {items && items.length === 0 && <div className="muted">No levels yet. Build one with AI, beat it, and publish it!</div>}
        <div className="level-grid">
          {items?.map((it) => (
            <div key={it.id} className="level-card gallery-card">
              <span className="level-name">{it.title}</span>
              <span className="level-brief">{it.briefing}</span>
              <span className="muted">by {it.author || 'anonymous'} · {it.plays} plays · {it.plays ? Math.round((100 * it.clears) / it.plays) : 0}% cleared{it.bestShots ? ` · record ${it.bestShots} shots` : ''}</span>
              <div className="result-actions">
                <button className="primary" onClick={() => void play(it.id)}>Play</button>
                <button onClick={async () => showToast((await copyText(galleryLink(it.id))) ? 'Link copied!' : galleryLink(it.id))}>Copy link</button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
