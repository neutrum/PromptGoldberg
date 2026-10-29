# Prompt Goldberg: judge walkthrough

**Superseded as the player walkthrough:** the actual teaching now lives in the app. Choose **Show me how**, place the highlighted ramp, press **Run**, then choose **Next: add a fan** and place your own addition. This document's timed presentation plan below is historical; it is not the onboarding experience. New and edited machines now wait for Run, and “add a fan” edits the current scene through placement rather than generating another level.

**One sentence:** turn a description into a physics-checked marble machine, then make it yours with natural-language edits or hands-on construction.

## A demonstration under three minutes

| Time | Action | What it demonstrates |
| --- | --- | --- |
| 0:00–0:20 | Open the workshop; describe “Fire a pizza marble from a cannon over a river into an oven bucket”. | Natural language is the primary input. |
| 0:20–0:50 | Watch the route and its ordered goal checklist. Briefly orbit the stage. | A generated, interactive 3D construction with working simulated logic. |
| 0:50–1:15 | Edit: “Paint the ramp coral and call the ball pizza”. Replay. | The existing machine changes while its verified route is preserved. |
| 1:15–1:55 | Open the brand menu, choose “Learn with one part”, place the highlighted ramp, and Run. | Understandable player interaction, a visible outcome, and independent server verification. |
| 1:55–2:25 | Create a second machine: “A fan blows a marble round a corner to ring a bell”. | A different mechanism and new prompt interpretation. |
| 2:25–2:45 | Explain the fixed kit, physics checks, failed-request recovery, and optional build puzzles. | Scope and verification are explicit. |

Allow for model/network latency when recording. Demonstrate a real live request; do not describe a cached or offline result as AI generation. The timings are a recording plan, not a latency guarantee.

## Why the earlier flow struggled

For a judge, the prompt was buried behind puzzle play, and “New” versus “Edit” depended on a guess about the wording. Some branches delivered unverified puzzles; the compiler could simplify a route or a time limit and still report success. The README described the earlier orbital prototype. These made it hard to assess the entry's core promise.

For a player, the first puzzle demanded too much before teaching placement, and Watch did not actually switch the current scene. For a creator, editing could operate on the hidden original solution instead of the visible arrangement. The current flow addresses these with creation first, a one-part lesson, explicit actions, resumable Watch/Build, visible-build edits, and transactional verification.

## What to claim, and what still needs human judgment

The app generates configurations of a fixed 3D kit and verifies ordered physical goals. It is not a generator of arbitrary meshes or arbitrary game logic. Themes use part names and captions; a pizza remains a marble with marble physics. Explicit requirement checks cover common mechanical requests, not all language. Difficult prompts can fail visibly while preserving the previous build.

The technical flow now supports a clear demo. Whether it feels delightful or has enough creative variety still needs fresh human playtests. Give someone the URL without narration: can they create, understand, edit, and complete the lesson? A completed automated check cannot answer that.

## Submission preparation

The [official hackathon terms](https://www.victoriavr.com/hackathon/2026/terms) remain the source of truth. Prepare the public repository and working demo links, a description and category, and the required short video. The repository should open on this project's README. Verify the hosted AI configuration and budget shortly before judging. This local revision does not publish or submit the project.

The previously bundled ElevenLabs free-plan audio has been removed. The current app uses its own Web Audio synthesis; see [CREDITS.md](CREDITS.md).
