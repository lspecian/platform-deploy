package tarmac.policy

wildcard := "no-wildcard-iam"

scoped_statement := {
	"Effect": "Allow",
	"Action": ["s3:GetObject", "s3:PutObject"],
	"Resource": ["arn:aws:s3:::my-bucket/*"],
}

# --- allow ------------------------------------------------------------------

test_scoped_policy_is_allowed if {
	count(findings(wildcard)) == 0 with input as role_policy([scoped_statement])
}

test_single_action_as_a_string_is_allowed if {
	# The Action field is a string or a list; both forms have to be understood
	# or half of all policies go unchecked.
	statement := {"Effect": "Allow", "Action": "s3:GetObject", "Resource": "arn:aws:s3:::b/*"}
	count(findings(wildcard)) == 0 with input as role_policy([statement])
}

test_account_level_action_on_star_resource_is_allowed if {
	# AWS rejects a resource ARN on GetAuthorizationToken, so "*" is the only
	# legal way to write it. The exemption is by action name, not by pattern.
	statement := {"Effect": "Allow", "Action": ["ecr:GetAuthorizationToken"], "Resource": "*"}
	count(findings(wildcard)) == 0 with input as role_policy([statement])
}

test_deny_statement_with_wildcard_is_allowed if {
	# A wildcard in a Deny is a broad prohibition, which is the safe direction.
	statement := {"Effect": "Deny", "Action": "*", "Resource": "*"}
	count(findings(wildcard)) == 0 with input as role_policy([statement])
}

# --- deny -------------------------------------------------------------------

test_bare_wildcard_action_is_denied if {
	statement := {"Effect": "Allow", "Action": "*", "Resource": "arn:aws:s3:::b/*"}
	count(findings(wildcard)) == 1 with input as role_policy([statement])
}

test_service_wildcard_action_is_denied if {
	# `s3:*` is the common form and grants every S3 action AWS ever adds.
	statement := {"Effect": "Allow", "Action": ["s3:*"], "Resource": "arn:aws:s3:::b/*"}
	count(findings(wildcard)) == 1 with input as role_policy([statement])
}

test_ordinary_action_on_star_resource_is_denied if {
	statement := {"Effect": "Allow", "Action": ["s3:GetObject"], "Resource": "*"}
	count(findings(wildcard)) == 1 with input as role_policy([statement])
}

test_mixing_an_exempt_action_with_an_ordinary_one_is_denied if {
	# The whole point of the exemption being per-statement: smuggling s3:GetObject
	# into a statement alongside an account-level action must not inherit its pass.
	statement := {
		"Effect": "Allow",
		"Action": ["ecr:GetAuthorizationToken", "s3:GetObject"],
		"Resource": "*",
	}
	count(findings(wildcard)) == 1 with input as role_policy([statement])
}

test_one_bad_statement_among_good_ones_is_denied if {
	bad := {"Effect": "Allow", "Action": "iam:*", "Resource": "arn:aws:iam::*:role/x"}
	count(findings(wildcard)) == 1 with input as role_policy([scoped_statement, bad])
}

test_denial_message_names_the_role_and_the_action if {
	statement := {"Effect": "Allow", "Action": "s3:*", "Resource": "arn:aws:s3:::b/*"}
	some finding in findings(wildcard) with input as role_policy([statement])
	contains(finding.msg, "aws_iam_role_policy.task")
	contains(finding.msg, "s3:*")
}
