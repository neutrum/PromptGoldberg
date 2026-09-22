# Deploying to Railway

One service runs everything: the built web game plus the API, from the `Dockerfile`. `railway.json` tells Railway to build that Dockerfile, check `/api/health` and restart on crashes.

## First deploy (about 10 minutes)

1. **Create the project.** On [railway.com](https://railway.com): New Project → Deploy from GitHub repo → `neutrum/OrbitalGoldberg`. Railway picks up `railway.json` and builds the Dockerfile. Every push to `main` redeploys.
2. **Add a volume** for the community gallery and the level cache: the service → Settings → Volumes → New volume, mount path **`/data`**, 1 GB is plenty. Without it, published levels disappear on every deploy.
3. **Set the variables** (service → Variables):

   | Variable | Value | Why |
   | --- | --- | --- |
   | `ANTHROPIC_API_KEY` | a **new** key made only for this deploy | the AI level designer and coach |
   | `DAILY_LLM_CALL_CAP` | `100` while testing, `300` for judging | hard daily limit on AI calls (about 2 per level) |
   | `RATE_LIMIT_PER_DAY` | `40` (default) | AI levels per visitor per day |

   Already set by the Dockerfile: `NODE_ENV=production`, `DATA_DIR=/data`, `TRUST_PROXY=1`. Railway sets `PORT` itself. Other settings are listed in `.env.example`.
4. **Get a URL:** service → Settings → Networking → Generate Domain. A custom domain can be added in the same place.
5. **Check it:** open `https://<your-domain>/api/health`. Expect `"ok":true`, `"llm":"api"` and `"solver":"worker"`. Then play a campaign level and create one level with AI.

## Keeping it safe and cheap

- Set a monthly spend limit in the Anthropic Console (e.g. $150).
- Hobby plan ($5/month including $5 of usage) is enough; expect $5–10/month.
- Free uptime monitoring (UptimeRobot or Better Stack) on `/api/health`, 5-minute interval, until judging ends on Nov 25.
- The API key lives only in Railway's variables and your local `.env`. Never commit it or paste it anywhere else.

## Local production check

Build the web client and run the server the way the container does:

```sh
npm run build
NODE_ENV=production DATA_DIR=./data PORT=8787 npm start -w @og/server
```

Then open http://localhost:8787. Or with Docker: `docker build -t orbital-goldberg . && docker run -p 8787:8787 --env-file .env -v og-data:/data orbital-goldberg`.
