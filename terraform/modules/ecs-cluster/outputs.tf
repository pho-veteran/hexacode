output "cluster_name" {
  description = "Name of the ECS cluster"
  value       = aws_ecs_cluster.main.name
}

output "cluster_arn" {
  description = "ARN of the ECS cluster"
  value       = aws_ecs_cluster.main.arn
}

output "identity_log_group_name" {
  description = "CloudWatch log group name for identity service"
  value       = aws_cloudwatch_log_group.identity_service.name
}

output "problem_log_group_name" {
  description = "CloudWatch log group name for problem service"
  value       = aws_cloudwatch_log_group.problem_service.name
}

output "submission_log_group_name" {
  description = "CloudWatch log group name for submission service"
  value       = aws_cloudwatch_log_group.submission_service.name
}

output "worker_log_group_name" {
  description = "CloudWatch log group name for worker"
  value       = aws_cloudwatch_log_group.worker.name
}