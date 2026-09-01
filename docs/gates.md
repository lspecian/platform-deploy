# What blocks, what reports, and why

Every gate on the paved road is one of two things: it can stop a change from
merging, or it can tell you something and get out of the way. Which one a gate
is has to be a decision, not an accident — so each is listed here with the
reasoning.

## The rule for deciding

A gate **blocks** when all three hold:

1. It catches something that is materially cheaper to fix now than later.
2. A failure is almost always a real problem, not a judgement call.
3. The fix is available to the person who tripped it.

A gate **reports** when any of those fails — most often the second. A number
that moves for legitimate reasons has no honest pass/fail line, and blocking on
one teaches people to re-run the build until it goes green. Once that habit
exists, it applies to the gates that actually matter too. **Every gate you block
on for a bad reason weakens every gate you block on for a good one.**

The third condition is the one most often forgotten. A gate that fails with
something the developer cannot act on gets escalated to the platform team rather
than fixed, and the road becomes a bottleneck instead of a road.

---

## Blocking gates

| Gate | Catches | Why it blocks |
|---|---|---|
| **Typecheck** | Type errors | Deterministic, no judgement, fix is local |
| **Unit tests + coverage floor** | Broken behaviour, untested new code | The floor sits where the suite actually is, so a drop is a real regression rather than noise |
| **Manifest schema** | Malformed or misspelled `service.yaml` | An ignored typo produces a service that silently keeps a default. Cheapest possible place to catch it |
| **Secret scan (full history)** | Credentials in source | A committed secret is compromised the moment it lands. Nothing downstream can undo it |
| **Dependency vulnerabilities (high, critical)** | Known-exploitable dependencies | A published advisory is not a judgement call. Moderate and below report only |
| **Waiver hygiene** | Waivers with no owner, or past expiry | An unbounded suppression means the gate quietly covers nothing |
| **Static analysis** | Hardcoded credentials, shell injection, disabled TLS, dynamic evaluation | Few, specific, locally-written rules. High signal by construction |
| **Container image scan (high, critical)** | Vulnerable OS and library packages in the image | Same reasoning as dependencies, one layer down |
| **Container hardening policy** | Root containers, writable root filesystems, mutable image tags, plaintext secrets | Checked on the task definition, which is what actually runs — a Dockerfile's `USER` can be overridden |
| **Terraform fmt, validate** | Malformed infrastructure | Deterministic and trivially fixable |
| **Terraform policy** | Public ingress, unencrypted storage, wildcard IAM, missing ownership tags | Evaluated against the plan, so computed values and module internals are covered |
| **Policy unit tests** | Policies that stopped working | The guardrails are code; untested guardrails manufacture false confidence |
| **Guardrail verification** | Gates that no longer reject what they should | See below — this is the one most platforms are missing |
| **Deploy and smoke test** | A change that cannot actually deploy | Unit tests pass happily on code that will not start |

---

## Reporting gates

| Gate | Reports | Why it does not block |
|---|---|---|
| **Bundle size** | Frontend asset size, in the job summary | Growth is often legitimate. A hard cap gets raised the first time it is inconvenient, and then means nothing |
| **Low and moderate vulnerabilities** | Findings below the blocking threshold, printed by the audit step | Constant, mostly transitive, rarely actionable that day. Blocking here is how teams learn to ignore vulnerability output entirely |
| **SBOM** | An inventory of what is in the image, uploaded as an artifact | A list, not a judgement |
| **ReviewBot comment** | Every gate result and what to do about the failures | The pull request is where a reviewer already is |

---

## Guardrail verification

The unusual one, and the reason this document exists.

Every gate above is itself tested, in `tests/gates/`, by feeding the platform
services that are deliberately broken in exactly one way and asserting the
specific guardrail meant to catch each one fires.

This is not belt-and-braces. Gates break silently, in ways the happy path never
reveals:

- a Rego rule renamed so it matches nothing and denies nothing
- a scanner upgraded to a version whose output format changed, so findings parse
  to zero
- a `continue-on-error: true` added during an incident and never removed
- a policy that was always passing because its input path was wrong

In every one of those cases the pipeline stays green. Nobody finds out until the
thing the gate existed to prevent actually happens.

Two details make the suite mean something:

**A control.** `tests/gates/fixtures/compliant/` violates nothing and must pass
everything. Without it, a suite where every gate rejected every input
unconditionally would look perfectly healthy.

**Mutation tests.** For each fixture, the corresponding policy file is deleted
and the fixture must stop being caught. If it is still rejected with its rule
removed, the test was never testing that rule.

This was not hypothetical while building the platform. Semgrep's default ignore
list excludes `tests/`, so the secret-scanning rule was never exercised against
its own fixture — the rule looked healthy and matched nothing. The fixture suite
is what surfaced it.

---

## Verified in practice

ReviewBot's comment on a pull request is checked by opening one. The suite that
tests the guardrails is itself the thing most likely to rot, so the claims in
this document are exercised rather than asserted.

## Where gates run

| Stage | Gates |
|---|---|
| Pre-commit (local) | Manifest schema, formatting |
| Pull request | Every blocking gate above, plus reporting gates as a comment |
| Merge to main | Everything, then deploy to dev |
| dev → staging | Smoke test, automatic rollback on failure |
| staging → prod | The same, plus a required human approval |

Production approval is enforced in two places: GitHub environment protection,
and the manifest schema, which rejects `approval: automatic` under `prod`. Two
independent mechanisms, because the interesting failure is someone changing one
of them without noticing the other exists.

---

## What is deliberately not gated

- **Cost estimation.** Worth having, and not built. It needs a pricing source
  (Infracost or the AWS pricing API) and a baseline to diff against, and a cost
  number nobody has calibrated is a number reviewers learn to scroll past. Named
  here rather than listed as a gate that exists.
- **Coverage delta.** The coverage floor blocks, which covers the case that
  matters. Reporting the delta as well needs a stored baseline per branch; it
  was not worth the machinery for the value.
- **SBOM diff.** The SBOM is generated and attached to every build. Diffing it
  against the previous build needs somewhere to keep the previous one, which is
  artifact retention policy this project does not have.
- **Performance regression.** No load test, so any threshold would be invented.
- **Licence compliance.** Real concern, needs a policy this project does not have.
- **Infrastructure drift detection.** Belongs on a schedule, not in a pipeline.
- **Image signing and provenance attestation.** An SBOM is produced, but signing
  against an emulated registry proves nothing about a real supply chain.

