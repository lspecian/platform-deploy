# unreadable-container-definitions

Breaks exactly one rule: the task definition's container definitions cannot be
read at plan time, so no container policy can be applied to it.

## Why this fixture exists

This is the only fixture here that was written *after* the hole it covers was
already live in this repository.

Terraform emits `container_definitions` as unknown whenever the encoded JSON
embeds a value computed during apply — a bucket id, an ARN. The attribute is
then absent from `change.after` and flagged in `change.after_unknown`. The
policy's helper called `json.unmarshal` on a value that did not exist, produced
nothing, and every container rule iterated an empty set and reported success.

Five guardrails — no-root-container, readonly-root-filesystem, immutable-image,
no-plaintext-secrets, logging-required — passed on every real plan while
inspecting nothing at all.

Every other fixture in this directory hand-authors a *known* definitions string.
That is exactly why none of them caught it: they tested the rules against input
shaped the way the rules expected, not the way Terraform actually emits it.

The lesson is the rule now encoded in `container.rego`: **a policy engine that
cannot see its input must not approve it.** Anything else is a gate that is
strongest against the plans it can read and absent from the ones it cannot.
