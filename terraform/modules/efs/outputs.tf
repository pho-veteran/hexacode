output "file_system_id" {
  description = "EFS file system ID for submission artifacts."
  value       = aws_efs_file_system.submission_artifacts.id
}

output "file_system_arn" {
  description = "EFS file system ARN for AWS Backup selection."
  value       = aws_efs_file_system.submission_artifacts.arn
}

output "access_point_id" {
  description = "EFS access point ID for ECS task mounts."
  value       = aws_efs_access_point.submission_artifacts.id
}

output "access_point_arn" {
  description = "EFS access point ARN for submission artifacts."
  value       = aws_efs_access_point.submission_artifacts.arn
}

output "mount_target_ids" {
  description = "EFS mount target IDs."
  value       = [for target in aws_efs_mount_target.submission_artifacts : target.id]
}
