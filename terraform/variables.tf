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

variable "rds_deletion_protection" {
  description = "Enable deletion protection for the RDS instance."
  type        = bool
  default     = true
}

variable "rds_skip_final_snapshot" {
  description = "Skip the final snapshot when deleting the RDS instance."
  type        = bool
  default     = false
}

variable "rds_final_snapshot_identifier" {
  description = "Unique final snapshot identifier to use for the RDS instance when snapshots are required. Must be updated for each destructive operation."
  type        = string
  default     = ""

  validation {
    condition = trimspace(var.rds_final_snapshot_identifier) == "" || (
      length(var.rds_final_snapshot_identifier) >= 1 &&
      length(var.rds_final_snapshot_identifier) <= 255 &&
      can(regex("^[A-Za-z][A-Za-z0-9-]*$", var.rds_final_snapshot_identifier)) &&
      !can(regex("--", var.rds_final_snapshot_identifier)) &&
      !endswith(var.rds_final_snapshot_identifier, "-")
    )
    error_message = "rds_final_snapshot_identifier must be empty or a valid RDS snapshot identifier: 1-255 chars, starts with a letter, contains only letters, numbers, and hyphens, with no trailing hyphen or double hyphen."
  }
}

variable "backup_efs_file_system_arns" {
  description = "Optional EFS filesystem ARNs to include in the AWS Backup selection."
  type        = list(string)
  default     = []

  validation {
    condition = alltrue([
      for arn in var.backup_efs_file_system_arns :
      trimspace(arn) != "" && can(regex("^arn:[^:]+:elasticfilesystem:[^:]+:[0-9]{12}:file-system/fs-[A-Za-z0-9]+$", arn))
    ])
    error_message = "backup_efs_file_system_arns must contain only EFS file system ARNs."
  }
}

variable "backup_additional_resource_arns" {
  description = "Optional additional AWS Backup-supported resource ARNs to include in the AWS Backup selection."
  type        = list(string)
  default     = []

  validation {
    condition = alltrue([
      for arn in var.backup_additional_resource_arns :
      trimspace(arn) != ""
    ])
    error_message = "backup_additional_resource_arns must contain only non-empty ARNs."
  }
}

variable "network_firewall_blocked_domains" {
  description = "Domains blocked by the Network Firewall denylist for W5 egress inspection evidence."
  type        = list(string)
  default     = ["example.com"]

  validation {
    condition = alltrue([
      for domain in var.network_firewall_blocked_domains :
      can(regex("^([A-Za-z0-9-]+\\.)+[A-Za-z]{2,}$", domain))
    ])
    error_message = "network_firewall_blocked_domains must contain DNS names such as example.com."
  }
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

variable "management_vpc_enabled" {
  description = "Create a separate management VPC with an SSM-managed operator host and peering to the application VPC."
  type        = bool
  default     = false
}

variable "management_vpc_cidr_block" {
  description = "CIDR block for the management VPC. Must not overlap the application VPC CIDR."
  type        = string
  default     = "10.22.0.0/20"

  validation {
    condition     = can(cidrhost(var.management_vpc_cidr_block, 0))
    error_message = "management_vpc_cidr_block must be a valid IPv4 CIDR block."
  }
}

variable "ecs_scheduled_scaling_actions" {
  description = "Scheduled ECS service scaling actions keyed by scheduled action name."
  type = map(object({
    service_key  = string
    schedule     = string
    timezone     = string
    min_capacity = number
    max_capacity = number
  }))
  default = {}
}

variable "cost_controls" {
  description = <<-EOT
    Cost governance controls. Most fields auto-compute from environment name or baseline formulas
    when left null/empty. Only `alert_email` is always required.
  EOT
  type = object({
    # --- Notification channels (required) ---
    alert_email = string

    # --- Lambda IAM — still required, must be pre-created externally ---
    lambda_role_name        = string
    lambda_basic_policy_arn = string
    scheduler_role_name     = string
    scheduler_policy_arn    = string

    # --- Budget overrides (optional — module auto-computes from baselines) ---
    budget_name              = string
    budget_daily_limit_usd   = optional(number)
    budget_monthly_limit_usd = optional(number)

    # --- Baseline override (optional — module sums them) ---
    baseline_ecs_fargate_daily_usd    = optional(number)
    baseline_rds_daily_usd            = optional(number)
    baseline_elasticache_daily_usd    = optional(number)
    baseline_nat_gateway_daily_usd    = optional(number)
    baseline_alb_daily_usd            = optional(number)
    baseline_other_services_daily_usd = optional(number)

    # --- Alert thresholds ---
    budget_daily_warning_pct   = optional(number)
    budget_daily_critical_pct  = optional(number)
    budget_monthly_warning_pct = optional(number)
    anomaly_threshold_usd      = optional(number)

    # --- ECS cluster scoping ---
    ecs_cluster_name                    = optional(string)
    ecs_cost_guard_protection_tag_key   = optional(string)
    ecs_cost_guard_protection_tag_value = optional(string)

    # --- Lambda settings ---
    lambda_timeout_seconds = optional(number)
    lambda_memory_mb       = optional(number)

    # --- Scheduler ---
    schedule_expression = optional(string)
    schedule_timezone   = optional(string)

    # --- KMS ---
    kms_key_arn = optional(string)
  })
}