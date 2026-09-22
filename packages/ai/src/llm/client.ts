import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Anthropic from '@anthropic-ai/sdk';

export interface CompletionRequest {
  system: string;
  prompt: string;
  maxTokens?: number;
  /** Overrides CLAUDE_MODEL for this call. */
  model?: string;
}

export interface Completion {
  text: string;
  backend: LlmBackendName;
  costUsd?: number;
  inputTokens?: number;
  outputTokens?: number;
}

export type LlmBackendName = 'api' | 'cli';

export interface LlmBackend {
  name: LlmBackendName;
  complete(req: CompletionRequest): Promise<Completion>;
}

export class LlmError extends Error {
  constructor(message: string, readonly retryable = false) {
    super(message);
  }
}

const MODEL = process.env.CLAUDE_MODEL ?? 'claude-opus-5';

/** Claude API. Used in production; needs ANTHROPIC_API_KEY. */
function apiBackend(): LlmBackend {
  const client = new Anthropic();
  return {
    name: 'api',
    async complete({ system, prompt, maxTokens = 16000, model = MODEL }) {
      try {
        const response = await client.beta.messages.create({
          model,
          max_tokens: maxTokens,
          // Re-run policy declines on Anthropic's recommended fallback model instead of failing.
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
          system,
          messages: [{ role: 'user', content: prompt }],
        });
        if (response.stop_reason === 'refusal') {
          throw new LlmError('The model declined this request.');
        }
        const text = response.content
          .flatMap((b) => (b.type === 'text' ? [b.text] : []))
          .join('');
        return {
          text,
          backend: 'api',
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
        };
      } catch (err) {
        if (err instanceof LlmError) throw err;
        if (err instanceof Anthropic.RateLimitError) throw new LlmError('Claude API rate limit reached.', true);
        if (err instanceof Anthropic.AuthenticationError) throw new LlmError('Claude API key is invalid.');
        if (err instanceof Anthropic.APIConnectionError) throw new LlmError('Could not reach the Claude API.', true);
        if (err instanceof Anthropic.APIError) {
          throw new LlmError(`Claude API error ${err.status}: ${err.message}`, (err.status ?? 0) >= 500);
        }
        throw err;
      }
    },
  };
}

/**
 * Dev-only: shells out to the locally installed Claude Code CLI in headless mode,
 * so development uses the developer's own Claude Code login instead of an API key.
 * Never enabled in production.
 */
function cliBackend(): LlmBackend {
  const bin = process.env.CLAUDE_CLI ?? 'claude';
  return {
    name: 'cli',
    complete({ system, prompt, model = MODEL }) {
      // Prompts go through a file and stdin: long multi-line args are fragile on Windows.
      const dir = mkdtempSync(join(tmpdir(), 'og-claude-'));
      const systemFile = join(dir, 'system.txt');
      writeFileSync(systemFile, system);
      const args = [
        '-p',
        '--output-format', 'json',
        '--system-prompt-file', systemFile,
        '--tools', '',
        '--no-session-persistence',
        '--setting-sources', '',
        '--strict-mcp-config',
      ];
      args.push('--model', model);

      return new Promise<Completion>((resolve, reject) => {
        // Neutral cwd so the project's CLAUDE.md and settings don't leak into prompts.
        const child = spawn(bin, args, { cwd: dir, windowsHide: true });
        let stdout = '';
        let stderr = '';
        const timer = setTimeout(() => {
          child.kill();
          reject(new LlmError('Claude CLI timed out.', true));
        }, Number(process.env.CLAUDE_CLI_TIMEOUT_MS ?? 180_000));

        child.stdout.on('data', (d) => (stdout += d));
        child.stderr.on('data', (d) => (stderr += d));
        child.on('error', (err) => {
          clearTimeout(timer);
          reject(new LlmError(`Could not start Claude CLI (${bin}): ${err.message}`));
        });
        child.on('close', (code) => {
          clearTimeout(timer);
          rmSync(dir, { recursive: true, force: true });
          let out: {
            result?: string; is_error?: boolean; total_cost_usd?: number;
            usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number };
          };
          try {
            out = JSON.parse(stdout);
          } catch {
            reject(new LlmError(`Claude CLI exited with code ${code}: ${(stderr || stdout).slice(0, 500)}`));
            return;
          }
          if (out.is_error || typeof out.result !== 'string') {
            reject(new LlmError(`Claude CLI error: ${String(out.result ?? stderr).slice(0, 500)}`));
            return;
          }
          resolve({
            text: out.result,
            backend: 'cli',
            costUsd: out.total_cost_usd,
            // The CLI caches its prompt, so most input shows up as cache tokens.
            inputTokens: (out.usage?.input_tokens ?? 0) + (out.usage?.cache_read_input_tokens ?? 0) + (out.usage?.cache_creation_input_tokens ?? 0),
            outputTokens: out.usage?.output_tokens,
          });
        });
        child.stdin.end(prompt);
      });
    },
  };
}

/**
 * `choice` (or LLM_BACKEND=api|cli) picks explicitly. Otherwise: API when a key is set, else
 * the CLI outside production. The CLI backend is refused when NODE_ENV=production.
 */
export function createLlm(choice?: LlmBackendName): LlmBackend | null {
  const production = process.env.NODE_ENV === 'production';
  choice ??= (process.env.LLM_BACKEND as LlmBackendName | undefined) ?? (process.env.ANTHROPIC_API_KEY ? 'api' : production ? undefined : 'cli');
  if (choice === 'cli') {
    if (production) throw new Error('LLM_BACKEND=cli is for local development only.');
    return cliBackend();
  }
  if (choice === 'api') return apiBackend();
  return null;
}
