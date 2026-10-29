# Handoff — Done / To do (updated 2026-10-29)

Kept current with every commit so work can be handed between agents and compared. Older milestone notes further down are history.

## Done

2026-10-29 (Claude Code)
- [x] Committed the ChatGPT/Codex workshop revision (local part placement, verified create/edit, Tripo looks, Tripo-generated part kit `apps/web/public/models/kit-v1`). Superseded GLBs moved to ignored `data/model-kit/superseded/`; duplicate reference ZIP ignored; CREDITS corrected for the bundled kit.
- [x] Parts panel thumbnails generated (`models/kit-v1/thumbs/*.webp`); they were missing, every tile showed a broken image.
- [x] Wooden workbench scene: stone plinth, posts under raised parts, trees and rocks off the board. Visual only.
- [x] Stage size per machine (`MachineSpec.stage`, 12–32 cells, default 24): schema checks, compiler, sim floor, nudge, placement, scene. Verified: compile tests on 16×16 and 32×28; live AI creation on 16×16.
- [x] Terrain by prompt: edit ops `ground`, `flatten`, `stage`. The ground may change except under the ball and goal parts; parts on reshaped ground follow it; an edit no longer has to keep an obstacle the player removed. Verified live: "fill in the river", "raise a small hill near the start", "make the stage 20 by 20 and dig a small pond in the far corner".
- [x] Worlds by prompt (`MachineSpec.landscape`, looks only): name, palette, 3–6 features (conifers, broadleaf, birches, palms, cacti, bushes, flowers, mushrooms, reeds, rocks, boulders, hills, mountains, lake, snowdrifts), snow. Written by the AI on creation (route graph and full designer) and edits (`landscape` / `clearLandscape` ops); keyword fallback (`landscapeFromWords`) for offline creation or when the AI leaves it out. Seeded scatter on the apron, tall things behind the board only; instanced rendering. Verified live: "Create a terrain that looks like forests and hills in british columbia" → verified edit in 6.7 s, screenshot checked.
- [x] Settings (••• → Settings): stage size for new machines, five theme presets, custom interface and scene colours, grid / scenery / machine-world toggles; saved in the browser, sanitised on load.
- [x] Obstacles that matter on the board: fixed `prop` obstacles (rock, crate, tree, cactus, stump), each drawn exactly as its collider. The compiler stands them on the straight lines from ball to target and beside the route, never on a cell the ball passes, and keeps each only if the level still solves. Count from the mission: 1 for easy, 3 by default, 6 for hard, crowded, maze or forest; kinds suit the world (trees in a forest, cacti in a desert). Edits can add them ("put rocks in the way"). Verified: obstacle tests on three route types; live "A hard puzzle in a British Columbia forest..." → 6 obstacles, verified in 3.5 s, screenshot checked.
- [x] Shortcut probe and difficulty tiers: the compiler tries lazy builds (each route part left out or shifted 1–2 cells). Those that still solve by another path are shortcuts; obstacles go on their cells first, and a shortcut counts as blocked only when re-run with the obstacle and failing. Tiers from the mission: easy (1 obstacle, no probe), normal (3), hard (6). Notes report "Shortcuts by another path: N, M blocked". Measured: fan routes find about 5 and block 2 (normal) or 3–4 (hard); cannon routes find none; probe adds about 0.5 s. Live hard fan level: 6 found, 4 blocked.
- [x] Reprompting during a puzzle: a looks-only edit (colours, names, world) applies to the puzzle in place and keeps tries and score; an edit that reshapes the puzzle is held behind "Make it my copy" / "Keep playing". Accepting ends the scored run and titles it "(remix)". Previously any AI edit silently ended the puzzle as a give-up. Store tests cover both paths.
- [x] Settings and vocabulary for free-form prompts: `landscape.setting` outdoor or tabletop (a huge table with legs to a workshop floor, so the machine reads as a miniature); 19 new world features (crystals, columns, statues, houses, lanterns, candy, coral, cogs, ice spikes, craters; giant tools, wrenches, pencils, screws, nuts, mugs, books, desk lamp, pegboard); animated ones (cogs and candy spin, crystals float, lanterns bob; off with reduced motion). New board obstacles with honest colliders: crystal, column, nut, bolt, tape, spool, and tools lying over 2–3 cells (hammer, wrench, screwdriver, pencil); a world can name its own `obstacles`. One shared world brief for the route, designer and edit prompts; keyword worlds added for workshop/desk, crystal cave, candy, clockwork, ruins, reef, alien moon, village. Verified live with the judge-style prompt "create me a contraption that is on a wooden table in workshop with tools lying around as obstacles the contraption is a miniature in a real size world": tabletop world with pegboard, giant tools, mugs, screws and lamp; hammers, wrenches, screwdriver and pencil on the board; 3 shortcuts found, 3 blocked; 6.2 s; screenshot checked.
- [x] Machines use the whole grid: the goal goes as far along the ball's last run as it still works, rolling links can stand far down a long roll, and the compiler keeps the layout that spans the stage best (target: the golden section, 0.618, of each side; close placements stay as the fallback). Measured on 20 compiled routes: span 29% → 51% of the stage, start-to-goal floor distance 16 → 26 cells, all 20 still compile.
- [x] Faster layout: three layouts at once on the worker pool, best span kept. Live: workshop prompt layout 4.4 s → 1.6 s; simple fan prompt 0.7 s. Claude's route call (1–6.5 s, varies) is now most of the wait.
- [x] Fixes found on the way: a puzzle rebuilt from the player's placements keeps the solution's part order (the physics depends on it); the daily checks every ladder stage with the day's seed, tries three prompts offline, and is remembered per day in memory (before, a server could hand out different no-AI dailies on each request).
- [x] Goal steps capped at four in the compiler (touch checkpoints dropped first): a long domino chain split into two rows had produced five steps, an invalid machine the client rejected when making the puzzle. Found in the showcase run; regression test added.
- Showcase (live, verified, 3.5–7.6 s each): clockwork pocket watch, dragon's crystal cave, kid's night desk, sunken Atlantis. Weakest: clockwork cogs read as flat grey discs.
- [x] The board is never empty (user feedback: "bleak and boring"): a big low-poly landmark (`landscape.hero`: dragon, castle, ship, robot, rocket, windmill, teapot) lies on the board in the biggest open area off the ball's way, solid where a ball can reach (body, neck, head, tail, towers, hull…), with details above (wings, horns, glowing eyes, roofs, sail, spinning windmill blades); 1.5× scale so it reads from the default camera; the dragon takes the world's accent, deepened. Then the world's obstacles are spread evenly over the free board (3/5/8% of cells for easy/normal/hard, never next to the ball's way, within the 40-part limit), kept only when the level still works. The AI chooses the hero; a keyword fallback names it from the mission (dragon, castle, pirate/ship, robot, rocket/space, windmill/farm, teapot/desk/breakfast). Verified live: dragon cave, pirate cove, breakfast table, each 4.8–6.9 s, about 30 obstacles plus the hero; screenshots checked. Test: the dragon never covers a cell the ball passes.
- Tests: 234 passing across 31 files; typecheck clean.

## To do

Player brief (given earlier to ChatGPT, recovered 2026-10-29):
- [ ] Interface after the reference image in docs/ (as a reference, not a copy). The available parts are already in the right vertical panel.
- [ ] First run self-explanatory for players and judges: tooltip tutorial and visible cues that each step went as it should. A 4-step quick start exists; audit it against a fresh visit.
- [ ] A structured prompt handbook so writing prompts is fun, with generated example images.
- [ ] Decoy mechanisms on the board (a fan aimed the wrong way, a ramp to nowhere): obstacles now block the obvious line, but every mechanism on the board is still part of the solution.
- [ ] Turn wall from the compiler: check it actually blocks the ball (route without it fails), else replace it with an obstacle that does.
- [ ] Shortcuts the probe finds but cannot block (their cells also carry the intended ball): try a different layout seed for hard levels when fewer than half are blocked.
- [ ] Local "add a fan" placement during a puzzle still leaves the puzzle silently; apply the same copy rule.
- [ ] Daily ladder: use the difficulty tiers per stage (easy first, hard last).
- [ ] Clustered, evenly spaced (Poisson-disk) scatter for the world around the board.
- [ ] Full-designer levels (non-route missions) get no obstacle pass yet.

Plan to submission (agreed 2026-10-29; submit Nov 10, deadline Nov 11 16:30 CEST):
- [ ] Oct 29–31: requirement checks that a named world, setting and obstacles were honoured; an "I understood" card (world · obstacles · chain) with honest "closest" notes.
- [ ] Nov 1–3: judge prompt set (about 50 varied prompts) through the real pipeline: success rate, median time, request honoured; fix the top failures.
- [ ] Nov 3–5: first minute: camera follows the ball, slow motion at events, step cues; prompt handbook with example images from the set.
- [ ] Nov 5–7: interface after the reference image; decoy mechanisms; daily tiers. Feature freeze Nov 7.
- [ ] Nov 7–9: public deployment, monitoring, fresh-browser and mobile checks, video. Nov 10: submit.
- [ ] "Simple or detailed look" choice next to the prompt (user request 2026-10-29). Proposal: Quick (now, about 3–6 s) vs Detailed (a denser world from the larger model, plus optional AI-made 3D models for the hero parts through Tripo, about 1–2 min and paid credits, capped per day). Needs a decision on cost before building.

Speed (asked 2026-10-29):
- [ ] Claude call: start laying out as soon as the graph's links and end have streamed (the world and names arrive after), and draw the keyword world at once while the AI is still writing.
- [ ] Measure Claude latency per request in the judge prompt set (median and worst) and check the system prompt actually hits the cache.
- [ ] Photo → themed contraption (Claude vision, no stored photos, EXIF stripped, size cap, rate limit), planned for Nov 3–5.

Follow-ups from 2026-10-29:
- [ ] Themed small obstacles for more worlds (toast, eggs and cutlery for breakfast; barrels and anchors for pirates): breakfast currently falls back to crates and spools.
- [ ] Fill pattern reads slightly regular; cluster it (Poisson-disk with noise) like the surroundings.
- [ ] Cogs: give them visible teeth and an upright stance so the clockwork world reads; check animated pieces in a recorded run.
- [ ] Remaining interface panels still use fixed colours; move them onto the theme variables.
- [ ] Landscape on the board itself (trees between parts) needs colliders or a no-go rule first, or the ball will pass through scenery.
- [ ] README/DEMO: describe stage size, terrain edits, worlds and Settings.
- [ ] Not yet checked: real touch devices, Safari, the public deployment.

# Current workshop revision — 2026-10-27

- Player feedback follow-up: one current-machine prompt by default, literal add commands become local part placement, explicit Run, Undo, and an in-app ramp → run → fan lesson. New-machine creation is separate. Optional Tripo custom looks were added October 29; see docs/TRIPO.md. The reference's broader scenic redesign remains to do.

- Creation is the first action. Watch verified results, edit them with words, then optionally build the route yourself.
- Guided one-part lesson; prompt available during puzzles; Watch/Build switches and resumes the current puzzle.
- API creation and editing always verify. Failed or cancelled requests preserve the previous build and prompt.
- Strict compilation keeps explicit mechanisms, target, duration and parts limits. Unmet requirements are failures; no silent easing.
- Named parts, appearance edits, clearer stage/camera, responsive layout, synthesized audio. Removed the previously generated ElevenLabs audio files.
- README and DEMO.md describe the current entry. Earlier milestone notes below are historical; the unverified puzzle and recorded voice flows are superseded.
- Still needed for submission: publish the reviewed version, check the public demo and repository links, record the final under-three-minute video, and submit the category/description. This revision has not been deployed.

---

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
- [x] Give-up telemetry (2026-10-21): start/solve/give-up/hint per level to `data/plays/*.jsonl` (no player data), `GET /api/machine/stats` gives give-up rate and median tries.

## Week 2 (Oct 18–24): reliable and legible

- [x] Fallback without an AI: `/api/machine` builds a verified level from the mission's words (`createMachineOffline`) when no backend is set or the daily cap is hit; the daily does the same and keeps it for the day.
- [x] Edits as diff ops on Haiku 5.5 (`editOps.ts`): 1–6 s, 70–230 output tokens; the full rewrite is the fallback (`EDIT_OPS=off`).
- [x] Curveballs: the designer sets an honest `closest` note; the compiler adds one when it has to swap the ending.
- [x] Eval at 15 prompts incl. 5 curveballs (`--puzzle`), with the path (route/full) per prompt.
- [x] Drag placed parts by hand; build during the opening replay.
- [x] Route links (2026-10-21): seesaw (catches a falling ball, straight), bell endings that ring 2-3 times (a trench the ball rattles in), domino chains up to 16 (rows end to end). Benchmark 57/57; live: "slowest", "seesaw then trampoline", "ring twice", "only three parts" and a long chain all take the fast path now (1.9-8.7 s, verified). Only "every part" and two-ball missions still go to the full designer.

## Week 3 (Oct 25–31): the game around it

- [x] Share: 🔗 copies a link carrying the whole level (and, once solved, the sender's stars to beat); the daily shares a result line.
- [x] Community levels (2026-10-21): publish after solving (the server runs the build), a strip on the welcome card, a best-build board per level; daily leaderboard where every stage build is re-run on the server against the seeded puzzles. Tries are self-reported (the builds are not).
- [x] SFX baked once from ElevenLabs (free plan, credited in CREDITS.md and on the welcome card). [x] 31 "engineer" voice lines (ElevenLabs TTS, premade voice, free plan, credited), 🗣️ toggle.
- [x] Challenges (2026-10-21): `rules` on the spec (maxParts, minSeconds) read from the mission, kept by the compiled route or eased honestly ("this route runs about 6 s, so the bar is 5 s"); checked after a run that meets the goal, in the browser and on the server. Note: no compiled route runs past ~6 s, so "longer than 10 seconds" is always eased.
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
