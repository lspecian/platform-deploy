output "service_url" {
  description = "Where the service answers. Against the emulator this is the load balancer's path-prefixed data-plane form; against AWS it is the load balancer's DNS name."
  value       = var.is_local ? "${var.endpoint}/_alb/${aws_lb.main.name}/" : "http://${aws_lb.main.dns_name}"
}

output "load_balancer_name" {
  value = aws_lb.main.name
}

output "target_group_arn" {
  description = "Needed by the deploy step, which registers task addresses explicitly against the emulator."
  value       = aws_lb_target_group.main.arn
}

output "cluster_name" {
  value = aws_ecs_cluster.main.name
}

output "service_name" {
  value = aws_ecs_service.main.name
}

output "repository_url" {
  value = aws_ecr_repository.main.repository_url
}

output "log_group" {
  value = aws_cloudwatch_log_group.main.name
}

output "bucket_name" {
  value = var.bucket_name == null ? null : aws_s3_bucket.main[0].id
}
