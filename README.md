# Orbital Goldberg

A gravity puzzle game. Aim a probe, bend it around planets, and trigger a cosmic chain reaction: skim the giant, then reach the ice world, then crash into its moon. Every level is a real N-body simulation, and every AI-made level is proven solvable by an optimizer before you play it. Victoria VR AI Builder Hackathon 2026 entry. See [`orbital-goldberg-mvp.md`](orbital-goldberg-mvp.md) for the product plan.

## How it plays

- **Aim, launch, watch the chain.** Drag back from the glowing probe (or use the sliders / arrow keys) to set power, aim and launch time. A dotted line previews the first part of the path; the rest is the surprise. Numbered checkpoint rings light up with a chime as each goal step happens, time slows near every encounter, and a miss shows exactly where and by how much.
- **Stars and par.** Solve within par shots for three stars. Previous shots stay as ghost trails.
- **Build pieces.** Some levels let you drop a planet or gas giant onto an orbit to bend the path.
- **Race the machine.** Start the optimizer on the same level and compare its hundreds of simulations to your handful of shots.
- **Hints and coach.** After two misses you get a direction ("a little more power"); an AI coach phrases it from the actual event log. A solution path costs a star.

## Modes (replay value)

| Mode | Content source |
| --- | --- |
| Campaign | Hand-made levels with a difficulty curve (`packages/shared/src/levels`) |
| Daily challenge | Procedurally generated from the UTC date, same for everyone; share your result |
| Endless | Generated systems of rising difficulty with a shared shot budget; clearing a system refunds par shots |
| Create with AI | Prompt -> Claude designs -> optimizer proves solvable (or asks Claude to redesign) -> play; remix by talking |
| Community | Publish levels you beat; others play them, plays/clears/records are tracked |
| Share links | A level travels whole inside the URL hash; no server needed |
| Sandbox | The original simulator with JSON editing and the event log |

Progress (stars, best shots, daily results, endless best) is kept in the browser's localStorage.

## Layout

```
packages/shared   Pure TS used by browser worker and server
  schema.ts       SystemSpec (bodies, placements, goal events, tunables) — zod, source of truth
  init.ts         Kepler elements / launches / free states -> N-body state, timestep choice
  sim.ts          Leapfrog KDK, fixed grid + automatic substeps in close encounters, merges
  events.ts       Trace (approaches, bound spans, eclipses, escapes) + goal-independent event log
  goal.ts         Ordered goal checker with continuous score and human-readable misses
  optimizer.ts    Random scouting + Nelder–Mead over declared tunables
  fixtures/       Hand-made systems: slingshot, eclipse, rogue moon theft
  game/level.ts   Level schema (spec + player body + controls + par + pieces + solution), scoring
  game/procgen.ts Seeded procedural levels for daily / endless, verified solvable
  levels/         Campaign
apps/web          Vite + React Three Fiber; simulation, optimizer and procgen run in Web Workers
  game/           Game store, WebAudio synth sfx, hints, share links, API client
  scene/          GameScene (flight playback + slow-mo), Aim (drag to aim, piece placement), Checkpoints, Effects
  screens/        Menu, campaign, play HUD, create, community, sandbox
apps/server       Fastify game backend: prompt -> proven-solvable level (SSE), talk-to-edit, coach, gallery
```

Units: AU, years, solar masses (G = 4π²). Launch `speed` is departure speed once clear of the source body's gravity.

## Develop

```sh
npm install
npm run dev          # web app on http://localhost:5173
npm run dev:server   # API on :8787 (proxied from the web app under /api)
npm test             # physics, goal checker, optimizer, fixtures
npm run typecheck
```

Tune a fixture and write the solved numbers back:

```sh
npx tsx packages/shared/scripts/tune-fixture.ts packages/shared/src/fixtures/slingshot.json --budget 2000 --write
```

### AI backend

Two LLM backends, chosen in `apps/server/src/llm/client.ts`:

- **`cli` (dev only, default without a key):** runs the local Claude Code CLI headless (`claude -p`), so development uses your own Claude Code login. Refused when `NODE_ENV=production`.
- **`api`:** the Claude API via `@anthropic-ai/sdk`; used automatically once `ANTHROPIC_API_KEY` is set. Required for the hosted demo.

Copy `.env.example` to `.env` to override (`LLM_BACKEND`, `CLAUDE_MODEL`, `CLAUDE_COACH_MODEL`, rate limits, ...).

**Repair loop** (`apps/server/src/game/pipeline.ts`): the LLM designs a level (system + briefing + tip + player body) -> the optimizer searches all tunables (600 evals / 12 s, in a `worker_threads` worker so the stream keeps flowing) -> on a miss the LLM redesigns from the goal checker's miss notes, up to 3 designs. The level's `solution` holds the proven control values; the starting sliders are the LLM's original guess if it misses, otherwise a nudge away from the solution that is checked to miss.

Try the pipeline without HTTP: `npm run solve -w @og/server -- "A comet swings past the gas giant and crashes into its moon"`.

### API

Wire types live in `packages/shared/src/game/api.ts`.

| Endpoint | |
| --- | --- |
| `POST /api/level {prompt}` | SSE stream of `LevelStreamEvent`: `stage` (designing / verifying / redesigning), `progress`, then `level` (`solved`, `cached`) or `error`. Solved levels are cached by normalized prompt hash under `DATA_DIR/cache`. |
| `POST /api/edit {level, instruction}` | Same stream, first stage `editing`. Keeps the player body and its controls. |
| `POST /api/coach CoachRequest` | `{tip}`: rule-based tip (failed step, closeness, direction toward the known solution, never numbers), rephrased by `CLAUDE_COACH_MODEL` when it answers within 8 s. |
| `GET /api/gallery?sort=new\|top&limit=N` | `{items: GalleryItem[]}` |
| `GET /api/gallery/:id` | `GalleryItem & {level}` |
| `POST /api/gallery {level, author?}` | Publishes a level; its `solution` is replayed server-side and must clear it. |
| `POST /api/gallery/:id/result {cleared, shots}` | Counts plays, clears and best shots. |
| `POST /api/design`, `POST /api/check` | Sandbox: prompt -> system, headless simulate + goal check. |
| `GET /api/health` | LLM backend, solver mode, gallery size, LLM calls today. |

SSE errors (bad input 400, rate limit 429, no backend or daily cap 503) are sent as an `error` event with the matching status. Gallery data is one JSON file (`DATA_DIR/gallery.json`, default `<repo>/data`), written atomically.

Hosted-demo protection: per-IP limits on LLM endpoints (`RATE_LIMIT_PER_MIN`=6, `RATE_LIMIT_PER_DAY`=40), a global `DAILY_LLM_CALL_CAP`, prompt length caps, publish/result limits. Set `TRUST_PROXY=1` behind a reverse proxy.

## Milestones

- [x] Scaffold, simulation, renderer, hand-written systems, goal checker (all five event types), event log + timeline, optimizer
- [x] Prompt -> schema with Claude, validation + auto-fix (API or dev-only CLI backend)
- [ ] 10 test prompts eval script
- [x] Repair loop over SSE (optimizer first, LLM redesign second), solver worker threads
- [x] Coach tips and talk-to-edit
- [ ] Curveball prompts
- [x] Rate limits, caching, budget cap, community gallery
- [x] Game loop: aim/launch/checkpoints/stars, sound, ghosts, hints, race the machine, build pieces
- [x] Replayability: campaign, daily, endless, AI levels, remix, share links, community gallery
- [ ] Onboarding tutorial, mobile touch polish, deploy
