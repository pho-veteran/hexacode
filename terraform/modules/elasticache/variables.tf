variable "environment" {
  description = "Environment name (dev/staging/prod)"
  type        = string
}

variable "private_data_subnet_ids" {
  description = "IDs of private data subnets"
  type        = list(string)
}

variable "redis_security_group_id" {
  description = "Security group ID for ElastiCache Redis"
  type        = string
}