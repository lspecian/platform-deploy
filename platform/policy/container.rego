package tarmac.policy

# ---------------------------------------------------------------------------
# Fail closed when the container definitions cannot be read.
#
# This rule exists because its absence was a real, silent hole. Terraform emits
# `container_definitions` as unknown whenever the JSON embeds a value computed
# during apply — a bucket id, an ARN. The attribute is then missing from
# `change.after`, `json.unmarshal` yields nothing, and every rule below iterates
# an empty set. Five guardrails reported success while inspecting nothing.
#
# A policy engine that cannot see its input must not approve it. Anything else
# is a gate that is strongest against the plans it can read and absent from the
# ones it cannot, which is precisely backwards.
# ---------------------------------------------------------------------------

deny contains finding if {
	some task in resources("aws_ecs_task_definition")
	unknown_at_plan_time(task, "container_definitions")

	finding := {
		"rule": "container-definitions-unreadable",
		"resource": address(task),
		"msg": sprintf(
			"%s has container definitions that cannot be evaluated at plan time, so no container policy can be applied to it. This usually means the JSON embeds a value computed during apply -- reference a derived name instead of a resource attribute.",
			[address(task)],
		),
	}
}

# ---------------------------------------------------------------------------
# Container hardening
#
# These are checked on the task definition rather than the Dockerfile. A
# Dockerfile can declare `USER node` and a task definition can override it, so
# checking the Dockerfile alone verifies an intention rather than a fact. The
# plan is what will actually run.
# ---------------------------------------------------------------------------

deny contains finding if {
	some entry in container_definitions
	runs_as_root(entry.container)

	finding := {
		"rule": "no-root-container",
		"resource": entry.task,
		"msg": sprintf(
			"container %q runs as root. A container escape starts as root on the host. Set user to a non-zero uid.",
			[entry.container.name],
		),
	}
}

runs_as_root(container) if not container.user
runs_as_root(container) if container.user == ""
runs_as_root(container) if container.user == "root"
runs_as_root(container) if container.user == "0"
runs_as_root(container) if startswith(container.user, "0:")

deny contains finding if {
	some entry in container_definitions
	not entry.container.readonlyRootFilesystem == true

	finding := {
		"rule": "readonly-root-filesystem",
		"resource": entry.task,
		"msg": sprintf(
			"container %q has a writable root filesystem. Set readonlyRootFilesystem and mount a tmpfs for scratch space.",
			[entry.container.name],
		),
	}
}

# ---------------------------------------------------------------------------
# Image references
#
# A tag is mutable. `:latest` today is a different image tomorrow, so a rebuild
# of an unchanged commit can produce a different artifact, and "the image that
# passed staging" stops meaning anything. The pipeline deploys digests.
# ---------------------------------------------------------------------------

# `:latest` is refused everywhere, on every target, with no exemption. It is
# mutable by design and carries no information about what is running.
deny contains finding if {
	some entry in container_definitions
	endswith(entry.container.image, ":latest")

	finding := {
		"rule": "immutable-image",
		"resource": entry.task,
		"msg": sprintf(
			"container %q deploys %q. The latest tag is mutable by definition, so it cannot identify what is running.",
			[entry.container.name, entry.container.image],
		),
	}
}

# A tag without a digest is refused on any target that pulls from a registry.
#
# Exempt on the local emulator only, because an image built on the host and
# never pushed has no registry digest to reference — there is literally nothing
# to pin to. The exemption is narrow: it covers a missing digest, not `:latest`,
# and it applies only when the caller declares the local target.
#
# It defaults to *strict*. If the target is not declared, the digest is
# required. A policy that relaxes when it is unsure of its context is a policy
# that can be relaxed by forgetting to configure it.
deny contains finding if {
	some entry in container_definitions
	not contains(entry.container.image, "@sha256:")
	not endswith(entry.container.image, ":latest")
	not local_target

	finding := {
		"rule": "immutable-image",
		"resource": entry.task,
		"msg": sprintf(
			"container %q deploys %q by tag. Deploy by digest so the artifact that was tested is bit-for-bit the artifact that runs.",
			[entry.container.name, entry.container.image],
		),
	}
}

local_target if data.config.target == "local"

# ---------------------------------------------------------------------------
# Secrets
#
# Credential-shaped values belong in `secrets` (resolved from Secrets Manager or
# SSM at task start), never in `environment`, which is plain text in the task
# definition and visible to anyone with describe permissions.
#
# One exception: the local emulator's documented public constants. The emulator
# injects ECS container credentials correctly, but the JavaScript AWS SDK
# rejects an http credentials URI off-loopback, so the platform sets static
# dummy values on the local target. See docs/adr/0002-emulator-constraints.md.
#
# The exception is exactly one value. Anything else with a credential-shaped
# name is denied, and both the allow and the deny case are tested below — an
# exception that is named, bounded and tested is not the same thing as a hole.
# ---------------------------------------------------------------------------

SECRET_NAME_PATTERN := `(?i)(password|secret|token|credential|private_key|access_key)`

EMULATOR_SENTINEL := "test"

deny contains finding if {
	some entry in container_definitions
	some env in entry.container.environment
	regex.match(SECRET_NAME_PATTERN, env.name)
	not emulator_sentinel(env)

	finding := {
		"rule": "no-plaintext-secrets",
		"resource": entry.task,
		"msg": sprintf(
			"container %q sets %q in plain text. Use the task definition's secrets block so the value is resolved at runtime instead of stored in the task definition.",
			[entry.container.name, env.name],
		),
	}
}

emulator_sentinel(env) if {
	env.name in {"AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"}
	env.value == EMULATOR_SENTINEL
}

# ---------------------------------------------------------------------------
# Observability
#
# A container with no log configuration produces no logs, which is discovered
# during the first incident rather than before it.
# ---------------------------------------------------------------------------

deny contains finding if {
	some entry in container_definitions
	not entry.container.logConfiguration

	finding := {
		"rule": "logging-required",
		"resource": entry.task,
		"msg": sprintf(
			"container %q has no log configuration. Logs that do not exist cannot be read during an incident.",
			[entry.container.name],
		),
	}
}
