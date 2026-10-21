# Credits

All third-party code and assets used in Prompt Goldberg and Orbital Goldberg. Permissive licenses only (MIT, Apache-2.0, BSD, ISC).

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

- Code in this repository was written with assistance from Claude (Anthropic) via Claude Code.
- Star systems (Orbital Goldberg) and levels (Prompt Goldberg) are designed at runtime by the Claude API.
- The built-in Prompt Goldberg levels in `packages/machine/src/fixtures/levels/` were made by the same AI pipeline from their mission sentences.

## Assets

- Sound effects in `apps/web/public/sfx/` (cannon, boing, ding, plop, clack, whoosh): generated once with ElevenLabs sound effects (elevenlabs.io), October 2026, on the free plan, which requires attribution: **Sound effects by ElevenLabs.** If the project is used commercially, regenerate them on a paid plan. Without the files the game falls back to its built-in WebAudio synth.
- Voice lines in `apps/web/public/voice/` (31 short "engineer" lines): generated once with ElevenLabs text to speech, premade voice "Will", October 2026, free plan, same attribution: **Voice by ElevenLabs.** The 🗣️ button turns them off; without the files the game is silent there.
- No third-party art or fonts.
