output "backup_vault_name" {
  description = "Name of the AWS Backup vault."
  value       = aws_backup_vault.main.name
}

output "backup_vault_arn" {
  description = "ARN of the AWS Backup vault."
  value       = aws_backup_vault.main.arn
}

output "backup_plan_id" {
  description = "ID of the AWS Backup plan."
  value       = aws_backup_plan.daily.id
}

output "backup_plan_arn" {
  description = "ARN of the AWS Backup plan."
  value       = aws_backup_plan.daily.arn
}

output "backup_plan_name" {
  description = "Name of the AWS Backup plan."
  value       = aws_backup_plan.daily.name
}

output "backup_selection_id" {
  description = "ID of the AWS Backup selection."
  value       = aws_backup_selection.protected_resources.id
}

output "backup_service_role_arn" {
  description = "ARN of the IAM role used by AWS Backup."
  value       = aws_iam_role.backup_service.arn
}

output "backup_failure_event_rule_arn" {
  description = "EventBridge rule ARN for AWS Backup failure event routing."
  value       = try(aws_cloudwatch_event_rule.backup_job_failures[0].arn, null)
}

output "backup_failure_log_group_name" {
  description = "CloudWatch log group name that receives failed AWS Backup job events."
  value       = try(aws_cloudwatch_log_group.backup_failures[0].name, null)
}

output "backup_failure_alarm_name" {
  description = "CloudWatch alarm name for failed AWS Backup jobs."
  value       = try(aws_cloudwatch_metric_alarm.backup_failures[0].alarm_name, null)
}

output "backup_failure_alarm_arn" {
  description = "CloudWatch alarm ARN for failed AWS Backup jobs."
  value       = try(aws_cloudwatch_metric_alarm.backup_failures[0].arn, null)
}

output "backup_failure_topic_arn" {
  description = "SNS topic ARN for AWS Backup failure notifications."
  value       = try(aws_sns_topic.backup_failures[0].arn, null)
}

output "backup_observability_dashboard_name" {
  description = "CloudWatch dashboard name for backup observability."
  value       = try(aws_cloudwatch_dashboard.backup_observability[0].dashboard_name, null)
}

output "backup_failure_query_definition_id" {
  description = "CloudWatch Logs Insights query definition ID for backup failure events."
  value       = try(aws_cloudwatch_query_definition.backup_failure_events[0].query_definition_id, null)
}

output "backup_failure_query_definition_name" {
  description = "CloudWatch Logs Insights query definition name for backup failure events."
  value       = try(aws_cloudwatch_query_definition.backup_failure_events[0].name, null)
}
