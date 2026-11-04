import type { MeshCheck, MeshProvider } from './types';

const API = 'https://api.tripo3d.ai/v2/openapi';

/** Tripo text to model: low poly with a simple texture, the settings the game's library models were made with. */
export const tripo: MeshProvider = {
  id: 'tripo',
  name: 'Tripo',
  kind: 'mesh',
  keyUrl: 'https://platform.tripo3d.ai/api-keys',
  keyHint: 'tsk_...',
  note: 'About a minute and some Tripo credits per part.',
  downloadHosts: /(^|\.)(tripo3d\.ai|tripo3d\.com|tripo\.ai)$/,
  create: ({ key }) => {
    const call = async (path: string, body: unknown | undefined, signal?: AbortSignal) => {
      const res = await fetch(`${API}${path}`, {
        method: body ? 'POST' : 'GET',
        headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
        signal: signal ?? AbortSignal.timeout(30_000),
      });
      const json = await res.json().catch(() => ({})) as { code?: number; message?: string; data?: Record<string, unknown> };
      if (res.status === 401 || res.status === 403) throw new Error('Tripo refused the key.');
      if (!res.ok || json.code !== 0 || !json.data) throw new Error(`Tripo error ${res.status}: ${String(json.message ?? '').slice(0, 200)}`);
      return json.data;
    };
    return {
      async start(prompt, signal) {
        const data = await call('/task', { type: 'text_to_model', model_version: 'v3.1-20260211', prompt, face_limit: 4000, texture: true, pbr: false, texture_quality: 'standard' }, signal);
        return String(data.task_id);
      },
      async check(task, signal): Promise<MeshCheck> {
        const data = await call(`/task/${encodeURIComponent(task)}`, undefined, signal) as { status?: string; progress?: number; output?: Record<string, string | undefined> };
        if (data.status === 'success') {
          const url = data.output?.pbr_model ?? data.output?.model ?? data.output?.base_model;
          return url ? { status: 'done', url } : { status: 'failed', error: 'Tripo finished without a model.' };
        }
        if (data.status === 'queued' || data.status === 'running') return { status: 'running', progress: data.progress };
        return { status: 'failed', error: `Tripo: ${data.status ?? 'unknown'}` };
      },
    };
  },
};
