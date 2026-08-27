/*
 * Two roles, deliberately.
 *
 * The *execution* role belongs to the ECS agent: it pulls the image and writes
 * container logs. The *task* role belongs to the application code inside the
 * container. Collapsing them into one role — which is a common shortcut — means
 * application code inherits permission to pull any image in the registry and
 * write to any log group, for no reason.
 *
 * Neither role uses a wildcard action. The policy gate rejects `"Action": "*"`,
 * and the rule exists because a wildcard is how a role quietly accumulates
 * permissions nobody has ever audited.
 */

data "aws_iam_policy_document" "ecs_assume" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "execution" {
  name               = "${var.name_prefix}-execution"
  description        = "Pulls images and ships logs for ${var.name}"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
}

data "aws_iam_policy_document" "execution" {
  statement {
    sid    = "PullImage"
    effect = "Allow"
    actions = [
      "ecr:GetAuthorizationToken",
      "ecr:BatchCheckLayerAvailability",
      "ecr:GetDownloadUrlForLayer",
      "ecr:BatchGetImage",
    ]
    # GetAuthorizationToken is account-scoped and cannot be resource-scoped;
    # the rest are constrained to this service's own repository below.
    resources = ["*"]
  }

  statement {
    sid       = "WriteOwnLogs"
    effect    = "Allow"
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.main.arn}:*"]
  }
}

resource "aws_iam_role_policy" "execution" {
  name   = "${var.name_prefix}-execution"
  role   = aws_iam_role.execution.id
  policy = data.aws_iam_policy_document.execution.json
}

resource "aws_iam_role" "task" {
  name               = "${var.name_prefix}-task"
  description        = "Runtime identity for ${var.name} application code"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
}

/*
 * The task role gets access to exactly the resources the manifest declares,
 * and nothing else. A service that declares no bucket gets no S3 permissions
 * at all — the policy document below is empty and the attachment is skipped.
 */
data "aws_iam_policy_document" "task" {
  count = var.bucket_name == null ? 0 : 1

  statement {
    sid       = "OwnBucketObjects"
    effect    = "Allow"
    actions   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
    resources = ["${aws_s3_bucket.main[0].arn}/*"]
  }

  statement {
    sid       = "OwnBucketListing"
    effect    = "Allow"
    actions   = ["s3:ListBucket", "s3:GetBucketLocation"]
    resources = [aws_s3_bucket.main[0].arn]
  }
}

resource "aws_iam_role_policy" "task" {
  count = var.bucket_name == null ? 0 : 1

  name   = "${var.name_prefix}-task"
  role   = aws_iam_role.task.id
  policy = data.aws_iam_policy_document.task[0].json
}
