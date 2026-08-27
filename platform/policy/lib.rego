# Shared helpers for reading a Terraform plan.
#
# Policies evaluate `terraform show -json <plan>` rather than the .tf source.
# Source-level policy is easy to write and easy to fool: it cannot see values
# that come from variables, locals, data sources or modules, so a rule that
# reads the source can pass while the thing actually being created violates it.
# The plan is what Terraform is about to do, which is the only thing worth
# checking.
package tarmac.policy

# Every resource of `type` that will exist once this plan is applied.
#
# Deletions are excluded: a resource on its way out cannot violate anything, and
# flagging it would block the very change that removes the violation.
resources(type) := [rc |
	some rc in input.resource_changes
	rc.type == type
	not deleting(rc)
]

deleting(rc) if {
	rc.change.actions == ["delete"]
}

# The state a resource will be in after apply.
after(rc) := rc.change.after

# A short, human-readable identifier for a resource in a plan.
address(rc) := rc.address

# Every container definition across every task definition in the plan.
#
# Container definitions arrive as a JSON string inside the plan, so they have to
# be decoded before anything can be asserted about them.
container_definitions contains entry if {
	some task in resources("aws_ecs_task_definition")
	defs := json.unmarshal(after(task).container_definitions)
	some container in defs
	entry := {"task": address(task), "container": container}
}
