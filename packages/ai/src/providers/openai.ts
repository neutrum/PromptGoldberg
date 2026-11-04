import { LlmError, type Completion, type LlmBackend } from '../llm/client';
import type { TextProvider } from './types';

/**
 * The OpenAI chat completions API, which many providers also speak (OpenRouter, Groq, Mistral,
 * Together, a local Ollama). One request per call; the reply arrives whole.
 */
export function chatCompletions(opts: { name: string; url: string; key: string; model: string; fetch?: typeof fetch }): LlmBackend {
  const endpoint = `${opts.url.replace(/\/+$/, '')}/chat/completions`;
  const doFetch = opts.fetch ?? fetch;
  return {
    name: opts.name,
    async complete({ system, prompt, maxTokens = 16000, onText, signal }): Promise<Completion> {
      const started = Date.now();
      let res: Response;
      try {
        res = await doFetch(endpoint, {
          method: 'POST',
          headers: { authorization: `Bearer ${opts.key}`, 'content-type': 'application/json' },
          // The game's models are picked for Claude; this provider always uses the player's.
          body: JSON.stringify({ model: opts.model, max_completion_tokens: maxTokens, messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }] }),
          signal,
        });
      } catch {
        if (signal?.aborted) throw new LlmError('Cancelled.');
        throw new LlmError(`Could not reach ${opts.name}.`, true);
      }
      const data = await res.json().catch(() => ({})) as {
        choices?: { message?: { content?: string | null; refusal?: string | null } }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number };
        error?: { message?: string };
      };
      if (res.status === 401 || res.status === 403) throw new LlmError(`${opts.name} refused the key.`);
      if (res.status === 429) throw new LlmError(`${opts.name} rate limit or quota reached.`, true);
      if (!res.ok) throw new LlmError(`${opts.name} error ${res.status}: ${String(data.error?.message ?? '').slice(0, 200)}`, res.status >= 500);
      const message = data.choices?.[0]?.message;
      if (message?.refusal) throw new LlmError('The model declined this request.');
      const text = message?.content ?? '';
      if (!text) throw new LlmError(`${opts.name} sent an empty reply.`, true);
      onText?.(text);
      return { text, backend: opts.name, inputTokens: data.usage?.prompt_tokens, outputTokens: data.usage?.completion_tokens, timing: { totalMs: Date.now() - started } };
    },
  };
}

export const openai: TextProvider = {
  id: 'openai',
  name: 'ChatGPT (OpenAI)',
  kind: 'text',
  keyUrl: 'https://platform.openai.com/api-keys',
  keyHint: 'sk-...',
  defaultModel: 'gpt-5',
  models: ['gpt-5', 'gpt-5-mini'],
  note: 'Experimental: the game’s prompts were tuned on another model, so levels may need a second try more often.',
  create: ({ key, model }) => chatCompletions({ name: 'openai', url: 'https://api.openai.com/v1', key, model: model || 'gpt-5' }),
};

/**
 * An endpoint the player names. The server makes the request, so only public HTTPS hosts are
 * allowed (a local http one too while developing), never this network's own addresses.
 * shortcut: names are checked, not what they resolve to; a public name pointing at a private
 * address gets through. Resolve and check the address before a deployment that holds secrets inside.
 */
export function publicEndpoint(raw: string | undefined, production = process.env.NODE_ENV === 'production'): string {
  let u: URL;
  try { u = new URL(String(raw ?? '')); } catch { throw new LlmError('Give the API address, e.g. https://openrouter.ai/api/v1'); }
  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  const local = host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') || /^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.)/.test(host) || host === '::1' || /^(fc|fd|fe80)/.test(host) || !host.includes('.') && !host.includes(':');
  if (local && !production && (u.protocol === 'http:' || u.protocol === 'https:')) return u.toString();
  if (u.protocol !== 'https:') throw new LlmError('The API address must start with https://');
  if (local || u.username || u.password) throw new LlmError('That API address is not a public one.');
  return u.toString();
}

export const compatible: TextProvider = {
  id: 'openai-compatible',
  name: 'Any OpenAI-compatible API',
  kind: 'text',
  keyUrl: 'https://openrouter.ai/keys',
  keyHint: 'the provider’s key',
  needsUrl: true,
  defaultModel: '',
  note: 'OpenRouter, Groq, Mistral, Together and others: give the API address (ending in /v1) and a model name. Experimental.',
  create: ({ key, model, url }) => {
    if (!model) throw new LlmError('Name the model to use, e.g. anthropic/claude-sonnet-5.5 on OpenRouter.');
    return chatCompletions({ name: 'openai-compatible', url: publicEndpoint(url), key, model });
  },
};
