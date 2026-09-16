import type { FastifyReply } from 'fastify';
import type { LevelStreamEvent } from '@og/shared';

/** One SSE frame: `event:` + `data:` lines and a blank line. Multi-line data gets one `data:` per line. */
export function sseFrame<T extends { type: string }>(event: T): string {
  const data = JSON.stringify(event).split(/\r?\n/).map((l) => `data: ${l}`).join('\n');
  return `event: ${event.type}\n${data}\n\n`;
}

export interface SseStream {
  send(event: LevelStreamEvent): void;
  close(): void;
  /** Aborted when the client disconnects before the stream ends. */
  signal: AbortSignal;
  readonly closed: boolean;
}

/** Take over the reply and stream Server-Sent Events. */
export function openSse(reply: FastifyReply, status = 200, heartbeatMs = 15_000): SseStream {
  reply.hijack();
  const res = reply.raw;
  const controller = new AbortController();
  let closed = false;
  res.writeHead(status, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  // Comment lines keep proxies from timing out during long LLM calls.
  const ping = setInterval(() => !closed && res.write(': ping\n\n'), heartbeatMs);
  ping.unref();
  res.on('close', () => {
    clearInterval(ping);
    if (!closed) {
      closed = true;
      controller.abort();
    }
  });
  return {
    signal: controller.signal,
    get closed() {
      return closed;
    },
    send(event) {
      if (!closed) res.write(sseFrame(event));
    },
    close() {
      if (closed) return;
      closed = true;
      clearInterval(ping);
      res.end();
    },
  };
}

/** Parse an SSE body back into events (tests and the smoke script). */
export function parseSse(body: string): LevelStreamEvent[] {
  return body
    .split(/\n\n/)
    .map((block) => block.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('\n'))
    .filter(Boolean)
    .map((data) => JSON.parse(data) as LevelStreamEvent);
}
