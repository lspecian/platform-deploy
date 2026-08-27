variable "target" {
  type        = string
  description = <<-EOT
    Which cloud the road deploys onto: "local" (MiniStack emulator) or "aws"
    (a real account). This is the only structural difference between the two —
    everything below this variable is identical code.
  EOT

  validation {
    condition     = contains(["local", "aws"], var.target)
    error_message = "target must be \"local\" or \"aws\"."
  }
}

variable "environment" {
  type        = string
  description = "Which environment this state describes."

  validation {
    condition     = contains(["dev", "staging", "prod"], var.environment)
    error_message = "environment must be one of: dev, staging, prod."
  }
}

variable "region" {
  type        = string
  description = <<-EOT
    AWS region. Against the emulator this must match the instance's
    MINISTACK_REGION: the load balancer data plane resolves an unauthenticated
    request to the *default* region, so a mismatch leaves ingress unroutable
    while every control-plane call still succeeds.
  EOT
  default     = "eu-central-1"
}

variable "endpoint" {
  type        = string
  description = "Emulator endpoint. Ignored when target is \"aws\"."
  default     = "http://localhost:4566"
}

variable "manifest_path" {
  type        = string
  description = "Path to the service manifest that drives this deployment."
  default     = "../apps/hello-world/service.yaml"
}

variable "image" {
  type        = string
  description = <<-EOT
    Fully qualified image reference to deploy.

    The pipeline passes a digest, never a tag. Promotion between environments
    re-deploys the exact artifact that passed the previous environment; a tag
    can be repointed, so promoting by tag means production may run something no
    one tested.
  EOT
  default     = "traefik/whoami:latest"
}

variable "vpc_cidr" {
  type        = string
  description = "CIDR for the service VPC."
  default     = "10.20.0.0/16"
}
