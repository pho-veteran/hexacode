variable "environment" {
  description = "Environment name"
  type        = string
}

variable "region" {
  description = "AWS region for S3 bucket domain"
  type        = string
}

variable "frontend_bucket_name" {
  description = "Name of the frontend S3 bucket"
  type        = string
}

variable "frontend_bucket_arn" {
  description = "ARN of the frontend S3 bucket"
  type        = string
}

variable "web_acl_id" {
  description = "Optional AWS WAF web ACL ARN to associate with the CloudFront distribution."
  type        = string
  default     = null
  nullable    = true
}