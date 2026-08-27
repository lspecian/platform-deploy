terraform {
  required_version = ">= 1.9.0"

  required_providers {
    aws = {
      source = "hashicorp/aws"
      # Pinned to a minor range. Provider majors change resource behaviour, and
      # a plan that differs from the one reviewed is not a plan anyone approved.
      version = "~> 5.70"
    }
  }
}
