package tarmac.policy

# Each fixture starts from `good_container` and breaks exactly one thing, so a
# failing test names the rule that caught it and nothing else is in play.

with_field(field, value) := object.union(good_container, {field: value})

# --- allow ------------------------------------------------------------------

test_hardened_container_passes_every_container_rule if {
	count(findings("no-root-container")) == 0 with input as task_def(good_container)
	count(findings("readonly-root-filesystem")) == 0 with input as task_def(good_container)
	count(findings("immutable-image")) == 0 with input as task_def(good_container)
	count(findings("no-plaintext-secrets")) == 0 with input as task_def(good_container)
	count(findings("logging-required")) == 0 with input as task_def(good_container)
}

# --- running as root --------------------------------------------------------

test_container_with_no_user_is_denied if {
	# Omitting `user` means root. Absence has to be a violation, not a pass.
	container := object.remove(good_container, {"user"})
	count(findings("no-root-container")) == 1 with input as task_def(container)
}

test_container_with_explicit_root_is_denied if {
	count(findings("no-root-container")) == 1 with input as task_def(with_field("user", "root"))
}

test_container_with_uid_zero_is_denied if {
	count(findings("no-root-container")) == 1 with input as task_def(with_field("user", "0"))
}

test_container_with_uid_zero_and_gid_is_denied if {
	count(findings("no-root-container")) == 1 with input as task_def(with_field("user", "0:0"))
}

test_container_with_empty_user_is_denied if {
	count(findings("no-root-container")) == 1 with input as task_def(with_field("user", ""))
}

test_non_root_uid_is_allowed if {
	count(findings("no-root-container")) == 0 with input as task_def(with_field("user", "1000"))
}

# --- filesystem -------------------------------------------------------------

test_writable_root_filesystem_is_denied if {
	count(findings("readonly-root-filesystem")) == 1 with input as task_def(with_field("readonlyRootFilesystem", false))
}

test_missing_readonly_flag_is_denied if {
	# Unset is writable. Defaulting to "probably fine" is how this rule stops working.
	container := object.remove(good_container, {"readonlyRootFilesystem"})
	count(findings("readonly-root-filesystem")) == 1 with input as task_def(container)
}

# --- image references -------------------------------------------------------

test_latest_tag_is_denied if {
	count(findings("immutable-image")) == 1 with input as task_def(with_field("image", "registry/hello-world:latest"))
}

test_version_tag_without_digest_is_denied if {
	# A version tag looks disciplined and is still mutable: it can be repointed,
	# so it cannot prove the running artifact is the tested one.
	count(findings("immutable-image")) == 1 with input as task_def(with_field("image", "registry/hello-world:1.4.2"))
}

test_digest_is_allowed if {
	count(findings("immutable-image")) == 0 with input as task_def(with_field("image", "registry/hello-world@sha256:deadbeef"))
}

# --- plaintext secrets ------------------------------------------------------

test_plaintext_password_is_denied if {
	container := with_field("environment", [{"name": "DB_PASSWORD", "value": "hunter2"}])
	count(findings("no-plaintext-secrets")) == 1 with input as task_def(container)
}

test_plaintext_api_token_is_denied if {
	container := with_field("environment", [{"name": "STRIPE_TOKEN", "value": "sk_live_abc"}])
	count(findings("no-plaintext-secrets")) == 1 with input as task_def(container)
}

test_secret_detection_is_case_insensitive if {
	container := with_field("environment", [{"name": "db_secret", "value": "x"}])
	count(findings("no-plaintext-secrets")) == 1 with input as task_def(container)
}

test_ordinary_config_is_allowed if {
	container := with_field("environment", [
		{"name": "PORT", "value": "8080"},
		{"name": "LOG_LEVEL", "value": "info"},
	])
	count(findings("no-plaintext-secrets")) == 0 with input as task_def(container)
}

# --- the emulator exception -------------------------------------------------
#
# The exception is the interesting part of this rule, so it is tested from both
# sides: the sentinel is allowed, and a real credential under the same variable
# name is not. An exception nobody tested is indistinguishable from a hole.

test_emulator_sentinel_credentials_are_allowed if {
	container := with_field("environment", [
		{"name": "AWS_ACCESS_KEY_ID", "value": "test"},
		{"name": "AWS_SECRET_ACCESS_KEY", "value": "test"},
	])
	count(findings("no-plaintext-secrets")) == 0 with input as task_def(container)
}

test_a_real_looking_aws_key_is_still_denied if {
	# Same variable name as the sentinel, different value. This is the case that
	# decides whether the exception is narrow or is a bypass.
	container := with_field("environment", [{"name": "AWS_ACCESS_KEY_ID", "value": "AKIAIOSFODNN7EXAMPLE"}])
	count(findings("no-plaintext-secrets")) == 1 with input as task_def(container)
}

test_a_real_looking_aws_secret_is_still_denied if {
	container := with_field("environment", [{"name": "AWS_SECRET_ACCESS_KEY", "value": "wJalrXUtnFEMI/K7MDENG"}])
	count(findings("no-plaintext-secrets")) == 1 with input as task_def(container)
}

test_the_sentinel_does_not_exempt_other_variables if {
	# The value "test" is only excused for the two AWS credential variables.
	container := with_field("environment", [{"name": "DB_PASSWORD", "value": "test"}])
	count(findings("no-plaintext-secrets")) == 1 with input as task_def(container)
}

# --- logging ----------------------------------------------------------------

test_container_without_logging_is_denied if {
	container := object.remove(good_container, {"logConfiguration"})
	count(findings("logging-required")) == 1 with input as task_def(container)
}

# --- messages ---------------------------------------------------------------

test_denial_message_names_the_container if {
	some finding in findings("no-root-container") with input as task_def(with_field("user", "root"))
	contains(finding.msg, "web")
}
