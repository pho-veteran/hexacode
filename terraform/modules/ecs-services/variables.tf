variable "environment" {
  description = "Environment name"
  type        = string
}

variable "region" {
  description = "AWS region"
  type        = string
}

variable "ecs_cluster_name" {
  description = "Name of the ECS cluster"
  type        = string
}

variable "ecs_execution_role_arn" {
  description = "ARN of the ECS execution role"
  type        = string
}

variable "identity_task_role_arn" {
  description = "ARN of the identity service task role"
  type        = string
}

variable "problem_task_role_arn" {
  description = "ARN of the problem service task role"
  type        = string
}

variable "submission_task_role_arn" {
  description = "ARN of the submission service task role"
  type        = string
}

variable "worker_task_role_arn" {
  description = "ARN of the worker task role"
  type        = string
}

variable "tg_identity_arn" {
  description = "ARN of the identity service target group"
  type        = string
}

variable "tg_problem_arn" {
  description = "ARN of the problem service target group"
  type        = string
}

variable "tg_submission_arn" {
  description = "ARN of the submission service target group"
  type        = string
}

variable "private_app_subnet_ids" {
  description = "IDs of private app subnets"
  type        = list(string)
}

variable "sg_api_services_id" {
  description = "Security group ID for API services"
  type        = string
}

variable "sg_worker_id" {
  description = "Security group ID for worker"
  type        = string
}

variable "application_secret_arn" {
  description = "Secrets Manager ARN that stores DATABASE_URL and REDIS_URL"
  type        = string
  default     = ""
}

variable "ecr_repository_url" {
  description = "ECR repository URL for Hexacode images"
  type        = string
  default     = ""
}

variable "image_tag" {
  description = "Image tag to deploy"
  type        = string
  default     = "latest"
}

variable "cognito_user_pool_id" {
  description = "Cognito user pool ID"
  type        = string
  default     = ""
}

variable "cognito_app_client_id" {
  description = "Cognito app client ID"
  type        = string
  default     = ""
}

variable "cognito_issuer" {
  description = "Cognito issuer URL"
  type        = string
  default     = ""
}

variable "cognito_jwks_url" {
  description = "Cognito JWKS URL"
  type        = string
  default     = ""
}

variable "problem_bucket_name" {
  description = "Name of the problem assets S3 bucket"
  type        = string
  default     = ""
}

variable "submission_bucket_name" {
  description = "Name of the submission artifacts S3 bucket"
  type        = string
  default     = ""
}

variable "judge_queue_url" {
  description = "URL of the judge jobs SQS queue"
  type        = string
  default     = ""
}

variable "internal_alb_dns_name" {
  description = "DNS name of the internal ALB"
  type        = string
  default     = ""
}