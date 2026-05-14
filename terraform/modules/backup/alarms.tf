resource "aws_sns_topic" "backup_failures" {
  count = var.enable_failure_notifications ? 1 : 0
  name  = "hexacode-${var.environment}-backup-failures"

  tags = {
    Name        = "hexacode-${var.environment}-backup-failures"
    Environment = var.environment
  }
}

resource "aws_cloudwatch_log_group" "backup_failures" {
  count             = var.enable_failure_notifications ? 1 : 0
  name              = "/aws/events/hexacode-${var.environment}-backup-failures"
  retention_in_days = 14

  tags = {
    Name        = "hexacode-${var.environment}-backup-failures"
    Environment = var.environment
  }
}

resource "aws_cloudwatch_event_rule" "backup_job_failures" {
  count       = var.enable_failure_notifications ? 1 : 0
  name        = "hexacode-${var.environment}-backup-job-failures"
  description = "Routes failed AWS Backup jobs into CloudWatch Logs for alarming."

  event_pattern = jsonencode({
    source = ["aws.backup"]
    "detail-type" = [
      "Backup Job State Change",
      "Restore Job State Change",
      "Copy Job State Change"
    ]
    detail = {
      state = ["FAILED"]
    }
  })
}

resource "aws_cloudwatch_log_resource_policy" "backup_failures" {
  count       = var.enable_failure_notifications ? 1 : 0
  policy_name = "hexacode-${var.environment}-backup-failure-events"
  policy_document = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AllowEventBridgeCreateLogStream"
        Effect = "Allow"
        Principal = {
          Service = ["events.amazonaws.com", "delivery.logs.amazonaws.com"]
        }
        Action   = ["logs:CreateLogStream"]
        Resource = ["${aws_cloudwatch_log_group.backup_failures[0].arn}:*"]
      },
      {
        Sid    = "AllowEventBridgePutLogEvents"
        Effect = "Allow"
        Principal = {
          Service = ["events.amazonaws.com", "delivery.logs.amazonaws.com"]
        }
        Action   = ["logs:PutLogEvents"]
        Resource = ["${aws_cloudwatch_log_group.backup_failures[0].arn}:*:*"]
        Condition = {
          ArnEquals = {
            "aws:SourceArn" = aws_cloudwatch_event_rule.backup_job_failures[0].arn
          }
        }
      }
    ]
  })
}

resource "aws_cloudwatch_event_target" "backup_job_failures_logs" {
  count = var.enable_failure_notifications ? 1 : 0
  rule  = aws_cloudwatch_event_rule.backup_job_failures[0].name
  arn   = aws_cloudwatch_log_group.backup_failures[0].arn
}

resource "aws_cloudwatch_log_metric_filter" "backup_failures" {
  count          = var.enable_failure_notifications ? 1 : 0
  name           = "hexacode-${var.environment}-backup-failures"
  log_group_name = aws_cloudwatch_log_group.backup_failures[0].name
  pattern        = "{ ($.source = \"aws.backup\") && ($.detail.state = \"FAILED\") }"

  metric_transformation {
    name      = "HexacodeBackupFailures"
    namespace = "Hexacode/Backup"
    value     = "1"
  }
}

resource "aws_cloudwatch_metric_alarm" "backup_failures" {
  count               = var.enable_failure_notifications ? 1 : 0
  alarm_name          = "hexacode-${var.environment}-backup-failures"
  alarm_description   = "Triggers when AWS Backup backup, restore, or copy jobs fail."
  comparison_operator = "GreaterThanOrEqualToThreshold"
  evaluation_periods  = 1
  metric_name         = aws_cloudwatch_log_metric_filter.backup_failures[0].metric_transformation[0].name
  namespace           = aws_cloudwatch_log_metric_filter.backup_failures[0].metric_transformation[0].namespace
  period              = 300
  statistic           = "Sum"
  threshold           = 1
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.backup_failures[0].arn]
}
