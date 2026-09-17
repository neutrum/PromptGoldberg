# TODO

Hackathon deadline: **Nov 11, 16:30 CEST** (submit a day early). Hosted demo must stay up through judging (until Nov 25).

## Next up (in order)

- [ ] **Playtest with 3–5 people who have never seen the game.** Watch them play the tutorial and levels 1–5 without helping. Note where they get stuck, what they misread, and how many shots each level takes. Adjust par and level order from this.
- [ ] **Mobile / touch polish.** Drag-to-aim, piece placement and orbit camera on touch; the side panel is hidden under 600 px width; check the result card and tutorial bubbles on a phone.
- [ ] **Deploy.** VPS or managed host, `NODE_ENV=production`, `ANTHROPIC_API_KEY` set (the CLI backend is refused in production), `TRUST_PROXY=1` behind a proxy, persistent `DATA_DIR` for the gallery, and uptime monitoring through Nov 25.
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
- [ ] Procgen starting sliders often sit at the edge of their range; start them nearer the middle.
- [ ] Race-the-machine counter only updates when the optimizer improves; add a steady evaluation count.
- [ ] Pieces feel static but move during flight; consider showing their future orbit arc while placing.
- [ ] Optional bloom/post-processing and a subtle ambient music loop (generated, to keep licensing clean).

## AI

- [ ] Eval script: 10 test prompts; target 8/10 levels proven solvable within 3 designs, first level in under 60 s.
- [ ] Curveball / off-topic prompts: check they become sensible space levels.
- [ ] Talk-to-edit and the redesign path were only tested with the fake LLM; test with the real API.
- [ ] Speed up AI level creation (~60 s now): cheaper model for the first design, or stream the design as soon as it's valid and verify in the background.

## Known technical notes

- Stored level solutions break if `sim.duration` changes (the timestep changes with it); after editing any level, re-run `npx tsx packages/shared/scripts/solve-level.ts <file> --write`.
- Placed pieces can nudge light planets off their orbits; prefer goals that don't depend on a light moving target.
