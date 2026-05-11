output "internal_alb_dns_name" {
  description = "DNS name of the internal ALB"
  value       = aws_lb.internal.dns_name
}

output "internal_alb_arn" {
  description = "ARN of the internal ALB"
  value       = aws_lb.internal.arn
}

output "internal_alb_listener_arn" {
  description = "ARN of the HTTP listener"
  value       = aws_lb_listener.http.arn
}

output "tg_identity_arn" {
  description = "ARN of the identity service target group"
  value       = aws_lb_target_group.tg_identity.arn
}

output "tg_problem_arn" {
  description = "ARN of the problem service target group"
  value       = aws_lb_target_group.tg_problem.arn
}

output "tg_submission_arn" {
  description = "ARN of the submission service target group"
  value       = aws_lb_target_group.tg_submission.arn
}