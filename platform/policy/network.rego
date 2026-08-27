package tarmac.policy

# ---------------------------------------------------------------------------
# Public ingress
#
# Only the load balancer may accept traffic from the internet. Everything else
# takes traffic from a security group, not a CIDR.
#
# This is the rule that stops the most common serious mistake in a small AWS
# footprint: a service security group opened to 0.0.0.0/0 "temporarily" to debug
# something, and never closed. The load balancer is exempt because being
# reachable is its entire job — but only on HTTP and HTTPS.
# ---------------------------------------------------------------------------

PUBLIC_CIDRS := {"0.0.0.0/0", "::/0"}

# Ports the load balancer is allowed to expose to the internet.
ALLOWED_PUBLIC_PORTS := {80, 443}

deny contains finding if {
	some sg in resources("aws_security_group")
	some rule in after(sg).ingress
	some cidr in rule.cidr_blocks
	cidr in PUBLIC_CIDRS
	not load_balancer_group(sg)

	finding := {
		"rule": "no-public-ingress",
		"resource": address(sg),
		"msg": sprintf(
			"%s accepts traffic from %s on port %d. Only the load balancer may be reachable from the internet; take traffic from the load balancer's security group instead.",
			[address(sg), cidr, rule.from_port],
		),
	}
}

# Even the load balancer may not open arbitrary ports to the world.
deny contains finding if {
	some sg in resources("aws_security_group")
	load_balancer_group(sg)
	some rule in after(sg).ingress
	some cidr in rule.cidr_blocks
	cidr in PUBLIC_CIDRS
	not rule.from_port in ALLOWED_PUBLIC_PORTS

	finding := {
		"rule": "no-public-ingress",
		"resource": address(sg),
		"msg": sprintf(
			"%s exposes port %d to %s. A load balancer may expose only 80 and 443.",
			[address(sg), rule.from_port, cidr],
		),
	}
}

# The load balancer's own security group, identified by the name the platform
# gives it. Application teams never name their own security groups, so this
# cannot be spoofed by a service — the platform module owns both names.
load_balancer_group(sg) if {
	endswith(after(sg).name, "-alb")
}

# ---------------------------------------------------------------------------
# Standalone rules
#
# `aws_security_group_rule` is a separate resource type, so a rule attached this
# way would bypass the checks above entirely. Any allow-list that only covers
# one of the two forms is not an allow-list.
# ---------------------------------------------------------------------------

deny contains finding if {
	some rule in resources("aws_security_group_rule")
	after(rule).type == "ingress"
	some cidr in after(rule).cidr_blocks
	cidr in PUBLIC_CIDRS

	finding := {
		"rule": "no-public-ingress",
		"resource": address(rule),
		"msg": sprintf(
			"%s opens port %d to %s. Reference a source security group instead of a public CIDR.",
			[address(rule), after(rule).from_port, cidr],
		),
	}
}
