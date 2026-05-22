output "budget_name" {
  description = "Name of the daily AWS Budget"
  value       = aws_budgets_budget.daily_cost_budget.name
}

output "sns_topic_arn" {
  description = "ARN of the budget and anomaly alert SNS topic"
  value       = aws_sns_topic.cost_guard_budget_alerts.arn
}

output "lambda_name" {
  description = "Name of the cost guard Lambda function"
  value       = aws_lambda_function.cost_guard.function_name
}

output "lambda_arn" {
  description = "ARN of the cost guard Lambda function"
  value       = aws_lambda_function.cost_guard.arn
}

output "schedule_name" {
  description = "Name of the EventBridge Scheduler schedule"
  value       = aws_scheduler_schedule.cost_guard.name
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
  value       = aws_cloudwatch_event_rule.cost_anomaly_cost_guard.name
}

output "anomaly_event_log_group_name" {
  description = "CloudWatch log group that stores Cost Anomaly events"
  value       = aws_cloudwatch_log_group.cost_anomaly_events.name
}

output "anomaly_event_alarm_name" {
  description = "CloudWatch alarm name for Cost Anomaly events"
  value       = aws_cloudwatch_metric_alarm.cost_anomaly_events.alarm_name
}

output "anomaly_event_query_definition_id" {
  description = "CloudWatch Logs Insights query definition ID for Cost Anomaly events"
  value       = aws_cloudwatch_query_definition.cost_anomaly_events.query_definition_id
}

output "anomaly_event_query_definition_name" {
  description = "CloudWatch Logs Insights query definition name for Cost Anomaly events"
  value       = aws_cloudwatch_query_definition.cost_anomaly_events.name
}
