# ADR 0001 — Use MiniStack as the local cloud emulator

**Status:** Accepted · 2026-08-27

## Context

The paved road has to actually deploy something. A pipeline whose deploy stage
prints "would deploy" proves nothing, and the whole premise of this platform is
that a change flows from a branch to running infrastructure.

Deploying to a real cloud account on every push is not viable for a reference
platform: it needs credentials, a budget, and an owner. Anyone who clones this
repository should be able to run the whole road with Docker and nothing else.

So the road needs a local cloud. The candidates:

**LocalStack** is the obvious answer and was the first choice. Its free tier no
longer includes ECS, ECR, ELBv2 or RDS — those moved behind a paid plan. Without
a container service, a registry or a load balancer, the deploy stage would have
to be simulated, which is precisely what this project is trying not to do.

**Docker Compose** as the deploy target avoids the problem by not having one.
But then there is no infrastructure-as-code story worth showing: no registry, no
load balancer, no IAM, no cloud resources driven by the service manifest.

**MiniStack** (`ministackorg/ministack`, MIT) emulates 60+ AWS services on one
port, with ECS, ECR and ELBv2 free. Its ECS `RunTask` starts real Docker
containers rather than recording that a task was requested.

## Decision

Use MiniStack as the local target.

The decision was made after a timeboxed spike, not from its README. The spike
ran Terraform and the AWS CLI against a live instance and confirmed:

- Terraform drives it — 27 resources apply cleanly for this service
- ECS starts a real container that serves real HTTP
- Ingress works end to end: load balancer → target group → container
- The emulator starts in under two seconds in a 186 MB image

It also found four behaviours that differ from AWS. Those are documented in
[ADR 0002](0002-emulator-constraints.md) along with what the design does about
each. None of them were discovered after building on top of them.

## Consequences

**Good.** `git clone && make up` produces a running service on any machine with
Docker — no account, no key, no signup. CI runs the full road with no secrets,
so the pipeline in this repository is a working pipeline rather than a
description of one. The Terraform is the Terraform you would write for AWS.

**Bad.** MiniStack is young — first released five months before this was
written. Its behaviour is not AWS's behaviour, and four places where it differs
are load-bearing enough to need documenting and working around.

**Mitigation.** The road targets both the emulator and a real AWS account from
the same Terraform ([ADR 0003](0003-dual-target-terraform.md)). Every emulator
workaround sits behind a named `is_local` conditional, so what is a workaround
and what is the real behaviour is always legible — and a reader can see exactly
how much of the road is emulator-specific. It is four conditionals.

## Revisiting

Reconsider if the emulator's divergences from AWS start requiring conditionals
in application code rather than platform code. The moment a service has to know
which cloud it is running on, the road has stopped doing its job.
