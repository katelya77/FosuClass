# syntax=docker/dockerfile:1.7
# Build from repository root:
#   docker build -f server/Dockerfile --build-arg GIT_REVISION=$(git rev-parse HEAD) .
#
# Chromium retained: personal schedule import may enable
# FOSU_IMPORT_USE_PLAYWRIGHT_FALLBACK with system chromium.

ARG NODE_VERSION=20

# ---------- admin SPA ----------
FROM node:${NODE_VERSION}-bookworm-slim AS admin-builder
WORKDIR /src
COPY admin-web/package.json admin-web/package-lock.json ./admin-web/
WORKDIR /src/admin-web
RUN npm ci
COPY admin-web/ ./
# vite outDir is ../server/public/admin-app relative to admin-web
RUN mkdir -p /src/server/public/admin-app && npm run build \
  && test -f /src/server/public/admin-app/index.html

# ---------- production node_modules ----------
FROM node:${NODE_VERSION}-alpine AS server-deps
WORKDIR /app
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# ---------- shared runtime ----------
FROM node:${NODE_VERSION}-alpine AS runtime-common

ARG GIT_REVISION=unknown
ARG BUILD_CREATED=unknown
ARG IMAGE_VERSION=0.0.0

LABEL org.opencontainers.image.source="https://github.com/katelya77/FosuClass" \
      org.opencontainers.image.revision="${GIT_REVISION}" \
      org.opencontainers.image.created="${BUILD_CREATED}" \
      org.opencontainers.image.version="${IMAGE_VERSION}" \
      org.opencontainers.image.title="fosuclass-api" \
      org.opencontainers.image.description="FosuClass API + progressive admin SPA"

RUN apk add --no-cache ca-certificates \
    && rm -rf /var/cache/apk/*

ENV NODE_ENV=production \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    FOSU_DATA_DIR=/app/data \
    FOSU_SEED_DATA_DIR=/app/seed-data \
    FOSU_STORAGE_DIR=/app/storage \
    PORT=3000

WORKDIR /app

COPY --from=server-deps /app/node_modules ./node_modules
COPY server/package.json server/package-lock.json ./
COPY server/src ./src
COPY server/scripts ./scripts
COPY server/assets ./assets
COPY server/data/ai ./seed-data/ai
COPY server/public ./public
COPY config/admin-rollout-manifest.json ./config/admin-rollout-manifest.json
COPY --from=admin-builder /src/server/public/admin-app ./public/admin-app

RUN mkdir -p /app/storage /app/data /app/seed-data \
    && chmod -R a+rX /app/src /app/public /app/scripts /app/assets /app/seed-data \
    && chmod a+rwx /app/storage /app/data

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
  CMD node scripts/test-health.js || exit 1

# Root retained for 1Panel bind-mount write compatibility. The launcher copies
# only missing curated seed files before Express imports any writable service.
CMD ["node", "scripts/start-runtime.js"]

# ---------- core (no browser runtime) ----------
FROM runtime-common AS core

# ---------- browser (production default until APaaS is proven browser-free) ----------
FROM runtime-common AS browser

RUN apk add --no-cache \
      chromium \
      nss \
      freetype \
      harfbuzz \
      ttf-freefont \
    && rm -rf /var/cache/apk/*

ENV FOSU_IMPORT_BROWSER_EXECUTABLE_PATH=/usr/bin/chromium-browser
