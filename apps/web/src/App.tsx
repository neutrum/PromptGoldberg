import { useEffect } from 'react';
import { useGame } from './game/gameStore';
import { getGalleryLevel } from './game/net';
import { clearHash, readHash, readTutorialSwitch } from './game/share';
import { CampaignScreen, CreateScreen, GalleryScreen, MenuScreen } from './screens/Menus';
import { PlayScreen } from './screens/Play';
import { SandboxScreen } from './screens/Sandbox';
import { MachineScreen } from './machine/MachineScreen';

export function App() {
  const screen = useGame((s) => s.screen);
  const toast = useGame((s) => s.toast);

  // Shared links open straight into the level; ?tutorial=off skips the coach marks.
  useEffect(() => {
    const tutorials = readTutorialSwitch();
    if (tutorials !== null) useGame.getState().setTutorials(tutorials);
    if (location.hash === '#machine') {
      useGame.getState().go('machine');
      return;
    }
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
      {screen === 'machine' && <MachineScreen />}
      {toast && <div className="toast">{toast}</div>}
    </>
  );
}
