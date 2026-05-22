variable "environment" {
  description = "Environment name"
  type        = string
}

variable "region" {
  description = "AWS region"
  type        = string
}

variable "budget_name" {
  description = "Daily AWS Budget name"
  type        = string
}

variable "budget_limit_amount_usd" {
  description = "Daily AWS Budget limit in USD"
  type        = number
}

variable "alert_email" {
  description = "Email address for budget and anomaly alerts"
  type        = string
}

variable "sns_topic_name" {
  description = "SNS topic used for budget and anomaly notifications"
  type        = string
}

variable "lambda_name" {
  description = "Cost guard Lambda function name"
  type        = string
}

variable "lambda_role_name" {
  description = "Existing IAM role name used by the cost guard Lambda"
  type        = string
}

variable "lambda_basic_policy_arn" {
  description = "Existing IAM policy ARN attached to the cost guard Lambda role for basic logging"
  type        = string
}

variable "schedule_name" {
  description = "EventBridge Scheduler schedule name"
  type        = string
}

variable "scheduler_role_name" {
  description = "Existing IAM role name used by the EventBridge Scheduler target"
  type        = string
}

variable "scheduler_policy_arn" {
  description = "Existing IAM policy ARN attached to the scheduler role for Lambda invocation"
  type        = string
}

variable "schedule_expression" {
  description = "Schedule expression for the cost guard Lambda"
  type        = string
}

variable "schedule_timezone" {
  description = "Timezone for the cost guard schedule"
  type        = string
}

variable "anomaly_monitor_name" {
  description = "Cost Anomaly Detection monitor name"
  type        = string
}

variable "anomaly_subscription_name" {
  description = "Cost Anomaly Detection subscription name"
  type        = string
}

variable "anomaly_threshold_usd" {
  description = "Absolute anomaly threshold in USD"
  type        = number
}
