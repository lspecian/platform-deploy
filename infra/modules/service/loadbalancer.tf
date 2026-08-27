resource "aws_lb" "main" {
  name               = substr("${var.name_prefix}-alb", 0, 32)
  load_balancer_type = "application"
  internal           = false
  subnets            = aws_subnet.public[*].id
  security_groups    = [aws_security_group.alb.id]

  # Deletion protection in production only. Everywhere else, a `terraform
  # destroy` that needs a console visit to finish is a tax on people cleaning
  # up after themselves.
  enable_deletion_protection = var.environment == "prod" && !var.is_local

  tags = { Name = var.name_prefix }
}

resource "aws_lb_target_group" "main" {
  name        = substr("${var.name_prefix}-tg", 0, 32)
  port        = var.port
  protocol    = "HTTP"
  vpc_id      = aws_vpc.main.id
  target_type = "ip"

  health_check {
    enabled = true
    # Readiness, not liveness: the load balancer's question is "should this
    # instance receive traffic", which is exactly what /readyz answers. Pointing
    # it at /healthz would route traffic to instances whose dependencies are down.
    path                = var.readiness_path
    matcher             = "200"
    interval            = 15
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }

  # Give in-flight requests time to finish when a task is being replaced.
  deregistration_delay = 15

  tags = { Name = var.name_prefix }
}

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.main.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.main.arn
  }

  /*
   * Recreate rather than update in place.
   *
   * The emulator's ModifyListener writes to the listener's DefaultActions but
   * never syncs the default *rule*, which is what its request dispatcher
   * actually reads — so an in-place change appears to succeed and silently
   * does nothing. Recreating the listener sidesteps the bug, costs nothing on
   * real AWS, and is documented in docs/adr/0002-emulator-constraints.md.
   */
  lifecycle {
    create_before_destroy = true
  }

  tags = { Name = var.name_prefix }
}
