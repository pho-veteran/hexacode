variable "region" {
  description = "AWS region"
  type        = string
  default     = "ap-southeast-1"
}

variable "environment" {
  description = "Environment name (dev/staging/prod)"
  type        = string
}

variable "cidr_block" {
  description = "VPC CIDR block"
  type        = string
  default     = "10.20.0.0/16"
}

variable "availability_zones" {
  description = "AZ suffixes to use"
  type        = list(string)
  default     = ["a", "b"]
}

variable "db_instance_class" {
  description = "RDS instance class"
  type        = string
  default     = "db.t4g.medium"
}

variable "db_multi_az" {
  description = "Enable Multi-AZ for RDS"
  type        = bool
  default     = false
}

variable "db_allocated_storage" {
  description = "RDS allocated storage in GiB"
  type        = number
  default     = 100
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
  default     = ""
}

variable "chat_lambda_arn" {
  description = "ARN of the deployed chat Lambda function"
  type        = string
  default     = ""
}

variable "frontend_domain" {
  description = "Frontend origin used for Cognito callbacks and CORS"
  type        = string
  default     = ""
}

variable "cors_lambda_arn" {
  description = "ARN of the deployed CORS Lambda function"
  type        = string
  default     = ""
}

variable "kms_key_arn" {
  description = "KMS key ARN for Secrets Manager if CMK-backed"
  type        = string
  default     = ""
}