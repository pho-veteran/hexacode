variable "environment" {
  description = "Environment name"
  type        = string
}

variable "private_data_subnet_ids" {
  description = "IDs of private data subnets"
  type        = list(string)
}

variable "sg_rds_proxy_id" {
  description = "Security group ID for the RDS proxy"
  type        = string
}

variable "db_instance_identifier" {
  description = "Identifier of the RDS instance"
  type        = string
}

variable "db_master_user_secret_arn" {
  description = "ARN of the managed master user secret"
  type        = string
}
