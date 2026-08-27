# ADR 0003 — One Terraform codebase, two targets

**Status:** Accepted · 2026-08-27

## Context

The road needs to run locally so anyone can clone it, and it needs to be
credible as something you would actually run on AWS. Those pull in opposite
directions if you let them become two codebases.

Two codebases is the failure mode: the local one gets exercised constantly and
the AWS one rots, until the day someone runs it and discovers it has not worked
for months. At that point the local road proves nothing about the real one.

## Decision

One module set, two targets, selected by a single variable.

The only structural difference is the provider's `endpoints` block and the
credential-skipping flags that go with it. Everything below the provider — VPC,
security groups, registry, cluster, task definition, service, load balancer,
target group, IAM roles, bucket — is byte-identical between targets.

```hcl
provider "aws" {
  region = var.region

  access_key                  = local.is_local ? "test" : null
  skip_credentials_validation = local.is_local

  dynamic "endpoints" {
    for_each = local.is_local ? [1] : []
    content { ecs = var.endpoint  # ...and the rest
    }
  }
}
```

Emulator workarounds live behind a named `is_local` flag passed into the module,
so they are visible as workarounds rather than disguised as design. There are
four of them, all listed in [ADR 0002](0002-emulator-constraints.md).

## CI targets the emulator; AWS is manual only

CI deploys to the emulator on every push. It is free, needs no secrets, and
means the pipeline in this repository genuinely executes rather than being
described.

Real AWS is `workflow_dispatch` and `make deploy-aws` only. Nothing that runs
automatically can reach a real account. This is deliberate: a pipeline that can
deploy to a real cloud on a push is a pipeline that can bill you on a push, and
a reference platform should not have that property.

Credentials for the AWS path come from GitHub OIDC, so no long-lived AWS key
exists in this repository or in its secrets. Static keys in CI are the most
common way cloud credentials leak, and the fix costs about twenty lines of
Terraform.

Everything the road creates is tagged `Platform=tarmac` with the owning team, so
`make destroy-aws` removes all of it and nothing is left running by accident.

## Consequences

**Good.** The Terraform in this repository is the Terraform you would run
against AWS. The local road exercises the same code the real road uses, so it
cannot silently rot. A reviewer can read one module and understand both.

**Bad.** Some AWS behaviour cannot be exercised locally — health-check driven
target deregistration, IAM actually being enforced, real ALB timing. The
emulator will report success in places where AWS would not.

**Accepted.** Local runs prove the wiring, not the cloud's semantics. Anything
that depends on real AWS behaviour has to be verified against real AWS, which is
what the manual path is for.

## What was not chosen

**Terragrunt.** It solves configuration duplication across many environments and
many stacks. With three environments and one stack it would add a tool and a
layer of indirection to solve a problem this repository does not have. A tfvars
file per environment is the smaller thing that works.

**Workspaces vs separate backends.** State is separated by workspace here, which
is adequate for a local emulator and one AWS account. Separate backends per
account is the right answer once environments live in separate accounts with
separate blast radii, and is the first thing to change when this grows.
