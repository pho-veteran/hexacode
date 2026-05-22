data "aws_region" "current" {}

data "aws_caller_identity" "current" {}

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
    "$or" = [
      {
        "detail-type" = ["Backup Job State Change", "Copy Job State Change"]
        detail = {
          state = ["FAILED"]
        }
      },
      {
        "detail-type" = ["Restore Job State Change"]
        detail = {
          status = ["FAILED"]
        }
      }
    ]
  })
}

resource "aws_cloudwatch_log_resource_policy" "backup_failures" {
  count       = var.enable_failure_notifications ? 1 : 0
  policy_name = "hexacode-${var.environment}-backup-failure-events"
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

resource "aws_cloudwatch_event_target" "backup_job_failures_logs" {
  count = var.enable_failure_notifications ? 1 : 0
  rule  = aws_cloudwatch_event_rule.backup_job_failures[0].name
  arn   = aws_cloudwatch_log_group.backup_failures[0].arn
}

resource "aws_cloudwatch_log_metric_filter" "backup_failures" {
  count          = var.enable_failure_notifications ? 1 : 0
  name           = "hexacode-${var.environment}-backup-failures"
  log_group_name = aws_cloudwatch_log_group.backup_failures[0].name
  pattern        = "{ ($.source = \"aws.backup\") && ( ($.detail.state = \"FAILED\") || ($.detail.status = \"FAILED\") ) }"

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

resource "aws_cloudwatch_query_definition" "backup_failure_events" {
  count = var.enable_failure_notifications ? 1 : 0
  name  = "hexacode-${var.environment}-backup-failure-events"

  log_group_names = [aws_cloudwatch_log_group.backup_failures[0].name]

  query_string = <<-EOT
fields @timestamp, detail-type, detail.state, detail.status, detail.backupVaultName, detail.resourceArn, detail.restoreJobId, detail.backupJobId, detail.copyJobId
| filter source = "aws.backup"
| filter detail.state = "FAILED" or detail.status = "FAILED"
| sort @timestamp desc
| limit 50
EOT
}

resource "aws_cloudwatch_dashboard" "backup_observability" {
  count          = var.enable_failure_notifications ? 1 : 0
  dashboard_name = "HexaCode-Production-Observability"

  dashboard_body = jsonencode({
    widgets = [
      {
        type   = "metric"
        x      = 0
        y      = 0
        width  = 6
        height = 6
        properties = {
          view    = "timeSeries"
          stacked = false
          metrics = [
            ["AWS/ApiGateway", "4xx", "Stage", "$default", "ApiId", "5l48bwt6ck", { region = data.aws_region.current.region }],
            ["AWS/ApiGateway", "5xx", "Stage", "$default", "ApiId", "5l48bwt6ck", { region = data.aws_region.current.region }],
            ["AWS/ApiGateway", "Count", "Stage", "$default", "ApiId", "5l48bwt6ck", { region = data.aws_region.current.region }],
            ["AWS/ApiGateway", "Latency", "Stage", "$default", "ApiId", "5l48bwt6ck", { region = data.aws_region.current.region }],
          ]
          region = data.aws_region.current.region
          title  = "API Layer"
          period = 300
        }
      },
      {
        type   = "metric"
        x      = 6
        y      = 0
        width  = 6
        height = 6
        properties = {
          view    = "timeSeries"
          stacked = false
          title   = "Data Layer - RDS Connections and CPU"
          metrics = [
            ["AWS/RDS", "DatabaseConnections", "DBInstanceIdentifier", "hexacode-prod-db", { period = 60 }],
            [".", "CPUUtilization", ".", ".", { period = 60 }],
          ]
          region = data.aws_region.current.region
        }
      },
      {
        type   = "metric"
        x      = 12
        y      = 0
        width  = 6
        height = 6
        properties = {
          view    = "bar"
          stacked = false
          metrics = [
            ["CWAgent", "mem_used_percent", "host", "ip-10-22-0-9.us-west-2.compute.internal"],
            [".", "disk_used_percent", "path", "/", "host", "ip-10-22-0-9.us-west-2.compute.internal", "device", "nvme0n1p1", "fstype", "xfs"],
          ]
          region = data.aws_region.current.region
          title  = "Infrastructure - Management EC2 CWAgent"
        }
      },
      {
        type   = "metric"
        x      = 18
        y      = 0
        width  = 6
        height = 6
        properties = {
          view    = "timeSeries"
          stacked = false
          metrics = [
            ["HexaCode/Operations", "AI_Inference_Latency"],
          ]
          region = data.aws_region.current.region
          title  = "Custom Metric - ApiBusinessLatencyMs"
        }
      },
      {
        type   = "metric"
        x      = 0
        y      = 6
        width  = 12
        height = 6
        properties = {
          title   = "Backup failure count"
          view    = "timeSeries"
          region  = data.aws_region.current.region
          stat    = "Sum"
          period  = 300
          metrics = [
            [aws_cloudwatch_log_metric_filter.backup_failures[0].metric_transformation[0].namespace, aws_cloudwatch_log_metric_filter.backup_failures[0].metric_transformation[0].name],
          ]
        }
      },
      {
        type   = "alarm"
        x      = 12
        y      = 6
        width  = 12
        height = 6
        properties = {
          title  = "Backup failure alarm"
          alarms = [aws_cloudwatch_metric_alarm.backup_failures[0].arn]
        }
      },
      {
        type   = "log"
        x      = 0
        y      = 12
        width  = 24
        height = 6
        properties = {
          title  = "Backup failure events"
          region = data.aws_region.current.region
          query  = "SOURCE '${aws_cloudwatch_log_group.backup_failures[0].name}' | fields @timestamp, detail-type, detail.state, detail.status, detail.resourceArn | filter source = \"aws.backup\" | filter detail.state = \"FAILED\" or detail.status = \"FAILED\" | sort @timestamp desc | limit 20"
          view   = "table"
        }
      },
    ]
  })
}
