/** Ask a model for JSON and validate it, retrying with the problems: the one way every AI step talks to the model. */
import { LlmError, type Completion, type LlmBackend } from './client';

/** Pull the JSON object out of a reply that may include a code fence or stray prose. */
export function extractJson(text: string): unknown {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fence ? fence[1] : text;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('no JSON object in reply');
  return JSON.parse(body.slice(start, end + 1));
}

export type Validation<T> = { ok: true; value: T } | { ok: false; problems: string };

/**
 * Ask for JSON, validate it, and retry once with the validation problems.
 * Every completion is appended to `calls`.
 */
export async function requestValidated<T>(
  llm: LlmBackend,
  req: { system: string; prompt: string; maxTokens?: number; thinking?: 'off'; model?: string },
  validate: (json: unknown) => Validation<T>,
  calls: Completion[],
  retries = 1,
  /** Receives the reply text so far on each streamed chunk (restarts on a retry). */
  onProgress?: (textSoFar: string) => void,
): Promise<T> {
  let prompt = req.prompt;
  let lastProblems = '';
  for (let attempt = 0; attempt <= retries; attempt++) {
    let soFar = '';
    const onText = onProgress && ((delta: string) => {
      soFar += delta;
      onProgress(soFar);
    });
    const reply = await llm.complete({ system: req.system, prompt, maxTokens: req.maxTokens, onText, thinking: req.thinking, model: req.model });
    calls.push(reply);

    let problems: string;
    try {
      const v = validate(extractJson(reply.text));
      if (v.ok) return v.value;
      problems = v.problems;
    } catch (err) {
      problems = `- the reply was not valid JSON (${err instanceof Error ? err.message : String(err)})`;
    }
    lastProblems = problems;
    prompt = `${req.prompt}

Your previous reply was:
${reply.text}

It failed validation:
${problems}

Reply with a corrected JSON object only.`;
  }
  // The last reason travels with the error, so a failed build says what the designer kept getting wrong.
  throw new LlmError(`Could not get a valid design after ${retries} ${retries === 1 ? 'retry' : 'retries'}. Last problem: ${lastProblems.replace(/^- /, '').slice(0, 300)}`);
}
