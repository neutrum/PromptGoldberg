# Credits

Credits for Prompt Goldberg and the earlier Orbital Goldberg prototype. The table below lists the principal libraries; their distributions retain their own license notices.

## Libraries

| Package | License | Use |
|---|---|---|
| three | MIT | 3D rendering |
| @react-three/fiber | MIT | React renderer for three.js |
| @react-three/drei | MIT | R3F helpers (lines, controls, stars) |
| react, react-dom | MIT | UI |
| zustand | MIT | Client state |
| zod | MIT | Schema validation |
| vite, @vitejs/plugin-react | MIT | Build tooling |
| vitest | MIT | Tests |
| fastify | MIT | Backend server |
| @anthropic-ai/sdk | MIT | Claude API client |
| typescript | Apache-2.0 | Language |
| @dimforge/rapier3d-compat | Apache-2.0 | Rigid-body physics (Prompt Goldberg) |

## AI-generated materials

- Code in this repository was written with assistance from Claude (Anthropic) via Claude Code and Codex (OpenAI).
- Star systems (Orbital Goldberg) and levels (Prompt Goldberg) are designed at runtime by the Claude API.
- The built-in Prompt Goldberg levels in `packages/machine/src/fixtures/levels/` were made by the same AI pipeline from their mission sentences.
- Optional custom part appearances are generated at runtime through Tripo. The app stores the description, provider model version, task ID and reported credit use alongside each local asset; see [custom looks](docs/TRIPO.md). These generated files live in `DATA_DIR/looks` and are not bundled in this repository.

## Assets

- Sound effects are synthesized at runtime with Web Audio in `apps/web/src/game/audio.ts`.
- The previously generated ElevenLabs free-plan recordings have been removed from the shipped assets. No recorded voice or external sound sample is loaded by the current app.
- Default part models in `apps/web/public/models/kit-v1/` were generated once with Tripo (model `v3.1-20260211`) from the prompts in `docs/model-kit.prompts.json` and `docs/model-kit.refinements.json`; per-asset task IDs and credit use are in that folder's `provenance.json`. They are visual only and fitted to the procedural colliders, which fall back to code-built meshes if a model fails to load. Terrain and effects are built from code. Players can also apply a saved Tripo appearance over supported parts; their physics stays procedural.
- The interface uses system fonts and platform-rendered Unicode emoji.
