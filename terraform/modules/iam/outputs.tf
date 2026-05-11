output "ecs_execution_role_arn" {
  description = "ARN of the ECS execution role"
  value       = aws_iam_role.ecs_execution.arn
}

output "identity_task_role_arn" {
  description = "ARN of the identity service task role"
  value       = aws_iam_role.identity_task.arn
}

output "problem_task_role_arn" {
  description = "ARN of the problem service task role"
  value       = aws_iam_role.problem_task.arn
}

output "submission_task_role_arn" {
  description = "ARN of the submission service task role"
  value       = aws_iam_role.submission_task.arn
}

output "worker_task_role_arn" {
  description = "ARN of the worker task role"
  value       = aws_iam_role.worker_task.arn
}