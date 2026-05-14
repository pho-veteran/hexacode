output "sg_apigw_vpclink_id" {
  description = "Security group ID for API Gateway VPC Link"
  value       = aws_security_group.apigw_vpclink.id
}

output "sg_internal_alb_id" {
  description = "Security group ID for internal Application Load Balancer"
  value       = aws_security_group.internal_alb.id
}

output "sg_api_services_id" {
  description = "Security group ID for identity and problem API services"
  value       = aws_security_group.api_services.id
}

output "sg_submission_service_id" {
  description = "Security group ID for submission API service"
  value       = aws_security_group.submission_service.id
}

output "sg_worker_id" {
  description = "Security group ID for judge worker"
  value       = aws_security_group.worker.id
}

output "sg_rds_id" {
  description = "Security group ID for RDS PostgreSQL"
  value       = aws_security_group.rds.id
}

output "sg_rds_proxy_id" {
  description = "Security group ID for RDS Proxy"
  value       = aws_security_group.rds_proxy.id
}

output "sg_redis_id" {
  description = "Security group ID for ElastiCache Redis"
  value       = aws_security_group.redis.id
}

output "sg_client_vpn_id" {
  description = "Security group ID for Client VPN"
  value       = try(aws_security_group.client_vpn[0].id, null)
}

output "sg_efs_id" {
  description = "Security group ID for EFS submission artifacts"
  value       = aws_security_group.efs.id
}
