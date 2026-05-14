# RDS Module Outputs

output "db_endpoint" {
  description = "Connection endpoint for the RDS instance"
  value       = aws_db_instance.main.endpoint
}

output "db_address" {
  description = "Address of the RDS instance"
  value       = aws_db_instance.main.address
}

output "db_master_user_secret_arn" {
  description = "ARN of the managed master user secret"
  value       = aws_db_instance.main.master_user_secret[0].secret_arn
}

output "db_instance_identifier" {
  description = "Identifier of the RDS instance"
  value       = aws_db_instance.main.identifier
}

output "db_instance_arn" {
  description = "ARN of the RDS instance"
  value       = aws_db_instance.main.arn
}
