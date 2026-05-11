# SQS Module - Hexacode Judge Jobs Queue
# Creates the judge-jobs queue and its dead-letter queue

resource "aws_sqs_queue" "judge_jobs_dlq" {
  name                      = "hexacode-${var.environment}-judge-jobs-dlq"
  message_retention_seconds = 86400 # 1 day

  tags = {
    Name        = "hexacode-${var.environment}-judge-jobs-dlq"
    Environment = var.environment
  }
}

resource "aws_sqs_queue" "judge_jobs" {
  name                       = "hexacode-${var.environment}-judge-jobs"
  message_retention_seconds  = 86400 # 1 day
  visibility_timeout_seconds = 300   # 5 minutes
  receive_wait_time_seconds  = 20    # long polling

  redrive_policy = jsonencode({
    maxReceiveCount     = 5,
    deadLetterTargetArn = aws_sqs_queue.judge_jobs_dlq.arn
  })

  tags = {
    Name        = "hexacode-${var.environment}-judge-jobs"
    Environment = var.environment
  }
}