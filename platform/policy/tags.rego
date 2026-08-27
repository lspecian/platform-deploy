package tarmac.policy

# ---------------------------------------------------------------------------
# Ownership
#
# Every resource that can carry tags must say who owns it and which environment
# it belongs to. This is not bookkeeping: an untagged resource is one nobody can
# be asked about when it appears on a bill, triggers an alarm at 3am, or turns
# up in an audit. "Whose is this?" should never require archaeology.
#
# Only resource types that actually support tags are checked. Flagging a route
# table association for having no owner would train people to ignore the rule.
# ---------------------------------------------------------------------------

TAGGABLE_TYPES := {
	"aws_s3_bucket",
	"aws_ecs_cluster",
	"aws_ecs_service",
	"aws_ecs_task_definition",
	"aws_lb",
	"aws_lb_target_group",
	"aws_cloudwatch_log_group",
	"aws_ecr_repository",
	"aws_security_group",
	"aws_vpc",
}

REQUIRED_TAGS := {"Owner", "Environment"}

deny contains finding if {
	some type in TAGGABLE_TYPES
	some resource in resources(type)
	some required in REQUIRED_TAGS
	not has_tag(resource, required)

	finding := {
		"rule": "ownership-tags",
		"resource": address(resource),
		"msg": sprintf(
			"%s is missing the %q tag. An untagged resource has no one to ask about it when it shows up on a bill or an alarm.",
			[address(resource), required],
		),
	}
}

# tags_all includes provider-level default_tags, which is where the platform
# sets Owner and Environment for every resource at once. Checking `tags` alone
# would report a violation for resources that are correctly tagged.
has_tag(resource, name) if {
	after(resource).tags_all[name]
}

has_tag(resource, name) if {
	after(resource).tags[name]
}
