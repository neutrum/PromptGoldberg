/**
 * What an AI provider is to the game. Two kinds: a text provider designs levels and workbench
 * parts (it answers prompts with JSON), a mesh provider turns words into a 3D model (a GLB) that
 * a workbench part is drawn with. A provider is one object of one of these shapes; see README.md.
 */
import type { LlmBackend } from '../llm/client';

/** What the settings screen shows for a provider; plain data, safe to send to a browser. */
export interface ProviderInfo {
  id: string;
  name: string;
  kind: 'text' | 'mesh';
  /** Where a player gets a key. */
  keyUrl: string;
  /** What a key looks like ("sk-ant-..."), for the key field's placeholder. */
  keyHint: string;
  /** Text providers: the model used when the player names none, and a few to pick from. */
  defaultModel?: string;
  models?: string[];
  /** The provider needs an endpoint from the player (an OpenAI-compatible server). */
  needsUrl?: boolean;
  /** One honest line: what is tested, what it costs. */
  note?: string;
}

/** A player's settings for one provider. The key is used for the request it came with, never kept. */
export interface ProviderConfig {
  key: string;
  model?: string;
  url?: string;
}

export interface TextProvider extends ProviderInfo {
  kind: 'text';
  create(config: ProviderConfig): LlmBackend;
}

/** A model being made: still running, failed, or done with where to fetch the GLB. */
export type MeshCheck =
  | { status: 'running'; progress?: number; /** A provider that works in stages hands on its next task. */ task?: string }
  | { status: 'failed'; error: string }
  | { status: 'done'; url: string };

export interface MeshMaker {
  /** Starts making a model of the words; returns the provider's task id. */
  start(prompt: string, signal?: AbortSignal): Promise<string>;
  check(task: string, signal?: AbortSignal): Promise<MeshCheck>;
}

export interface MeshProvider extends ProviderInfo {
  kind: 'mesh';
  /** Hosts the finished GLB may be downloaded from; the key is never sent there. */
  downloadHosts: RegExp;
  create(config: ProviderConfig): MeshMaker;
}

export type Provider = TextProvider | MeshProvider;

/** The settings screen's view of a provider: everything but the code. */
export const infoOf = ({ id, name, kind, keyUrl, keyHint, defaultModel, models, needsUrl, note }: Provider): ProviderInfo =>
  ({ id, name, kind, keyUrl, keyHint, defaultModel, models, needsUrl, note });
