import type { SketchBody } from '@og/shared';

/**
 * Bodies that are already complete in a partly streamed level-design reply, so a UI can draw
 * the system while Claude is still writing it. Tolerates any unfinished tail.
 */
export function sketchFrom(text: string): { title?: string; bodies: SketchBody[] } {
  const rawTitle = text.match(/"title"\s*:\s*"((?:[^"\\]|\\.)*)"/)?.[1];
  const title = rawTitle === undefined ? undefined : unescapeJson(rawTitle);
  const bodies: SketchBody[] = [];
  const key = text.indexOf('"bodies"');
  const open = key < 0 ? -1 : text.indexOf('[', key);
  if (open < 0) return { title, bodies };

  let depth = 0;
  let inString = false;
  let escaped = false;
  let start = -1;
  for (let i = open + 1; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0 && start >= 0) {
        const body = toSketch(text.slice(start, i + 1));
        if (body) bodies.push(body);
        start = -1;
      }
    } else if (ch === ']' && depth === 0) break;
  }
  return { title, bodies };
}

function toSketch(json: string): SketchBody | null {
  try {
    const b = JSON.parse(json) as Record<string, unknown>;
    const placement = (b.placement ?? {}) as Record<string, unknown>;
    if (typeof b.id !== 'string') return null;
    const orbit = placement.kind === 'orbit';
    return {
      id: b.id,
      name: typeof b.name === 'string' ? b.name : b.id,
      type: typeof b.type === 'string' ? b.type : 'planet',
      color: typeof b.color === 'string' ? b.color : undefined,
      parent: orbit && typeof placement.parent === 'string' ? placement.parent
        : placement.kind === 'launch' && typeof placement.from === 'string' ? placement.from : undefined,
      a: orbit && typeof placement.a === 'number' ? placement.a : undefined,
      phase: orbit && typeof placement.phase === 'number' ? placement.phase : undefined,
      launched: placement.kind === 'launch',
      position: placement.kind === 'free' && Array.isArray(placement.position) && placement.position.length >= 2
        && placement.position.slice(0, 2).every((c) => typeof c === 'number')
        ? [placement.position[0] as number, placement.position[1] as number] : undefined,
    };
  } catch {
    return null;
  }
}

function unescapeJson(s: string): string {
  try {
    return JSON.parse(`"${s}"`) as string;
  } catch {
    return s;
  }
}
