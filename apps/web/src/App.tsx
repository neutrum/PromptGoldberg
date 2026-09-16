import { useEffect } from 'react';
import { useGame } from './game/gameStore';
import { getGalleryLevel } from './game/net';
import { clearHash, readHash } from './game/share';
import { CampaignScreen, CreateScreen, GalleryScreen, MenuScreen } from './screens/Menus';
import { PlayScreen } from './screens/Play';
import { SandboxScreen } from './screens/Sandbox';

export function App() {
  const screen = useGame((s) => s.screen);
  const toast = useGame((s) => s.toast);

  // Shared links open straight into the level.
  useEffect(() => {
    const target = readHash();
    if (!target) return;
    const { openLevel, showToast } = useGame.getState();
    if (target.kind === 'level') openLevel(target.level, { kind: 'shared' });
    else getGalleryLevel(target.id)
      .then(({ level }) => openLevel(level, { kind: 'gallery', id: target.id }))
      .catch((err) => showToast(err instanceof Error ? err.message : String(err)));
    clearHash();
  }, []);

  return (
    <>
      {screen === 'menu' && <MenuScreen />}
      {screen === 'campaign' && <CampaignScreen />}
      {screen === 'play' && <PlayScreen />}
      {screen === 'create' && <CreateScreen />}
      {screen === 'gallery' && <GalleryScreen />}
      {screen === 'sandbox' && <SandboxScreen />}
      {toast && <div className="toast">{toast}</div>}
    </>
  );
}
