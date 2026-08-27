# Tarmac

## What This Is

Tarmac is an internal delivery platform — a "paved road" that application teams use to get a service from a branch into production safely. A team adopting Tarmac gets a scaffolded repository, one declarative service manifest, a pipeline they inherit rather than copy, infrastructure generated from that manifest, and guardrails that fail closed. The sample service riding it is deliberately boring: a React SPA calling a Node API that returns a greeting. The service is the payload; the road is the product.

## Core Value

A developer changes one file and ships safely without knowing how any of it works — and cannot ship something unsafe even if they try.

Of those two halves, the second is the one this project proves hardest. When trade-offs arise, protect the proof that guardrails fail closed.

## Requirements

### Validated

(None yet — ship to validate)

### Active

See `.planning/REQUIREMENTS.md` for the full set with IDs. Summary:

- [ ] A boring but real service: React SPA + Node/Fastify API, health endpoints, structured logs, hardened container
- [ ] A schema-validated `service.yaml` that is the only infrastructure surface a developer touches
- [ ] One Terraform module set that targets both a local AWS emulator and real AWS
- [ ] A reusable CI/CD workflow with a published block-vs-report matrix and a rationale per gate
- [ ] Rego policy evaluated against the Terraform plan, with unit tests covering allow and deny
- [ ] A broken-fixture suite proving every guardrail rejects the thing it exists to reject
- [ ] Developer surfaces: `tarmac` CLI, scaffolding template, ReviewBot PR comment
- [ ] Documentation: README, ADRs, and an explicit reasoned list of omissions

### Out of Scope

- **Canary / weighted traffic shifting** — not requested, and it would work on only one of the two targets. Deploy → smoke → automatic rollback is a complete deployment story.
- **Database and migrations** — a migration gate is a good platform topic, but a real database plus migration tooling plus a destructive-migration policy does not fit a one-day budget. The app is stateless.
- **Kubernetes** — the emulator can spawn real k3s, so this is possible, but a container service demonstrates the same platform concerns with far less surface. A scope choice, not a capability limit.
- **Multi-region, disaster recovery, service mesh, tracing backend** — real concerns, but they exercise cloud topology rather than the road.
- **Service catalogue / web portal** — the CLI and the pull request are the surfaces. A portal is right at fifty services, not at one.
- **Autoscaling** — configurable but not load-tested. Claiming tested autoscaling without a load test would be dishonest.
- **Image signing and provenance attestation** — an SBOM is produced; signing against an emulated registry proves nothing about a real supply chain.
- **A second sample service** — reusability is better shown by the scaffolding template generating one on demand.

## Context

**Local cloud emulator.** LocalStack moved ECS, ECR, ELBv2 and RDS behind a paid plan, which makes it unusable as a free foundation for a road that must actually deploy something. MiniStack (MIT, `ministackorg/ministack`, v1.5.2) emulates those services free and runs real Docker containers for ECS.

**Spike findings — verified by running Terraform and the AWS CLI against the emulator, not assumed:**

- Terraform drives the emulator; 13 resources applied cleanly.
- ECS starts a real Docker container that serves real HTTP.
- End-to-end ingress works: load balancer → target group → real container, verified by curl.
- The data plane resolves to the **default account and region** — an unauthenticated HTTP request carries no SigV4 and the LB store is keyed on both. Therefore: one emulator instance per environment, each with `MINISTACK_ACCOUNT_ID` and `MINISTACK_REGION` set so its default scope matches.
- `ModifyListener` updates `listener["DefaultActions"]` but never syncs the default rule, which is what `dispatch_request` reads — so listener changes are silently ignored. Therefore: blue/green swaps recreate the listener. Upstream bug, worth reporting.
- ECS does not register task IPs into target groups (`awsvpc` not modelled). Therefore: the deploy step calls `RegisterTargets` explicitly on the emulator target; real AWS does it automatically.
- `forward` reads only `TargetGroupArn` and ignores `ForwardConfig` — no target group weights, so no ALB-weighted canary on the emulator.

**Real AWS account — verified:** `AdministratorAccess`, default VPC in `eu-central-1` with three subnets, no existing ECS clusters or load balancers. Fargate goes in public subnets with `assign_public_ip`, avoiding a NAT Gateway — the only line item that would actually cost money. Roughly $1/day, torn down after.

## Constraints

- **Timeline**: one working day — scope is the variable, honesty is not
- **Portability**: `git clone && make up` on a laptop with Docker; no cloud account, API key or signup
- **CI**: gates execute on GitHub Actions against the emulator, so the repo demonstrates a working pipeline rather than describing one
- **Safety**: real AWS is manual-dispatch only, tagged, and removable in one command — nothing can surprise-deploy or surprise-bill
- **Security**: GitHub OIDC for AWS; no long-lived cloud credential exists in the repository
- **Honesty**: nothing is claimed to work that has not been observed working; where something is simulated, the docs say so
- **Defensibility**: every gate and every omission has a written rationale
- **Tech stack**: TypeScript throughout, Terraform, Rego, GitHub Actions, Docker

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| MiniStack over LocalStack | LocalStack's free tier no longer includes ECS, ECR or ELBv2, so the deploy stage would have to be faked | — Pending |
| Dual-target Terraform | The same code deploying locally and to real AWS is what a paved road *is*; the difference is one `endpoints` block | — Pending |
| CI targets the emulator only | Reproducible, secret-free, works for anyone who clones the repo | — Pending |
| Real AWS on manual dispatch | Nothing should be able to surprise-deploy or surprise-bill | — Pending |
| OIDC over static keys | No long-lived cloud credential should exist in a repository | — Pending |
| One emulator instance per environment | The data plane only serves the default account/region; separate instances give isolation and working ingress | — Pending |
| No canary | Not requested, works on only one target, and deploy→smoke→rollback is already complete | — Pending |
| Container service over Kubernetes | Same platform concerns, far less surface | — Pending |
| One manifest, not pipeline inputs | The platform/application contract should be one reviewable, schema-checked file | — Pending |
| Promotion by digest | Rebuilding between environments means production runs an artifact nothing tested | — Pending |
| Policy against the Terraform plan, not source | Source-level policy misses computed values and module internals | — Pending |
| Waivers expire | Permanent suppression is how security gates quietly stop working | — Pending |
| Broken-fixture guardrail tests | An untested guardrail manufactures false confidence, which is worse than none | — Pending |
| Same validation code locally and in CI | Divergence between local and CI checks destroys trust in the road | — Pending |

---
*Last updated: 2026-08-27 after initialization*
