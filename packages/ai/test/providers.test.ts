import { describe, expect, it } from 'vitest';
import { chatCompletions, listProviders, publicEndpoint, textBackend } from '../src/providers';

describe('providers', () => {
  it('lists what a player can bring a key for', () => {
    const ids = listProviders().map((p) => p.id);
    expect(ids).toEqual(expect.arrayContaining(['anthropic', 'openai', 'openai-compatible', 'tripo', 'meshy']));
    expect(() => textBackend('tripo', { key: 'k' })).toThrow(/Unknown AI provider/);
  });

  it('talks the OpenAI chat API with the player’s key and model, whatever model the game asked for', async () => {
    let sent: { url: string; auth: string; body: { model: string; messages: { role: string }[] } } | null = null;
    const llm = chatCompletions({
      name: 'openai', url: 'https://api.example.test/v1/', key: 'sk-player', model: 'gpt-x',
      fetch: (async (url: string, init: RequestInit) => {
        sent = { url, auth: (init.headers as Record<string, string>).authorization, body: JSON.parse(String(init.body)) };
        return new Response(JSON.stringify({ choices: [{ message: { content: '{"ok": true}' } }], usage: { prompt_tokens: 5, completion_tokens: 3 } }));
      }) as typeof fetch,
    });
    const reply = await llm.complete({ system: 's', prompt: 'p', model: 'claude-opus-5' });
    expect(reply.text).toBe('{"ok": true}');
    expect(sent!.url).toBe('https://api.example.test/v1/chat/completions');
    expect(sent!.auth).toBe('Bearer sk-player');
    expect(sent!.body.model).toBe('gpt-x');
    expect(sent!.body.messages.map((m) => m.role)).toEqual(['system', 'user']);
  });

  it('says plainly when the key is refused', async () => {
    const llm = chatCompletions({ name: 'openai', url: 'https://api.example.test/v1', key: 'bad', model: 'm', fetch: (async () => new Response('{}', { status: 401 })) as unknown as typeof fetch });
    await expect(llm.complete({ system: 's', prompt: 'p' })).rejects.toThrow(/refused the key/);
  });

  it('only sends players’ requests to public HTTPS endpoints in production', () => {
    expect(publicEndpoint('https://openrouter.ai/api/v1', true)).toBe('https://openrouter.ai/api/v1');
    for (const bad of ['http://openrouter.ai/api/v1', 'https://localhost:11434/v1', 'https://192.168.1.5/v1', 'https://10.0.0.1/v1', 'https://169.254.169.254/latest', 'https://[::1]/v1', 'https://intranet/v1', 'not a url'])
      expect(() => publicEndpoint(bad, true), bad).toThrow();
    // While developing, a local server (Ollama) is fine.
    expect(publicEndpoint('http://localhost:11434/v1', false)).toBe('http://localhost:11434/v1');
  });
});
