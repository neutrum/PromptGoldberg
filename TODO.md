# TODO

Hackathon deadline: **Nov 11, 16:30 CEST** (submit Nov 10). The hosted demo must stay up through judging (until Nov 25).

## The pivot (Oct 11)

Orbital Goldberg (n-body gravity puzzles) was judged confusing, hard to prompt and not engaging. The research report (`reports/AI native game pivot.md`, not in git) concluded: keep the "AI designs, physics proves" pipeline, drop gravity, build **Prompt Goldberg**: a sentence becomes a Rube Goldberg machine from a small parts kit, a deterministic rigid-body simulation proves it runs, an optimizer nudges parts until it works, and the player changes it by talking. The hackathon's rule 6.1 wants exactly this: a browser project that "turns plain language into 3D scenes and working logic"; judges type their own prompts.

Orbital Goldberg stays in the repo and gets submitted as entry #2 (the Terms allow three).

**Gate, Oct 17:** a typed sentence yields a working machine that is fun to watch for 5 of 10 eval prompts (`npm run eval:machine -w @og/ai`). Otherwise fall back to a Death-by-AI style judge game on the same scene kit.

## Done

- [x] `@og/machine`: 11-part kit (ball, ramp, platform, wall, dominoes, seesaw, fan, trampoline, cannon, bucket, bell) on a 0.5 m grid, Rapier simulation with recorded playback frames, ordered goal checker (bucket, bell, topple, touch), nudge optimizer. Deterministic across threads (tested) and in the browser (same WebAssembly build).
- [x] `createMachine()` in `@og/ai`: design (Sonnet 5.5, no thinking) → run → nudge → redesign with the run's timeline, streaming sketch/draft/machine events. Physics runs in a worker pool.
- [x] Server: `POST /api/machine` and `/api/machine/edit` (SSE).
- [x] Web: Prompt Goldberg screen (menu card and `#machine`): parts appear as Claude writes them, the browser re-simulates for playback, follow camera, goal checklist, "physics-proven" badge, talk-to-edit, prompt chips, sample machine on open.
- [x] First live results: "dominoes and a fan" worked in 7 s (first draft at 3 s); "cannon over a wall" needed one redesign; "seesaw, dominoes, bell" worked after one nudge.
- [x] Fix-it mode (the game): a proven machine is broken three ways (1 missing, 2 missing, a part moved) and the player repairs it; hand-placed parts land on the floor or the platform under the cursor; placed parts can be picked up again; hint after 2 tries.
- [x] Daily: one machine per UTC day (server cache + fallback), a three-stage ladder, best total tries per day.
- [x] Juice: confetti per goal step, slow motion around goal events, fanfare on success, miss sound; orbit camera that frames each machine and glides with the ball.
- [x] Prompt Goldberg is the app at the root URL (old game only at `#orbital`); welcome card with prompt cards, dice button for cards any time, two coach nudges after the first build.
- [x] Puzzle play by default: the AI's goal parts stay, the player builds the chain from the parts in hand ("connect" kind; The Incredible Machine frame). Watch mode is a switch. Puzzle generation on the server.
- [x] Click-to-name: hovering a part shows its player name ("dominoes #2"), clicking puts it in the prompt ("move " + click = "move dominoes #2").
- [x] Levels, not machines (The Incredible Machine frame, user's call 2026-10-12): the designer must put the farthest target at least 10 cells (x+y+z) from the ball and nothing may float (`layoutProblems`, enforced at validation with the reason fed back; 2 retries). Connect puzzles fix only the ball, the targets (bucket/bell/dominoes) and the shelves under them; touch-goal parts and free shelves go to the bin, shelves with a height control (arrow keys). A part dropped in its solution cell gets the solution's nudges back (`withPlacements` magnet), so the AI's layout always counts. Live eval after the change: 7/7 prompts built, spread 16-25, bins of 1-7 parts, 8-27 s.
- [x] Scenery (2026-10-12): walls and shelves with `fixed: true` are level, not bin. Every level needs a fixed wall standing in the box between the ball and the farthest target (`obstacles`, enforced in `layoutProblems`); scenery stays in every puzzle kind, draws in stone grey. Sample is "Over the wall". Mission prompts ("get the pizza into the oven past the guard wall") build 3/3 with a wall, a cannon and ledges.
- [x] Corner rule (2026-10-12): the farthest target must be at least 4 cells away along x AND z (`TURN_MIN`), so every route turns; the optimizer never nudges scenery and keeps shelves inside their cell (a whole-cell shelf move pulled the floor from under parts). Sample is "Over the wall, round the corner" (ramp + cannon in hand).
- [x] Example levels + mission copy (2026-10-12): `packages/machine/src/fixtures/levels/*.json` (AI-built from mission sentences, with a `level` block), listed on the welcome ("Play a level the AI already made") and behind the 🎮 Levels button; the panel shows the mission sentence; solving one nudges "now make your own". Cards are missions (a goal and a place). Generator: scratchpad `genlevels.mjs` + `levelmeta.py`.
- [x] Shaped ground (2026-10-13, user's ask: "non-flat scenery like ditches"): `terrain` on the spec, up to 6 rectangles `{name,x,z,w,d,h}` with h from -2 (ditch, river, pit: a ball that rolls in is stuck) to 3 (bank, hill: the ball can start up there). The sim builds the floor as a slab at the lowest level plus blocks (`groundRuns`), so flat levels are bit-identical to before; placement, the floating check and the "scenery in the way" rule read the ground height; the renderer draws the blocks and a water surface for watery names; the sketch shows the ground before the parts. The designer must shape the ground unless the request says "flat" (`wantsFlat`), and the ground is locked in edits with the targets. Sample has a river under the cannon's flight.
- [x] No answer sheet (2026-10-14, user's call: "you don't have to solve the problem in advance"): puzzle play sends `verify: false`, the AI designs once (validated against the layout rules, 2 retries) and nothing is run, nudged or redesigned. `makeLevelPuzzle` (no physics) keeps the stage and hands out the AI's route parts plus 2–3 `spares` the designer names (kinds only); the panel says nobody has solved it, "Hint" becomes "AI's idea" (unproven), "Watch it whole" replays the player's own build. Watch mode and the Daily still verify. Live: 6/6 missions in 11–22 s (was ~50% in 60–120 s); the AI's own idea worked 0/1 when tried blind, which is the point: the player builds it.
- [x] Variety (2026-10-14): VARIETY and SPARES paragraphs in the prompt (cannon at most one level in three), plus a server-side twist per request (`TWISTS`/`pickTwist` in @og/ai: fan along the bank, trampoline to a ledge, seesaw onto a reversed ramp, dominoes round the corner, hill start, pit crossing, target in a pit, gap in a wall pair, shelf-to-shelf drop) unless the mission names a mechanism. Live eval: hands of trampoline+fan, seesaw+cannon, fan+ramps, seesaw+ramps; ground of moat, pit, river, hill+cellar, hill+bank+pond.
- [x] Edit lock (anti-cheat): the ball and every goal part are fixed in edits. The edit prompt lists them; `validateMachineEdit` in `@og/ai` rejects any reply that moves/removes them or makes the goal easier (`lockProblems` in `@og/machine`), and the retry carries the reason. Redesigns keep the lock too. An edit after a Daily clears the daily so its tries never count.

## Week 1 (to Oct 17): prove the nugget

- [x] Gate eval (2026-10-20, watch mode): 7/10 working machines (gate 5/10). Prompt Goldberg stays the entry.
- [x] Route graphs (2026-10-20, user's "graphify" idea): the AI writes the level's story as a small graph (`RouteGraph`: start, 1–3 links that turn the route, an ending, the mission's names, spares) on Haiku 5.5; `compileRoute` lays it out by following the ball (place a link, simulate, read where the ball lands, put the next part there), adds scenery only while it still works, and every level comes out verified. Puzzle eval, 15 prompts incl. 5 curveballs: 10/10 route levels verified in 1.4–5.3 s; the full designer (11–22 s, unrun) only for missions the graph cannot say (seesaw, "twice", "only three parts"). Kinematics in the commit message of 2a8653c.
- [x] Solvable built-in levels: `scripts/levels.ts` checks every level runs and leaves a bin (`--fix` nudges and writes). Ten levels: five new ones made through the AI route path (`packages/ai/scripts/gen-levels.ts`, one mechanism each: cannon, fan, ramp turn, cannon+trampoline, cannon+fan) then the older five, all with spares.
- [x] Par (the AI's route length), three stars (solve, par or fewer parts, 3 tries or fewer), hints cost 2 tries, best stars per level. Difficulty words ("easy", "hard", "fiendish") map to enforced spread and bin sizes.
- [x] Bins: puzzle levels must hand out 2+ route parts and 2+ spares (`binProblems`); connect puzzles hand out the spares too.
- [x] Nicer parts: spinning fan blades, a bell dome, a tilted cannon barrel on wheels; a sound and a ring flash for every physics event.
- [x] Browser vs server determinism: `/api/machine/verify` re-runs a solved build; all ten levels bit-identical, "✓ server agrees" badge.
- [ ] Log give-ups per level (no telemetry yet).

## Week 2 (Oct 18–24): reliable and legible

- [x] Fallback without an AI: `/api/machine` builds a verified level from the mission's words (`createMachineOffline`) when no backend is set or the daily cap is hit; the daily does the same and keeps it for the day.
- [x] Edits as diff ops on Haiku 5.5 (`editOps.ts`): 1–6 s, 70–230 output tokens; the full rewrite is the fallback (`EDIT_OPS=off`).
- [x] Curveballs: the designer sets an honest `closest` note; the compiler adds one when it has to swap the ending.
- [x] Eval at 15 prompts incl. 5 curveballs (`--puzzle`), with the path (route/full) per prompt.
- [x] Drag placed parts by hand; build during the opening replay.
- [ ] Route links the compiler cannot do yet: seesaw, a long domino chain as a link, "ring it twice". Each would move a mission from the slow designer to the fast path.

## Week 3 (Oct 25–31): the game around it

- [x] Share: 🔗 copies a link carrying the whole level (and, once solved, the sender's stars to beat); the daily shares a result line.
- [ ] A community gallery of machine levels (reuse `GalleryStore`), and a server-side daily leaderboard (the verify endpoint is the anti-cheat base).
- [x] SFX baked once from ElevenLabs (free plan, credited in CREDITS.md and on the welcome card). [ ] The ~30 "engineer" voice lines.
- [ ] Challenge prompts with constraints ("use only three parts", "longer than 10 seconds"); the opening five levels already teach one mechanism each.
- [x] Mobile layout check at 390x844 with touch taps; CREDITS.md updated.

## Week 4 (Nov 1–7): harden and record

- [ ] Dedicated Console workspace + key with a $50 cap; per-session and per-IP caps; 30 pre-generated machines as fallback.
- [ ] Railway Hobby plan, uptime check on `/api/health`, `DAILY_LLM_CALL_CAP` sized for judging. (No deploys until asked.)
- [ ] Freeze the schema Nov 7. Playtest with 3–5 people. Record the < 3 min video (storyboard in the report). Write the description in the organizer's words.

## Buffer (Nov 8–10)

- [ ] Playtest fixes; two-day prompt-chip pass on Orbital Goldberg for entry #2; submit both Nov 10; confirm the focus category on Discord.

## Lessons from The Incredible Machine (1992, Dynamix; research 2026-10-11)

What it was: a goal in one line ("put the ball in the basket"), a board with fixed parts, a parts bin at the side with a few parts in limited numbers, Run/Stop, deterministic physics (no random numbers), 87 puzzles that introduce one part at a time, then a free-form mode. About 45 parts; nine months and ~$36k to build; a million copies by 2000. Successor: Contraption Maker (2014, same designers), 200+ puzzles, Steam Workshop sharing.

What to copy:
- The frame: goal sentence + fixed parts + bin. That is now the default play ("connect"): the AI's goal parts stay, everything else goes into the bin. Any build the physics accepts wins; the AI's layout is only one solution.
- Scarcity makes it solvable: the bin is small on purpose. Keep hands at 2–5 parts; add 1–2 decoy parts for the hard tier later.
- Teach one part at a time: the first cards should each introduce one part (ramp, then fan, then cannon...). Order the card deck that way.
- Surplus parts are fine; a win with parts left over feels clever. (Already allowed: Run works before every part is down.)
- Environment knobs (gravity, wind) were their late-game variety; cheap for us later (a "low gravity" prompt flag).
- Humour carried it (Pokey the cat, Mort the mouse). Our version: captions from the AI, a named cat/pizza card, silly goal names.
- Score was time and puzzles; players ignored it. Keep tries, not time.
- What we add that it never had: the sentence. Nobody hand-authors the 87 puzzles; the judge types one and gets a level.

## Cut list

No multiplayer, no live voice agent, no Meshy at runtime, no splats, no WFC, no new orbital content, no AI-generated art.

## Known technical notes

- Rapier 0.21 (`@dimforge/rapier3d-compat`, Apache-2.0). Timestep 1/120 s, playback frames at 60 Hz. Parts are created in spec order; change that and traces change.
- Sonnet 5.5 refuses `thinking: disabled`; the client sends `between_tools` for it (`thinkingOff()` in `packages/ai/src/llm/client.ts`). Opus 5.5 cannot turn thinking off at all.
- Changing any kit dimension in `KIT` changes every stored machine's behaviour; re-run `npx tsx packages/machine/scripts/run.ts <fixture> --nudge --write` for the fixtures and the tests.
- Orbital Goldberg notes (solver workers, level solutions tied to `sim.duration`, piece sizes) still apply to `packages/shared`.
- Anti-cheat today covers edits only. Scores (daily best) live in localStorage and the client sends the machine to `/api/machine/puzzle`, so a leaderboard would need the server to generate the daily puzzle itself and verify the player's placements with its own simulation (`POST /api/daily/solve`); all the pieces exist.
