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

# Apply outstanding security patches from the distribution.
#
# The base is pinned by digest for reproducibility, but a pinned digest is
# frozen in time: when Alpine publishes a security fix, the pinned image keeps
# the vulnerable package until upstream rebuilds and someone re-pins. At the
# time of writing that gap was a HIGH OpenSSL advisory — patched in Alpine's
# repository, not yet in any published node:22-alpine tag.
#
# Upgrading at build time trades a little reproducibility for actually being
# patched. That is the right side of the trade for a runtime image: two builds
# of the same commit may differ by a security patch, which is a far better
# failure mode than shipping a known-vulnerable TLS library because the digest
# has not moved.
RUN apk --no-cache upgrade

# Remove the package managers from the runtime image.
#
# The container runs `node dist/server.js` and never needs npm, yarn or corepack.
# npm ships with its own vendored dependency tree — tar, sigstore, picomatch,
# ip-address and others — which `npm audit` cannot see because they are not in
# our dependency tree, but an image scanner reports every one of them. Every
# CVE in that tree would be a finding to triage on a package we do not use at
# runtime.
#
# So it is deleted rather than waived. This is not a trick to quiet the scanner:
# a package manager in a production image is a live arbitrary-code-installation
# tool sitting next to the application, and removing it is the correct hardening
# regardless of what any scanner says.
RUN rm -rf /usr/local/lib/node_modules/npm \
    /usr/local/lib/node_modules/corepack \
    /usr/local/bin/npm \
    /usr/local/bin/npx \
    /usr/local/bin/corepack \
    /opt/yarn-v* \
    /usr/local/bin/yarn \
    /usr/local/bin/yarnpkg

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
