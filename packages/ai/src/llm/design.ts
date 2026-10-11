import { z } from 'zod';
import { SystemSpec, fixupSpec, parseSpec, type SpecIssue } from '@og/shared';
import slingshot from '@og/shared/fixtures/slingshot.json' with { type: 'json' };
import { LlmError, type Completion, type LlmBackend } from './client';

export const SCHEMA = JSON.stringify(z.toJSONSchema(SystemSpec, { io: 'input' }));

export const SYSTEM_PROMPT = `You design small star systems for Orbital Goldberg, a gravity toy where a user describes a cosmic chain reaction and a physics engine checks whether it happens.

Given the user's description, output one system as JSON that matches the schema below. A numeric optimizer will fine-tune the parameters you list in "tunables", so aim for a plausible structure with roughly right numbers rather than exact values.

Units: distance in AU, time in years, mass in solar masses. Reference values: Sun mass 1, radius 0.00465. Jupiter mass 9.5e-4, radius 4.8e-4. Earth mass 3e-6, radius 4.3e-5. Moon mass 3.7e-8, radius 1.2e-5. One day is 0.002738 yr. 1 AU/yr is about 4.74 km/s. Circular orbital speed at 1 AU around the Sun is 6.28 AU/yr.

Design guidance:
- Use 3 to 8 bodies, with exactly one star at the centre (placement kind "free" at the origin with zero velocity) unless the description asks for something else.
- Moons orbit well inside their planet's Hill radius (a_planet * cbrt(m_planet / (3 * m_star))); a third of it or less is safe.
- The goal is an ordered list of 1 to 3 checkable events. Keep it short: each event must be something the physics can detect (flyby, capture, collision, escape, eclipse).
- Flyby maxDistance should be generous but meaningful, e.g. 0.05 to 0.5 AU for planets.
- Choose sim.duration so the whole chain can finish, but not much longer (for example a Hohmann transfer from 1 AU to 5 AU takes about 2.7 years).
- Put the uncertain numbers in "tunables" (usually 2 to 4): launch speed, angle and time for probes and comets; phase of a target planet; position or velocity components of a rogue body (paths like "bodies.rogue.placement.velocity.0"). Ranges should be wide enough to contain a solution.
- Give bodies short lowercase ids and evocative names, and colours as hex strings.
- If the request is not about space, reinterpret it playfully as a space scenario instead of refusing.

JSON schema:
${SCHEMA}

Example of a valid system:
${JSON.stringify(slingshot)}

Reply with only the JSON object inside a single \`\`\`json code block. No other text.`;

export interface DesignResult {
  spec: SystemSpec;
  notes: string[];
  calls: Completion[];
}

/** Pull the JSON object out of a reply that may include a code fence or stray prose. */
export function extractJson(text: string): unknown {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fence ? fence[1] : text;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('no JSON object in reply');
  return JSON.parse(body.slice(start, end + 1));
}

export function formatIssues(issues: SpecIssue[]): string {
  return issues.slice(0, 20).map((i) => `- ${i.path || '(root)'}: ${i.message}`).join('\n');
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
    prompt = `${req.prompt}

Your previous reply was:
${reply.text}

It failed validation:
${problems}

Reply with a corrected JSON object only.`;
  }
  throw new LlmError('Could not get a valid system design after a retry.');
}

/** Prompt -> validated, fixed-up system. Retries once with the validation errors. */
export async function designSystem(llm: LlmBackend, userPrompt: string): Promise<DesignResult> {
  const calls: Completion[] = [];
  const result = await requestValidated(
    llm,
    { system: SYSTEM_PROMPT, prompt: `Design a system for this description:

${userPrompt}` },
    (json): Validation<{ spec: SystemSpec; notes: string[] }> => {
      const parsed = parseSpec(json);
      return parsed.ok ? { ok: true, value: fixupSpec(parsed.spec) } : { ok: false, problems: formatIssues(parsed.issues) };
    },
    calls,
  );
  return { ...result, calls };
}
