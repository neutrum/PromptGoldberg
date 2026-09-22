import { useSyncExternalStore } from 'react';

const query = (q: string) => (typeof window !== 'undefined' && 'matchMedia' in window ? window.matchMedia(q) : null);

/** True on phones and tablets: no hover, a finger instead of a mouse, usually no keyboard. */
export const isTouch = query('(pointer: coarse)')?.matches ?? false;

/** Tracks a CSS media query. */
export function useMedia(q: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      const m = query(q);
      m?.addEventListener('change', cb);
      return () => m?.removeEventListener('change', cb);
    },
    () => query(q)?.matches ?? false,
  );
}

/** Phone-width layout: side panels move into the bottom stack. */
export const useNarrow = () => useMedia('(max-width: 600px)');
