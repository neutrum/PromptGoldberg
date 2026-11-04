# Prompt Goldberg: demo video storyboard

The hackathon asks for a demo video **under three minutes** (terms 6.2.3). Target: **2:30**, 1600×900 capture, mastered to 1920×1080. The finished cut runs **1:56**: the shots below were tightened in the edit, in the same order. Live site: https://ogserver-production.up.railway.app

**The one idea the video must leave behind:** one sentence makes a playable 3D physics level; the AI sets the stage, a person solves it.

## Shots

| # | Time | On screen | Caption / narration | Proves |
|---|---|---|---|---|
| 1 | 0:00–0:08 | Cold open on the payoff: Domino Rally, the ball drops onto the ramp, twelve dominoes fall, the bell rings. Close camera. | *One sentence makes a level. Someone else solves it.* Title: **Prompt Goldberg** | Fun, at a glance |
| 2 | 0:08–0:30 | Start screen → Make a level → type **“a taxi ball crosses New York and stops at the Statue of Liberty”** → Create. The build steps tick off, the stage fills in, the Statue of Liberty stands on the board. | *Any sentence becomes a 3D physics level in about ten seconds.* | Impact, the core loop, live AI |
| 3 | 0:30–0:50 | Fast montage from 💡 Prompt ideas, each “Solve this one” or a picture: Paris and the Eiffel Tower, **“guľa sa kotúľa z Tatier do chaty”** (Slovak), **🐉🏰🔥**, a messy kid’s bedroom, pirates on skull island. | *Any place, any story, any language. Emoji and typos too.* | Generalizability |
| 4 | 0:50–1:12 | Designer: type **“build a fence around the goal”**, then **“make it night”**; drag a landmark to a new spot. Workbench: **“a spiral chute”** → the part lands in the kit as shapes, then its Tripo 3D look replaces them (cut the wait). | *The designer shapes it with words. The Workbench makes new parts: the AI builds the shape, Tripo the 3D look.* | Creative control, AI depth |
| 5 | 1:12–1:48 | **Test it as a player.** Click a ramp under the ball; type **“put a fan 3 cells east of the ball”**. Run: the ball misses, “Not there yet” hint. Turn the fan (R), Run again: goal reached, stars, **✓ server agrees**. | *The AI never solves it for you. Place parts by click or by words, run, try again.* | The game, UX, the server check |
| 6 | 1:48–2:08 | One diagram over a dimmed stage: sentence → the AI writes the level idea → layout on the grid → a solver proves it can be solved with the player’s parts → Rapier physics, re-run on the server for every clear. Numbers fade in. | *49 of 50 judge prompts make a fair level. One AI call per level. Every clear is re-simulated on the server.* | Technical depth |
| 7 | 2:08–2:22 | Share link → it opens on another screen; Today’s puzzle board; Settings → AI providers (Claude, ChatGPT, any OpenAI-compatible, Tripo, Meshy). | *Send a level to anyone. Bring your own AI keys.* | Reach, openness |
| 8 | 2:22–2:30 | End card over the Domino Rally bell. | **Play it:** ogserver-production.up.railway.app · **Code:** github.com/neutrum/PromptGoldberg | Call to action |

## Claims allowed on screen

Only these, each checked against the app or a report:

- About 9 s and one AI call per new level on the live server (measured 2026-11-03).
- 49 of 50 judge prompts make a level proven solvable with the player's parts (`apps/cli/judge-prompts.json`, report in `data/judge/`).
- Every clear is re-run on the server ("server agrees").
- Providers: Claude, ChatGPT, OpenAI-compatible, Tripo, Meshy (Settings → AI providers). ChatGPT and Meshy are marked experimental in the app; say "bring your own keys", not "tested with".
- Landmarks and goals are Tripo models made once (about 110); a Workbench look is made live.

## Capture notes

- Record shots 2, 4 and 5 on the live site: real latency, real AI. Cut waits but never fake a result.
- WebGL needs a real GPU: record in headed Chrome, not headless (headless uses a software renderer and drops frames).
- Before recording: Tripo credits in hand (one Workbench look is about 20), Anthropic credits topped up, the daily AI cap raised on Railway for the session, hints reset (📖 → Show me on the screen) or skipped as the shot needs.
- Shot 1 and 8: Domino Rally is level 1 (Start with level 1). Use the camera follow; zoom in before Run.
- Shot 6: an HTML diagram rendered as a scene, not a screen capture.
- Audio: music bed plus either captions only (silent-demo) or narration. Narration options: ElevenLabs (an MCP is connected here) or the studio's own TTS endpoint.

## Tool: skill-video-studio

[aaitor/skill-video-studio](https://github.com/aaitor/skill-video-studio) (MIT) is a Claude Code skill (`/devrel-video`) that plans beats, captures the browser with Playwright, composes title, chapters and end card with HyperFrames, and masters with FFmpeg (with ffprobe checks, a contact sheet and a thumbnail). Its `brief.yaml` maps onto the shots above: `beats` with `at_seconds`, `approved_claims`, `cta`, `audio`.

Fit: good for capture, composition and checks. Gaps: its narrated mode is on the roadmap (narration needs your own TTS endpoint), and its examples are 25–30 s silent walkthroughs, so a 2:30 film is several captures joined. Needs Node 22+ (24 here), FFmpeg (installed), Playwright with Chromium and some Python packages; keep its workspace on D:, C: is nearly full.

## How the first cut was made (2026-11-03)

Recorded on the live site in a visible Chrome (real GPU) over the DevTools protocol, one script per shot, typing and clicking through the real interface. Narration: ElevenLabs, one clip per shot, split at its pauses so "Missed?" lands on the miss and "Solved" on the win. HyperFrames could not be used here (its npm download was blocked), so the logo animation, diagram and end card are an HTML page rendered frame by frame in headless Chrome, and FFmpeg does the cut, frame, ducked music, loudness (-16 LUFS) and captions. Sources and the build script: `D:\Devel\skill-video-studio\projects\prompt-goldberg` (`rec/shot*.mjs`, `gfx.html`, `build.py`). Output: 1:51, 1920x1080, captions also as `captions.en.srt`.
