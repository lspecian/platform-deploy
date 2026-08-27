package tarmac.policy

# ---------------------------------------------------------------------------
# IAM
#
# No wildcard actions. A role that can do anything is a role nobody has audited,
# and `"Action": "*"` is how a role that started narrow ends up broad — each
# addition individually reasonable, the total never reviewed.
#
# Wildcard *resources* are treated differently, because some actions genuinely
# cannot be resource-scoped (ecr:GetAuthorizationToken is account-level and AWS
# rejects a resource ARN on it). Those are allow-listed by action name rather
# than waved through by pattern.
# ---------------------------------------------------------------------------

# Actions AWS does not allow to be resource-scoped.
ACCOUNT_LEVEL_ACTIONS := {
	"ecr:GetAuthorizationToken",
	"sts:GetCallerIdentity",
	"logs:DescribeLogGroups",
}

policy_documents contains entry if {
	some role in resources("aws_iam_role_policy")
	doc := json.unmarshal(after(role).policy)
	some statement in doc.Statement
	entry := {"resource": address(role), "statement": statement}
}

# A statement's actions, normalised — the field is a string or a list of strings.
actions_of(statement) := statement.Action if {
	is_array(statement.Action)
}

actions_of(statement) := [statement.Action] if {
	is_string(statement.Action)
}

resources_of(statement) := statement.Resource if {
	is_array(statement.Resource)
}

resources_of(statement) := [statement.Resource] if {
	is_string(statement.Resource)
}

deny contains finding if {
	some entry in policy_documents
	entry.statement.Effect == "Allow"
	some action in actions_of(entry.statement)
	wildcard_action(action)

	finding := {
		"rule": "no-wildcard-iam",
		"resource": entry.resource,
		"msg": sprintf(
			"%s allows action %q. List the actions the service actually needs; a wildcard grants every action AWS adds in future too.",
			[entry.resource, action],
		),
	}
}

wildcard_action(action) if action == "*"

# `s3:*` is a wildcard too, and a more common one than a bare `*`.
wildcard_action(action) if endswith(action, ":*")

deny contains finding if {
	some entry in policy_documents
	entry.statement.Effect == "Allow"
	some res in resources_of(entry.statement)
	res == "*"
	not all_actions_account_level(entry.statement)

	finding := {
		"rule": "no-wildcard-iam",
		"resource": entry.resource,
		"msg": sprintf(
			"%s allows %v on every resource. Scope it to the ARNs this service owns.",
			[entry.resource, actions_of(entry.statement)],
		),
	}
}

# A statement may target "*" only when every action in it is one AWS refuses to
# resource-scope. One ordinary action in the statement and the exemption is gone.
all_actions_account_level(statement) if {
	every action in actions_of(statement) {
		action in ACCOUNT_LEVEL_ACTIONS
	}
}
