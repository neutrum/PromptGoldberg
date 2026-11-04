import type { MeshCheck, MeshProvider } from './types';

const API = 'https://api.meshy.ai/openapi/v2/text-to-3d';

/**
 * Meshy text to 3D in its two stages: a preview (the shape), then a refine (the texture). The
 * task id carries the stage, "preview:..." then "refine:...", so the caller only polls.
 */
export const meshy: MeshProvider = {
  id: 'meshy',
  name: 'Meshy',
  kind: 'mesh',
  keyUrl: 'https://www.meshy.ai/settings/api',
  keyHint: 'msy_...',
  note: 'Experimental: two stages, a few minutes and some Meshy credits per part.',
  downloadHosts: /(^|\.)meshy\.ai$/,
  create: ({ key }) => {
    const call = async (path: string, body: unknown | undefined, signal?: AbortSignal) => {
      const res = await fetch(`${API}${path}`, {
        method: body ? 'POST' : 'GET',
        headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
        signal: signal ?? AbortSignal.timeout(30_000),
      });
      const json = await res.json().catch(() => ({})) as Record<string, unknown>;
      if (res.status === 401 || res.status === 403) throw new Error('Meshy refused the key.');
      if (!res.ok) throw new Error(`Meshy error ${res.status}: ${String(json.message ?? '').slice(0, 200)}`);
      return json;
    };
    return {
      async start(prompt, signal) {
        const r = await call('', { mode: 'preview', prompt, art_style: 'realistic', topology: 'triangle', target_polycount: 5000, should_remesh: true }, signal);
        return `preview:${String(r.result)}`;
      },
      async check(task, signal): Promise<MeshCheck> {
        const [stage, id] = task.split(':');
        const r = await call(`/${encodeURIComponent(id ?? '')}`, undefined, signal) as { status?: string; progress?: number; model_urls?: { glb?: string }; task_error?: { message?: string } };
        if (r.status === 'SUCCEEDED') {
          if (stage === 'preview') {
            const next = await call('', { mode: 'refine', preview_task_id: id }, signal);
            return { status: 'running', progress: 50, task: `refine:${String(next.result)}` };
          }
          return r.model_urls?.glb ? { status: 'done', url: r.model_urls.glb } : { status: 'failed', error: 'Meshy finished without a GLB.' };
        }
        if (r.status === 'PENDING' || r.status === 'IN_PROGRESS') return { status: 'running', progress: Math.round((stage === 'preview' ? 0 : 50) + (r.progress ?? 0) / 2) };
        return { status: 'failed', error: `Meshy: ${r.task_error?.message || r.status || 'unknown'}` };
      },
    };
  },
};
