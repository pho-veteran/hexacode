data "aws_caller_identity" "current" {}

data "aws_partition" "current" {}

data "aws_region" "current" {}

data "archive_file" "cost_guard_zip" {
  type        = "zip"
  output_path = "${path.module}/cost_guard.zip"

  source {
    content  = file("${path.module}/cost_guard.py")
    filename = "lambda_function.py"
  }
}

data "aws_iam_role" "cost_guard_lambda" {
  name = var.lambda_role_name
}

data "aws_iam_role" "scheduler" {
  name = var.scheduler_role_name
}

resource "aws_sns_topic" "cost_guard_budget_alerts" {
  name = var.sns_topic_name

  lifecycle {
    ignore_changes = [
      tags,
      tags_all,
    ]
  }
}

resource "aws_sns_topic_policy" "cost_anomaly_topic" {
  arn = aws_sns_topic.cost_guard_budget_alerts.arn
  policy = jsonencode({
    Version = "2008-10-17"
    Id      = "__default_policy_ID"
    Statement = [
      {
        Sid    = "__default_statement_ID"
        Effect = "Allow"
        Principal = {
          AWS = "*"
        }
        Action = [
          "SNS:GetTopicAttributes",
          "SNS:SetTopicAttributes",
          "SNS:AddPermission",
          "SNS:RemovePermission",
          "SNS:DeleteTopic",
          "SNS:Subscribe",
          "SNS:ListSubscriptionsByTopic",
          "SNS:Publish"
        ]
        Resource = aws_sns_topic.cost_guard_budget_alerts.arn
        Condition = {
          StringEquals = {
            "AWS:SourceOwner" = data.aws_caller_identity.current.account_id
          }
        }
      }
    ]
  })
}

resource "aws_iam_role_policy" "cost_guard_lambda" {
  name = "CostGuard-ECS"
  role = data.aws_iam_role.cost_guard_lambda.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "ecs:StopTask",
          "ecs:DescribeTasks",
          "ecs:DescribeServices",
          "ecs:UpdateService",
          "ecs:ListTasks",
          "ecs:ListServices",
          "ecs:ListClusters",
          "ecs:ListTagsForResource"
        ]
        Resource = "*"
      },
      {
        Effect = "Allow"
        Action = [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents"
        ]
        Resource = "arn:aws:logs:*:*:*"
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

resource "aws_lambda_function" "cost_guard" {
  filename         = data.archive_file.cost_guard_zip.output_path
  function_name    = var.lambda_name
  role             = data.aws_iam_role.cost_guard_lambda.arn
  handler          = "lambda_function.lambda_handler"
  source_code_hash = data.archive_file.cost_guard_zip.output_base64sha256
  runtime          = "python3.12"
  timeout          = 3
  memory_size      = 128

  tags = {
    Name        = var.lambda_name
    Environment = var.environment
  }

  lifecycle {
    ignore_changes = [
      filename,
      publish,
      source_code_hash,
      tags,
      tags_all,
    ]
  }
}

resource "aws_lambda_permission" "allow_budget_alerts" {
  statement_id  = "sns-invoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.cost_guard.function_name
  principal     = "sns.amazonaws.com"
  source_arn    = aws_sns_topic.cost_guard_budget_alerts.arn
}

resource "aws_sns_topic_subscription" "cost_guard_lambda" {
  topic_arn = aws_sns_topic.cost_guard_budget_alerts.arn
  protocol  = "lambda"
  endpoint  = aws_lambda_function.cost_guard.arn

  lifecycle {
    ignore_changes = [
      confirmation_timeout_in_minutes,
      endpoint_auto_confirms,
    ]
  }
}

resource "aws_scheduler_schedule" "cost_guard" {
  name       = var.schedule_name
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
      maximum_retry_attempts       = 0
    }
  }
}

resource "aws_budgets_budget" "daily_cost_budget" {
  name         = var.budget_name
  budget_type  = "COST"
  limit_amount = tostring(var.budget_limit_amount_usd)
  limit_unit   = "USD"
  time_unit    = "DAILY"

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 50
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = [var.alert_email]
  }

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = [var.alert_email]
    subscriber_sns_topic_arns  = [aws_sns_topic.cost_guard_budget_alerts.arn]
  }

  lifecycle {
    ignore_changes = [
      billing_view_arn,
      metrics,
      tags,
      tags_all,
    ]
  }
}

resource "aws_ce_anomaly_monitor" "service" {
  name              = var.anomaly_monitor_name
  monitor_type      = "DIMENSIONAL"
  monitor_dimension = "SERVICE"

  lifecycle {
    ignore_changes = [
      tags,
      tags_all,
    ]
  }
}

resource "aws_ce_anomaly_subscription" "service" {
  name      = var.anomaly_subscription_name
  frequency = "DAILY"

  monitor_arn_list = [
    aws_ce_anomaly_monitor.service.arn
  ]

  subscriber {
    type    = "EMAIL"
    address = var.alert_email
  }

  threshold_expression {
    dimension {
      key           = "ANOMALY_TOTAL_IMPACT_ABSOLUTE"
      match_options = ["GREATER_THAN_OR_EQUAL"]
      values        = [tostring(var.anomaly_threshold_usd)]
    }
  }

  lifecycle {
    ignore_changes = [
      tags,
      tags_all,
    ]
  }
}

resource "aws_cloudwatch_event_rule" "cost_anomaly_cost_guard" {
  name = "hexacode-${var.environment}-cost-anomaly-cost-guard"

  event_pattern = jsonencode({
    source        = ["aws.ce"]
    "detail-type" = ["Anomaly Detected"]
    detail = {
      monitorName = [var.anomaly_monitor_name]
    }
  })
}

resource "aws_lambda_permission" "allow_cost_anomaly_eventbridge" {
  statement_id  = "AllowExecutionFromCostAnomalyEvents"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.cost_guard.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.cost_anomaly_cost_guard.arn
}

resource "aws_cloudwatch_log_group" "cost_anomaly_events" {
  name              = "/aws/events/hexacode-${var.environment}-cost-anomaly"
  retention_in_days = 14

  tags = {
    Name        = "hexacode-${var.environment}-cost-anomaly"
    Environment = var.environment
  }
}

resource "aws_cloudwatch_log_resource_policy" "cost_anomaly_events" {
  policy_name = "hexacode-${var.environment}-cost-anomaly-events"
  policy_document = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "TrustEventsToStoreLogEvent"
        Effect = "Allow"
        Principal = {
          Service = ["events.amazonaws.com", "delivery.logs.amazonaws.com"]
        }
        Action = ["logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = [
          "arn:aws:logs:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:log-group:/aws/events/*:*"
        ]
      }
    ]
  })
}

resource "aws_cloudwatch_event_target" "cost_anomaly_lambda" {
  rule      = aws_cloudwatch_event_rule.cost_anomaly_cost_guard.name
  arn       = aws_lambda_function.cost_guard.arn
  target_id = "InvokeCostGuardLambda"
}

resource "aws_cloudwatch_event_target" "cost_anomaly_logs" {
  rule      = aws_cloudwatch_event_rule.cost_anomaly_cost_guard.name
  arn       = aws_cloudwatch_log_group.cost_anomaly_events.arn
  target_id = "CaptureCostAnomalyEvents"
}

resource "aws_cloudwatch_log_metric_filter" "cost_anomaly_events" {
  name           = "hexacode-${var.environment}-cost-anomaly-events"
  log_group_name = aws_cloudwatch_log_group.cost_anomaly_events.name
  pattern        = "{ ($.source = \"aws.ce\") && ($.detail.monitorName = \"${var.anomaly_monitor_name}\") }"

  metric_transformation {
    name      = "HexacodeCostAnomalyEvents"
    namespace = "Hexacode/Cost"
    value     = "1"
  }
}

resource "aws_cloudwatch_metric_alarm" "cost_anomaly_events" {
  alarm_name          = "hexacode-${var.environment}-cost-anomaly-events"
  alarm_description   = "Triggers when Cost Anomaly Detection emits an anomaly event for the HexaCode monitor."
  comparison_operator = "GreaterThanOrEqualToThreshold"
  evaluation_periods  = 1
  metric_name         = aws_cloudwatch_log_metric_filter.cost_anomaly_events.metric_transformation[0].name
  namespace           = aws_cloudwatch_log_metric_filter.cost_anomaly_events.metric_transformation[0].namespace
  period              = 300
  statistic           = "Sum"
  threshold           = 1
  treat_missing_data  = "notBreaching"
}

resource "aws_cloudwatch_query_definition" "cost_anomaly_events" {
  name            = "hexacode-${var.environment}-cost-anomaly-events"
  log_group_names = [aws_cloudwatch_log_group.cost_anomaly_events.name]

  query_string = <<-EOT
fields @timestamp, detail.monitorName, detail.impact.totalImpact, detail.anomalyStartDate, detail.anomalyEndDate, resources
| filter source = "aws.ce"
| filter detail.monitorName = "${var.anomaly_monitor_name}"
| sort @timestamp desc
| limit 50
EOT
}
