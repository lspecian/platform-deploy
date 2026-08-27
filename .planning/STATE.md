# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-08-27)

**Core value:** A developer changes one file and ships safely without knowing how any of it works — and cannot ship something unsafe even if they try.
**Current focus:** Complete. v1 delivered.

## Current Position

Phase: 3 of 3 (Proof and Surfaces) — complete
Plan: 4 of 4 in final phase
Status: Milestone complete
Last activity: 2026-08-27 — ReviewBot, real-AWS path and README landed; both pipelines green

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
| CLI | 47 |
| Policy (opa) | 58 |
| Guardrail verification | 29 |
| **Total** | **235** |

### Decisions that proved out

- Spiking the emulator before designing on it: found five divergences early, all absorbed in platform code and none in application code
- Testing the guardrails: caught three that were silently dead
- Policy against the plan rather than source: caught an over-broad IAM role in our own module
- Not committing a fixture credential: avoided permanent scanner allowlists

### Open items

- The real-AWS deploy is built and OIDC-authenticated but has not been run against the live account. One manual dispatch away.
- Report the `ModifyListener` default-rule bug upstream to ministackorg/ministack.

### Blockers/Concerns

None. Deliberate omissions are listed with reasons in the README and docs/gates.md.

## Session Continuity

Last session: 2026-08-27
Stopped at: v1 complete, pushed to github.com/lspecian/platform-deploy
Resume file: None
