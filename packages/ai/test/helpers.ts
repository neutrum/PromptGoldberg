import type { CompletionRequest, LlmBackend } from '../src';

export const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

type Reply = string | Error | ((req: CompletionRequest) => string);

export class FakeLlm implements LlmBackend {
  name = 'api' as const;
  requests: CompletionRequest[] = [];
  constructor(private replies: Reply[]) {}
  async complete(req: CompletionRequest) {
    this.requests.push(req);
    const next = this.replies.length > 1 ? this.replies.shift()! : this.replies[0];
    if (next instanceof Error) throw next;
    const text = typeof next === 'function' ? next(req) : next;
    // Stream it in a few chunks, like the API backend.
    for (let i = 0; i < text.length; i += 200) req.onText?.(text.slice(i, i + 200));
    return { text, backend: 'api' as const };
  }
}
