package tarmac.policy

# ---------------------------------------------------------------------------
# Storage
#
# Encryption at rest and public-access blocking are not choices an application
# team makes. They are platform defaults, applied because the alternative —
# every team deciding independently, under deadline — reliably produces at least
# one unencrypted or public bucket.
#
# The platform module already sets all of this. These rules exist so that a
# service which stops using the module, or adds a bucket by hand, is caught
# rather than trusted.
# ---------------------------------------------------------------------------

deny contains finding if {
	some bucket in resources("aws_s3_bucket")
	not encrypted(after(bucket).bucket)

	finding := {
		"rule": "encryption-required",
		"resource": address(bucket),
		"msg": sprintf(
			"%s has no server-side encryption configuration. Add an aws_s3_bucket_server_side_encryption_configuration for it, or use the platform service module which does this for you.",
			[address(bucket)],
		),
	}
}

# Encryption lives in a separate resource, so the check has to correlate the two
# by bucket name rather than reading a field on the bucket itself.
encrypted(bucket_name) if {
	some config in resources("aws_s3_bucket_server_side_encryption_configuration")
	after(config).bucket == bucket_name
}

encrypted(bucket_name) if {
	# The bucket reference usually points at an attribute computed during apply,
	# so it is unknown while planning. With exactly one bucket and one encryption
	# configuration being created together, the pairing is unambiguous.
	count(resources("aws_s3_bucket")) == 1
	count(resources("aws_s3_bucket_server_side_encryption_configuration")) == 1
	some config in resources("aws_s3_bucket_server_side_encryption_configuration")
	unknown_at_plan_time(config, "bucket")
	bucket_name != ""
}

deny contains finding if {
	some bucket in resources("aws_s3_bucket")
	not public_access_blocked(after(bucket).bucket)

	finding := {
		"rule": "no-public-buckets",
		"resource": address(bucket),
		"msg": sprintf(
			"%s has no public access block. Every bucket the platform creates blocks public ACLs and policies.",
			[address(bucket)],
		),
	}
}

public_access_blocked(bucket_name) if {
	some block in resources("aws_s3_bucket_public_access_block")
	after(block).bucket == bucket_name
	after(block).block_public_acls == true
	after(block).block_public_policy == true
}

public_access_blocked(bucket_name) if {
	count(resources("aws_s3_bucket")) == 1
	count(resources("aws_s3_bucket_public_access_block")) == 1
	some block in resources("aws_s3_bucket_public_access_block")
	unknown_at_plan_time(block, "bucket")
	# These are literals in the module, so they are known even when the bucket
	# reference is not. The rule still checks them.
	after(block).block_public_acls == true
	after(block).block_public_policy == true
	bucket_name != ""
}
