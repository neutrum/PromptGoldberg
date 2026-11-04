/**
 * Read a server-sent event stream to its end, one parsed JSON event at a time. Events are
 * separated by a blank line; a frame's `data:` lines join into one JSON text. Frames that are
 * not JSON (comments, pings) are skipped.
 */
export async function readEventStream<T>(body: ReadableStream<Uint8Array>, onEvent: (event: T) => void): Promise<void> {
  // The DOM typings disagree on what a decoder stream accepts; it takes the bytes a fetch body gives.
  const reader = body.pipeThrough(new TextDecoderStream() as unknown as ReadableWritablePair<string, Uint8Array>).getReader();
  let buffer = '';
  const flush = (chunk: string) => {
    const data = chunk.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trimStart()).join('\n');
    if (!data) return;
    let event: T;
    try { event = JSON.parse(data) as T; } catch { return; }
    onEvent(event);
  };
  try {
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
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
