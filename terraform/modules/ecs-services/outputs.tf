output "identity_service_name" {
  description = "Name of the identity service"
  value       = aws_ecs_service.identity_service.name
}

output "problem_service_name" {
  description = "Name of the problem service"
  value       = aws_ecs_service.problem_service.name
}

output "submission_service_name" {
  description = "Name of the submission service"
  value       = aws_ecs_service.submission_service.name
}

output "worker_service_name" {
  description = "Name of the worker service"
  value       = aws_ecs_service.worker.name
}

output "identity_service_desired_count" {
  description = "Desired task count for identity service"
  value       = aws_ecs_service.identity_service.desired_count
}

output "problem_service_desired_count" {
  description = "Desired task count for problem service"
  value       = aws_ecs_service.problem_service.desired_count
}

output "submission_service_desired_count" {
  description = "Desired task count for submission service"
  value       = aws_ecs_service.submission_service.desired_count
}

output "worker_service_desired_count" {
  description = "Desired task count for worker"
  value       = aws_ecs_service.worker.desired_count
}