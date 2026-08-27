# Base image is pinned by digest, not by tag. A tag is mutable: `node:22-alpine`
# points at a different image today than it did last week, so a rebuild of an
# "unchanged" commit can produce a different artifact. The container policy gate
# rejects any FROM without a digest.
#
# node:22-alpine at v22.23.2
FROM node@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32 AS base
WORKDIR /app

# ---------------------------------------------------------------------------
# deps: install once against the lockfile, cached until the lockfile changes.
# Manifests are copied before source so editing a .ts file does not bust the
# dependency layer.
# ---------------------------------------------------------------------------
FROM base AS deps
COPY package.json package-lock.json ./
COPY apps/hello-world/package.json apps/hello-world/
COPY platform/validate/package.json platform/validate/
RUN npm ci

# ---------------------------------------------------------------------------
# build: compile the API and bundle the SPA into dist/public
# ---------------------------------------------------------------------------
FROM deps AS build
COPY . .
RUN npm run build --workspace @tarmac/hello-world

# ---------------------------------------------------------------------------
# prod-deps: runtime dependencies only. Dev dependencies are the majority of
# the tree and every one of them is attack surface that ships to production.
# ---------------------------------------------------------------------------
FROM deps AS prod-deps
RUN npm ci --omit=dev

# ---------------------------------------------------------------------------
# runtime
# ---------------------------------------------------------------------------
FROM base AS runtime

# Build provenance, injected by the pipeline. The API returns these on
# /api/greeting so a smoke test can assert which artifact is actually running.
ARG APP_VERSION=0.0.0-dev
ARG GIT_COMMIT=unknown
ENV APP_VERSION=${APP_VERSION} \
    GIT_COMMIT=${GIT_COMMIT} \
    NODE_ENV=production \
    PORT=8080

# OCI labels let the registry and any scanner trace an image back to its source.
LABEL org.opencontainers.image.title="hello-world" \
      org.opencontainers.image.description="Reference service for the Tarmac paved road" \
      org.opencontainers.image.version="${APP_VERSION}" \
      org.opencontainers.image.revision="${GIT_COMMIT}"

# The `node` user ships with the image (uid 1000). Running as root inside a
# container means a container escape starts as root on the host.
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/apps/hello-world/dist ./dist
COPY --from=build --chown=node:node /app/apps/hello-world/package.json ./package.json

USER node
EXPOSE 8080

# Runs with a read-only root filesystem; nothing here writes to disk. The task
# definition mounts a tmpfs at /tmp for anything that needs scratch space.
#
# No shell form: `CMD node dist/server.js` would run under `sh -c`, which does
# not forward SIGTERM, so the graceful shutdown handler would never fire and
# every deploy would drop in-flight requests.
CMD ["node", "dist/server.js"]
