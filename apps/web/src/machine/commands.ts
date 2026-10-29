import type { PartKind } from '@og/machine';

const parts: Record<string, Exclude<PartKind, 'ball'>> = {
  fan: 'fan', ramp: 'ramp', cannon: 'cannon', trampoline: 'trampoline', seesaw: 'seesaw',
  wall: 'wall', bucket: 'bucket', bell: 'bell', dominoes: 'dominoes', shelf: 'platform', platform: 'platform',
};

/** A literal add command is a placement action; it never generates a different level. */
export function addedPart(text: string): Exclude<PartKind, 'ball'> | null {
  const match = /^(?:please\s+)?(?:add|insert|place)\s+(?:(?:a|an|one|another)\s+)?(fan|ramp|cannon|trampoline|seesaw|wall|bucket|bell|dominoes|shelf|platform)(?:\s+(?:here|to (?:this|the) (?:machine|scene|build)))?[.!]?$/i.exec(text.trim());
  return match ? parts[match[1].toLowerCase()] : null;
}

/** Protect obvious edit instructions even when the new-machine form is open. */
export const isEditInstruction = (text: string) => /^(?:please\s+)?(?:add|insert|remove|delete|move|rotate|paint|rename|replace|swap|change|recolor|colour|color|name)\b/i.test(text.trim());
