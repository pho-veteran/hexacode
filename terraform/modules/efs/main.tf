resource "aws_efs_file_system" "submission_artifacts" {
  creation_token         = "hexacode-${var.environment}-submission-artifacts"
  encrypted              = true
  throughput_mode        = "elastic"
  performance_mode       = "generalPurpose"
  availability_zone_name = null

  lifecycle_policy {
    transition_to_ia = "AFTER_30_DAYS"
  }

  protection {
    replication_overwrite = "ENABLED"
  }

  tags = {
    Name        = "hexacode-${var.environment}-submission-artifacts"
    Environment = var.environment
    DataRole    = "submission-artifacts-source-of-truth"
  }
}

resource "aws_efs_backup_policy" "submission_artifacts" {
  file_system_id = aws_efs_file_system.submission_artifacts.id

  backup_policy {
    status = "ENABLED"
  }
}

resource "aws_efs_mount_target" "submission_artifacts" {
  count = length(var.private_data_subnet_ids)

  file_system_id  = aws_efs_file_system.submission_artifacts.id
  subnet_id       = var.private_data_subnet_ids[count.index]
  security_groups = [var.security_group_id]
}

resource "aws_efs_access_point" "submission_artifacts" {
  file_system_id = aws_efs_file_system.submission_artifacts.id

  posix_user {
    gid = 1000
    uid = 1000
  }

  root_directory {
    path = "/submission-artifacts"

    creation_info {
      owner_gid   = 1000
      owner_uid   = 1000
      permissions = "0750"
    }
  }

  tags = {
    Name        = "hexacode-${var.environment}-submission-artifacts-ap"
    Environment = var.environment
  }
}
