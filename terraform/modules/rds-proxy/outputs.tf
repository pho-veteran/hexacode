output "proxy_endpoint" {
  description = "Endpoint for the RDS proxy"
  value       = aws_db_proxy.main.endpoint
}

output "proxy_arn" {
  description = "ARN of the RDS proxy"
  value       = aws_db_proxy.main.arn
}

output "proxy_name" {
  description = "Name of the RDS proxy"
  value       = aws_db_proxy.main.name
}
