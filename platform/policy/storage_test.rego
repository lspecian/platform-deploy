package tarmac.policy

encryption := "encryption-required"

public_bucket := "no-public-buckets"

bucket_change(name) := {
	"address": sprintf("aws_s3_bucket.%s", [name]),
	"type": "aws_s3_bucket",
	"change": {"actions": ["create"], "after": {"bucket": name, "tags_all": {"Owner": "team-x", "Environment": "dev"}}},
}

encryption_change(bucket) := {
	"address": "aws_s3_bucket_server_side_encryption_configuration.main",
	"type": "aws_s3_bucket_server_side_encryption_configuration",
	"change": {"actions": ["create"], "after": {"bucket": bucket}},
}

# What Terraform actually emits when the bucket reference is computed during
# apply: the key is *absent* from `after` and flagged in `after_unknown`. The
# first version of these tests used `bucket: null`, which is a shape Terraform
# never produces — so the tests passed while the rule did not work on a real
# plan. Copied from actual `terraform show -json` output.
encryption_unresolved := {
	"address": "aws_s3_bucket_server_side_encryption_configuration.main",
	"type": "aws_s3_bucket_server_side_encryption_configuration",
	"change": {
		"actions": ["create"],
		"after": {"expected_bucket_owner": null},
		"after_unknown": {"bucket": true, "id": true},
	},
}

block_unresolved := {
	"address": "aws_s3_bucket_public_access_block.main",
	"type": "aws_s3_bucket_public_access_block",
	"change": {
		"actions": ["create"],
		"after": {
			"block_public_acls": true,
			"block_public_policy": true,
			"ignore_public_acls": true,
			"restrict_public_buckets": true,
		},
		"after_unknown": {"bucket": true, "id": true},
	},
}

block_change(bucket) := {
	"address": "aws_s3_bucket_public_access_block.main",
	"type": "aws_s3_bucket_public_access_block",
	"change": {"actions": ["create"], "after": {
		"bucket": bucket,
		"block_public_acls": true,
		"block_public_policy": true,
	}},
}

# --- allow ------------------------------------------------------------------

test_encrypted_and_blocked_bucket_is_allowed if {
	plan := {"resource_changes": [
		bucket_change("assets"),
		encryption_change("assets"),
		block_change("assets"),
	]}
	count(findings(encryption)) == 0 with input as plan
	count(findings(public_bucket)) == 0 with input as plan
}

test_unknown_bucket_reference_at_plan_time_is_allowed if {
	# Terraform cannot resolve the bucket reference during a plan, so the key is
	# absent from `after` and flagged in `after_unknown`. With exactly one bucket
	# and one config being created together the pairing is unambiguous, and
	# failing here would block every first-time apply.
	plan := {"resource_changes": [
		bucket_change("assets"),
		encryption_unresolved,
		block_unresolved,
	]}
	count(findings(encryption)) == 0 with input as plan
	count(findings(public_bucket)) == 0 with input as plan
}

# --- deny -------------------------------------------------------------------

test_bucket_with_no_encryption_is_denied if {
	plan := {"resource_changes": [bucket_change("assets"), block_change("assets")]}
	count(findings(encryption)) == 1 with input as plan
}

test_bucket_with_no_public_access_block_is_denied if {
	plan := {"resource_changes": [bucket_change("assets"), encryption_change("assets")]}
	count(findings(public_bucket)) == 1 with input as plan
}

test_encryption_for_a_different_bucket_does_not_count if {
	# Two buckets, one encryption config. The unambiguous-pairing fallback must
	# not fire here, or a second bucket could ride on the first one's config.
	plan := {"resource_changes": [
		bucket_change("assets"),
		bucket_change("uploads"),
		encryption_change("assets"),
		block_change("assets"),
		block_change("uploads"),
	]}
	count(findings(encryption)) == 1 with input as plan
}

test_public_access_block_that_does_not_block_is_denied if {
	# The resource existing is not the point; the values are.
	weak := {
		"address": "aws_s3_bucket_public_access_block.main",
		"type": "aws_s3_bucket_public_access_block",
		"change": {"actions": ["create"], "after": {
			"bucket": "assets",
			"block_public_acls": false,
			"block_public_policy": false,
		}},
	}
	plan := {"resource_changes": [bucket_change("assets"), encryption_change("assets"), weak]}
	count(findings(public_bucket)) == 1 with input as plan
}

test_denial_message_names_the_bucket if {
	plan := {"resource_changes": [bucket_change("assets"), block_change("assets")]}
	some finding in findings(encryption) with input as plan
	contains(finding.msg, "aws_s3_bucket.assets")
}
