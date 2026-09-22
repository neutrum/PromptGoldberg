import { create } from 'zustand';

/** What the view buttons ask the game camera to do. */
export type CameraCommand = 'fit' | 'in' | 'out';

interface CameraState {
  /** The camera frames the action by itself (overview while aiming, the probe in flight) until the player moves it. */
  auto: boolean;
  command: CameraCommand | null;
  setAuto: (auto: boolean) => void;
  send: (command: CameraCommand) => void;
  /** Hands the pending command to the camera once. */
  take: () => CameraCommand | null;
}

export const useCamera = create<CameraState>((set, get) => ({
  auto: true,
  command: null,
  setAuto: (auto) => { if (get().auto !== auto) set({ auto }); },
  send: (command) => set({ command, ...(command === 'fit' ? { auto: true } : {}) }),
  take: () => {
    const c = get().command;
    if (c) set({ command: null });
    return c;
  },
}));
