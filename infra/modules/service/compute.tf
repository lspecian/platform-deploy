resource "aws_ecr_repository" "main" {
  name = var.name

  # Tags must be immutable. If a tag can be repointed, "the image that passed
  # staging" and "the image running in production" can silently diverge — which
  # defeats promotion by digest.
  image_tag_mutability = "IMMUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  tags = { Name = var.name }
}

resource "aws_cloudwatch_log_group" "main" {
  name              = "/ecs/${var.name_prefix}"
  retention_in_days = var.log_retention_days

  tags = { Name = var.name_prefix }
}

resource "aws_ecs_cluster" "main" {
  name = var.name_prefix

  setting {
    name  = "containerInsights"
    value = "enabled"
  }

  tags = { Name = var.name_prefix }
}

/*
 * The task definition is where most of the container hardening actually lands.
 * The Dockerfile can declare a non-root USER, but a task definition can
 * override it — so the platform sets it here too, and the policy gate checks
 * this rendered plan rather than trusting the Dockerfile.
 */
resource "aws_ecs_task_definition" "main" {
  family                   = var.name_prefix
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = tostring(var.cpu)
  memory                   = tostring(var.memory)
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task.arn

  container_definitions = jsonencode([
    {
      name      = var.name
      image     = var.image
      essential = true

      user                   = "1000:1000"
      readonlyRootFilesystem = true

      # Nothing on disk is needed at runtime, but Node and the AWS SDK expect a
      # writable temp directory to exist.
      mountPoints = [{ sourceVolume = "tmp", containerPath = "/tmp", readOnly = false }]

      portMappings = [{ containerPort = var.port, protocol = "tcp" }]

      environment = concat(
        [
          { name = "PORT", value = tostring(var.port) },
          { name = "ENVIRONMENT", value = var.environment },
          { name = "SERVICE_NAME", value = var.name },
          { name = "AWS_REGION", value = var.region },
        ],
        var.bucket_name == null ? [] : [
          { name = "BUCKET_NAME", value = aws_s3_bucket.main[0].id },
        ],
        /*
         * Emulator only.
         *
         * The emulator does inject AWS_CONTAINER_CREDENTIALS_FULL_URI, but the
         * JS SDK refuses an http credentials URI unless the host is loopback
         * or 169.254.170.2 — and the emulator serves it on a bridge address.
         * botocore accepts it; this SDK does not. Without credentials the task
         * cannot reach its bucket and readiness never goes green.
         *
         * These are the emulator's documented public constants, not secrets.
         * The policy gate still forbids credential-shaped values in a task
         * definition; it carries one narrow, tested exception for this exact
         * sentinel, and rejects anything else. See
         * docs/adr/0002-emulator-constraints.md.
         */
        var.is_local ? [
          { name = "AWS_ACCESS_KEY_ID", value = "test" },
          { name = "AWS_SECRET_ACCESS_KEY", value = "test" },
        ] : [],
      )

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.main.name
          "awslogs-region"        = var.region
          "awslogs-stream-prefix" = "ecs"
        }
      }
    }
  ])

  volume {
    name = "tmp"
  }

  tags = { Name = var.name_prefix }
}

resource "aws_ecs_service" "main" {
  name            = var.name
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.main.arn
  desired_count   = var.replicas
  launch_type     = "FARGATE"

  network_configuration {
    subnets         = aws_subnet.public[*].id
    security_groups = [aws_security_group.task.id]
    # Required without a NAT Gateway: the task needs a route out to pull its
    # image. The security group is what keeps it unreachable from the internet.
    assign_public_ip = true
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.main.arn
    container_name   = var.name
    container_port   = var.port
  }

  # The load balancer must be able to accept registrations before the service
  # tries to register with it.
  depends_on = [aws_lb_listener.http]

  tags = { Name = var.name_prefix }
}
