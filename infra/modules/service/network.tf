/*
 * Network.
 *
 * Public subnets with public IPs on the tasks, and deliberately no NAT
 * Gateway. A NAT Gateway is the single most expensive thing in a small AWS
 * footprint (roughly $32/month before data charges) and it exists to let
 * private subnets reach the internet. For a stateless service that only needs
 * to pull its own image, paying that to gain one hop of indirection is not a
 * trade worth making at this size.
 *
 * The security posture is carried by the security groups instead: tasks accept
 * traffic only from the load balancer's security group, never from the
 * internet, even though they sit in a public subnet.
 */

data "aws_availability_zones" "available" {
  state = "available"
}

locals {
  # Two AZs: a load balancer requires at least two subnets in distinct zones.
  azs = slice(data.aws_availability_zones.available.names, 0, 2)
}

resource "aws_vpc" "main" {
  cidr_block           = var.vpc_cidr
  enable_dns_support   = true
  enable_dns_hostnames = true

  tags = { Name = var.name_prefix }
}

resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id
  tags   = { Name = var.name_prefix }
}

resource "aws_subnet" "public" {
  count = length(local.azs)

  vpc_id                  = aws_vpc.main.id
  cidr_block              = cidrsubnet(var.vpc_cidr, 8, count.index)
  availability_zone       = local.azs[count.index]
  map_public_ip_on_launch = true

  tags = { Name = "${var.name_prefix}-public-${count.index}" }
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id
  tags   = { Name = "${var.name_prefix}-public" }
}

resource "aws_route" "internet" {
  route_table_id         = aws_route_table.public.id
  destination_cidr_block = "0.0.0.0/0"
  gateway_id             = aws_internet_gateway.main.id
}

resource "aws_route_table_association" "public" {
  count = length(aws_subnet.public)

  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

/*
 * The load balancer is the only thing the internet may talk to.
 */
resource "aws_security_group" "alb" {
  name        = "${var.name_prefix}-alb"
  description = "Ingress to the ${var.name} load balancer"
  vpc_id      = aws_vpc.main.id

  ingress {
    description = "HTTP from the internet"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    description     = "To the service tasks only"
    from_port       = var.port
    to_port         = var.port
    protocol        = "tcp"
    security_groups = [aws_security_group.task.id]
  }

  tags = { Name = "${var.name_prefix}-alb" }
}

/*
 * Tasks accept traffic from the load balancer's security group and from
 * nowhere else. This is the rule the Terraform policy gate enforces: a task
 * security group with an ingress rule open to 0.0.0.0/0 fails the build.
 */
resource "aws_security_group" "task" {
  name        = "${var.name_prefix}-task"
  description = "Ingress to ${var.name} tasks"
  vpc_id      = aws_vpc.main.id

  egress {
    description = "Outbound for image pulls and AWS API calls"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "${var.name_prefix}-task" }
}

# Declared separately to break the cycle: the ALB group's egress references the
# task group, and the task group's ingress references the ALB group.
resource "aws_security_group_rule" "task_from_alb" {
  type                     = "ingress"
  description              = "Service port, from the load balancer only"
  from_port                = var.port
  to_port                  = var.port
  protocol                 = "tcp"
  security_group_id        = aws_security_group.task.id
  source_security_group_id = aws_security_group.alb.id
}
