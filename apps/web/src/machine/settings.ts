/**
 * The player's own settings: the stage size new machines are built on, and a theme for the scene
 * and the interface. Kept in this browser only; nothing here changes physics or verification.
 */
import { create } from 'zustand';
import { GRID, STAGE_MAX, STAGE_MIN, type Stage } from '@og/machine';

export interface Theme {
  /** Interface */
  ui: string; panel: string; accent: string; text: string;
  /** Scene */
  sky: string; board: string; raised: string; dug: string; grid: string; plinth: string; water: string; post: string; foliage: string;
  showGrid: boolean; scenery: boolean;
}

export const THEME_FIELDS: { key: keyof Theme & string; label: string; group: 'Interface' | 'Scene' }[] = [
  { key: 'ui', label: 'Background', group: 'Interface' },
  { key: 'panel', label: 'Panels', group: 'Interface' },
  { key: 'accent', label: 'Accent', group: 'Interface' },
  { key: 'text', label: 'Text', group: 'Interface' },
  { key: 'sky', label: 'Sky', group: 'Scene' },
  { key: 'board', label: 'Floor', group: 'Scene' },
  { key: 'raised', label: 'Hills', group: 'Scene' },
  { key: 'dug', label: 'Ditches', group: 'Scene' },
  { key: 'water', label: 'Water', group: 'Scene' },
  { key: 'grid', label: 'Grid lines', group: 'Scene' },
  { key: 'plinth', label: 'Base', group: 'Scene' },
  { key: 'post', label: 'Supports', group: 'Scene' },
  { key: 'foliage', label: 'Trees', group: 'Scene' },
];

export const THEMES: Record<string, { name: string; theme: Theme }> = {
  workshop: { name: 'Workshop', theme: {
    ui: '#101c28', panel: '#192b39', accent: '#ffcd73', text: '#eef4f1',
    sky: '#30495d', board: '#b88b58', raised: '#a39684', dug: '#6e5a45', grid: '#a57a4b', plinth: '#6d7177', water: '#2a78b8', post: '#6b4a2b', foliage: '#2f5a3c',
    showGrid: true, scenery: true } },
  blueprint: { name: 'Blueprint', theme: {
    ui: '#0d1b2e', panel: '#13284a', accent: '#8fd3ff', text: '#e8f2ff',
    sky: '#16335c', board: '#1f4f8a', raised: '#3a6aa6', dug: '#14345e', grid: '#9cc7f0', plinth: '#0f2546', water: '#64b5f6', post: '#cfe3f7', foliage: '#5d8fc4',
    showGrid: true, scenery: false } },
  meadow: { name: 'Meadow', theme: {
    ui: '#13231a', panel: '#1d3424', accent: '#ffd166', text: '#f1f7ee',
    sky: '#8ec5e8', board: '#7fb069', raised: '#a3b18a', dug: '#6b4f3a', grid: '#6c9a58', plinth: '#8d8478', water: '#3d8fd1', post: '#7a5230', foliage: '#2d6a4f',
    showGrid: false, scenery: true } },
  candy: { name: 'Candy', theme: {
    ui: '#2a1530', panel: '#3b1e44', accent: '#ff8fd1', text: '#fff0fa',
    sky: '#ffd6ec', board: '#ffc8dd', raised: '#cdb4db', dug: '#a26fb0', grid: '#f7a1c4', plinth: '#bde0fe', water: '#8ecae6', post: '#ffffff', foliage: '#90e0a8',
    showGrid: true, scenery: true } },
  night: { name: 'Night', theme: {
    ui: '#07090f', panel: '#121725', accent: '#ffb347', text: '#e6e9f5',
    sky: '#0b1020', board: '#2b3145', raised: '#3d4560', dug: '#191d2b', grid: '#4a5578', plinth: '#20232d', water: '#2f5d9e', post: '#8b6b4a', foliage: '#1d3b2d',
    showGrid: true, scenery: true } },
};

export const STAGE_PRESETS: { label: string; stage: Stage }[] = [
  { label: 'Small', stage: { x: 16, z: 16 } },
  { label: 'Standard', stage: { x: GRID.x, z: GRID.z } },
  { label: 'Wide', stage: { x: 32, z: 20 } },
  { label: 'Large', stage: { x: 32, z: 32 } },
];

interface Settings {
  stage: Stage;
  preset: string;
  theme: Theme;
  setStage(stage: Stage): void;
  applyPreset(id: string): void;
  setColor<K extends keyof Theme>(key: K, value: Theme[K]): void;
  reset(): void;
}

const KEY = 'pg.settings';
const clampSide = (n: unknown, fallback: number) => Number.isInteger(n) ? Math.max(STAGE_MIN, Math.min(STAGE_MAX, n as number)) : fallback;
const isColor = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);

/** Whatever was saved, checked field by field so a stale or edited entry cannot break the scene. */
function load(): Pick<Settings, 'stage' | 'preset' | 'theme'> {
  const base = { stage: { x: GRID.x, z: GRID.z }, preset: 'workshop', theme: { ...THEMES.workshop.theme } };
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (!saved || typeof saved !== 'object') return base;
    const theme = { ...base.theme };
    for (const k of Object.keys(theme) as (keyof Theme)[]) {
      const v = saved.theme?.[k];
      if (typeof theme[k] === 'boolean' ? typeof v === 'boolean' : isColor(v)) (theme as Record<string, unknown>)[k] = v;
    }
    return {
      stage: { x: clampSide(saved.stage?.x, base.stage.x), z: clampSide(saved.stage?.z, base.stage.z) },
      preset: typeof saved.preset === 'string' && (saved.preset in THEMES || saved.preset === 'custom') ? saved.preset : 'workshop',
      theme,
    };
  } catch { return base; }
}

export const useSettings = create<Settings>((set, get) => {
  const save = () => { const { stage, preset, theme } = get(); try { localStorage.setItem(KEY, JSON.stringify({ stage, preset, theme })); } catch { /* private mode */ } };
  return {
    ...load(),
    setStage(stage) { set({ stage: { x: clampSide(stage.x, GRID.x), z: clampSide(stage.z, GRID.z) } }); save(); },
    applyPreset(id) { if (THEMES[id]) { set({ preset: id, theme: { ...THEMES[id].theme } }); save(); } },
    setColor(key, value) { set((s) => ({ preset: 'custom', theme: { ...s.theme, [key]: value } })); save(); },
    reset() { set({ stage: { x: GRID.x, z: GRID.z }, preset: 'workshop', theme: { ...THEMES.workshop.theme } }); save(); },
  };
});

/** The stage a create request should ask for: none for the standard size, so existing caches still apply. */
export function requestedStage(): Stage | undefined {
  const { stage } = useSettings.getState();
  return stage.x === GRID.x && stage.z === GRID.z ? undefined : stage;
}

/** Interface colours as the CSS variables machine.css reads. */
export function themeStyle(t: Theme): Record<string, string> {
  return { '--bg': t.ui, '--panel': t.panel, '--accent': t.accent, '--gold': t.accent, '--text': t.text };
}
