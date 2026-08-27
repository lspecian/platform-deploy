# Tarmac — an internal paved-road delivery platform

> Intake document for project planning.
> **Build budget: one working day.** Every scope decision below follows from that.

---

## The one open decision

Everything else in this document is settled. This is not:

**Where is the centre of gravity?** All three areas below appear in the project.
The question is which one gets built to depth and which two get built to
"credible and honest". Doing all three shallowly is the failure mode.

| Option | The strongest thing it can claim | Cost | Risk |
|---|---|---|---|
| **A. Quality gates** *(recommended)* | "Every guardrail is proven to fail closed, in CI, on every commit" | Low–medium | None — runs entirely in GitHub Actions, no emulator dependency |
| **B. Developer experience** | "A developer ships without learning any of it" | Medium | Easy to demo, harder to prove depth |
| **C. Infrastructure** | "Real Terraform, real containers, three isolated accounts" | Medium–high | Weakened by the spike findings below — ingress cannot be demonstrated |

**Recommendation: A, with B as a close second and C as the substrate.**

Reasoning: the spike knocked a hole in C (no working load balancer data plane,
so no demonstrable ingress and no traffic-shifted deploys). A is the cheapest
to build per unit of credibility, is immune to emulator limitations because it
runs in CI, and is the area where most platforms are weakest — nearly every
platform demonstrates that a good change passes and never demonstrates that a
bad change is stopped. B is what makes it feel like a product rather than a
pile of YAML, and the parts of B that matter most (a schema-validated manifest,
a small CLI) are cheap.

---

## What this is

Tarmac is an internal delivery platform — a "paved road" that application teams
use to get a service from a branch into production safely. A team adopting
Tarmac gets a scaffolded repository, one declarative service manifest, a
pipeline they inherit rather than copy, infrastructure generated from that
manifest, and guardrails that fail closed.

The sample service is deliberately boring: a React SPA calling a Node API that
returns a greeting. The service is the payload. The road is the product.

## Core value

**A developer changes one file and ships safely without knowing how any of it
works — and cannot ship something unsafe even if they try.**

Of those two halves, the second is the one this project proves hardest.

---

## Who it's for

**Application developer.** Wants to ship. Doesn't want to learn Terraform, IAM,
or container hardening. Touches: the `tarmac` CLI, `service.yaml`, and PR feedback.

**Platform engineer.** Owns the road. Changes a policy once, it applies
everywhere. Needs the platform's own logic tested — a bug in a guardrail is
worse than no guardrail, because it manufactures false confidence.

**Security reviewer.** Wants to answer "what stops a secret reaching production?"
from one page, not by auditing pipeline YAML.

---

## The developer experience

```
tarmac new payments-api     # scaffold a repo already wired to the road
tarmac dev                  # whole stack locally, hot reload
tarmac validate             # same check CI runs — never disagrees with CI
git push                    # gates run, ReviewBot comments, deploy on merge
tarmac status / rollback    # where is my change, and undo
```

The contract is one file:

```yaml
name: payments-api
owner: team-payments
runtime: { type: container, port: 8080 }
resources:
  bucket: { name: payment-receipts }
  queue:  { name: payment-events }
slo:
  availability: 99.9
```

Schema-validated, drives Terraform, and the only infrastructure surface a
developer touches.

---

## Spike results — what is actually true

A timeboxed spike ran Terraform against the MiniStack emulator before any
design was committed. Results are load-bearing; several are inconvenient.

**Verified working:**
- Terraform drives the emulator — 13 resources applied cleanly (VPC, subnets,
  security group, registry, log group, IAM role, container cluster, task
  definition, load balancer, target group, listener, service)
- Creating a container service starts a **real Docker container** that serves
  real HTTP traffic
- Environment isolation by account works — a 12-digit access key becomes the
  account ID and appears in every ARN, so dev/staging/prod are genuinely
  separate accounts rather than name prefixes
- Load balancer *control* plane works — create, register targets, describe health
- Emulator starts in under two seconds, 186 MB image

**Verified broken (emulator v1.5.2, light edition):**
- **The load balancer data plane does not route.** Neither documented URL form
  works; both fall through to the storage service handler. Even a
  `fixed-response` action — which requires no backend at all — does not
  respond. Forwarding to IP targets is not implemented.
- **The container service does not register tasks into target groups.**
  `awsvpc` networking is not modelled: tasks report no network interfaces and
  no IP, so there is nothing for the platform to register automatically.

**Consequences, accepted deliberately:**
- Ingress cannot be demonstrated through the load balancer. The load balancer
  is still provisioned in Terraform and still policy-checked, but traffic in
  the demo reaches the container through its published port.
- **Traffic-shifted deployment — canary, weighted blue-green — is off the
  table.** It cannot be built honestly on this foundation. Deployment safety is
  instead demonstrated as: deploy, smoke test, automatic rollback on failure.
- The gap is documented in an architecture decision record, including what
  would change on real AWS. Nothing in the README will claim ingress works.

---

## Requirements

### Must — the project fails without these

**Application**
- React SPA (Vite, TypeScript) rendering a greeting from the API
- Node 22 + Fastify API in TypeScript, `/healthz`, `/readyz`, structured JSON logs
- Unit and integration tests; a hardened container image (non-root, read-only
  root filesystem, pinned base, multi-stage)

**Contract**
- `service.yaml` with a published JSON Schema
- One validation implementation, invoked by the CLI, the pre-commit hook, and
  CI — so local and CI can never disagree

**Pipeline**
- Reusable GitHub Actions workflow that application repositories inherit
- A written, published block-vs-report matrix with a rationale per gate
- Blocking: lint, typecheck, unit tests with a coverage floor, secret scanning,
  dependency vulnerabilities, static analysis, image scan, container hardening
  policy, manifest schema validation, Terraform validate/plan/policy
- Reporting: cost delta, bundle size, coverage delta, SBOM diff
- Waivers carry an owner and an expiry; an expired waiver fails the build

**Guardrail verification — the centrepiece**
- Deliberately broken fixtures, each violating exactly one rule, with a CI job
  asserting each is **rejected**:
  secret in source · critical CVE · root container · security group open to the
  world · manifest missing an owner · unencrypted storage · expired waiver
- Rego policies with `opa test` unit tests covering allow *and* deny paths

**Infrastructure**
- Terraform provisions registry, container service, task definition, service,
  load balancer, log group, IAM roles, and the resources the manifest declares
- Three environments as three separate accounts
- Promotion by image digest — the artifact that passed staging is bit-for-bit
  the artifact that reaches production

**Documentation**
- README explaining the road, the gates, and the omissions in fifteen minutes
- ADRs for every significant decision, including the spike findings
- An explicit, reasoned "what we left out" section

### Should — build if the Must set lands early

- `tarmac` CLI: `new`, `dev`, `validate`, `deploy`, `status`, `rollback`, `doctor`
- Scaffolding template that generates a road-ready repository
- ReviewBot: one PR comment, updated in place, showing gate results, the
  infrastructure diff in plain English, and cost delta
- Deploy, smoke test, automatic rollback on smoke failure

### Cut — explicitly not building

- **Traffic-shifted deployment (canary / weighted blue-green)** — the emulator's
  load balancer cannot route, so this cannot be built honestly
- **Database and migrations** — a migration gate is a genuinely good platform
  topic, but a real database plus migration tooling plus a destructive-migration
  policy does not fit the budget. The app is stateless; storage is a bucket.
- **Kubernetes** — the emulator can spawn real k3s, so this is possible, but a
  container service demonstrates the same platform concerns with far less
  surface. A scope choice, not a capability limit.
- **Real cloud account** — the road runs locally so anyone can clone and run it
  with no credentials and no budget. The Terraform is written as it would be
  for real AWS; the difference is the endpoint configuration.
- **Multi-region, disaster recovery, service mesh, tracing backend** — real
  concerns, but they exercise cloud topology rather than the road.
- **Service catalogue / web portal** — the CLI and the pull request are the
  surfaces. A portal is the right answer at fifty services, not at one.
- **Autoscaling** — configurable but not load-tested. Claiming tested
  autoscaling without a load test would be dishonest.
- **Image signing and provenance attestation** — an SBOM is produced; signing
  against an emulated registry proves nothing about a real supply chain.
- **A second sample service** — reusability is better shown by the scaffolding
  template generating one on demand.

---

## Constraints

- **Deadline: one working day.** Scope is the variable; honesty is not.
- **Runs anywhere**: `git clone && make up` on a laptop with Docker. No cloud
  account, no API key, no signup.
- **Runs in CI**: the gates execute on GitHub Actions, so the repository
  demonstrates a working pipeline rather than describing one.
- **Honest**: nothing is claimed to work that has not been observed working.
  Where something is simulated, the documentation says so plainly.
- **Defensible**: every gate and every omission has a written rationale.
- **Stack**: TypeScript throughout, Terraform, Rego, GitHub Actions, Docker.

---

## Key decisions

| Decision | Rationale |
|---|---|
| MiniStack over LocalStack | LocalStack's free tier no longer includes the container service, registry, or load balancer, so the deploy stage would have to be faked |
| Ship despite the load balancer gap | Deploy still starts a real container; gap documented in an ADR |
| No canary | Cannot be built honestly on a load balancer that does not route traffic |
| Container service over Kubernetes | Same platform concerns, far less surface |
| Monorepo | The road and a service riding it must be reviewable together |
| One manifest, not pipeline inputs | The platform/application contract should be one reviewable, schema-checked file |
| Promotion by digest | Rebuilding between environments means production runs an artifact nothing tested |
| Policy against the Terraform plan, not source | Source-level policy misses computed values and module internals |
| Waivers expire | Permanent suppression is how security gates quietly stop working |
| Broken-fixture guardrail tests | An untested guardrail manufactures false confidence, which is worse than none |
| Same validation code locally and in CI | Divergence between local and CI checks destroys trust in the road |

---

## Suggested phase shape

1. **Foundation** — application, container image, `service.yaml` + schema +
   validation library, Terraform modules, three environment accounts, `make up`.
2. **The road** — reusable workflow, every gate, the block/report matrix, Rego
   policies with unit tests, deploy with smoke test and rollback.
3. **Proof and surfaces** — the broken-fixture suite, CLI, scaffolding template,
   ReviewBot, README, ADRs.

Phase 1 must land before 2 is meaningful. Phase 3 carries the differentiator; if
time runs short, cut from the CLI and ReviewBot, never from the fixture suite.

## Definition of done

- `make up` on a clean machine produces a running, reachable service
- A commit flows to a deployed environment with no manual steps
- Every broken fixture is demonstrably blocked, in CI, visible in a public run
- The README explains the road, the gates, and the omissions in fifteen minutes
- Every omission has a stated reason
