variable "environment" {
  description = "Environment name (e.g., prod, staging)"
  type        = string
}

variable "region" {
  description = "AWS region"
  type        = string
}

# ---------------------------------------------------------------------------
# Baseline budget inputs — used to derive realistic budget limits automatically
# ---------------------------------------------------------------------------

variable "baseline_ecs_fargate_daily_usd" {
  description = "Expected daily ECS Fargate cost (vCPU-hr × price + GB-hr × price). Used to auto-scale the budget. Default assumes 8 FARGATE tasks avg."
  type        = number
  default     = 10.00
}

variable "baseline_rds_daily_usd" {
  description = "Expected daily RDS cost (instance-hours × price + storage + I/O). Default: db.r6g.large Multi-AZ in us-west-2."
  type        = number
  default     = 6.60
}

variable "baseline_elasticache_daily_usd" {
  description = "Expected daily ElastiCache cost (node-hours × price + data transfer). Default: 2× cache.t4g.small cluster mode."
  type        = number
  default     = 1.30
}

variable "baseline_nat_gateway_daily_usd" {
  description = "Expected daily NAT Gateway cost (per AZ-hour + per GB processed). Default: 2 AZs × $0.045/GB assumed 10 GB/day."
  type        = number
  default     = 1.50
}

variable "baseline_alb_daily_usd" {
  description = "Expected daily ALB cost (LCU-hours × price + connection hours). Default: light usage."
  type        = number
  default     = 0.80
}

variable "baseline_other_services_daily_usd" {
  description = "Expected daily cost for CloudFront, S3, Secrets Manager, EFS, API Gateway, WAF, Network Firewall, Backup, ECR, etc."
  type        = number
  default     = 4.80
}

# ---------------------------------------------------------------------------
# Budget configuration — auto-computed from baseline; override for fine-tune
# ---------------------------------------------------------------------------

variable "budget_daily_limit_usd" {
  description = "Daily AWS Budget limit in USD. Defaults to 110% of baseline_daily_total. Override for custom limits."
  type        = number
  default     = null # computed from baseline in main.tf
}

variable "budget_monthly_limit_usd" {
  description = "Monthly AWS Budget limit in USD. Defaults to 110% of baseline_monthly_total. Use for calendar-month spend visibility."
  type        = number
  default     = null # computed from baseline in main.tf
}

variable "budget_daily_warning_pct" {
  description = "Percentage threshold for the first budget alert (warning). Set to 0 to disable."
  type        = number
  default     = 80
}

variable "budget_daily_critical_pct" {
  description = "Percentage threshold for the second budget alert (critical/action). Set to 0 to disable."
  type        = number
  default     = 100
}

variable "budget_monthly_warning_pct" {
  description = "Percentage threshold for the monthly budget warning alert."
  type        = number
  default     = 80
}

# ---------------------------------------------------------------------------
# Anomaly detection
# ---------------------------------------------------------------------------

variable "anomaly_threshold_usd" {
  description = "Absolute anomaly threshold in USD. Default is 20% of baseline_daily_total — alerts on spike ≥ this."
  type        = number
  default     = null # computed from baseline in main.tf
}

variable "anomaly_monitor_name" {
  description = "Cost Anomaly Detection monitor name"
  type        = string
  default     = null # computed from environment in main.tf
}

variable "anomaly_subscription_name" {
  description = "Cost Anomaly Detection subscription name"
  type        = string
  default     = null # computed from environment in main.tf
}

# ---------------------------------------------------------------------------
# Notification channels
# ---------------------------------------------------------------------------

variable "alert_email" {
  description = "Email address for budget and anomaly alerts"
  type        = string
}

variable "alert_sns_topic_arn" {
  description = "Existing SNS topic ARN for Lambda/production alerts. If empty, a new topic is created."
  type        = string
  default     = ""
}

variable "sns_topic_name" {
  description = "SNS topic name (used only when alert_sns_topic_arn is empty)"
  type        = string
  default     = null # computed from environment in main.tf
}

# ---------------------------------------------------------------------------
# Cost guard Lambda
# ---------------------------------------------------------------------------

variable "lambda_name" {
  description = "Cost guard Lambda function name"
  type        = string
  default     = null # computed from environment in main.tf
}

variable "lambda_role_name" {
  description = "Existing IAM role name used by the cost guard Lambda"
  type        = string
}

variable "lambda_basic_policy_arn" {
  description = "Existing IAM policy ARN attached to the cost guard Lambda role for basic logging"
  type        = string
}

variable "lambda_timeout_seconds" {
  description = "Lambda timeout — increase if ECS cluster has many services"
  type        = number
  default     = 30
}

variable "lambda_memory_mb" {
  description = "Lambda memory allocation"
  type        = number
  default     = 256
}

# ---------------------------------------------------------------------------
# ECS cluster scoping — prevent cost guard from affecting wrong clusters
# ---------------------------------------------------------------------------

variable "ecs_cluster_name" {
  description = "ECS cluster name the cost guard is authorized to operate on. Must match the actual cluster name."
  type        = string
  default     = null # computed from environment in main.tf
}

variable "ecs_cost_guard_protection_tag_key" {
  description = "Tag key that marks an ECS service as protected from cost guard. Services with this tag = true are NOT stopped."
  type        = string
  default     = "Protected"
}

variable "ecs_cost_guard_protection_tag_value" {
  description = "Tag value that marks a service as protected. Default 'true' means tag Protected=true is the protection signal."
  type        = string
  default     = "true"
}

# ---------------------------------------------------------------------------
# EventBridge Scheduler
# ---------------------------------------------------------------------------

variable "schedule_name" {
  description = "EventBridge Scheduler schedule name"
  type        = string
  default     = null # computed from environment in main.tf
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
  description = "Cron expression for the cost guard schedule (runs daily)"
  type        = string
  default     = "cron(0 9 * * ? *)"
}

variable "schedule_timezone" {
  description = "Timezone for the schedule expression"
  type        = string
  default     = "Asia/Ho_Chi_Minh"
}

# ---------------------------------------------------------------------------
# KMS key for SNS encryption
# ---------------------------------------------------------------------------

variable "kms_key_arn" {
  description = "KMS key ARN for SNS topic encryption. If empty, AWS-managed SSE-S3 is used."
  type        = string
  default     = ""
}

# ---------------------------------------------------------------------------
# Dead-letter queue for failed Lambda invocations
# ---------------------------------------------------------------------------

variable "dlq_name" {
  description = "SQS DLQ name for failed cost guard Lambda invocations"
  type        = string
  default     = null # computed from environment in main.tf
}

variable "dlq_message_retention_seconds" {
  description = "How long to retain failed messages in the DLQ before automatic expiry"
  type        = number
  default     = 604800 # 7 days
}

# ---------------------------------------------------------------------------
# Log retention
# ---------------------------------------------------------------------------

variable "log_retention_days" {
  description = "CloudWatch log retention period for cost anomaly events"
  type        = number
  default     = 30
}

# ---------------------------------------------------------------------------
# Tags — enforced standard
# ---------------------------------------------------------------------------

variable "tags" {
  description = "Map of tags applied to all cost-controls resources"
  type        = map(string)
  default     = {}
}
