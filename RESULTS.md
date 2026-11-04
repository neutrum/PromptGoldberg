# Results

What has been measured, how, and where the evidence is. Numbers are from single runs on the dates given, not guarantees.

## The judge set: 50 prompts written to break it

[`apps/cli/judge-prompts.json`](apps/cli/judge-prompts.json), run with `npm run pg -- judge`. Each prompt must produce a level, show the things it names (`expect` words), and be **fair**: when the level is made, a solver must find a build from the player's own tray that reaches the goal in the physics.

**Full set, 2026-11-02** (local server, Claude through the Claude Code CLI):

| | |
|---|---|
| Levels made | 50 / 50 |
| Fair (proven at creation) | 49 / 50 |
| Not proven | `huge` ("a huge machine across the whole map"): no build found in the time allowed; the level still plays, marked unproven |
| Parts needed (par) | 2 parts: 26 levels · 3 parts: 20 · 4 parts: 4 |
| Time per level | median 20.5 s, 90th percentile 31.9 s (the CLI backend starts a process per call) |

**Live server sample, 2026-11-03** (https://ogserver-production.up.railway.app, Claude API):

| Prompt | Level | Time | Fair |
|---|---|---|---|
| neon Tokyo at night, the ball has to reach the ramen shop | Neon Ramen Run | 8.6 s | ✓ |
| wake the sleeping dragon in its crystal cave | Wake the Dragon | 7.1 s | ✓ |
| a messy kid's bedroom, the marble has to get into the toy box | Marble Bedroom Run | 5.3 s | ✓ |
| 🐉🏰🔥 | Dragon's Lair Drop | 5.6 s | ✓ |
| Grandma lost her ball of yarn … (a 40-word story) | Yarn Escape | 4.7 s | ✓ |
| guľa sa kotúľa z Tatier do chaty (Slovak) | Guľa z Tatier | 5.0 s | ✓ |

6 / 6 made, 6 / 6 fair, every named thing on the board, median 5.6 s. One AI call per level; the daily AI-call cap on the server was 100 then and is 300 for judging.

Recheck on the code as submitted (2026-11-10): the full set on a local server made 50 / 50 levels with every named thing on the board, but proved only 32 / 50 fair, because that local server answers through the slow command-line backend (median 38.5 s a level) and the fairness search shares the machine. The 18 prompts it left unproven were then sent to the live server: **18 / 18 made and fair**, 3 to 9 s each.

## Built-in levels: easy to hard

Measured with the kit solver (`solveWithKit`) on each of the 11 levels in `packages/core/src/fixtures/levels`. "Tries" is how many simulations the solver needed; a newcomer's first level should need few parts and forgive placement.

| Order | Level | Parts to win | Solver tries |
|---|---|---|---|
| 1 | Domino Rally (made 2026-11-03 for the first minute) | 1: the ramp from the tray, under the ball | — |
| 2 | Ramp Run | 2 | 121 |
| 3 | Windy Alley | 2 | 309 |
| 4 | First Shot (the old level 1) | 2 | 409 |
| 5–11 | Bounce House, Castle Siege, Over the Wall, Round the Corner, Pizza Delivery, Wake the Cat, Across the River | 1–3 | 98–498 |

## Physics agreement

Every win is re-run on the server with the same build; the browser and the server must produce the same trace hash (*✓ server agrees* in the game). Checked in every recorded win of the demo video (Domino Rally, Windy Alley) on the live site.

## Failsafes

| Situation | What happens | Test |
|---|---|---|
| The AI answers with invalid JSON | Retried (two retries); after that the player reads "The AI could not make that work this time. Nothing changed" | observed live 2026-11-03; message in `apps/server/src/app.ts` |
| An AI change takes too long | Stopped at 25 s (`EDIT_DEADLINE_MS`), level unchanged, plain message | `apps/server/test/providers.test.ts` |
| Looks ("make it night", "snowy", "sunset") | No AI call; applied in about 30 ms | `packages/core/test/words-looks.test.ts` |
| Placing, turning, removing parts by words | No AI call | `packages/core/test/words-build.test.ts` |
| The Workbench AI is slow or fails | The closest known part after a minute | `apps/server/test/app.test.ts` |
| A level the AI cannot make fair | Still playable, marked unproven; "Solve it for me" says when it finds no way | judge set |
| Redeploys | The daily AI-call count and all levels, parts and 3D looks live on a volume | `apps/server/test/units.test.ts` |

## Tests

`npm test`: 168 tests in 36 files, every layer (core physics, layout, solver and word parsers; AI pipelines against a fake model; the client's stream parsing; whole games headless; server routes with real physics; the web store; the CLI). `npm run typecheck` checks every project reference.

## 3D models

108 Tripo models (low poly, 4,000 faces, textures at 512 px) of everyday things, world centrepieces, famous landmarks and goals the judge set names. Generated once with `scripts/pregen-library.ts` (20 credits each); where each came from is in `apps/web/public/models/library/provenance.json`. Models made live through the Workbench are shrunk on arrival (the first one: 730 KB to 206 KB).

## Not established

Whether the levels are fun, real-device touch play, and Safari. The game was played through in Chrome on desktop and checked at phone size in device emulation.
