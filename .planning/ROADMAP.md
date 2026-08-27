# Roadmap: Tarmac

## Overview

Three phases, ordered so each one is only meaningful once the previous has landed. Phase 1 builds the thing that ships and the infrastructure it ships onto — without a deployable service there is nothing for a pipeline to gate. Phase 2 builds the road itself: the inherited workflow, every quality gate, and the policy layer. Phase 3 proves the road actually works by attacking it with deliberately broken services, then wraps it in the surfaces a developer touches and the documentation a reviewer reads.

The differentiator lives in Phase 3 (the broken-fixture suite). If time runs short the cut order is ReviewBot, then the CLI, then the real-AWS path. The fixture suite is never cut.

## Phases

- [x] **Phase 1: Foundation** - A real service, a schema-validated manifest, and dual-target infrastructure that actually serves traffic
- [x] **Phase 2: The Road** - The inherited pipeline, every gate, the policy layer, and a deploy that rolls itself back
- [x] **Phase 3: Proof and Surfaces** - Broken fixtures that prove the guardrails bite, plus CLI, ReviewBot, docs and real AWS

## Phase Details

### Phase 1: Foundation
**Goal**: A developer can run `make up` on a clean machine and reach a running service through its load balancer, described entirely by one schema-validated manifest.
**Depends on**: Nothing (first phase)
**Requirements**: APP-01, APP-02, APP-03, APP-04, APP-05, CTR-01, CTR-02, CTR-03, CTR-04, INF-01, INF-02, INF-03, INF-04
**Success Criteria** (what must be TRUE):
  1. `make up` on a machine with only Docker produces a greeting rendered in a browser, fetched from the API through the load balancer
  2. Deleting a required field from `service.yaml` fails validation with a message naming the field; adding a misspelled field fails rather than being ignored
  3. The same validation command runs locally and in CI and produces identical results
  4. `terraform apply` provisions the service against the local emulator, and the same modules plan cleanly against real AWS with only a variable changed
  5. dev, staging and prod have separate state and separate account identity
**Plans**: 3 plans

Plans:
- [x] 01-01: Application — React SPA, Fastify API, health endpoints, structured logs, tests, hardened image
- [x] 01-02: Contract — `service.yaml`, JSON Schema, single validation library shared by CLI, hook and CI
- [x] 01-03: Infrastructure — dual-target Terraform modules, three environments, `make up`

### Phase 2: The Road
**Goal**: A change flows from pull request to a deployed environment through a pipeline the application repository inherits, where every gate's blocking behaviour is deliberate and documented.
**Depends on**: Phase 1
**Requirements**: PIP-01, PIP-02, PIP-03, PIP-04, PIP-05, PIP-06, PIP-07, PIP-08, POL-01, POL-02, POL-03
**Success Criteria** (what must be TRUE):
  1. An application repository gets the full pipeline by referencing one reusable workflow, not by copying YAML
  2. Every gate appears in a published matrix marked blocking or reporting, each with a written rationale
  3. A pull request that fails a blocking gate cannot merge; one that only trips a reporting gate can
  4. Merging to main deploys to dev with no human action; production waits for approval
  5. The image deployed to a later environment is the same digest that passed the earlier one
  6. A deliberately failing smoke test causes an automatic rollback to the previous version
  7. `opa test` passes with both allow and deny cases for every policy
**Plans**: 3 plans

Plans:
- [x] 02-01: Reusable workflow, all gates, block-vs-report matrix, expiring waivers
- [x] 02-02: Rego policy layer against the Terraform plan, with unit tests
- [x] 02-03: Deploy, digest promotion, smoke test, automatic rollback

### Phase 3: Proof and Surfaces
**Goal**: Every guardrail is demonstrably proven to reject the thing it exists to reject, and the road has the surfaces a developer touches and the documentation a reviewer reads.
**Depends on**: Phase 2
**Requirements**: GAT-01, GAT-02, GAT-03, GAT-04, GAT-05, GAT-06, GAT-07, GAT-08, CLI-01, CLI-02, CLI-03, CLI-04, CLI-05, BOT-01, BOT-02, DOC-01, DOC-02, DOC-03, INF-05, INF-06
**Success Criteria** (what must be TRUE):
  1. Seven deliberately broken fixtures each fail CI, each blocked by the specific guardrail it targets and no other
  2. Disabling any single guardrail causes its fixture test to fail, proving the test is wired to the guardrail rather than passing incidentally
  3. `tarmac new` produces a repository that passes the full pipeline without hand-editing
  4. A pull request carries exactly one bot comment, updated in place across pushes
  5. The README lets a reader with no context explain the road, the gates and the omissions
  6. A real AWS deploy runs from a manual dispatch using OIDC, with no static credential in the repository, and `make destroy-aws` removes everything it created
**Plans**: 4 plans

Plans:
- [x] 03-01: Broken-fixture suite and the CI job that asserts each is rejected
- [x] 03-02: `tarmac` CLI and the scaffolding template
- [x] 03-03: ReviewBot pull request comment
- [x] 03-04: README, ADRs, omissions list, real-AWS path with OIDC and teardown

---
*Roadmap created: 2026-08-27*

---

## Outcome

All three phases delivered. Both pipelines green on GitHub Actions, including a
job that stands up the emulator, deploys, and verifies the running commit
matches the build.

**Verified, not asserted:**
- `make up` from a clean machine reaches a service answering through its load
  balancer in about 90 seconds
- Rollback tested by deploying a wrong image: smoke failed, previous version
  restored, exit code 1
- Container verified non-root with a read-only root filesystem, and graceful
  SIGTERM confirmed from its shutdown log
- 29 guardrail tests including mutation tests that delete each policy and assert
  the fixture stops being caught

**Deferred from the Should tier:** none. CLI, scaffolding and ReviewBot all
landed. The real-AWS path is built and OIDC-authenticated but has not been run
against the live account — that remains a one-command manual step.

**Gates caught real defects in this repository**, which is the evidence they
work: an over-broad IAM role, vulnerable packages invisible to `npm audit`, a
config bug reading `process.env` instead of its argument, and three guardrails
that were silently dead.
