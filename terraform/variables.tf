variable "region" {
  description = "AWS region"
  type        = string
  default     = "us-west-2"
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

variable "ecr_repository_name" {
  description = "ECR repository name for Hexacode images"
  type        = string
  default     = "prod/hexacode"
}

variable "image_tag" {
  description = "Image tag to deploy"
  type        = string
  default     = ""
}

variable "chat_lambda_arn" {
  description = "Optional external chat Lambda ARN. Leave empty to use Terraform-managed Bedrock chat."
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

variable "client_vpn_enabled" {
  description = "Create AWS Client VPN for approved human database access"
  type        = bool
  default     = false
}

variable "client_vpn_cidr_block" {
  description = "Client VPN CIDR block"
  type        = string
  default     = "10.30.0.0/22"
}

variable "client_vpn_server_certificate_arn" {
  description = "ACM ARN for the Client VPN server certificate"
  type        = string
  default     = ""
}

variable "client_vpn_root_certificate_chain_arn" {
  description = "ACM ARN for the Client VPN root client certificate"
  type        = string
  default     = ""
}