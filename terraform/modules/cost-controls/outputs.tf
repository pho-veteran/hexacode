output "budget_daily_name" {
  description = "Name of the daily AWS Budget"
  value       = aws_budgets_budget.daily_cost_budget.name
}

output "budget_monthly_name" {
  description = "Name of the monthly AWS Budget"
  value       = aws_budgets_budget.monthly_cost_budget.name
}

output "sns_topic_arn" {
  description = "ARN of the KMS-encrypted SNS topic for budget and anomaly alerts"
  value       = aws_sns_topic.cost_guard_alerts.arn
}

output "sns_topic_name" {
  description = "Name of the SNS topic"
  value       = aws_sns_topic.cost_guard_alerts.name
}

output "dlq_url" {
  description = "URL of the dead-letter queue for failed Lambda invocations"
  value       = aws_sqs_queue.lambda_dlq.url
}

output "dlq_arn" {
  description = "ARN of the dead-letter queue"
  value       = aws_sqs_queue.lambda_dlq.arn
}

output "lambda_name" {
  description = "Name of the cost guard Lambda function"
  value       = aws_lambda_function.cost_guard.function_name
}

output "lambda_arn" {
  description = "ARN of the cost guard Lambda function"
  value       = aws_lambda_function.cost_guard.arn
}

output "lambda_function_name_env" {
  description = "Lambda name passed via ECS_CLUSTER_NAME env var (confirms env-driven config)"
  value       = aws_lambda_function.cost_guard.function_name
}

output "schedule_name" {
  description = "Name of the EventBridge Scheduler schedule"
  value       = aws_scheduler_schedule.cost_guard_daily.name
}

output "anomaly_monitor_arn" {
  description = "ARN of the Cost Anomaly Detection monitor"
  value       = aws_ce_anomaly_monitor.service.arn
}

output "anomaly_subscription_arn" {
  description = "ARN of the Cost Anomaly Detection subscription"
  value       = aws_ce_anomaly_subscription.service.arn
}

output "anomaly_event_rule_name" {
  description = "Name of the EventBridge rule that routes Cost Anomaly events"
  value       = aws_cloudwatch_event_rule.cost_anomaly_eventbridge.name
}

output "anomaly_event_rule_arn" {
  description = "ARN of the EventBridge rule"
  value       = aws_cloudwatch_event_rule.cost_anomaly_eventbridge.arn
}

output "anomaly_event_log_group_name" {
  description = "CloudWatch log group that stores Cost Anomaly events"
  value       = aws_cloudwatch_log_group.cost_anomaly_events.name
}

output "anomaly_event_alarm_name" {
  description = "CloudWatch alarm name for Cost Anomaly events"
  value       = aws_cloudwatch_metric_alarm.cost_anomaly_events.alarm_name
}

output "anomaly_event_alarm_arn" {
  description = "ARN of the CloudWatch alarm for Cost Anomaly events"
  value       = aws_cloudwatch_metric_alarm.cost_anomaly_events.arn
}

output "ecs_cluster_scoped" {
  description = "ECS cluster name the cost guard is scoped to"
  value       = local.ecs_cluster_name
}

output "protection_tag" {
  description = "Tag key=value used to protect services from cost guard"
  value       = "${var.ecs_cost_guard_protection_tag_key}=${var.ecs_cost_guard_protection_tag_value}"
}