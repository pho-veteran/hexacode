variable "environment" {
  description = "Environment name."
  type        = string
}

variable "region" {
  description = "AWS region."
  type        = string
}

variable "availability_zones" {
  description = "AZ suffixes to use."
  type        = list(string)
}

variable "management_vpc_cidr_block" {
  description = "CIDR block for the management VPC."
  type        = string
}

variable "app_vpc_id" {
  description = "Application VPC ID to peer with."
  type        = string
}

variable "app_vpc_cidr_block" {
  description = "Application VPC CIDR block."
  type        = string
}

variable "app_private_app_route_table_ids" {
  description = "Application private app route table IDs that need a return route to the management VPC."
  type        = list(string)
}

variable "app_private_data_route_table_ids" {
  description = "Application private data route table IDs that need a return route to the management VPC."
  type        = list(string)
}

variable "instance_type" {
  description = "EC2 instance type for the SSM-managed operator host."
  type        = string
  default     = "t3.micro"
}

variable "application_secret_arn" {
  description = "Secrets Manager ARN containing runtime database and storage environment values for ops scripts."
  type        = string
}

variable "problem_bucket_arn" {
  description = "Problem asset bucket ARN used by catalog import tooling."
  type        = string
}

variable "submission_bucket_arn" {
  description = "Submission artifact bucket ARN used by operator tooling."
  type        = string
}

variable "kms_key_arn" {
  description = "Optional KMS key ARN for CMK-backed application secrets."
  type        = string
  default     = ""
}
