import type { GoalResult, SystemSpec } from '@og/shared';

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

async function post<T>(path: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new ApiError('The AI backend is not reachable. Start it with "npm run dev:server".', 0);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error ?? `Request failed (${res.status})`, res.status);
  return data as T;
}

export interface DesignResponse {
  spec: SystemSpec;
  goal: GoalResult;
  tuned: { spec: SystemSpec; goal: GoalResult; evals: number } | null;
  notes: string[];
  usage: { backend: 'api' | 'cli'; costUsd?: number; inputTokens?: number; outputTokens?: number }[];
}

/** Prompt -> designed system (+ optimizer pass). The streaming repair loop (/api/solve) replaces this later. */
export function design(prompt: string): Promise<DesignResponse> {
  return post('/design', { prompt });
}
