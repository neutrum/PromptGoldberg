# Orbital Goldberg: one container serves the built web game and the API.
# Works on Railway, Fly.io or any Docker host. Persist /data (gallery + level cache) on a volume.
FROM node:24-slim

WORKDIR /app

# Install all workspace dependencies (tsx and vite are needed to build and run).
COPY . .
RUN npm ci --no-audit --no-fund

# Build the web client into apps/web/dist; the server serves it.
RUN npm run build

ENV NODE_ENV=production \
    DATA_DIR=/data \
    TRUST_PROXY=1 \
    PORT=8787

EXPOSE 8787
CMD ["npm", "start", "-w", "@og/server"]
