locals {
  is_local = var.target == "local"
}

/*
 * One provider, two targets.
 *
 * Against a real account this is an ordinary AWS provider: credentials come
 * from the environment (GitHub OIDC in CI, a profile locally) and no endpoint
 * is overridden.
 *
 * Against the emulator the endpoints block redirects every service to one
 * port, and the credential checks are skipped because there is no real STS to
 * check against. The access key is deliberately non-numeric: MiniStack treats
 * a 12-digit key as the account ID, and we want the account to come from the
 * instance's own MINISTACK_ACCOUNT_ID so the data plane's default scope
 * matches what Terraform creates. A numeric key here would create resources in
 * an account the load balancer cannot serve.
 */
provider "aws" {
  region = var.region

  access_key = local.is_local ? "test" : null
  secret_key = local.is_local ? "test" : null

  skip_credentials_validation = local.is_local
  skip_metadata_api_check     = local.is_local
  skip_requesting_account_id  = local.is_local
  skip_region_validation      = local.is_local
  s3_use_path_style           = local.is_local

  default_tags {
    tags = {
      Environment = var.environment
      ManagedBy   = "terraform"
      Platform    = "tarmac"
      # Every resource the road creates carries this, so `make destroy-aws`
      # can find them all and nothing is left running by accident.
      Owner = local.manifest.owner
    }
  }

  dynamic "endpoints" {
    for_each = local.is_local ? [1] : []
    content {
      ec2    = var.endpoint
      ecs    = var.endpoint
      ecr    = var.endpoint
      elbv2  = var.endpoint
      iam    = var.endpoint
      logs   = var.endpoint
      s3     = var.endpoint
      sts    = var.endpoint
      ssm    = var.endpoint
      kms    = var.endpoint
      sqs    = var.endpoint
      events = var.endpoint
    }
  }
}
