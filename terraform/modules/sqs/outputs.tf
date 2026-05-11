# SQS Module Outputs

output "judge_queue_url" {
  description = "URL of the judge jobs SQS queue"
  value       = aws_sqs_queue.judge_jobs.url
}

output "judge_queue_arn" {
  description = "ARN of the judge jobs SQS queue"
  value       = aws_sqs_queue.judge_jobs.arn
}

output "judge_dlq_url" {
  description = "URL of the judge jobs dead-letter queue"
  value       = aws_sqs_queue.judge_jobs_dlq.url
}

output "judge_dlq_arn" {
  description = "ARN of the judge jobs dead-letter queue"
  value       = aws_sqs_queue.judge_jobs_dlq.arn
}