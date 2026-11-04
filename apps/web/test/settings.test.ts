import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  const data = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v); }, removeItem: (k: string) => { data.delete(k); },
  } });
  // A stale or hand-edited entry: an out-of-range stage, a bad colour and a wrong type.
  data.set('pg.settings', JSON.stringify({ stage: { x: 99, z: 16 }, preset: 'nope', theme: { board: 'red', sky: '#000000', showGrid: 'yes' } }));
});
import { requestedStage, THEMES, useSettings } from '../src/ui/settings';

describe('player settings', () => {
  it('loads saved settings field by field, clamping and ignoring what is invalid', () => {
    const s = useSettings.getState();
    expect(s.stage).toEqual({ x: 32, z: 16 });
    expect(s.preset).toBe('workshop');
    expect(s.theme.sky).toBe('#000000');
    expect(s.theme.board).toBe(THEMES.workshop.theme.board);
    expect(s.theme.showGrid).toBe(true);
  });

  it('asks for no stage at the standard size, so creation requests stay as before', () => {
    useSettings.getState().setStage({ x: 24, z: 24 });
    expect(requestedStage()).toBeUndefined();
    useSettings.getState().setStage({ x: 20, z: 28 });
    expect(requestedStage()).toEqual({ x: 20, z: 28 });
    expect(JSON.parse(localStorage.getItem('pg.settings')!).stage).toEqual({ x: 20, z: 28 });
  });

  it('a colour change makes the theme the player’s own; a preset or reset replaces it', () => {
    useSettings.getState().setColor('accent', '#123456');
    expect(useSettings.getState().preset).toBe('custom');
    useSettings.getState().applyPreset('night');
    expect(useSettings.getState().theme).toEqual(THEMES.night.theme);
    useSettings.getState().reset();
    expect(useSettings.getState().preset).toBe('workshop');
  });
});
