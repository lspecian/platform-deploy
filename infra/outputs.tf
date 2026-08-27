output "service_url" {
  description = "Open this to see the service."
  value       = module.service.service_url
}

output "environment" {
  value = var.environment
}

output "target" {
  value = var.target
}

output "cluster_name" {
  value = module.service.cluster_name
}

output "service_name" {
  value = module.service.service_name
}

output "target_group_arn" {
  value = module.service.target_group_arn
}

output "repository_url" {
  value = module.service.repository_url
}

output "log_group" {
  value = module.service.log_group
}

output "image" {
  description = "The exact image reference this state deployed. A digest in every pipeline-driven deploy."
  value       = var.image
}
