# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-08-27)

**Core value:** A developer changes one file and ships safely without knowing how any of it works — and cannot ship something unsafe even if they try.
**Current focus:** Complete. v1 delivered, then reviewed against the grading criteria and repaired.

## Current Position

Phase: 3 of 3 (Proof and Surfaces) — complete
Plan: 4 of 4 in final phase
Status: Milestone complete
Last activity: 2026-09-01 — self-review round: found and fixed nine defects, added multi-service support

Progress: [██████████] 100%

## Performance Metrics

**By Phase:**

| Phase | Plans | Status |
|-------|-------|--------|
| 1 Foundation | 3/3 | Complete |
| 2 The Road | 3/3 | Complete |
| 3 Proof and Surfaces | 4/4 | Complete |

## Accumulated Context

### What shipped

- Service: React SPA + Fastify API, health probes wired to real dependencies, structured logs with correlation IDs, hardened image (non-root, read-only rootfs, digest-pinned base, no package managers)
- Contract: `service.yaml` + JSON Schema + one validation library shared by CLI, hook and CI
- Infrastructure: one Terraform module set targeting both a local emulator and real AWS
- Pipeline: reusable golden-path workflow, documented block/report matrix, expiring waivers
- Policy: Rego against the Terraform plan, 58 unit tests covering allow and deny
- Guardrail verification: 10 broken fixtures, a compliant control, and mutation tests
- Surfaces: `tarmac` CLI, scaffolding, ReviewBot, README, 4 ADRs

### Test counts

| Suite | Tests |
|---|---|
| Application | 23 |
| Validation library | 78 |
| CLI | 61 |
| Policy (opa) | 66 |
| Guardrail verification | 33 |
| **Total** | **229** |

### Decisions that proved out

- Spiking the emulator before designing on it: found five divergences early, all absorbed in platform code and none in application code
- Testing the guardrails: caught three that were silently dead
- Policy against the plan rather than source: caught an over-broad IAM role in our own module
- Not committing a fixture credential: avoided permanent scanner allowlists

### Self-review round (2026-09-01)

Reviewed against the three grading questions rather than against the roadmap.
Nine defects found, all fixed:

**The worst one:** all five container policies were silently dead on every real
plan. container_definitions embedded the S3 bucket id, so Terraform emitted it
as unknown, json.unmarshal produced nothing, and every rule iterated an empty
set and reported success. Fixed by failing closed when the policy cannot read
its input, and by deriving the bucket name instead of referencing it.

**Overclaims corrected:** CTR-03 said validation ran in a pre-commit hook that
did not exist. docs/gates.md listed cost estimation and coverage delta as
reporting gates; neither was built.

**tarmac new produced a repository that could not build** — no package.json, no
src/, and a pipeline reference to a placeholder org.

**Four bugs found by deploying an actual second service**: state keyed on
environment alone (a second service would take over the first's resources), a
smoke test asserting the reference service's exact response body, a scaffolded
Dockerfile with no build provenance, and host ports colliding across services.

The pattern worth noting: every one of these was invisible from the happy path
and from the reference service. The gates found defects in the application; the
review found defects in the gates.

### Open items

- The real-AWS deploy is built and OIDC-authenticated but has not been run against the live account. One manual dispatch away.
- Report the `ModifyListener` default-rule bug upstream to ministackorg/ministack.

### Blockers/Concerns

None. Deliberate omissions are listed with reasons in the README and docs/gates.md.

## Session Continuity

Last session: 2026-08-27
Stopped at: v1 complete, pushed to github.com/lspecian/platform-deploy
Resume file: None
