import { fixupSpec, levelFromSpec, parseSpec, type Level, type SystemSpec } from '@og/shared';
import slingshot from '@og/shared/fixtures/slingshot.json' with { type: 'json' };
import type { Completion, LlmBackend } from './client';
import { SCHEMA, formatIssues, requestValidated, type Validation } from './design';

const EXAMPLE = {
  ...slingshot,
  briefing: 'Launch the probe from Terra, swing past Jove and ride the boost out to Rime.',
  tip: 'Jove moves while you travel: aim where it will be, not where it is.',
  player: 'probe',
};

const LEVEL_PROMPT = `You design puzzle levels for Orbital Goldberg, a gravity puzzle game. The player sets launch controls for ONE probe or comet, fires it through a small star system simulated with real N-body gravity, and must make an ordered chain of goal events happen. A numeric optimizer then proves the level is solvable by searching the launch controls, so aim for a plausible setup with roughly right numbers rather than exact values.

Output one JSON object: the system (matching the schema below) plus three extra top-level fields:
- "briefing": 1 to 2 short sentences for the player, in game terms (what to hit, reach or swing past). No numbers.
- "tip": one short hint for a stuck player (e.g. about timing or where a planet will be). No numbers.
- "player": the id of the launched body the player controls.

Units: distance in AU, time in years, mass in solar masses. Reference values: Sun mass 1, radius 0.00465. Jupiter mass 9.5e-4, radius 4.8e-4. Earth mass 3e-6, radius 4.3e-5. Moon mass 3.7e-8, radius 1.2e-5. One day is 0.002738 yr. 1 AU/yr is about 4.74 km/s. Circular orbital speed at 1 AU around the Sun is 6.28 AU/yr.

Level rules:
- Exactly one player body: type "probe" or "comet", mass 0 or tiny, placement kind "launch" from a planet or moon (or from the star for a comet).
- Tunables: the player's launch "speed", "angle" and "time" (paths "bodies.<player>.placement.speed" etc.), with ranges wide enough to contain a solution but narrow enough to be a fun puzzle (speed range roughly ±50% of your guess, angle range up to ±60 degrees, time within the first part of the run). You may add ONE extra tunable for the phase of a target body; it is fixed by the optimizer and not shown to the player.
- The goal is an ordered list of 1 to 3 events that involve the player body (flyby, capture, collision, escape). Prefer flybys with generous maxDistance and collisions with large targets; avoid eclipses.
- Compact system: 3 to 6 bodies, one star at the origin (placement kind "free", zero velocity), orbits within about 10 AU. Moons orbit well inside their planet's Hill radius (a_planet * cbrt(m_planet / (3 * m_star))); a third of it or less. Inflate the radius of small collision targets (moons, asteroids) up to about 5x so hits are possible.
- Short runs: sim.duration between 0.5 and 8 years; just long enough for the chain to finish. Leave out sim.dt.
- Give bodies short lowercase ids, evocative names and hex colours.
- Players aim by hand, so near misses of the right shot should still work: prefer big collision targets, moons on wide orbits and generous flyby distances, and avoid chains that only work with a grazing pass of a heavy planet.
- If the request is not about space, reinterpret it playfully as a space level instead of refusing.

JSON schema of the system:
${SCHEMA}

Example reply content:
${JSON.stringify(EXAMPLE)}

Reply with only the JSON object inside a single \`\`\`json code block. No other text.`;

export interface LevelDesign {
  spec: SystemSpec;
  briefing?: string;
  tip?: string;
  player?: string;
  notes: string[];
}

const text = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined);

/** Split the extra level fields from the system, validate and fix up, and check it makes a playable level. */
export function validateLevelDesign(json: unknown, keep?: { player: string; paths: string[] }): Validation<LevelDesign> {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return { ok: false, problems: '- expected a JSON object' };
  const { briefing, tip, player, spec: nested, ...rest } = json as Record<string, unknown>;
  const raw = nested && typeof nested === 'object' ? nested : rest;
  const parsed = parseSpec(raw);
  if (!parsed.ok) return { ok: false, problems: formatIssues(parsed.issues) };
  const { spec, notes } = fixupSpec(parsed.spec);

  const playerId = keep?.player ?? text(player, 40);
  const problems: string[] = [];
  const body = spec.bodies.find((b) => b.id === playerId) ?? spec.bodies.find((b) => b.placement.kind === 'launch');
  if (!body) problems.push('- there is no launched player body (placement kind "launch")');
  else if (keep && body.id !== keep.player) problems.push(`- keep the player body "${keep.player}"`);
  if (!spec.goal.length) problems.push('- the goal needs 1 to 3 events');
  if (spec.goal.length > 3) problems.push('- use at most 3 goal events');
  if (body && keep) {
    // Keep the player's controls: restore any the edit dropped, if the path still exists.
    for (const path of keep.paths) {
      if (spec.tunables.some((t) => t.path === path)) continue;
      const fresh = fixupSpec({ ...spec, tunables: [] }).spec.tunables.find((t) => t.path === path);
      if (fresh) spec.tunables.push(fresh);
    }
  }
  if (body && !spec.tunables.some((t) => t.path.startsWith(`bodies.${body.id}.`))) {
    problems.push(`- add tunables for the player's launch controls (bodies.${body.id}.placement.speed/angle/time)`);
  }
  if (!problems.length) {
    try {
      levelFromSpec(spec, { id: 'check', player: body!.id });
    } catch (err) {
      problems.push(`- could not build a level: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (problems.length) return { ok: false, problems: problems.join('\n') };
  return { ok: true, value: { spec, notes, briefing: text(briefing, 400), tip: text(tip, 200), player: body!.id } };
}

export async function designLevel(llm: LlmBackend, userPrompt: string, calls: Completion[], onProgress?: (textSoFar: string) => void): Promise<LevelDesign> {
  return requestValidated(
    llm,
    // First design without thinking: planets appear within seconds and the draft is playable fast;
    // redesigns (which happen while the player is already playing) think.
    { system: LEVEL_PROMPT, prompt: `Design a level for this description:\n\n${userPrompt}`, thinking: 'off' },
    (json) => validateLevelDesign(json),
    calls,
    1,
    onProgress,
  );
}

export interface RedesignContext {
  request: string;
  previous: SystemSpec;
  goalNotes: string[];
  bestScore: number;
  evals: number;
  keep?: { player: string; paths: string[] };
  /** Set when the previous design was solvable but only with near-perfect aim. */
  fragile?: { robustness: number };
}

/** Ask for a structurally different design after the optimizer could not solve the previous one (or only barely). */
export async function redesignLevel(llm: LlmBackend, ctx: RedesignContext, calls: Completion[], onProgress?: (textSoFar: string) => void): Promise<LevelDesign> {
  if (ctx.fragile) return requestValidated(llm, { system: LEVEL_PROMPT, prompt: fragilePrompt(ctx) }, (json) => validateLevelDesign(json, ctx.keep), calls, 1, onProgress);
  const prompt = `${ctx.request}

A previous design could not be solved: after ${ctx.evals} simulated shots over all tunables the best result completed ${ctx.bestScore.toFixed(2)} of ${ctx.previous.goal.length} goal events. The best attempt's goal checker said:
${ctx.goalNotes.map((n, i) => `${i + 1}. ${n}`).join('\n')}

Previous design (with the optimizer's best values):
${JSON.stringify(ctx.previous)}

Redesign it so the goal becomes reachable while keeping the idea: for example move targets closer or onto the probe's natural path, loosen flyby distances, enlarge collision targets, widen tunable ranges around more plausible values, or lengthen sim.duration a little. Reply with the full JSON object (system plus briefing, tip and player).`;
  return requestValidated(llm, { system: LEVEL_PROMPT, prompt }, (json) => validateLevelDesign(json, ctx.keep), calls, 1, onProgress);
}

function fragilePrompt(ctx: RedesignContext): string {
  return `${ctx.request}

A previous design was solvable, but only with pixel-perfect aim: moving any launch control by half a percent of its range made the shot miss (only ${Math.round(100 * ctx.fragile!.robustness)}% of such near misses still won, even after enlarging the targets). Players aim by hand, so this is unplayable. The goal checker on near misses said:
${ctx.goalNotes.map((n, i) => `${i + 1}. ${n}`).join('\n')}

Previous design (with the optimizer's best values):
${JSON.stringify(ctx.previous)}

Redesign it so that near misses still work while keeping the idea: make collision targets much bigger, put moons on wider orbits, avoid chains that need a grazing pass of a heavy planet (small errors there get amplified), make flyby distances more generous, and keep the flight short. Keep every goal step the request asks for. Reply with the full JSON object (system plus briefing, tip and player).`;
}

/** Talk-to-edit: apply a plain-language change to an existing level. */
export async function editLevelDesign(llm: LlmBackend, level: Level, instruction: string, calls: Completion[], onProgress?: (textSoFar: string) => void): Promise<LevelDesign> {
  const keep = { player: level.player, paths: level.controls.map((c) => c.path) };
  const spec = { ...level.spec, tunables: level.controls.map((c) => ({ path: c.path, min: c.min, max: c.max })) };
  const prompt = `${editRequest(level, instruction)}

Current level:
${JSON.stringify({ ...spec, briefing: level.briefing, tip: level.tip, player: level.player })}

Apply the change and keep everything else as it is where possible. Keep the player body "${level.player}" and its launch tunables. Update the briefing if the goal changed. Reply with the full JSON object (system plus briefing, tip and player).`;
  return requestValidated(llm, { system: LEVEL_PROMPT, prompt, thinking: 'off' }, (json) => validateLevelDesign(json, keep), calls, 1, onProgress);
}

export const editRequest = (level: Level, instruction: string) =>
  `Edit the level "${level.title}" with this change requested by the player:\n\n${instruction}`;
