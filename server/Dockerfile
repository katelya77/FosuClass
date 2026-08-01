# syntax=docker/dockerfile:1.7
# Build from repository root:
#   docker build -f server/Dockerfile --build-arg GIT_REVISION=$(git rev-parse HEAD) .
#
# Chromium retained: personal schedule import may enable
# FOSU_IMPORT_USE_PLAYWRIGHT_FALLBACK with system chromium.

ARG NODE_VERSION=20

# ---------- production workspace dependencies ----------
FROM node:${NODE_VERSION}-alpine AS workspace-deps
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages ./packages
COPY plugins ./plugins
COPY apps ./apps
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

# ---------- production server dependencies ----------
FROM node:${NODE_VERSION}-alpine AS server-deps
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

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
      org.opencontainers.image.description="FosuClass API + Legacy admin console"

RUN apk add --no-cache ca-certificates \
    && rm -rf /var/cache/apk/*

ENV NODE_ENV=production \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    FOSU_DATA_DIR=/app/data \
    FOSU_STORAGE_DIR=/app/storage \
    PORT=3000

WORKDIR /app

COPY --from=workspace-deps /app/node_modules ./node_modules
COPY --from=server-deps /app/server/node_modules ./server/node_modules
COPY packages ./packages
COPY plugins ./plugins
COPY apps ./apps
COPY server/package.json server/package-lock.json ./server/
COPY server/src ./server/src
COPY server/scripts ./server/scripts
COPY server/assets ./server/assets
COPY server/data ./data
COPY server/public ./server/public
COPY server/config/admin-rollout-manifest.json ./server/config/admin-rollout-manifest.json
COPY server/config/agent-capability-manifest.json ./server/config/agent-capability-manifest.json
# adminRolloutManifestService hardcodes its production target at /app/config
# (tools/test-admin-rollout-runtime-contract.js); keep the legacy path live.
COPY server/config/admin-rollout-manifest.json ./config/admin-rollout-manifest.json

RUN mkdir -p /app/storage /app/data/backups \
    && chmod -R a+rX /app/server/src /app/server/public /app/server/scripts /app/server/assets /app/packages /app/plugins /app/apps /app/data \
    && chmod a+rwx /app/storage /app/data

WORKDIR /app/server

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
  CMD node scripts/test-health.js || exit 1

# Root retained for 1Panel bind-mount write compatibility. Runtime-data
# bootstrap remains available for the deferred persistent-data delivery PR.
CMD ["node", "src/app.js"]

# ---------- core (no browser runtime) ----------
FROM runtime-common AS core

# ---------- standalone agent platform (server / worker / admin / migrate) ----------
# P5b: single image, four roles selected by AGENT_PLATFORM_ROLE (default server).
# Entry: server/src/standalone/agentServerMain.js; probes /health/live,
# /health/startup, /health/ready on AGENT_PLATFORM_PORT (default 8080).
# No Chromium, no campus data baked in. Multi-arch safe (linux/amd64+arm64 via
# buildx): runtime-common only adds ca-certificates and pure-JS npm deps,
# no x86-only native binaries.
FROM runtime-common AS standalone

LABEL org.opencontainers.image.title="fosu-agent-platform" \
      org.opencontainers.image.description="Xiaofu Agent Platform standalone: server/worker/admin/migrate roles, PostgreSQL+Redis durable backends"

ENV AGENT_PLATFORM_ROLE=server \
    AGENT_PLATFORM_PORT=8080 \
    FOSU_AGENT_REPOSITORY_BACKEND=postgres

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD node scripts/test-standalone-health.js || exit 1

CMD ["node", "src/standalone/agentServerMain.js"]

# ---------- browser (production default until APaaS is proven browser-free) ----------
# NOTE: keep 'browser' as the LAST stage -- default docker build (no --target)
# produces the fosuclass-api image; the docker smoke gate, container-publish
# workflow and 1Panel/vps deploys rely on that default. Use --target standalone
# explicitly for the agent platform image.
FROM runtime-common AS browser

RUN apk add --no-cache \
      chromium \
      nss \
      freetype \
      harfbuzz \
      ttf-freefont \
    && rm -rf /var/cache/apk/*

ENV FOSU_IMPORT_BROWSER_EXECUTABLE_PATH=/usr/bin/chromium-browser
