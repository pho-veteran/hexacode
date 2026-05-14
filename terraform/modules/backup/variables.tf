variable "environment" {
  description = "Environment name used in backup resource naming."
  type        = string
}

variable "backup_vault_name" {
  description = "Name of the AWS Backup vault."
  type        = string
}

variable "backup_plan_name" {
  description = "Name of the AWS Backup plan."
  type        = string
}

variable "backup_selection_name" {
  description = "Name of the AWS Backup selection."
  type        = string
}

variable "daily_backup_schedule" {
  description = "Cron schedule for the daily backup rule."
  type        = string
  default     = "cron(0 5 * * ? *)"
}

variable "backup_retention_days" {
  description = "Number of days to retain recovery points."
  type        = number
  default     = 35

  validation {
    condition     = var.backup_retention_days >= 7
    error_message = "backup_retention_days must be at least 7 days."
  }
}

variable "rds_instance_arn" {
  description = "ARN of the RDS instance to protect."
  type        = string

  validation {
    condition     = trimspace(var.rds_instance_arn) != ""
    error_message = "rds_instance_arn must be a non-empty ARN."
  }
}

variable "efs_file_system_arns" {
  description = "Optional list of EFS filesystem ARNs to include in the backup selection."
  type        = list(string)
  default     = []

  validation {
    condition = alltrue([
      for arn in var.efs_file_system_arns :
      trimspace(arn) != "" && can(regex("^arn:[^:]+:elasticfilesystem:[^:]+:[0-9]{12}:file-system/fs-[A-Za-z0-9]+$", arn))
    ])
    error_message = "efs_file_system_arns must contain only EFS file system ARNs."
  }
}

variable "enable_failure_notifications" {
  description = "Create EventBridge and SNS resources for AWS Backup failure notifications."
  type        = bool
  default     = true
}
