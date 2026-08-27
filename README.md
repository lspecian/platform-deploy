# Tarmac

An internal delivery platform — a paved road that takes a service from a
developer's branch to running infrastructure, with guardrails that fail closed.

[![ci](https://github.com/lspecian/platform-deploy/actions/workflows/ci.yml/badge.svg)](https://github.com/lspecian/platform-deploy/actions/workflows/ci.yml)
[![platform](https://github.com/lspecian/platform-deploy/actions/workflows/platform.yml/badge.svg)](https://github.com/lspecian/platform-deploy/actions/workflows/platform.yml)

The sample service is deliberately boring: a React SPA calling a Node API that
returns a greeting. **The service is the payload. The road is the product.**

---

## Try it

Requires Docker and Node 22. No cloud account, no API key, no signup.

```bash
git clone https://github.com/lspecian/platform-deploy && cd platform-deploy
npm install
make up
```

About ninety seconds later you have a service answering through its load
balancer. `make up` starts a local cloud emulator per environment, builds a
hardened image, provisions infrastructure with Terraform, deploys, and smoke
tests the result.

```
==> Applying infrastructure for dev (local)
==> Registering targets
==> Smoke testing http://localhost:4566/_alb/hello-world-dev-alb/
  {"message":"hello world","service":"hello-world","environment":"dev",
   "version":"0.1.0","commit":"9b09049"}
==> Deploy succeeded
```

`make down` removes it all.

---

## What a developer actually does

```bash
tarmac new payments-api --owner team-payments   # scaffold, wired to the road
tarmac dev                                      # whole stack, hot reload
tarmac validate                                 # the same check CI runs
git push                                        # gates run, then deploy
tarmac status / tarmac rollback                 # where is it, and undo
```

Changing what a service needs is one file. No HCL:

```yaml
# service.yaml
name: payments-api
owner: team-payments
runtime:
  type: container
  port: 8080
resources:
  bucket:
    name: payments-receipts
```

Terraform reads that, creates the bucket encrypted with public access blocked,
grants the task role access to exactly that bucket and nothing else, and injects
its name as `BUCKET_NAME`.

That chain is not decorative — the app's `/readyz` probe actually reaches the
bucket, and the load balancer health-checks that probe. Manifest to running
health check, end to end.

---

## How a change reaches production

```mermaid
flowchart LR
  PR[pull request] --> G{gates}
  G -->|blocking| B["lint · types · tests+coverage<br/>secrets · deps · SAST<br/>image scan · container policy<br/>manifest · terraform policy"]
  G -->|reporting| R["bundle size · coverage delta<br/>SBOM · cost"]
  B --> M[merge to main]
  M --> D[dev]
  D -->|smoke| S[staging]
  S -->|smoke + approval| P[prod]
  D -.->|smoke fails| RB[automatic rollback]
  S -.-> RB
  P -.-> RB
```

Application repositories **inherit** this by calling one reusable workflow. They
do not copy it. When a gate is added or tightened, every service gets it at
once — a pipeline teams copy is a pipeline that has diverged within a quarter,
and then nobody can answer "does every service scan its images?"

The full block-vs-report matrix, with a rationale for every gate, is in
[docs/gates.md](docs/gates.md). The short version of the rule:

> A gate blocks when a failure is almost always a real problem and the fix is
> available to the person who tripped it. Everything else reports. Blocking on a
> number that moves for legitimate reasons teaches people to re-run the build
> until it goes green — and **every gate you block on for a bad reason weakens
> every gate you block on for a good one.**

---

## The part most platforms are missing

Every gate here is itself tested, by feeding the platform services that are
**deliberately broken in exactly one way** and asserting the specific guardrail
meant to catch each one fires.

| Fixture | Must be rejected by |
|---|---|
| Credential in source | Secret scanning (real gitleaks) |
| Hardcoded AWS key | Static analysis (real semgrep) |
| Container running as root | Container policy |
| Security group open to `0.0.0.0/0` | Terraform policy |
| Unencrypted bucket | Terraform policy |
| Mutable `:latest` image tag | Container policy |
| Plaintext secret in a task definition | Container policy |
| Manifest with no owner | Schema validation |
| Expired vulnerability waiver | Waiver policy |
| Critical CVE | Dependency policy |

Two details make this mean something:

**A control.** One fixture violates nothing and must pass everything. Without
it, a suite where every gate rejected every input would look perfectly healthy.

**Mutation tests.** For each fixture, the corresponding policy file is deleted
and the fixture must *stop* being caught. If it is still rejected with its rule
removed, the test was never testing that rule.

This is not theoretical. Building this platform, the fixture suite caught three
dead guardrails that all looked healthy from the happy path:

- **Semgrep silently skipped `tests/`.** Its default ignore list excludes test
  directories, so the secret-scanning rule was never exercised against its own
  fixture — and would never have flagged a credential in any test file.
- **A fixture built on an allowlisted value.** It used AWS's canonical
  documentation key, `AKIAIOSFODNN7EXAMPLE`, which scanners deliberately ignore
  so that copying an example from the docs does not fail a build. It matched
  nothing.
- **A policy rule reading a field Terraform never emits.** It checked
  `after.bucket == null`, but Terraform omits attributes computed during apply
  and flags them in `after_unknown`. The key was absent, not null, so the rule
  silently did not fire — and the unit test encoded the same wrong shape, so it
  passed while the rule was broken on a real plan.

Each of those is a gate that reports success while protecting nothing. That is
the failure mode this suite exists to catch.

---

## Two targets, one codebase

The same Terraform deploys to a local emulator or to real AWS. The only
structural difference is the provider's `endpoints` block, selected by one
variable.

| | Local (MiniStack) | Real AWS |
|---|---|---|
| Cost | Free | ~$1/day, torn down after |
| Used by | CI, and anyone who clones this | Manual demo only |
| Trigger | Every push | `workflow_dispatch` / `make deploy-aws` |
| Credentials | None | GitHub OIDC — no static keys |

CI never touches a real account. A pipeline that can deploy to a real cloud on a
push is a pipeline that can bill you on a push.

LocalStack was the obvious choice and was rejected: its free tier no longer
includes ECS, ECR or ELBv2, so the deploy stage would have had to be simulated.
[MiniStack](https://github.com/ministackorg/ministack) has them free and runs
real containers. Seven behaviours where it differs from AWS are documented — five found by a
timeboxed spike *before* anything was built on it, two more surfaced by
deploying a second environment — and all are absorbed by conditionals in
platform code and none in application code —
[ADR 0002](docs/adr/0002-emulator-constraints.md).

---

## Layout

```
apps/hello-world/      the service: SPA, API, tests, hardened image, service.yaml
platform/
  schema/              the service manifest contract (JSON Schema)
  validate/            one validation library — CLI, hook and CI all call it
  policy/              Rego rules + 58 unit tests, evaluated against the plan
  cli/                 the tarmac CLI
  semgrep/             locally-written static analysis rules
  scripts/             deploy, rollback, emulator, policy check
infra/                 dual-target Terraform: modules + per-environment tfvars
tests/gates/           deliberately broken fixtures that must be rejected
docs/adr/              why each significant decision was made
docs/gates.md          what blocks, what reports, and why
```

---

## What I deliberately left out

Scope was one working day. These are choices, not oversights.

**Canary / weighted traffic shifting.** Not requested, and it would work on only
one of the two targets — the emulator's forward action ignores target group
weights. A feature that works on real AWS and silently does not locally is worse
than no feature. Deploy → smoke → automatic rollback is a complete deployment
story, and it is verified: deploying a wrong image produces a failed smoke test,
an automatic rollback, and a non-zero exit. [ADR 0004](docs/adr/0004-deployment-strategy.md)

**A database and migration gating.** A migration gate is one of the best topics
in this space — expand/contract, destructive-change detection, migrations that
outlive a rollback. A real database plus migration tooling plus the policy to
gate it did not fit the budget, and half of it would have been worse than none.
The service is stateless; its declared resource is a bucket.

**Kubernetes.** The emulator can spawn a real k3s cluster, so this was possible.
A container service demonstrates the same platform concerns — image promotion,
health checks, rollout, policy, least-privilege identity — with far less
surface. A scope choice, not a capability limit.

**Multi-region, disaster recovery, service mesh, tracing backend.** Real
concerns that exercise cloud topology rather than the road.

**A service catalogue or web portal.** The CLI and the pull request are the
surfaces. A portal is the right answer at fifty services, not at one.

**Autoscaling.** Configurable, but not load-tested. Claiming tested autoscaling
without a load test would be dishonest.

**Image signing and provenance attestation.** An SBOM is produced. Signing
against an emulated registry proves nothing about a real supply chain.

**Performance and licence gates.** No load test means any threshold would be
invented, and licence policy needs a policy this project does not have.

---

## Things worth knowing

**Every claim here was run.** The rollback was tested by breaking a deploy. The
container is verified non-root with a read-only root filesystem rather than
asserted. The guardrails are tested by attacking them. Where something is
simulated, the docs say so.

**The gates caught real problems in this repository**, which is the strongest
evidence they work. The policy layer found an over-broad IAM role granting
repository-scoped ECR actions on every repository. Image scanning found
vulnerable packages `npm audit` structurally could not see, because they live in
npm's own bundled dependency tree — fixed by removing package managers from the
runtime image rather than waiving them. A unit test caught `loadConfig` reading
`process.env` instead of its argument.

**Waivers expire.** A vulnerability waiver needs an owner, a reason and an
expiry within 90 days, and an expired waiver fails the build on its own — even
if the finding it covered is gone. Unbounded suppression is how a security gate
quietly stops covering anything while the build stays green.

---

## Decisions

| | |
|---|---|
| [0001](docs/adr/0001-local-cloud-emulator.md) | Choosing the local cloud emulator |
| [0002](docs/adr/0002-emulator-constraints.md) | Where it differs from AWS, and how the road absorbs it |
| [0003](docs/adr/0003-dual-target-terraform.md) | One Terraform codebase, two targets |
| [0004](docs/adr/0004-deployment-strategy.md) | Deploy, smoke test, roll back — and why not canary |
