# Deploying Prompt Goldberg to Railway

One service runs everything: the built web game plus the API, from the `Dockerfile`. `railway.json` tells Railway to build that Dockerfile, check `/api/health` and restart on crashes.

## First deploy (about 10 minutes)

1. **Create the project.** On [railway.com](https://railway.com): New Project → Deploy from GitHub repo → `neutrum/PromptGoldberg`. Railway picks up `railway.json` and builds the Dockerfile. Every push to `main` redeploys.
2. **Add a volume** for the community gallery, daily boards, the workbench library (`workbench-parts.json`) and the 3D looks players make (`meshes/`): the service → Settings → Volumes → New volume, mount path **`/data`**. Start with 1 GB and monitor storage as models accumulate. Without it, all of these disappear on every push, since every push redeploys.
3. **Set the variables** (service → Variables):

   | Variable | Value | Why |
   | --- | --- | --- |
   | `ANTHROPIC_API_KEY` | a **new** key made only for this deploy | the AI level designer and coach |
   | `DAILY_LLM_CALL_CAP` | `100` while testing, `300` for judging | hard daily limit on AI calls (about 2 per level) |
   | `RATE_LIMIT_PER_DAY` | `40` (default) | AI levels per visitor per day |

   No Tripo or Meshy key on the server: players bring their own in Settings → AI providers, and their requests skip `DAILY_LLM_CALL_CAP`. Already set by the Dockerfile: `NODE_ENV=production`, `DATA_DIR=/data`, `TRUST_PROXY=1`. Railway sets `PORT` itself. Other settings are listed in `.env.example`.
4. **Get a URL:** service → Settings → Networking → Generate Domain. A custom domain can be added in the same place.
5. **Check it:** open `https://<your-domain>/api/health`. Expect `"ok":true`, `"llm":"api"` and `"solver":"worker"`. Then open the root workshop, complete “Show me how”, create a machine, apply an edit, and try the workshop on mobile. Typing “add a fan” should select a fan for placement in that same machine; playback starts only with Run. Confirm the live build does not display the offline-builder notice when AI is configured. In the designer, make a part on the Workbench, then open **+ Add a kit part**: the part is listed there, and asking for it again by name answers at once.

## Keeping it safe and cheap

- Set a monthly spend limit in the Anthropic Console (e.g. $150).
- Check the hosting provider’s current plan and usage costs before choosing a plan.
- Monitor `/api/health` through the judging period.
- The API key lives only in Railway's variables and your local `.env`. Never commit it or paste it anywhere else.
- Watch the volume: each 3D look a player makes is about 200 KB in `DATA_DIR/meshes` (textures are shrunk to 512 px on arrival).

## Local production check

Build the web client and run the server the way the container does:

```sh
npm run build
NODE_ENV=production DATA_DIR=./data PORT=8787 npm start -w @pg/server
```

Then open http://localhost:8787. Or with Docker: `docker build -t prompt-goldberg . && docker run -p 8787:8787 --env-file .env -v og-data:/data prompt-goldberg`.
