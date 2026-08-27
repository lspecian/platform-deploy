import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { validateManifest } from "@tarmac/validate";

/**
 * `tarmac new <name>`
 *
 * Generates a repository already wired to the paved road.
 *
 * The generated output is deliberately small. A scaffold that emits two hundred
 * files is one nobody reads, so people keep whatever it produced whether or not
 * it fits — and the parts they do not understand become the parts they are
 * afraid to change. Everything here is something a developer should be able to
 * read in a sitting.
 *
 * Notably absent: a copy of the pipeline. The generated CI file *calls* the
 * reusable workflow. A scaffold that copies pipeline YAML produces a fleet of
 * services that were identical on day one and have diverged by the end of the
 * quarter, and a gate added later reaches none of them.
 */
export interface ScaffoldOptions {
  readonly name: string;
  readonly owner: string;
  readonly port?: number;
  readonly description?: string;
}

export interface GeneratedFile {
  readonly path: string;
  readonly contents: string;
}

export function serviceManifest(options: ScaffoldOptions): string {
  const port = options.port ?? 8080;
  return `# The contract between this service and the platform.
#
# This is the only infrastructure surface you need to touch. Terraform reads it,
# the pipeline validates it. Run \`tarmac validate\` before pushing.
apiVersion: tarmac/v1

name: ${options.name}
owner: ${options.owner}
${options.description ? `description: ${options.description}\n` : ""}
runtime:
  type: container
  port: ${port}
  cpu: 256
  memory: 512
  healthcheck:
    liveness: /healthz
    readiness: /readyz

environments:
  dev:
    replicas: 1
    approval: automatic
  staging:
    replicas: 1
    approval: automatic
  prod:
    replicas: 2
    # Production waits for a human. The schema rejects "automatic" here.
    approval: required

slo:
  availability: 99.9
  latency_p95_ms: 300
`;
}

export function workflow(name: string): string {
  return `# ${name}'s pipeline.
#
# This calls the platform's reusable workflow rather than copying it, so every
# gate — including gates added after this service onboarded — applies here
# automatically. Do not inline the pipeline steps.
name: ci

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  golden-path:
    uses: tarmac-platform/platform-deploy/.github/workflows/golden-path.yml@main
    with:
      service-path: .
      environment: dev
`;
}

export function readme(options: ScaffoldOptions): string {
  return `# ${options.name}

${options.description ?? "A service on the paved road."}

Owned by **${options.owner}**.

## Local development

\`\`\`
tarmac dev        # run the whole stack locally
tarmac validate   # the same check CI runs
tarmac deploy     # deploy to dev
tarmac status     # where is my change
tarmac rollback   # undo
\`\`\`

## Changing what this service needs

Edit \`service.yaml\`. To add a bucket:

\`\`\`yaml
resources:
  bucket:
    name: ${options.name}-data
\`\`\`

Terraform picks it up, the bucket is created encrypted with public access
blocked, and its name arrives in the container as \`BUCKET_NAME\`. You do not
write any HCL.

## What you do not have to think about

Image hardening, IAM roles, the load balancer, log shipping, secret scanning,
dependency and image vulnerability scanning, infrastructure policy, and rollback
on a failed deploy. Those are the road's job. If one of them blocks you and you
cannot tell why, that is a bug in the road — raise it.
`;
}

export function dockerfile(port: number): string {
  return `# Pinned by digest, not by tag: a tag is mutable, so a rebuild of an unchanged
# commit can produce a different image. The container policy gate rejects a FROM
# without a digest.
FROM node@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32 AS base
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS build
COPY . .
RUN npm run build

FROM base AS runtime
# The runtime never needs a package manager, and every one of npm's vendored
# dependencies is attack surface plus a stream of scanner findings.
RUN apk --no-cache upgrade && rm -rf /usr/local/lib/node_modules/npm \\
    /usr/local/bin/npm /usr/local/bin/npx /opt/yarn-v* /usr/local/bin/yarn

COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=deps --chown=node:node /app/node_modules ./node_modules

# Non-root: a container escape from a root container starts as root on the host.
USER node
EXPOSE ${port}

# Exec form, so SIGTERM reaches the process and graceful shutdown runs. The
# shell form would swallow it and every deploy would drop in-flight requests.
CMD ["node", "dist/server.js"]
`;
}

export function generate(options: ScaffoldOptions): readonly GeneratedFile[] {
  const port = options.port ?? 8080;
  return [
    { path: "service.yaml", contents: serviceManifest(options) },
    { path: ".github/workflows/ci.yml", contents: workflow(options.name) },
    { path: "README.md", contents: readme(options) },
    { path: "Dockerfile", contents: dockerfile(port) },
  ];
}

export interface ScaffoldResult {
  readonly written: readonly string[];
  readonly errors: readonly string[];
}

export function scaffold(target: string, options: ScaffoldOptions): ScaffoldResult {
  const errors: string[] = [];

  // Validate before writing anything. Producing a repository that fails its own
  // first pipeline run is a bad first impression of the road.
  const manifest = validateManifest(serviceManifest(options));
  if (!manifest.valid) {
    return {
      written: [],
      errors: manifest.errors.map((e) => `${e.path ? `${e.path}: ` : ""}${e.message}`),
    };
  }

  if (existsSync(target)) {
    return { written: [], errors: [`${target} already exists`] };
  }

  const written: string[] = [];
  for (const file of generate(options)) {
    const full = join(target, file.path);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, file.contents);
    written.push(file.path);
  }

  return { written, errors };
}
