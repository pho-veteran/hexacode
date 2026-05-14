variable "environment" {
  description = "Environment name"
  type        = string
}

variable "application_secret_arn" {
  description = "Secrets Manager ARN that stores DATABASE_URL and REDIS_URL"
  type        = string
  default     = ""
}

variable "problem_bucket_arn" {
  description = "ARN of the problem assets S3 bucket"
  type        = string
}

variable "submission_bucket_arn" {
  description = "ARN of the submission artifacts S3 bucket"
  type        = string
}

variable "judge_queue_arn" {
  description = "ARN of the judge jobs SQS queue"
  type        = string
}

variable "efs_file_system_arn" {
  description = "ARN of the submission artifacts EFS file system"
  type        = string
}

variable "efs_access_point_arn" {
  description = "ARN of the submission artifacts EFS access point"
  type        = string
}

variable "kms_key_arn" {
  description = "KMS key ARN for Secrets Manager if CMK-backed"
  type        = string
  default     = ""
}