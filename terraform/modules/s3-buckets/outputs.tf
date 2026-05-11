# S3 Bucket Module Outputs

output "frontend_bucket_name" {
  description = "Name of the frontend S3 bucket"
  value       = aws_s3_bucket.frontend.bucket
}

output "frontend_bucket_arn" {
  description = "ARN of the frontend S3 bucket"
  value       = aws_s3_bucket.frontend.arn
}

output "problem_bucket_name" {
  description = "Name of the problem assets S3 bucket"
  value       = aws_s3_bucket.problem_assets.bucket
}

output "problem_bucket_arn" {
  description = "ARN of the problem assets S3 bucket"
  value       = aws_s3_bucket.problem_assets.arn
}

output "submission_bucket_name" {
  description = "Name of the submission artifacts S3 bucket"
  value       = aws_s3_bucket.submission_artifacts.bucket
}

output "submission_bucket_arn" {
  description = "ARN of the submission artifacts S3 bucket"
  value       = aws_s3_bucket.submission_artifacts.arn
}