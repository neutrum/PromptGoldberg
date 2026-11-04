# Credits

Credits for Prompt Goldberg and the earlier Orbital Goldberg prototype. The table below lists the principal libraries; their distributions retain their own license notices.

## Libraries

| Package | License | Use |
|---|---|---|
| three | MIT | 3D rendering |
| three-stdlib | MIT | three.js loaders and helpers |
| @react-three/fiber | MIT | React renderer for three.js |
| @react-three/drei | MIT | R3F helpers (lines, controls, stars) |
| react, react-dom | MIT | UI |
| zustand | MIT | Client state |
| zod | MIT | Schema validation |
| vite, @vitejs/plugin-react | MIT | Build tooling |
| vitest | MIT | Tests |
| fastify | MIT | Backend server |
| @fastify/static | MIT | Serves the built game |
| tsx | MIT | Runs the TypeScript server and scripts |
| jpeg-js | BSD-3-Clause | Shrinks textures of 3D models made live |
| @anthropic-ai/sdk | MIT | Claude API client |
| typescript | Apache-2.0 | Language |
| @dimforge/rapier3d-compat | Apache-2.0 | Rigid-body physics (Prompt Goldberg) |

## AI-generated materials

- Code in this repository was written with assistance from Claude (Anthropic) via Claude Code and Codex (OpenAI).
- Star systems (Orbital Goldberg) and levels (Prompt Goldberg) are designed at runtime by the Claude API.
- The built-in Prompt Goldberg levels in `packages/core/src/fixtures/levels/` were made by the same AI pipeline from their mission sentences.
- Optional 3D looks for workbench parts are generated at runtime through Tripo or Meshy, on the player's own key or, a few a day, the server's. They live in `DATA_DIR/meshes` and are not bundled in this repository. Textures are shrunk with [jpeg-js](https://github.com/jpeg-js/jpeg-js) (BSD-3-Clause).

## Assets

- Sound effects are synthesized at runtime with Web Audio in `apps/web/src/platform/audio.ts`.
- The previously generated ElevenLabs free-plan recordings have been removed from the shipped assets. No recorded voice or external sound sample is loaded by the current app.
- Default part models in `apps/web/public/models/kit-v1/` were generated once with Tripo (model `v3.1-20260211`) from the prompts in `docs/model-kit.prompts.json` and `docs/model-kit.refinements.json`; per-asset task IDs and credit use are in that folder's `provenance.json`. They are visual only and fitted to the procedural colliders, which fall back to code-built meshes if a model fails to load. Terrain and effects are built from code. Players can also apply a saved Tripo appearance over supported parts; their physics stays procedural.
- The 108 models of the thing library in `apps/web/public/models/library/` (landmarks, world centrepieces, everyday things, goals) were generated once with Tripo (same model) by `scripts/pregen-library.ts`; where each came from is in that folder's `provenance.json`. They are visual only; the shape recipes stay the colliders.
- The interface uses system fonts and platform-rendered Unicode emoji.

## Demo video

- Narration: ElevenLabs text-to-speech (voice "Charlie", free plan; attribution: elevenlabs.io).
- Music bed: generated locally by skill-video-studio's `gen-bgm.py` (MIT), no samples.
- Footage: recorded from the live site in Chrome; titles, diagram and end card drawn in HTML and rendered frame by frame; cut and mixed with FFmpeg.
