# TODO

Hackathon deadline: **Nov 11, 16:30 CEST** (submit a day early). Hosted demo must stay up through judging (until Nov 25).

## Next up (in order)

- [ ] **Playtest with 3–5 people who have never seen the game.** Watch them play the tutorial and levels 1–5 without helping. Note where they get stuck, what they misread, and how many shots each level takes. Adjust par and level order from this.
- [x] **Mobile / touch polish.** Checked in emulated phones (390×844): side panels move into the bottom stack, the camera frames the system in the space the HUD leaves free, larger grab radius, press-drag-release piece placement, tappable Skip, and touch-worded tutorial. Still to do: try it on a real phone (iOS Safari and Android Chrome).
- [x] **Deploy.** Live on Railway: https://ogserver-production.up.railway.app (Dockerfile + railway.json, volume at /data, see DEPLOY.md). Still to do: move to the Hobby plan before the free trial ends, add uptime monitoring on `/api/health`, raise `DAILY_LLM_CALL_CAP` to about 300 for judging. Measured live: first AI draft 30 s, final version 169 s (slower than local; the free trial has 2 shared vCPUs).
- [ ] **Demo video (under 3 min).** A prompt → the AI designs → the optimizer proves the level can be won → you beat it; show the tutorial, a build level and the daily challenge.
- [ ] **Submission:** short description, focus category (confirm on Discord), public repo link, hosted link, `CREDITS.md` check.

## Content

- [ ] **Two-piece build levels.** An earlier attempt was dropped: every working spot for the second piece relied on long-range effects no player could reason out. Most promising direction: short flights, a heavy nearby second target that the pieces don't disturb, and designing backwards (place pieces first, then put targets on the resulting path). Tools: `packages/shared/scripts/solve-level.ts --search-pieces`, `piece-search.ts`.
- [ ] **Levels that combine aim and building.** Earlier attempts failed: the controls could usually solve them without the piece, and forcing the piece left very narrow solutions.
- [ ] **Level 9 (Build a Slingshot)** is the least forgiving of misclicks (33% of small nudges still solve); re-tune for a more forgiving piece spot.
- [ ] **Level 7 (Bank Shot)** only works for about 1 in 75 random placements; watch whether playtesters find it.
- [ ] More campaign levels between the harder ones (eclipse, capture, moon collisions).

## Game feel

- [ ] Generated levels at difficulty 7+ are very hard (almost no random shots succeed); consider easier Endless difficulty steps or more forgiving flyby distances after playtesting.
- [x] Procgen starting sliders start near the middle (was 34% of sliders within 10% of an edge, now 0% over 32 sample levels).
- [x] Race-the-machine counter updates on every simulation (`onEval`, sent at most every 50 ms).
- [x] Placed pieces show a dashed arc of where they travel during the probe's preview window.
- [ ] Optional bloom/post-processing and a subtle ambient music loop (generated, to keep licensing clean).

## AI

All AI logic is in `packages/ai` behind one call, `createLevel()`. Eval: `npm run eval -w @og/ai -- --edits`.

- [x] Eval script with 10 prompts (8 normal, 2 curveballs). Claude Code CLI backend, 2026-09-22:
  - Baseline: 10/10 solved within 3 designs, 9/10 under 60 s (median 23 s), but 4/10 levels were knife-edge (17% or fewer of ±0.5% control nudges still won).
  - After adding forgiveness (loosen the goal, else redesign with the near-miss notes): 10/10 solved, 8/10 under 60 s (median 44 s), least forgiving level 33%, 7/10 at 67% or more.
- [x] Curveball prompts ("pizza", "my cat knocking things off the table") become sensible space levels.
- [x] Talk-to-edit and redesign tested with the real model (CLI). One edit took 26 min once and did not reproduce (75 s on replay); probably slow CLI calls. `createLevel` now has a total deadline (server: `LEVEL_DEADLINE_MS`, 150 s).
- [ ] Re-run the eval with `ANTHROPIC_API_KEY` once it is available (CLI timings include Claude Code start-up).
- [x] Progressive levels: the first playable draft shows after about 15–18 s (end-to-end in the browser); proof and fairness improvements arrive while the player plays.
- [ ] Faster first draft: a cheaper or faster model for the first design, or stream the LLM reply (API backend) and show bodies as they arrive.
- [ ] Levels are still hard for random play (0–10% of random shots win); watch in playtests whether the AI levels feel fair.

## Known technical notes

- Stored level solutions break if `sim.duration` changes (the timestep changes with it); after editing any level, re-run `npx tsx packages/shared/scripts/solve-level.ts <file> --write`.
- Placed pieces can nudge light planets off their orbits; prefer goals that don't depend on a light moving target.
