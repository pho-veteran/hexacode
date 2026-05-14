# RDS Module - Hexacode PostgreSQL Database
# Creates PostgreSQL 16 instance in private data subnets

resource "aws_db_subnet_group" "main" {
  name       = "hexacode-${var.environment}-db-subnet-group"
  subnet_ids = var.private_data_subnet_ids

  tags = {
    Name        = "hexacode-${var.environment}-db-subnet-group"
    Environment = var.environment
  }
}

locals {
  final_snapshot_required   = var.environment == "prod" || !var.skip_final_snapshot
  final_snapshot_identifier = local.final_snapshot_required ? trimspace(var.final_snapshot_identifier) : null
}

resource "aws_db_instance" "main" {
  identifier        = "hexacode-${var.environment}-db"
  engine            = "postgres"
  engine_version    = "16"
  db_name           = "hexacode"
  instance_class    = var.db_instance_class
  storage_type      = "gp3"
  allocated_storage = var.db_allocated_storage
  storage_encrypted = true

  username                    = "hexacode"
  manage_master_user_password = true

  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [var.rds_security_group_id]

  multi_az                              = var.db_multi_az
  performance_insights_enabled          = true
  performance_insights_retention_period = 7

  backup_retention_period = var.environment == "prod" ? 14 : 7
  backup_window           = "03:00-04:00"
  maintenance_window      = "mon:04:00-mon:05:00"

  skip_final_snapshot       = var.environment == "prod" ? false : var.skip_final_snapshot
  deletion_protection       = var.environment == "prod" ? true : var.deletion_protection
  final_snapshot_identifier = local.final_snapshot_required ? local.final_snapshot_identifier : null

  tags = {
    Name        = "hexacode-${var.environment}-db"
    Environment = var.environment
  }

  lifecycle {
    precondition {
      condition     = !local.final_snapshot_required || trimspace(var.final_snapshot_identifier) != ""
      error_message = "final_snapshot_identifier must be set to a unique value when final snapshots are required."
    }
  }
}