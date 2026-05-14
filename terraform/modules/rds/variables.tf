variable "environment" {
  description = "Environment name (dev/staging/prod)"
  type        = string
}

variable "db_instance_class" {
  description = "RDS instance class"
  type        = string
}

variable "db_allocated_storage" {
  description = "RDS allocated storage in GiB"
  type        = number
}

variable "db_multi_az" {
  description = "Enable Multi-AZ for RDS"
  type        = bool
}

variable "private_data_subnet_ids" {
  description = "IDs of private data subnets"
  type        = list(string)
}

variable "rds_security_group_id" {
  description = "Security group ID for RDS"
  type        = string
}

variable "deletion_protection" {
  description = "Enable deletion protection for the DB instance."
  type        = bool
  default     = true
}

variable "skip_final_snapshot" {
  description = "Skip the final snapshot when deleting the DB instance."
  type        = bool
  default     = false
}

variable "final_snapshot_identifier" {
  description = "Unique final snapshot identifier to use when final snapshots are required. Must be updated for each destructive operation."
  type        = string
  default     = ""

  validation {
    condition = trimspace(var.final_snapshot_identifier) == "" || (
      length(var.final_snapshot_identifier) >= 1 &&
      length(var.final_snapshot_identifier) <= 255 &&
      can(regex("^[A-Za-z][A-Za-z0-9-]*$", var.final_snapshot_identifier)) &&
      !can(regex("--", var.final_snapshot_identifier)) &&
      !endswith(var.final_snapshot_identifier, "-")
    )
    error_message = "final_snapshot_identifier must be empty or a valid RDS snapshot identifier: 1-255 chars, starts with a letter, contains only letters, numbers, and hyphens, with no trailing hyphen or double hyphen."
  }
}