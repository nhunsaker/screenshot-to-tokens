# Live-demo site. Tier A: a static page built from committed inputs. Tier B (S2T_TIERS=a,b): Point and say on Argon at
# /try/, metered by the demo budget, with one warm headless Chromium in the same process (scripts/serve-site.mjs).
# Coolify: memory limit 2 GB, restart on failure, persistent volume at /data (the budget ledger), healthcheck /health.
# Keys come from env only (META_API_KEY, BASETEN_API_KEY); nothing secret is baked into the image.
FROM mcr.microsoft.com/playwright:v1.61.1-noble
# curl: Coolify's healthcheck execs it inside the container. git: the Argon build is cloned from the public fork.
RUN apt-get update && apt-get install -y --no-install-recommends curl git ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
# Dev dependencies included: playwright (matching the image's browsers, 1.61.1) is a devDependency.
COPY package.json pnpm-lock.yaml ./
RUN npm install -g pnpm@9.15.0 && pnpm install --frozen-lockfile
COPY . .
RUN node scripts/build-site.mjs && node scripts/live/fetch-argon-app.mjs build/argon-app
RUN mkdir -p /data && chown pwuser:pwuser /data
ENV NODE_ENV=production PORT=3000 S2T_PUBLIC=1 S2T_ORIGIN=https://s2t.sorbcloud.com S2T_TIERS=a S2T_DATA=/data
EXPOSE 3000
USER pwuser
CMD ["node", "scripts/serve-site.mjs"]
