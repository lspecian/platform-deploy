# ADR 0002 — Emulator constraints and how the road accommodates them

**Status:** Accepted · 2026-08-27
**Emulator version:** MiniStack v1.5.2 (light edition)

## Context

Four behaviours of the local emulator differ from AWS in ways that change the
design. All four were found by a timeboxed spike before anything was built on
top of them. Each is recorded here with what was observed, what the road does
about it, and what changes on real AWS.

This document exists so that nobody reading the code has to guess whether a
conditional is a workaround or a genuine platform decision.

---

## 1. The load balancer data plane only serves the default account and region

**Observed.** A load balancer created under account `000000000001` in
`eu-central-1` was created successfully, reported healthy targets, and returned
nothing. Requests fell through to the storage service's handler instead.

**Cause.** The load balancer store is keyed by account *and* region, taken from
the request context. A data-plane request is plain HTTP with no SigV4, so it
resolves to the emulator's default account and region. A load balancer created
under any other scope is invisible to it — while every control-plane call
continues to succeed, which is what makes this an expensive thing to discover
late.

**Decision.** One emulator instance per environment, each on its own port with
`MINISTACK_ACCOUNT_ID` and `MINISTACK_REGION` set so its default scope matches
what Terraform creates:

| Environment | Port | Account |
|---|---|---|
| dev | 4566 | `000000000001` |
| staging | 4567 | `000000000002` |
| prod | 4568 | `000000000003` |

This is better than the alternative anyway. Three instances mean three genuinely
separate state stores, so a mistake in dev cannot reach prod's state at all.

**On real AWS.** Not applicable — separate accounts, separate endpoints.

---

## 2. `ModifyListener` does not update what the dispatcher reads

**Observed.** Changing a listener's default action reported success and had no
effect: the load balancer kept serving the previous action.

**Cause.** The request dispatcher reads the default *rule's* actions.
`ModifyListener` writes to the listener's `DefaultActions` and never syncs that
rule. The two disagree, and the dispatcher reads the stale one.

This is a genuine upstream bug rather than a modelling gap, and it is worth
reporting.

**Decision.** The listener is declared `create_before_destroy`, so a change
replaces it rather than modifying it in place.

**On real AWS.** No effect. Replacing a listener is slightly slower than
modifying one, and correct either way.

---

## 3. ECS does not register task addresses with the target group

**Observed.** An ECS service with a `load_balancer` block started a real
container, and the target group stayed empty. The load balancer correctly
answered `No registered targets in target group`.

**Cause.** `awsvpc` networking is not modelled. Tasks report no network
interface and no private IP, so there is no address for ECS to register.

**Decision.** The deploy script registers task addresses explicitly when the
target is local, and skips that step entirely on AWS. It lives in
`platform/scripts/deploy.sh` behind one conditional, so no service ever deals
with it.

**On real AWS.** ECS registers task IPs itself. The step is skipped.

This one is arguably a feature of the demonstration: it makes visible a
mechanism that AWS hides, and it is exactly the class of difference a paved road
exists to absorb on a team's behalf.

---

## 4. `forward` ignores `ForwardConfig`, so target groups cannot be weighted

**Observed.** No weighting support: the forward action reads only a single
`TargetGroupArn`.

**Consequence.** Canary and weighted blue-green cannot be implemented against
the emulator. They would work on real AWS, which means building them would
produce a feature that works on one target and silently does not on the other —
worse than not having it.

**Decision.** No traffic-shifted deployment. Deployment safety is instead:
deploy, smoke test the new version, roll back automatically if the smoke test
fails. That is a complete deployment story, it works identically on both
targets, and it is verified end to end.

See [ADR 0004](0004-deployment-strategy.md).

---

## 5. Container credentials are injected but this SDK rejects them

**Observed.** A task could not reach the bucket its manifest declared:
`Could not load credentials from any providers`. Readiness stayed red.

**Cause.** The emulator does inject `AWS_CONTAINER_CREDENTIALS_FULL_URI`,
`AWS_CONTAINER_AUTHORIZATION_TOKEN` and `AWS_ENDPOINT_URL` — correctly. But the
JavaScript AWS SDK only accepts an `http` credentials URI when the host is
loopback or `169.254.170.2`, and the emulator serves it on a bridge address.
botocore's allow-list is broader, so this affects JS services and not Python
ones.

**Decision.** On the local target only, the task definition sets the emulator's
documented constants `AWS_ACCESS_KEY_ID=test` / `AWS_SECRET_ACCESS_KEY=test`.

These are a published public constant, not a secret. The policy gate still
forbids credential-shaped values in a task definition; it carries one narrow
exception for exactly this sentinel and rejects every other value, and both the
allow and the deny case are covered by policy unit tests. An exception that is
named, bounded and tested is a different thing from a hole.

**On real AWS.** The task role supplies credentials through the ECS credentials
endpoint. No environment variables are set and the exception never applies.

---

## What this list is for

Five divergences, all found in one timeboxed spike, all absorbed by four
conditionals in platform code and none in application code. That ratio is the
actual claim being made here: the emulator is close enough to AWS that a service
team never sees the difference.
