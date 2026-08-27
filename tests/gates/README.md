# Guardrail verification

Every directory here is a service that is broken in exactly one way, and a test
that asserts the platform **rejects** it.

## Why this exists

Almost every delivery platform can demonstrate that a good change passes. Very
few can demonstrate that a bad change is stopped. That asymmetry matters,
because a guardrail nobody has watched fail is a guardrail nobody should trust —
and an untested guardrail is worse than no guardrail at all, because it produces
confidence without protection.

A gate can break silently in ways that are invisible from the happy path:

- a Rego rule renamed so it matches nothing and denies nothing
- a scanner upgraded to a version whose output format changed, so findings parse
  to zero
- a `continue-on-error` added during an incident and never removed
- a policy that was always passing because its input path was wrong

In every one of those cases the pipeline stays green. The only way to know a
gate still bites is to bite it, on every commit.

## How to read a fixture

Each fixture breaks exactly one rule. If a fixture broke two, a passing test
would not tell you which guardrail caught it — and the other could be dead
without anyone noticing.

Each is paired with an assertion that the **specific** expected rule fired, not
merely that something failed. "Something failed" is satisfied by a typo.

## The control

`compliant/` violates nothing and must pass every gate. Without it, a suite
where every gate rejected everything unconditionally would look perfectly
healthy.
