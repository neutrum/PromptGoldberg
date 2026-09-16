import type { CoachRequest, CoachResponse, Level, LevelStreamEvent } from '@og/shared';

const unreachable = 'The AI server is not reachable. Start it with "npm run dev:server".';

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, init);
  } catch {
    throw new Error(unreachable);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? (res.status >= 500 ? unreachable : `Request failed (${res.status})`));
  return data as T;
}

const postJson = <T>(path: string, body: unknown) =>
  json<T>(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

/** POST a request and read the server-sent event stream it returns. */
export async function streamLevel(
  path: '/level' | '/edit',
  body: unknown,
  onEvent: (e: LevelStreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
      body: JSON.stringify(body),
      signal,
    });
  } catch {
    if (signal?.aborted) return;
    throw new Error(unreachable);
  }
  // Errors (rate limit, bad input) still arrive as an SSE `error` event, just with a non-2xx status.
  const isStream = (res.headers.get('content-type') ?? '').includes('text/event-stream');
  if ((!res.ok && !isStream) || !res.body) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? (res.status >= 500 ? unreachable : `Request failed (${res.status})`));
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  const flush = (chunk: string) => {
    const data = chunk.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trimStart()).join('\n');
    if (!data) return;
    try {
      onEvent(JSON.parse(data) as LevelStreamEvent);
    } catch {
      // Ignore malformed chunks.
    }
  };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    let m: RegExpMatchArray | null;
    while ((m = buffer.match(/\r?\n\r?\n/)) && m.index !== undefined) {
      flush(buffer.slice(0, m.index));
      buffer = buffer.slice(m.index + m[0].length);
    }
  }
  if (buffer.trim()) flush(buffer);
}

export const coach = (req: CoachRequest) => postJson<CoachResponse>('/coach', req);

export interface GalleryEntry {
  id: string;
  title: string;
  briefing: string;
  author: string;
  plays: number;
  clears: number;
  createdAt: string;
  bestShots?: number | null;
}

type GalleryList = GalleryEntry[] | { levels?: GalleryEntry[]; items?: GalleryEntry[]; entries?: GalleryEntry[] };

export const listGallery = (sort: 'new' | 'top') =>
  json<GalleryList>(`/gallery?sort=${sort}`).then((d) => (Array.isArray(d) ? d : d.levels ?? d.items ?? d.entries ?? []));

export const getGalleryLevel = (id: string) =>
  json<{ level: Level } & Partial<GalleryEntry>>(`/gallery/${encodeURIComponent(id)}`);

export const publishLevel = (level: Level, author: string) =>
  postJson<{ id: string }>('/gallery', { level, author: author || undefined });

export const reportGalleryResult = (id: string, cleared: boolean, shots: number) =>
  postJson<unknown>(`/gallery/${encodeURIComponent(id)}/result`, { cleared, shots }).catch(() => undefined);
