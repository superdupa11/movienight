# syntax=docker/dockerfile:1

# ---- deps ----------------------------------------------------------------
# Separate stage so native modules (better-sqlite3) compile once and cache.
FROM node:22-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci

# ---- build ---------------------------------------------------------------
FROM deps AS build
WORKDIR /app
COPY . .
RUN npm run build

# Reinstall production deps only, so the native build matches the runtime image.
RUN npm ci --omit=dev

# ---- runtime -------------------------------------------------------------
FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

# vips for sharp poster transcoding; tini for correct signal handling
RUN apt-get update && apt-get install -y --no-install-recommends \
      libvips42 tini \
    && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./

# /data holds the SQLite file and the poster cache. Mount it.
RUN mkdir -p /data/art && chown -R node:node /data
VOLUME ["/data"]

USER node
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8080/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/server/index.js"]
