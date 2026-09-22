import type { SimEvent } from '@og/shared';

/** Years as a compact human time: days under ~2 months, else years. */
export function formatTime(years: number): string {
  if (years < 0.15) return `${(years * 365.25).toFixed(1)} d`;
  return `${years.toFixed(2)} yr`;
}

export function formatDistance(au: number): string {
  if (au < 0.01) return `${Math.round(au * 149_597_871).toLocaleString()} km`;
  return `${au.toFixed(3)} AU`;
}

export const EVENT_ICON: Record<SimEvent['type'], string> = {
  launch: '🚀',
  flyby: '↪',
  capture: '◎',
  collision: '💥',
  escape: '↗',
  eclipse: '◐',
  warp: '🌀',
  bounce: '🏓',
};

export function describeEvent(e: SimEvent, names: Map<string, string>): string {
  const n = (id: string) => names.get(id) ?? id;
  const [a, b, c] = e.bodies;
  switch (e.type) {
    case 'launch':
      return `${n(a)} launched`;
    case 'warp':
      return `${n(a)} went through ${n(b)} and came out of ${n(c)}`;
    case 'bounce':
      return `${n(a)} bounced off ${n(b)}`;
    case 'flyby':
      return `${n(a)} flew past ${n(b)} at ${formatDistance(e.details.distance)}`;
    case 'capture':
      return `${n(a)} captured by ${n(b)} (period ${formatTime(e.details.period)})`;
    case 'collision':
      return `${n(a)} collided with ${n(b)}`;
    case 'escape':
      return `${n(a)} escaped the system`;
    case 'eclipse':
      return `${n(a)} eclipsed ${n(b)} seen from ${n(c)}${e.details.total > 1 ? ` (#${e.details.index} of ${e.details.total})` : ''}`;
  }
}
