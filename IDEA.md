# Tarmac — an internal paved-road delivery platform

> Intake document for project planning.
> **Build budget: one working day.** Every scope decision below follows from that.

---

## Centre of gravity

Depth goes into **quality gates**, and specifically into proving they fail closed.
Infrastructure is a close second and is genuinely demonstrable on two targets.
Developer experience gets the cheap, high-value parts only.

Reasoning: nearly every delivery platform can show that a good change passes.
Almost none can show that a bad change is stopped. That asymmetry is where the
value is, it is cheap to build, and it runs entirely in CI with no emulator or
cloud dependency — so it is the part that cannot break on demo day.

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

## Two targets, one codebase

The road deploys to either target from the same Terraform. The only structural
difference is the provider `endpoints` block, selected by a variable.

| | **Local (MiniStack)** | **Real AWS** |
|---|---|---|
| Cost | Free | ~$1/day, torn down after |
| Used by | CI, and anyone who clones the repo | Manual demo only |
| Trigger | Every push | `workflow_dispatch` / `make deploy-aws` |
| Credentials | None | GitHub OIDC — no static keys anywhere |

CI runs against the emulator so the pipeline is reproducible, needs no secrets,
and works for anyone who clones the repo. Real AWS is never triggered by a push;
nothing can surprise-deploy or surprise-bill.

**Verified about the AWS account:** `AdministratorAccess`, default VPC in
`eu-central-1` with three subnets, no existing ECS clusters or load balancers.
Fargate goes in the public subnets with `assign_public_ip`, which avoids a NAT
Gateway — the only line item that would actually cost anything.

---

## Emulator behaviour — verified, not assumed

A timeboxed spike ran Terraform and the AWS CLI against MiniStack v1.5.2 before
any design was committed.

**Works:**
- Terraform drives the emulator — 13 resources applied cleanly (VPC, subnets,
  security group, registry, log group, IAM role, cluster, task definition, load
  balancer, target group, listener, service)
- ECS starts a **real Docker container** that serves real HTTP
- **End-to-end ingress works**: load balancer → target group → real container,
  verified by curl
- Load balancer control plane: create, register targets, describe health
- Emulator starts in under two seconds, 186 MB image

**Constraints found, and how the design accommodates each:**

| Finding | Consequence |
|---|---|
| The data plane resolves to the **default account and region** — an unauthenticated HTTP request carries no SigV4, and the LB store is keyed on both | One emulator instance per environment, each with `MINISTACK_ACCOUNT_ID` and `MINISTACK_REGION` set so its default scope matches. Environments stay genuinely isolated *and* routable. |
| `ModifyListener` updates `listener["DefaultActions"]` but never syncs the default rule, which is what `dispatch_request` actually reads — so listener changes are silently ignored | Blue/green swaps recreate the listener instead of modifying it. Upstream bug; worth reporting. |
| ECS does not register task IPs into target groups — `awsvpc` networking is not modelled, so tasks report no network interface | The deploy step calls `RegisterTargets` explicitly on the emulator target. Real AWS does it automatically, so this is a conditional in the deploy path — precisely the kind of difference a paved road exists to hide. |
| `forward` reads only `TargetGroupArn` and ignores `ForwardConfig` entirely — no target group weights | No ALB-weighted canary on the emulator. See the cut list. |

---

## Requirements

### Must

**Application**
- React SPA (Vite, TypeScript) rendering a greeting from the API
- Node 22 + Fastify API in TypeScript, `/healthz`, `/readyz`, structured JSON logs
- Unit and integration tests; hardened container image (non-root, read-only root
  filesystem, pinned base, multi-stage)

**Contract**
- `service.yaml` with a published JSON Schema
- Unknown or misspelled fields rejected, not ignored
- One validation implementation, invoked by the CLI, the pre-commit hook and CI,
  so local and CI can never disagree

**Pipeline**
- Reusable GitHub Actions workflow that application repositories inherit
- A published block-vs-report matrix with a written rationale per gate
- Blocking: lint, typecheck, unit tests with a coverage floor, secret scanning,
  dependency vulnerabilities, static analysis, image scan, container hardening
  policy, manifest schema validation, Terraform validate/plan/policy
- Reporting: cost delta, bundle size, coverage delta, SBOM diff
- Waivers carry an owner and an expiry; an expired waiver fails the build
- Merge to main deploys to dev automatically; production requires approval
- A failed post-deploy smoke test rolls back automatically

**Guardrail verification — the centrepiece**
- Deliberately broken fixtures, each violating exactly one rule, with a CI job
  asserting each is **rejected**: secret in source · critical CVE · root
  container · security group open to the world · manifest missing an owner ·
  unencrypted storage · expired waiver
- Rego policies evaluated against the Terraform plan, with `opa test` unit tests
  covering allow *and* deny paths

**Infrastructure**
- One Terraform module set targeting both the emulator and real AWS
- Provisions registry, cluster, task definition, service, load balancer, log
  group, IAM roles, and the resources the manifest declares
- Three environments, isolated by account and by state
- Promotion by image digest — no rebuild between environments
- GitHub OIDC for the AWS target; no static credentials in the repository

**Documentation**
- README explaining the road, the gates and the omissions in fifteen minutes
- ADRs for every significant decision, including the emulator findings above
- An explicit, reasoned "what we left out" section

### Should — if the Must set lands early

- `tarmac` CLI: `new`, `dev`, `validate`, `deploy`, `status`, `rollback`, `doctor`
- Scaffolding template generating a road-ready repository
- ReviewBot: one PR comment, updated in place, with gate results, the
  infrastructure diff in plain English, and cost delta
- A verified real-AWS deploy, run once so the demo is real rather than described

### Cut — explicitly not building

- **Canary / weighted traffic shifting** — not asked for, and it would work on
  only one of the two targets. Deploy → smoke → automatic rollback is a complete
  deployment story. Named as a non-goal with a reason rather than half-built.
- **Database and migrations** — a migration gate is a genuinely good platform
  topic, but a real database plus migration tooling plus a destructive-migration
  policy does not fit the budget. The app is stateless; storage is a bucket.
- **Kubernetes** — the emulator can spawn real k3s, so this is possible, but a
  container service demonstrates the same platform concerns with far less
  surface. A scope choice, not a capability limit.
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
- **Runs in CI**: the gates execute on GitHub Actions against the emulator, so
  the repository demonstrates a working pipeline rather than describing one.
- **Real AWS is never automatic**: manual dispatch only, tagged and tearable
  down in one command.
- **Honest**: nothing is claimed to work that has not been observed working.
  Where something is simulated, the documentation says so plainly.
- **Defensible**: every gate and every omission has a written rationale.
- **Stack**: TypeScript throughout, Terraform, Rego, GitHub Actions, Docker.

---

## Key decisions

| Decision | Rationale |
|---|---|
| MiniStack over LocalStack | LocalStack's free tier no longer includes ECS, ECR or ELBv2, so the deploy stage would have to be faked |
| Dual-target Terraform | The same code deploying locally and to real AWS is what a paved road *is*; the difference is one `endpoints` block |
| CI targets the emulator only | Reproducible, secret-free, and works for anyone who clones the repo |
| Real AWS on manual dispatch | Nothing should be able to surprise-deploy or surprise-bill |
| OIDC over static keys | No long-lived cloud credential should exist in a repository |
| One emulator instance per environment | The data plane only serves the default account/region; separate instances give isolation and working ingress |
| No canary | Not requested, works on only one target, and deploy→smoke→rollback is already a complete story |
| Container service over Kubernetes | Same platform concerns, far less surface |
| One manifest, not pipeline inputs | The platform/application contract should be one reviewable, schema-checked file |
| Promotion by digest | Rebuilding between environments means production runs an artifact nothing tested |
| Policy against the Terraform plan, not source | Source-level policy misses computed values and module internals |
| Waivers expire | Permanent suppression is how security gates quietly stop working |
| Broken-fixture guardrail tests | An untested guardrail manufactures false confidence, which is worse than none |
| Same validation code locally and in CI | Divergence between local and CI checks destroys trust in the road |

---

## Suggested phase shape

1. **Foundation** — application, container image, `service.yaml` + schema +
   validation library, dual-target Terraform modules, three environments,
   `make up` producing a service reachable through the load balancer.
2. **The road** — reusable workflow, every gate, the block/report matrix, Rego
   policies with unit tests, deploy with smoke test and automatic rollback.
3. **Proof and surfaces** — the broken-fixture suite, CLI, scaffolding template,
   ReviewBot, README, ADRs, and the real-AWS path.

Phase 1 must land before 2 is meaningful. Phase 3 carries the differentiator; if
time runs short the cut order is ReviewBot, then the CLI, then real AWS. The
fixture suite is never cut.

## Definition of done

- `make up` on a clean machine produces a service reachable through the load balancer
- A commit flows to a deployed environment with no manual steps
- Every broken fixture is demonstrably blocked, in CI, in a public run
- The README explains the road, the gates and the omissions in fifteen minutes
- Every omission has a stated reason
