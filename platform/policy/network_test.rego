package tarmac.policy

# Every rule is tested twice: once with input that must be allowed, once with
# input that must be denied. A policy with only deny tests can pass while
# rejecting everything, which is a failure mode that looks like security.

sg(name, ingress) := {"resource_changes": [{
	"address": sprintf("aws_security_group.%s", [name]),
	"type": "aws_security_group",
	"change": {"actions": ["create"], "after": {"name": name, "ingress": ingress}},
}]}

from_cidr(port, cidr) := {"from_port": port, "to_port": port, "cidr_blocks": [cidr]}

from_group := {"from_port": 8080, "to_port": 8080, "cidr_blocks": [], "security_groups": ["sg-123"]}

public := "no-public-ingress"

# --- allow ------------------------------------------------------------------

test_task_group_taking_traffic_from_a_security_group_is_allowed if {
	count(findings(public)) == 0 with input as sg("hello-world-dev-task", [from_group])
}

test_load_balancer_on_port_80_is_allowed if {
	count(findings(public)) == 0 with input as sg("hello-world-dev-alb", [from_cidr(80, "0.0.0.0/0")])
}

test_load_balancer_on_port_443_is_allowed if {
	count(findings(public)) == 0 with input as sg("hello-world-dev-alb", [from_cidr(443, "0.0.0.0/0")])
}

test_private_cidr_is_allowed if {
	count(findings(public)) == 0 with input as sg("hello-world-dev-task", [from_cidr(8080, "10.0.0.0/8")])
}

test_a_security_group_being_deleted_is_not_flagged if {
	count(findings(public)) == 0 with input as {"resource_changes": [{
		"address": "aws_security_group.old",
		"type": "aws_security_group",
		"change": {
			"actions": ["delete"],
			"after": {"name": "old-task", "ingress": [from_cidr(8080, "0.0.0.0/0")]},
		},
	}]}
}

# --- deny -------------------------------------------------------------------

test_task_group_open_to_the_world_is_denied if {
	count(findings(public)) == 1 with input as sg("hello-world-dev-task", [from_cidr(8080, "0.0.0.0/0")])
}

test_ipv6_open_to_the_world_is_denied if {
	count(findings(public)) == 1 with input as sg("hello-world-dev-task", [from_cidr(8080, "::/0")])
}

test_load_balancer_exposing_ssh_is_denied if {
	# Being a load balancer is not a licence to open any port.
	count(findings(public)) == 1 with input as sg("hello-world-dev-alb", [from_cidr(22, "0.0.0.0/0")])
}

test_standalone_rule_open_to_the_world_is_denied if {
	# The other way to attach a rule. A check that only covered inline ingress
	# would miss this entirely.
	count(findings(public)) == 1 with input as {"resource_changes": [{
		"address": "aws_security_group_rule.debug",
		"type": "aws_security_group_rule",
		"change": {
			"actions": ["create"],
			"after": {"type": "ingress", "from_port": 8080, "to_port": 8080, "cidr_blocks": ["0.0.0.0/0"]},
		},
	}]}
}

test_standalone_egress_rule_is_allowed if {
	# Outbound to the internet is normal and necessary; this rule is about ingress.
	count(findings(public)) == 0 with input as {"resource_changes": [{
		"address": "aws_security_group_rule.out",
		"type": "aws_security_group_rule",
		"change": {
			"actions": ["create"],
			"after": {"type": "egress", "from_port": 0, "to_port": 0, "cidr_blocks": ["0.0.0.0/0"]},
		},
	}]}
}

test_denial_message_names_the_resource_and_the_cidr if {
	some finding in findings(public) with input as sg("hello-world-dev-task", [from_cidr(8080, "0.0.0.0/0")])
	contains(finding.msg, "aws_security_group.hello-world-dev-task")
	contains(finding.msg, "0.0.0.0/0")
	finding.rule == "no-public-ingress"
}
