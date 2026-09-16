import { CAMPAIGN } from '@og/shared';
import { useEffect, useState } from 'react';
import { useGame } from '../game/gameStore';
import { getGalleryLevel, listGallery, type GalleryEntry } from '../game/net';
import { todayKey } from '../game/progress';
import { galleryLink, copyText } from '../game/share';

function Backdrop() {
  return <div className="backdrop" aria-hidden />;
}

export function MenuScreen() {
  const progress = useGame((s) => s.progress);
  const { go, playDaily, startEndless, toggleMute } = useGame.getState();
  const campaignStars = CAMPAIGN.reduce((sum, l) => sum + (progress.levels[l.id]?.stars ?? 0), 0);
  const daily = progress.daily[todayKey()];
  const nextCampaign = CAMPAIGN.findIndex((l) => !progress.levels[l.id]);

  return (
    <div className="app menu">
      <Backdrop />
      <div className="menu-inner">
        <h1 className="logo">Orbital<span>Goldberg</span></h1>
        <p className="tagline">Aim a probe. Bend it around worlds. Trigger the cosmic chain reaction.</p>
        <div className="menu-grid">
          <button className="menu-card primary-card" onClick={() => (nextCampaign >= 0 && nextCampaign < CAMPAIGN.length && campaignStars === 0 ? useGame.getState().playCampaign(0) : go('campaign'))}>
            <span className="menu-icon">🪐</span>
            <span className="menu-name">{campaignStars === 0 ? 'Play' : 'Campaign'}</span>
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
          <button className="menu-card" onClick={() => go('create')}>
            <span className="menu-icon">✨</span>
            <span className="menu-name">Create with AI</span>
            <span className="menu-sub">Describe a chain reaction; AI builds it and proves it can be solved</span>
          </button>
          <button className="menu-card" onClick={() => go('gallery')}>
            <span className="menu-icon">🌌</span>
            <span className="menu-name">Community</span>
            <span className="menu-sub">Play levels other people made</span>
          </button>
          <button className="menu-card" onClick={() => go('sandbox')}>
            <span className="menu-icon">🔭</span>
            <span className="menu-name">Sandbox</span>
            <span className="menu-sub">The raw simulator: edit JSON, watch events</span>
          </button>
        </div>
        <div className="menu-footer">
          <button className="icon" onClick={toggleMute}>{progress.muted ? '🔇 Sound off' : '🔊 Sound on'}</button>
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
  const { go, createWithAi } = useGame.getState();
  const [prompt, setPrompt] = useState('');

  return (
    <div className="app menu">
      <Backdrop />
      <div className="menu-inner narrow">
        <div className="screen-head">
          <button onClick={() => go('menu')}>← Menu</button>
          <h2>Create with AI</h2>
        </div>
        <p className="muted">Describe a cosmic chain reaction. Claude designs the star system, then a physics optimizer fires hundreds of test shots to prove it can be solved, and asks for a redesign when it can’t.</p>
        <form onSubmit={(e) => { e.preventDefault(); if (prompt.trim() && !ai.busy) void createWithAi(prompt.trim()); }}>
          <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={3} maxLength={600} placeholder="A comet swings past the gas giant, gets flung to the twin moons…" disabled={ai.busy} />
          <div className="create-row">
            <button className="primary" disabled={ai.busy || !prompt.trim()}>{ai.busy ? 'Building…' : 'Build level'}</button>
            {source?.kind === 'ai' && level && !ai.busy && <button type="button" onClick={() => go('play')}>Back to “{level.title}”</button>}
          </div>
        </form>
        <div className="examples">
          {EXAMPLES.map((ex) => <button key={ex} disabled={ai.busy} onClick={() => setPrompt(ex)}>{ex}</button>)}
        </div>
        {(ai.busy || ai.lines.length > 0) && (
          <div className="panel ai-log">
            {ai.lines.map((l, i) => <div key={i} className={i === ai.lines.length - 1 && ai.busy ? 'current' : ''}>{i === ai.lines.length - 1 && ai.busy ? '◌ ' : '✓ '}{l}</div>)}
            {ai.busy && <div className="machine-bar"><div style={{ width: `${Math.round(ai.progress * 100)}%` }} /></div>}
            {ai.busy && ai.lines.length === 0 && <div className="current">◌ Contacting the designer…</div>}
          </div>
        )}
        {ai.error && <div className="error-inline">{ai.error}</div>}
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
