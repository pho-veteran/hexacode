variable "environment" {
  description = "Environment name used in EFS resource naming."
  type        = string
}

variable "private_data_subnet_ids" {
  description = "Private data subnet IDs for EFS mount targets."
  type        = list(string)
}

variable "security_group_id" {
  description = "Security group ID attached to EFS mount targets."
  type        = string
}
