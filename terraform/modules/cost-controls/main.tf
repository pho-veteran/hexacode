data "aws_caller_identity" "current" {}

data "aws_partition" "current" {}

data "aws_region" "current" {}

# =============================================================================
# Local values — name derivation and computed budgets
# =============================================================================

locals {
  env = var.environment

  # ---------------------------------------------------------------------------
  # Persistent name constants — one source of truth for all resource names
  # ---------------------------------------------------------------------------
  project_name           = "hexacode"
  budget_prefix          = "${local.project_name}-${local.env}"
  lambda_prefix          = "${local.project_name}-${local.env}-costguard"
  schedule_prefix        = "${local.project_name}-${local.env}-cost-guard"
  sns_topic_suffix       = "${local.project_name}-${local.env}-cost-guard"
  log_group_suffix       = "${local.project_name}-${local.env}"
  anomaly_monitor_suffix = "${local.project_name}-${local.env}"
  dlq_suffix             = "${local.project_name}-${local.env}"

  # ---------------------------------------------------------------------------
  # Budget thresholds — computed from baseline inputs
  # ---------------------------------------------------------------------------
  baseline_daily_total = (
    var.baseline_ecs_fargate_daily_usd +
    var.baseline_rds_daily_usd +
    var.baseline_elasticache_daily_usd +
    var.baseline_nat_gateway_daily_usd +
    var.baseline_alb_daily_usd +
    var.baseline_other_services_daily_usd
  )

  baseline_monthly_total = local.baseline_daily_total * 30.44 # average days/month

  # Actual budget limits — use provided or default to 110% of baseline
  budget_daily_limit   = var.budget_daily_limit_usd != null ? var.budget_daily_limit_usd : ceil(local.baseline_daily_total * 1.10)
  budget_monthly_limit = var.budget_monthly_limit_usd != null ? var.budget_monthly_limit_usd : ceil(local.baseline_monthly_total * 1.10)

  # Anomaly threshold — default to 20% of daily baseline (spike detection)
  anomaly_threshold = var.anomaly_threshold_usd != null ? var.anomaly_threshold_usd : ceil(local.baseline_daily_total * 0.20)

  # Anomaly monitor/subscription names — computed if not provided
  anomaly_monitor_name      = var.anomaly_monitor_name != null ? var.anomaly_monitor_name : "${local.anomaly_monitor_suffix}-monitor"
  anomaly_subscription_name = var.anomaly_subscription_name != null ? var.anomaly_subscription_name : "${local.anomaly_monitor_suffix}-subscription"

  # Lambda name
  lambda_name    = var.lambda_name != null ? var.lambda_name : local.lambda_prefix
  schedule_name  = var.schedule_name != null ? var.schedule_name : local.schedule_prefix
  sns_topic_name = var.sns_topic_name != null ? var.sns_topic_name : local.sns_topic_suffix
  dlq_name       = var.dlq_name != null ? var.dlq_name : "${local.dlq_suffix}-dlq"

  # ECS cluster scoped for this environment
  ecs_cluster_name = var.ecs_cluster_name != null ? var.ecs_cluster_name : "${local.project_name}-${local.env}"

  # ---------------------------------------------------------------------------
  # Standard tags applied to all resources in this module
  # Merged with any caller-supplied tags (caller takes precedence)
  # ---------------------------------------------------------------------------
  common_tags = merge(
    {
      Project     = local.project_name
      Environment = local.env
      ManagedBy   = "terraform"
      Module      = "cost-controls"
    },
    var.tags
  )

  # Tags for the Lambda function (override Module since it's a runtime resource)
  lambda_tags = merge(local.common_tags, { Name = local.lambda_name })
}

# =============================================================================
# Baseline cost breakdown ( informational-only output — no resources )
# =============================================================================

output "baseline_cost_breakdown" {
  description = "Computed daily cost baseline breakdown"
  value = {
    ecs_fargate   = var.baseline_ecs_fargate_daily_usd
    rds           = var.baseline_rds_daily_usd
    elasticache   = var.baseline_elasticache_daily_usd
    nat_gateway   = var.baseline_nat_gateway_daily_usd
    alb           = var.baseline_alb_daily_usd
    other         = var.baseline_other_services_daily_usd
    daily_total   = local.baseline_daily_total
    monthly_total = local.baseline_monthly_total
  }
}

output "budget_limits" {
  description = "Computed budget limits (default or overridden)"
  value = {
    daily_limit       = local.budget_daily_limit
    monthly_limit     = local.budget_monthly_limit
    anomaly_threshold = local.anomaly_threshold
  }
}

# =============================================================================
# Dead-letter queue for failed Lambda invocations
# Prevents silent EventBridge delivery failures from dropping anomaly events
# =============================================================================

resource "aws_sqs_queue" "lambda_dlq" {
  name                              = local.dlq_name
  message_retention_seconds         = var.dlq_message_retention_seconds
  kms_master_key_id                 = var.kms_key_arn != "" ? var.kms_key_arn : null
  kms_data_key_reuse_period_seconds = 300

  tags = local.common_tags

  lifecycle {
    ignore_changes = [tags, tags_all]
  }
}

# Allow EventBridge to send failed events to DLQ
resource "aws_sqs_queue_policy" "lambda_dlq_events" {
  queue_url = aws_sqs_queue.lambda_dlq.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "EventBridge DLQ policy"
        Effect = "Allow"
        Principal = {
          Service = "events.amazonaws.com"
        }
        Action   = "sqs:SendMessage"
        Resource = aws_sqs_queue.lambda_dlq.arn
        Condition = {
          ArnEquals = {
            "aws:SourceArn" = aws_cloudwatch_event_rule.cost_anomaly_eventbridge.arn
          }
        }
      }
    ]
  })
}

# =============================================================================
# SNS Topic for budget + anomaly alerts
# KMS-encrypted for sensitive cost notification payloads
# =============================================================================

resource "aws_sns_topic" "cost_guard_alerts" {
  name = local.sns_topic_name

  kms_master_key_id = var.kms_key_arn != "" ? var.kms_key_arn : null

  tags = local.common_tags

  lifecycle {
    ignore_changes = [tags, tags_all]
  }
}

# Least-privilege SNS topic policy — only Cost Explorer + subscribers can publish
resource "aws_sns_topic_policy" "cost_guard_alerts" {
  arn = aws_sns_topic.cost_guard_alerts.arn

  policy = jsonencode({
    Version = "2008-10-17"
    Id      = "${local.sns_topic_suffix}-policy"
    Statement = [
      {
        Sid    = "AllowCostExplorerToPublish"
        Effect = "Allow"
        Principal = {
          Service = "costoptimizer.amazonaws.com"
        }
        Action   = "SNS:Publish"
        Resource = aws_sns_topic.cost_guard_alerts.arn
      },
      {
        Sid    = "AllowSubscribers"
        Effect = "Allow"
        Principal = {
          Service = "events.amazonaws.com"
        }
        Action   = "SNS:Publish"
        Resource = aws_sns_topic.cost_guard_alerts.arn
        Condition = {
          StringEquals = {
            "AWS:SourceOwner" = data.aws_caller_identity.current.account_id
          }
        }
      },
      {
        Sid    = "RestrictTopicManagement"
        Effect = "Allow"
        Principal = {
          AWS = "*"
        }
        Action = [
          "SNS:GetTopicAttributes",
          "SNS:SetTopicAttributes",
          "SNS:Subscribe",
          "SNS:ListSubscriptionsByTopic",
        ]
        Resource = aws_sns_topic.cost_guard_alerts.arn
        Condition = {
          StringEquals = {
            "AWS:SourceOwner" = data.aws_caller_identity.current.account_id
          }
        }
      }
    ]
  })
}

resource "aws_sns_topic_subscription" "alert_email" {
  topic_arn = aws_sns_topic.cost_guard_alerts.arn
  protocol  = "email"
  endpoint  = var.alert_email

  lifecycle {
    ignore_changes = [confirmation_timeout_in_minutes, endpoint_auto_confirms]
  }
}

# =============================================================================
# Cost guard Lambda IAM role — inline policy scoped to specific ECS cluster
# This is appended to the externally-provided role via data source
# =============================================================================

data "aws_iam_role" "cost_guard_lambda" {
  name = var.lambda_role_name
}

data "aws_iam_role" "scheduler" {
  name = var.scheduler_role_name
}

resource "aws_iam_role_policy" "cost_guard_ecs" {
  name = "${local.lambda_prefix}-ecs"
  role = data.aws_iam_role.cost_guard_lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "ECSFargateOperations"
        Effect = "Allow"
        Action = [
          "ecs:StopTask",
          "ecs:DescribeTasks",
          "ecs:DescribeServices",
          "ecs:UpdateService",
          "ecs:ListTasks",
          "ecs:ListServices",
          "ecs:ListClusters",
          "ecs:ListTagsForResource",
        ]
        # Restrict to the specific ECS cluster — least privilege
        Resource = "arn:${data.aws_partition.current.partition}:ecs:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:cluster/${local.ecs_cluster_name}"
      },
      {
        Sid    = "DLQRead"
        Effect = "Allow"
        Action = [
          "sqs:GetQueueAttributes",
          "sqs:GetQueueUrl",
        ]
        Resource = aws_sqs_queue.lambda_dlq.arn
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "cost_guard_lambda_basic" {
  role       = data.aws_iam_role.cost_guard_lambda.name
  policy_arn = var.lambda_basic_policy_arn
}

resource "aws_iam_role_policy_attachment" "scheduler_invoke_lambda" {
  role       = data.aws_iam_role.scheduler.name
  policy_arn = var.scheduler_policy_arn
}

# =============================================================================
# Lambda function zip — inline Python
# =============================================================================

data "archive_file" "cost_guard_zip" {
  type        = "zip"
  output_path = "${path.module}/cost_guard.zip"

  source {
    content  = file("${path.module}/cost_guard.py")
    filename = "lambda_function.py"
  }
}

resource "aws_lambda_function" "cost_guard" {
  filename         = data.archive_file.cost_guard_zip.output_path
  function_name    = local.lambda_name
  role             = data.aws_iam_role.cost_guard_lambda.arn
  handler          = "lambda_function.lambda_handler"
  source_code_hash = data.archive_file.cost_guard_zip.output_base64sha256
  runtime          = "python3.12"
  timeout          = var.lambda_timeout_seconds
  memory_size      = var.lambda_memory_mb

  # Pass environment-aware configuration to the Lambda at deploy time
  environment {
    variables = {
      ECS_CLUSTER_NAME     = local.ecs_cluster_name
      PROTECTION_TAG_KEY   = var.ecs_cost_guard_protection_tag_key
      PROTECTION_TAG_VALUE = var.ecs_cost_guard_protection_tag_value
      SNS_TOPIC_ARN        = aws_sns_topic.cost_guard_alerts.arn
      DLQ_URL              = aws_sqs_queue.lambda_dlq.url
      ECS_REGION           = data.aws_region.current.region
      ENVIRONMENT          = local.env
    }
  }

  tags = local.lambda_tags

  lifecycle {
    ignore_changes = [filename, publish, source_code_hash, tags, tags_all]
  }
}

resource "aws_lambda_permission" "allow_budget_alerts" {
  statement_id  = "sns-invoke-cost-guard"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.cost_guard.function_name
  principal     = "sns.amazonaws.com"
  source_arn    = aws_sns_topic.cost_guard_alerts.arn
}

resource "aws_sns_topic_subscription" "cost_guard_lambda" {
  topic_arn = aws_sns_topic.cost_guard_alerts.arn
  protocol  = "lambda"
  endpoint  = aws_lambda_function.cost_guard.arn

  lifecycle {
    ignore_changes = [confirmation_timeout_in_minutes, endpoint_auto_confirms]
  }
}

# =============================================================================
# EventBridge Scheduler — daily trigger
# DLQ on failure instead of silent drop
# =============================================================================

resource "aws_scheduler_schedule" "cost_guard_daily" {
  name       = local.schedule_name
  group_name = "default"

  flexible_time_window {
    mode                      = "FLEXIBLE"
    maximum_window_in_minutes = 5
  }

  schedule_expression          = var.schedule_expression
  schedule_expression_timezone = var.schedule_timezone

  target {
    arn      = aws_lambda_function.cost_guard.arn
    role_arn = data.aws_iam_role.scheduler.arn

    retry_policy {
      maximum_event_age_in_seconds = 86400
      maximum_retry_attempts       = 1 # 0 silently drops; 1 sends to DLQ on second failure
    }

    dead_letter_config {
      arn = aws_sqs_queue.lambda_dlq.arn
    }
  }
}

# =============================================================================
# AWS Budgets — DAILY limit with 2-tier alerting (80% warning + 100% action)
# =============================================================================

resource "aws_budgets_budget" "daily_cost_budget" {
  name         = "${local.budget_prefix}-daily"
  budget_type  = "COST"
  limit_amount = tostring(local.budget_daily_limit)
  limit_unit   = "USD"
  time_unit    = "DAILY"

  cost_filter {
    name   = "Environment"
    values = [local.env]
  }

  # Tier 1 — warning at 80%
  dynamic "notification" {
    for_each = var.budget_daily_warning_pct > 0 ? [1] : []
    content {
      comparison_operator        = "GREATER_THAN"
      threshold                  = var.budget_daily_warning_pct
      threshold_type             = "PERCENTAGE"
      notification_type          = "ACTUAL"
      subscriber_email_addresses = [var.alert_email]
    }
  }

  # Tier 2 — critical at 100% + SNS trigger (fires cost guard)
  dynamic "notification" {
    for_each = var.budget_daily_critical_pct > 0 ? [1] : []
    content {
      comparison_operator        = "GREATER_THAN"
      threshold                  = var.budget_daily_critical_pct
      threshold_type             = "PERCENTAGE"
      notification_type          = "ACTUAL"
      subscriber_email_addresses = [var.alert_email]
      subscriber_sns_topic_arns  = [aws_sns_topic.cost_guard_alerts.arn]
    }
  }

  lifecycle {
    ignore_changes = [billing_view_arn, metrics, tags, tags_all]
  }
}

# =============================================================================
# AWS Budgets — MONTHLY limit for calendar-month spend visibility
# =============================================================================

resource "aws_budgets_budget" "monthly_cost_budget" {
  name         = "${local.budget_prefix}-monthly"
  budget_type  = "COST"
  limit_amount = tostring(local.budget_monthly_limit)
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  cost_filter {
    name   = "Environment"
    values = [local.env]
  }

  # Warning at 80%
  dynamic "notification" {
    for_each = var.budget_monthly_warning_pct > 0 ? [1] : []
    content {
      comparison_operator        = "GREATER_THAN"
      threshold                  = var.budget_monthly_warning_pct
      threshold_type             = "PERCENTAGE"
      notification_type          = "ACTUAL"
      subscriber_email_addresses = [var.alert_email]
    }
  }

  lifecycle {
    ignore_changes = [billing_view_arn, metrics, tags, tags_all]
  }
}

# =============================================================================
# Cost Anomaly Detection — SERVICE-scoped monitor
# =============================================================================

resource "aws_ce_anomaly_monitor" "service" {
  name              = local.anomaly_monitor_name
  monitor_type      = "DIMENSIONAL"
  monitor_dimension = "SERVICE"

  tags = local.common_tags

  lifecycle {
    ignore_changes = [tags, tags_all]
  }
}

resource "aws_ce_anomaly_subscription" "service" {
  name      = local.anomaly_subscription_name
  frequency = "DAILY"

  monitor_arn_list = [aws_ce_anomaly_monitor.service.arn]

  subscriber {
    type    = "EMAIL"
    address = var.alert_email
  }

  # Alert when total anomaly impact >= threshold USD
  threshold_expression {
    dimension {
      key           = "ANOMALY_TOTAL_IMPACT_ABSOLUTE"
      match_options = ["GREATER_THAN_OR_EQUAL"]
      values        = [tostring(local.anomaly_threshold)]
    }
  }

  lifecycle {
    ignore_changes = [tags, tags_all]
  }
}

# =============================================================================
# EventBridge rule — routes Cost Anomaly Detection events to Lambda + DLQ
# =============================================================================

resource "aws_cloudwatch_event_rule" "cost_anomaly_eventbridge" {
  name = "${local.budget_prefix}-cost-anomaly-eventbridge"

  event_pattern = jsonencode({
    source        = ["aws.costexplorer"]
    "detail-type" = ["Anomaly Detected"]
    detail = {
      monitorName = [local.anomaly_monitor_name]
    }
  })
}

resource "aws_lambda_permission" "allow_cost_anomaly_eventbridge" {
  statement_id  = "AllowExecutionFromCostAnomalyEvents"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.cost_guard.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.cost_anomaly_eventbridge.arn
}

resource "aws_cloudwatch_event_target" "cost_anomaly_lambda" {
  rule      = aws_cloudwatch_event_rule.cost_anomaly_eventbridge.name
  arn       = aws_lambda_function.cost_guard.arn
  target_id = "InvokeCostGuardLambda"

  # Failed deliveries go to DLQ, not silently dropped
  retry_policy {
    maximum_event_age_in_seconds = 86400
    maximum_retry_attempts       = 1
  }

  dead_letter_config {
    arn = aws_sqs_queue.lambda_dlq.arn
  }
}

# =============================================================================
# CloudWatch Logs — anomaly event log group + resource policy
# =============================================================================

resource "aws_cloudwatch_log_group" "cost_anomaly_events" {
  name              = "/aws/events/${local.log_group_suffix}-cost-anomaly"
  retention_in_days = var.log_retention_days

  tags = local.common_tags
}

resource "aws_cloudwatch_log_resource_policy" "cost_anomaly_events" {
  policy_name = "${local.log_group_suffix}-cost-anomaly-events"

  policy_document = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "TrustEventsToStoreLogEvent"
        Effect = "Allow"
        Principal = {
          Service = ["events.amazonaws.com", "delivery.logs.amazonaws.com"]
        }
        Action   = ["logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "arn:${data.aws_partition.current.partition}:logs:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:log-group:/aws/events/${local.log_group_suffix}-cost-anomaly:*"
      }
    ]
  })
}

resource "aws_cloudwatch_event_target" "cost_anomaly_logs" {
  rule      = aws_cloudwatch_event_rule.cost_anomaly_eventbridge.name
  arn       = aws_cloudwatch_log_group.cost_anomaly_events.arn
  target_id = "CaptureCostAnomalyEvents"
}

resource "aws_cloudwatch_log_metric_filter" "cost_anomaly_events" {
  name           = "${local.log_group_suffix}-cost-anomaly-events"
  log_group_name = aws_cloudwatch_log_group.cost_anomaly_events.name
  pattern        = "{ ($.source = \"aws.costexplorer\") }"

  metric_transformation {
    name      = "${local.project_name}CostAnomalyEvents"
    namespace = "${local.project_name}/Cost"
    value     = "1"
  }
}

resource "aws_cloudwatch_metric_alarm" "cost_anomaly_events" {
  alarm_name          = "${local.log_group_suffix}-cost-anomaly-events"
  alarm_description   = "Fires when Cost Anomaly Detection emits an anomaly event. Indicates unexpected spend spike above ${local.anomaly_threshold} USD."
  comparison_operator = "GreaterThanOrEqualToThreshold"
  evaluation_periods  = 1
  metric_name         = aws_cloudwatch_log_metric_filter.cost_anomaly_events.metric_transformation[0].name
  namespace           = aws_cloudwatch_log_metric_filter.cost_anomaly_events.metric_transformation[0].namespace
  period              = 300
  statistic           = "Sum"
  threshold           = 1
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.cost_guard_alerts.arn]

  tags = local.common_tags
}

# =============================================================================
# CloudWatch Logs Insights query definition — operational quick-look
# =============================================================================

resource "aws_cloudwatch_query_definition" "cost_anomaly_events" {
  name            = "${local.log_group_suffix}-cost-anomaly-events"
  log_group_names = [aws_cloudwatch_log_group.cost_anomaly_events.name]

  query_string = <<-EOT
    fields @timestamp,
           detail.monitorName,
           detail.impact.totalImpact,
           detail.anomalyStartDate,
           detail.anomalyEndDate,
           resources
    | filter source = "aws.costexplorer"
    | sort @timestamp desc
    | limit 50
  EOT
}
