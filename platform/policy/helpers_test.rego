package tarmac.policy

# Assert on one rule's findings at a time. A test for the network rule should
# not fail because its fixture happens to be missing an ownership tag — that is
# the tag rule's job, and the tag rule has its own tests.
findings(name) := [f | some f in deny; f.rule == name]

# Builds a plan containing a single task definition with one container.
task_def(container) := {"resource_changes": [{
	"address": "aws_ecs_task_definition.main",
	"type": "aws_ecs_task_definition",
	"change": {
		"actions": ["create"],
		"after": {"container_definitions": json.marshal([container])},
	},
}]}

# A container that violates nothing, used as the base for single-violation
# fixtures so each test changes exactly one thing.
good_container := {
	"name": "web",
	"image": "registry/hello-world@sha256:abc123",
	"user": "1000:1000",
	"readonlyRootFilesystem": true,
	"environment": [{"name": "PORT", "value": "8080"}],
	"logConfiguration": {"logDriver": "awslogs"},
}

role_policy(statements) := {"resource_changes": [{
	"address": "aws_iam_role_policy.task",
	"type": "aws_iam_role_policy",
	"change": {
		"actions": ["create"],
		"after": {"policy": json.marshal({"Statement": statements})},
	},
}]}
