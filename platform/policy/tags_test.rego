package tarmac.policy

ownership := "ownership-tags"

tagged(type, tags) := {"resource_changes": [{
	"address": sprintf("%s.main", [type]),
	"type": type,
	"change": {"actions": ["create"], "after": {"tags_all": tags}},
}]}

full_tags := {"Owner": "team-payments", "Environment": "prod", "Platform": "tarmac"}

# --- allow ------------------------------------------------------------------

test_fully_tagged_resource_is_allowed if {
	count(findings(ownership)) == 0 with input as tagged("aws_ecs_service", full_tags)
}

test_tags_from_provider_defaults_count if {
	# The platform sets Owner and Environment through provider default_tags, so
	# they land in tags_all rather than tags. Checking only `tags` would flag
	# every correctly-tagged resource in the repository.
	count(findings(ownership)) == 0 with input as tagged("aws_lb", full_tags)
}

test_tags_set_directly_count if {
	plan := {"resource_changes": [{
		"address": "aws_vpc.main",
		"type": "aws_vpc",
		"change": {"actions": ["create"], "after": {"tags": full_tags}},
	}]}
	count(findings(ownership)) == 0 with input as plan
}

test_untaggable_resource_type_is_not_flagged if {
	# A route table association cannot carry tags. Flagging it would teach people
	# that this rule fires on things they cannot fix, which is how a rule gets
	# ignored and then removed.
	plan := {"resource_changes": [{
		"address": "aws_route_table_association.public",
		"type": "aws_route_table_association",
		"change": {"actions": ["create"], "after": {}},
	}]}
	count(findings(ownership)) == 0 with input as plan
}

# --- deny -------------------------------------------------------------------

test_resource_with_no_tags_is_denied_for_each_missing_tag if {
	count(findings(ownership)) == 2 with input as tagged("aws_s3_bucket", {})
}

test_missing_owner_is_denied if {
	count(findings(ownership)) == 1 with input as tagged("aws_ecs_cluster", {"Environment": "dev"})
}

test_missing_environment_is_denied if {
	count(findings(ownership)) == 1 with input as tagged("aws_ecr_repository", {"Owner": "team-x"})
}

test_denial_message_names_the_resource_and_the_missing_tag if {
	some finding in findings(ownership) with input as tagged("aws_ecs_cluster", {"Environment": "dev"})
	contains(finding.msg, "aws_ecs_cluster.main")
	contains(finding.msg, "Owner")
}
