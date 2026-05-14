resource "aws_backup_vault" "main" {
  name = var.backup_vault_name

  tags = {
    Name        = var.backup_vault_name
    Environment = var.environment
  }
}

resource "aws_iam_role" "backup_service" {
  name = "hexacode-${var.environment}-backup-service-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Service = "backup.amazonaws.com"
        }
        Action = "sts:AssumeRole"
      }
    ]
  })

  tags = {
    Name        = "hexacode-${var.environment}-backup-service-role"
    Environment = var.environment
  }
}

resource "aws_iam_role_policy_attachment" "backup_service_policy" {
  role       = aws_iam_role.backup_service.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSBackupServiceRolePolicyForBackup"
}

resource "aws_backup_plan" "daily" {
  name = var.backup_plan_name

  rule {
    rule_name         = "${var.environment}-daily"
    target_vault_name = aws_backup_vault.main.name
    schedule          = var.daily_backup_schedule

    lifecycle {
      delete_after = var.backup_retention_days
    }
  }

  tags = {
    Name        = var.backup_plan_name
    Environment = var.environment
  }
}

locals {
  backup_resource_arns = compact(concat([var.rds_instance_arn], var.efs_file_system_arns))
}

resource "aws_backup_selection" "protected_resources" {
  iam_role_arn = aws_iam_role.backup_service.arn
  name         = var.backup_selection_name
  plan_id      = aws_backup_plan.daily.id
  resources    = local.backup_resource_arns
}
