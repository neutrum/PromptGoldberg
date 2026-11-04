import { claudeApi } from '../llm/client';
import type { TextProvider } from './types';

/** Claude, with the player's own key. The game's prompts are written and measured on Claude. */
export const anthropic: TextProvider = {
  id: 'anthropic',
  name: 'Claude (Anthropic)',
  kind: 'text',
  keyUrl: 'https://console.anthropic.com/settings/keys',
  keyHint: 'sk-ant-...',
  models: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-fable-5-1'],
  note: 'Recommended: the game’s prompts are tuned for this provider. Leave the model empty to use the game’s own choice for each step.',
  // No model: each step keeps the model the game picked for it.
  create: ({ key, model }) => claudeApi({ apiKey: key, model, name: 'anthropic' }),
};
