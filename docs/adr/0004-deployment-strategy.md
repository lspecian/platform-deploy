# ADR 0004 — Deploy, smoke test, roll back automatically

**Status:** Accepted · 2026-08-27

## Context

A deploy needs a story for what happens when the new version is broken. The
usual options:

**Canary / weighted traffic shifting.** Route a small percentage to the new
version, watch metrics, widen or abort. The strongest answer when you have the
traffic and the signal to make the judgement.

**Blue/green.** Stand up the new version alongside, verify, switch traffic in
one step, keep the old one warm to switch back.

**Deploy and verify.** Replace, prove the new version works, roll back if it
does not.

## Decision

Deploy, smoke test, roll back automatically on failure. No canary.

Three reasons, in order of weight:

**It works identically on both targets.** The emulator's `forward` action reads
a single target group ARN and ignores `ForwardConfig` entirely, so weighted
target groups do not exist there. Building canary would produce a feature that
works on real AWS and silently does not locally — which is worse than not having
it, because the local road is what everyone actually runs.

**A canary needs a signal to judge.** Weighting traffic is the easy half; the
hard half is deciding whether the canary is healthy, which needs error-rate and
latency data over a window long enough to be meaningful. This service has no
traffic. A canary with nothing to measure is a slower deploy wearing a costume.

**Nobody asked for it.** It is better to name this as a deliberate non-goal with
a reason than to half-build it.

## What is actually built

1. Terraform applies the new task definition
2. Tasks are made reachable (registered explicitly on the emulator; ECS does it
   on AWS — see [ADR 0002](0002-emulator-constraints.md))
3. The smoke test polls `/api/greeting` and asserts the **deployed commit
   matches the one just built**, not merely that something answers
4. On failure, the previous image is re-applied and re-verified
5. The deploy exits non-zero even when the rollback succeeds — the deploy did
   fail, and a green pipeline would hide that

Step 3 is the part that matters. A smoke test that only checks for a 200 will
pass against the *previous* version if the new one never starts, turning a
failed deploy into a green one. Asserting the commit is what makes it a real
check, which is why the API returns its build provenance at all.

## Verified

Rollback is tested, not asserted. Deploying an image that serves HTTP but is not
this service produces: smoke failure, automatic rollback, previous version
serving again, exit code 1.

## Consequences

**Good.** One mechanism, both targets, fully verified. A failed deploy restores
service without a human.

**Bad.** There is a window — between the new tasks serving and the smoke test
failing — where users can hit the broken version. A canary would have exposed
that to a fraction of traffic instead of all of it.

**Accepted.** For this service the window is seconds. For a service with real
traffic, this is the first thing to upgrade — and the smoke test built here is
the health signal a canary would need, so it is a step toward canary rather
than a detour.
