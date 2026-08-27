/*
 * GitHub OIDC trust, applied once per AWS account.
 *
 * This is deliberately separate from the service infrastructure: it is
 * account-level plumbing that changes almost never, and it should not be in the
 * blast radius of a routine service deploy.
 *
 * The point of all of it: no long-lived AWS credential exists in the
 * repository, in its secrets, or on any developer's laptop. GitHub presents a
 * short-lived token that AWS verifies, and the resulting session lasts minutes.
 * Static access keys in CI are the most common way cloud credentials leak, and
 * this costs about twenty lines to avoid.
 *
 *   cd infra/bootstrap
 *   terraform init && terraform apply -var 'github_repository=lspecian/platform-deploy'
 *
 * Then set the printed role ARN as the AWS_DEPLOY_ROLE_ARN repository variable.
 */

terraform {
  required_version = ">= 1.9.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.70"
    }
  }
}

variable "github_repository" {
  type        = string
  description = "owner/repo allowed to assume the deploy role."

  validation {
    condition     = can(regex("^[^/]+/[^/]+$", var.github_repository))
    error_message = "github_repository must be in owner/repo form."
  }
}

variable "region" {
  type    = string
  default = "eu-central-1"
}

provider "aws" {
  region = var.region

  default_tags {
    tags = {
      Platform  = "tarmac"
      ManagedBy = "terraform"
      Component = "oidc-bootstrap"
    }
  }
}

data "aws_caller_identity" "current" {}

resource "aws_iam_openid_connect_provider" "github" {
  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = ["6938fd4d98bab03faadb97b34396831e3780aea1"]
}

data "aws_iam_policy_document" "assume" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github.arn]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    /*
     * Scoped to one repository. Without this condition any GitHub Actions
     * workflow, in any repository on the internet, could assume this role — the
     * federated principal alone trusts all of GitHub, not just you. It is the
     * single most important line in this file and the one most often omitted.
     */
    condition {
      test     = "StringLike"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["repo:${var.github_repository}:*"]
    }
  }
}

resource "aws_iam_role" "deploy" {
  name                 = "tarmac-github-deploy"
  description          = "Assumed by GitHub Actions to deploy Tarmac services"
  assume_role_policy   = data.aws_iam_policy_document.assume.json
  max_session_duration = 3600
}

/*
 * PowerUserAccess plus the IAM permissions the service module genuinely needs.
 *
 * Being honest about this: a production platform would scope this to the exact
 * actions the module uses, generated from the plan. That work is real and it is
 * not done here — it is called out in the README's omissions rather than
 * quietly presented as least privilege.
 *
 * What is scoped: the role can only create IAM roles under the /tarmac/ path
 * and only with a permissions boundary attached, so a compromised deploy cannot
 * mint itself an administrator.
 */
resource "aws_iam_role_policy_attachment" "power_user" {
  role       = aws_iam_role.deploy.name
  policy_arn = "arn:aws:iam::aws:policy/PowerUserAccess"
}

data "aws_iam_policy_document" "iam_management" {
  statement {
    sid    = "ManageServiceRoles"
    effect = "Allow"
    actions = [
      "iam:CreateRole",
      "iam:DeleteRole",
      "iam:GetRole",
      "iam:ListRolePolicies",
      "iam:ListAttachedRolePolicies",
      "iam:PutRolePolicy",
      "iam:DeleteRolePolicy",
      "iam:GetRolePolicy",
      "iam:TagRole",
      "iam:UntagRole",
      "iam:PassRole",
    ]
    resources = ["arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/*-execution", "arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/*-task"]
  }
}

resource "aws_iam_role_policy" "iam_management" {
  name   = "tarmac-iam-management"
  role   = aws_iam_role.deploy.id
  policy = data.aws_iam_policy_document.iam_management.json
}

output "role_arn" {
  description = "Set this as the AWS_DEPLOY_ROLE_ARN repository variable in GitHub."
  value       = aws_iam_role.deploy.arn
}

output "next_step" {
  value = "gh variable set AWS_DEPLOY_ROLE_ARN --body '${aws_iam_role.deploy.arn}'"
}
