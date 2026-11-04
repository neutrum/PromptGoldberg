# AI providers

Players can bring their own key (Settings → AI providers). Without one, the server's own AI is used.

| Provider | Kind | What it does | Tested |
|---|---|---|---|
| `anthropic` | text | Designs levels, changes them, builds Workbench parts | Yes: the game is tuned on Claude |
| `openai` | text | The same, on ChatGPT | Experimental |
| `openai-compatible` | text | Any server that speaks the OpenAI chat API (OpenRouter, Groq, Mistral, Ollama…) | Experimental |
| `tripo` | mesh | A 3D model for a Workbench part | Yes |
| `meshy` | mesh | The same, on Meshy (preview, then refine) | Experimental |

## How a key travels

The browser keeps the key and sends it with each request in an `x-pg-*-key` header. The server
builds the provider for that one request and drops it. It never writes the key to disk or to the
logs. A request on a player's key skips the server's daily AI budget, but keeps the per-minute
limit, because the physics still runs on the server.

## Adding a provider

1. Write one file here that exports a `TextProvider` or a `MeshProvider` (see `types.ts`).
   - A text provider's `create(config)` returns an `LlmBackend`: `complete({ system, prompt, maxTokens, signal })`
     resolves to `{ text }`. The game asks for JSON and checks it, so any model that follows a JSON brief works.
     A provider that speaks the OpenAI chat API is one call to `chatCompletions(...)`.
   - A mesh provider's `create(config)` returns `start(prompt)` (a task id) and `check(task)`
     (`running`, `failed`, or `done` with a GLB URL). Set `downloadHosts` to the provider's own hosts.
2. Add it to the list in `index.ts`, or call `registerProvider(...)` from the host at start-up.

The settings screen lists it from `GET /api/providers`.
