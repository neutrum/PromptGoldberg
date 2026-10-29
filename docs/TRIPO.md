# Custom part looks

Tripo is an optional appearance tool inside Prompt Goldberg. The main prompt still creates or changes the machine's working logic. Literal commands such as “add a fan” still select a part for placement in the current scene.

Open **Give a part a new look**, choose an existing marble, fan, bell, wall or domino row, and describe its appearance. Generate, inspect the 3D preview, then choose **Use this look**. The current machine stays playable while generation runs. Applying the model leaves positions, physics, goals and machine identity intact, waits for Run, and supports Undo or Restore original look. One generated domino tile is reused across its row.

Saved looks can be selected again. Repeated requests for the same kind, description and model version reuse an existing job or model, and the UI identifies saved results. Changing scenes while generation runs prevents automatic application to the new scene; select the result from Saved looks when ready.

These are cosmetic models fitted to the kit's dimensions. They do not create arbitrary new mechanisms, colliders, aircraft flight, coaster tracks or joint animations. Ramps, shelves, seesaws, trampolines, cannons and buckets keep their authored visuals in this first integration. This avoids replacing their functional surfaces or compound mechanisms with an arbitrary mesh. The wider wooden-diorama visual pass remains separate work.

## Setup

Set these in the server's local `.env` or hosting environment, then restart the server:

```dotenv
TRIPO_API_KEY=<your private API key>
TRIPO_MODEL_VERSION=v3.1-20260211
TRIPO_DAILY_MODEL_CAP=5
```

The key is never sent to the browser. With no key, existing saved models remain usable. Setting the daily cap to zero disables new submissions. The cap counts submissions per UTC day and survives restarts. There are also two concurrent jobs maximum and per-IP submission limits of two per minute and six per day. These bound submissions, not the account's financial spend; account-side controls remain separate.

Keep `DATA_DIR` persistent. Metadata and downloaded GLBs live under `DATA_DIR/looks`. Ready files are served through stable local URLs. In-progress jobs with known provider task IDs resume after a server restart; uncertain submissions are not automatically repeated. Files from generated looks are not automatically copied into the repository or published elsewhere.

## API and validation

- `GET /api/looks`: availability, supported kinds and saved models.
- `POST /api/looks`: `{kind, prompt}`; returns a cached result or a queued job.
- `GET /api/looks/:id`: progress or a readable failure.
- `GET /api/looks/:id/model.glb`: a completed, locally stored model.

The adapter uses Tripo's documented v2 task API with 5,000 requested faces, standard geometry/textures and PBR. It downloads completed models immediately because provider download URLs expire. Downloads are limited to 20 MB and provider-owned HTTPS hosts. Stored GLBs must embed their buffers and textures. The renderer supports Meshopt and falls back to the original body if loading fails. Generated model shapes and orientation can vary; inspect the preview before applying.

Official references: [authentication and task workflow](https://docs.tripo3d.ai/get-started/quick-start.html), [H3 text-to-model parameters](https://docs.tripo3d.ai/model-generation/text-to-model-v3-0-v3-1.html), and [task results](https://docs.tripo3d.ai/task-query/get-your-task-result.html).

## Verified locally, 2026-10-29

One real model was generated with the user's configured Tripo account: a brass bell with a red wooden knob. The task reported 20 credits consumed and produced a 1,946,740-byte self-contained GLB. That model was imported into the local workshop's saved looks; it was not generated again during browser tests.

Checks cover preview, explicit apply, unchanged machine/goal/physics trace, successful Run, Undo, failure preservation and mobile layout. Server tests cover cache reuse, concurrent duplicate requests, persisted caps, task recovery, malformed files, credential handling and unavailable service. This establishes the tested bell workflow, not the quality of every generated shape or broad generation reliability.

For judges, demonstrate the core language → working chain → Run experience first. Custom looks then show a separate optional way to personalize an already functioning part. Clearly identify saved examples when using them.
