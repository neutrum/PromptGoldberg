import { describe, expect, it } from 'vitest';
import { ApiError, createClient, readEventStream } from '../src';

const streamOf = (...chunks: string[]) => new ReadableStream<Uint8Array>({
  start(c) { for (const s of chunks) c.enqueue(new TextEncoder().encode(s)); c.close(); },
});

describe('the API client', () => {
  it('reads server-sent events split anywhere, skipping pings', async () => {
    const got: unknown[] = [];
    await readEventStream(streamOf(': ping\n\n', 'event: stage\ndata: {"type":"st', 'age","n":1}\n\nevent: x\ndata: {"type":"done"}\n\n'), (e) => got.push(e));
    expect(got).toEqual([{ type: 'stage', n: 1 }, { type: 'done' }]);
  });

  it('posts AI requests to their routes and streams the events back', async () => {
    const calls: string[] = [];
    const api = createClient({
      baseUrl: 'http://pg.test/',
      fetch: async (url, init) => {
        calls.push(`${init?.method} ${String(url)} ${init?.body}`);
        return new Response(streamOf('data: {"type":"machine","solved":false}\n\n'), { headers: { 'content-type': 'text/event-stream' } });
      },
    });
    const events: { type: string }[] = [];
    await api.stream('solve', { machine: { title: 't' } as never }, (e) => events.push(e));
    expect(calls).toEqual(['POST http://pg.test/api/machine/solve {"machine":{"title":"t"}}']);
    expect(events.map((e) => e.type)).toEqual(['machine']);
  });

  it('says the server is unreachable, and passes the server’s own errors on', async () => {
    const down = createClient({ fetch: async () => { throw new TypeError('fetch failed'); }, unreachable: 'server down' });
    await expect(down.daily()).rejects.toThrow('server down');
    const refusing = createClient({ fetch: async () => Response.json({ error: 'too many requests' }, { status: 429 }) });
    await expect(refusing.listMachines()).rejects.toMatchObject({ message: 'too many requests', status: 429 });
    await expect(refusing.listMachines()).rejects.toBeInstanceOf(ApiError);
  });
});
