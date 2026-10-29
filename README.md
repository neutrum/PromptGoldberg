# Prompt Goldberg

Describe a marble machine, watch it work, then change it with words or rebuild the route yourself. A playful browser workshop for the Victoria VR AI Builder Hackathon 2026.

**The promise:** the prompt acts on the machine in front of you. Simple requests such as “add a fan” put that part in your hand: click to place it, then press Run. They never generate a different level. AI changes are checked before application; failed AI requests preserve your build and prompt. New and edited machines wait for you to press Run.

## Try it

1. Choose **Show me how**: place the highlighted ramp, then press **Run**.
2. After it works, choose **Next: add a fan**, place the fan, and try your own variation.
3. In the workshop, type `add a fan`, or pick a part in the side panel. R turns it; Escape cancels placement.
4. Press **Run** to test your arrangement. **Undo** restores the previous edit. Try `paint the ramp coral` for an AI appearance change.
5. Choose **New machine…** only when you want another scene. For example: `Fire a pizza marble from a cannon over a river into an oven bucket`.

Ten ready-made puzzles, a daily challenge, share links, and a community gallery extend the workshop. Progress is saved in this browser. The original orbital prototype remains at `/#orbital`; it is separate from the current entry.

## Run locally

Use Node.js 24 and npm. From the repository root:

```sh
npm ci
# Copy .env.example to .env and set ANTHROPIC_API_KEY for live AI.
npm run dev:server   # Terminal 1: API on port 8787
npm run dev          # Terminal 2: browser app on http://localhost:5173
```

The browser proxies `/api` to the server. The key stays on the server. With a key, the API backend is selected automatically; `LLM_BACKEND=api` makes that choice explicit. Without a key, development may use a local Claude Code login. In production without AI access, creation uses the disclosed offline keyword builder; natural-language editing requires AI. Ready-made puzzles and local physics still work.

```sh
npm test
npm run typecheck
npm run build
npm start -w @og/server  # Serves the built app and API on port 8787
```

See [DESIGN.md](DESIGN.md) for UX decisions, [VALIDATION.md](VALIDATION.md) for verification results, [DEPLOY.md](DEPLOY.md) for hosting, [DEMO.md](DEMO.md) for a short demonstration and judge expectations, and [CREDITS.md](CREDITS.md) for assets and assistance.

## What happens behind the prompt

Claude interprets the request as a small route graph. A compiler places mechanisms using simulated trajectories, then runs the complete machine in Rapier. More complex requests use a full design, physics check, bounded placement search, and redesign loop. Edits first use compact operations against the current visible build, then fall back to a complete design if needed.

AI creation checks explicit mechanism counts, their goal participation, bucket/bell finishes, repeat rings, and parts/time limits. Strict compilation does not remove requested mechanisms or ease those limits to manufacture a success. AI edit checks reject unchanged results and omitted explicit additions or repeated rings. These are targeted checks, not a complete natural-language correctness proof. Direct part additions are player construction: they remain untested until Run, and the player chooses whether the new part participates in the route.

The browser receives progress over SSE. Intermediate drafts do not replace a working scene. A final verified machine is replayed from a physics trace produced in a Web Worker. The server independently reruns solved puzzles and compares trace hashes. Cancelled or failed AI requests preserve the previous scene.

## The kit and its limits

The kit has one marble, ramps, shelves, walls, dominoes, seesaws, fans, trampolines, cannons, buckets, and bells, plus raised ground and ditches. A pizza is a named marble; an oven is a named bucket. Optional [Tripo custom looks](docs/TRIPO.md) generate cosmetic models for marbles, fans, bells, walls and dominoes: preview, apply, Run, Undo. Physics remains defined by the tested kit. Arbitrary new mechanics and fluid simulation are unsupported.

Complex combinations can fail. Multiple marbles are unsupported. The timed challenge parser supports up to 14 seconds. Editing keeps the start, existing goal parts, and terrain fixed; use New machine for a different setting. A physically valid result does not establish every subjective aspect of a prompt, such as “the funniest” or “the slowest possible”. The interface discloses substitutions supplied by the designer and all offline builds.

## Repository

| Directory | Responsibility |
| --- | --- |
| `packages/machine` | Shared schemas, kit geometry, Rapier simulation, ordered goals, route compiler, puzzle construction, built-in levels |
| `packages/ai/src/machine` | Route/design prompts, edit operations, requirement checks, physics worker orchestration |
| `apps/web/src/machine` | Workshop UI, placement controls, 3D playback, state, streaming client |
| `apps/server` | Fastify API, live AI, daily puzzles, verified gallery, rate limits and storage |
| `packages/shared`, other web screens | Earlier orbital prototype |

Key endpoints are `POST /api/machine`, `POST /api/machine/edit`, `POST /api/machine/verify`, `POST /api/machine/puzzle`, `GET /api/machine/daily`, and `/api/machines`. Public create/edit endpoints always verify even if a client sends `verify:false`. The package API retains an explicit design-only option for experiments; the workshop does not use it.

The prompt evaluation script reports verification, measurable unmet requirements, timing, and model usage:

```sh
npm run eval:machine -w @og/ai -- --only 3,9,11 --out results.json
```

This makes live model calls when configured. It does not measure player enjoyment. Server limits, storage, and model overrides are documented in `.env.example`. Persist `DATA_DIR` when hosting to retain community levels and daily results.
