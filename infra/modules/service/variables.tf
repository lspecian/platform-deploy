variable "name" {
  type        = string
  description = "Service name from the manifest."
}

variable "name_prefix" {
  type        = string
  description = "Environment-scoped resource name prefix."
}

variable "owner" {
  type        = string
  description = "Owning team. Tagged onto every resource so an unexpected bill or alarm has someone to route to."
}

variable "environment" {
  type = string
}

variable "region" {
  type = string
}

variable "is_local" {
  type        = bool
  description = <<-EOT
    True when running against the emulator. Guards the small number of places
    where the emulator genuinely differs from AWS, so those differences live in
    named conditionals rather than in a forked copy of the module.
  EOT
}

variable "image" {
  type        = string
  description = "Image to run. A digest in every environment the pipeline deploys."
}

variable "port" {
  type = number
}

variable "cpu" {
  type = number
}

variable "memory" {
  type = number
}

variable "replicas" {
  type = number
}

variable "liveness_path" {
  type = string
}

variable "readiness_path" {
  type = string
}

variable "vpc_cidr" {
  type = string
}

variable "bucket_name" {
  type        = string
  description = "Bucket declared in the manifest, or null if the service declares none."
  default     = null
}

variable "bucket_versioning" {
  type    = bool
  default = false
}

variable "log_retention_days" {
  type        = number
  description = "Log retention. Finite by default: logs kept forever are a cost and a liability, and nobody reads a two-year-old request log."
  default     = 30
}

variable "availability_zones" {
  type        = list(string)
  description = "Override the derived availability zones. Empty means derive them from the region."
  default     = []
}
