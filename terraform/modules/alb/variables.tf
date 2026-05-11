variable "environment" {
  description = "Environment name"
  type        = string
}

variable "vpc_id" {
  description = "VPC ID"
  type        = string
}

variable "private_app_subnet_ids" {
  description = "IDs of private app subnets"
  type        = list(string)
}

variable "sg_internal_alb_id" {
  description = "Security group ID for the internal ALB"
  type        = string
}