# Live-demo site, tier A: a static page built from committed inputs, served by a dependency-free node server.
FROM node:20-bookworm-slim
# Coolify's healthcheck execs curl inside the container; the slim image has none.
RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY . .
RUN node scripts/build-site.mjs
ENV NODE_ENV=production PORT=3000
EXPOSE 3000
USER node
CMD ["node", "scripts/serve-site.mjs"]
