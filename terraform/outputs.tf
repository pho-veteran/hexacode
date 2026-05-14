output "region" {
  description = "AWS region"
  value       = var.region
}

output "environment" {
  description = "Environment name"
  value       = var.environment
}

# VPC Outputs
output "vpc_id" {
  description = "VPC ID"
  value       = module.vpc.vpc_id
}

output "public_subnet_ids" {
  description = "IDs of public subnets"
  value       = module.vpc.public_subnet_ids
}

output "private_app_subnet_ids" {
  description = "IDs of private app subnets"
  value       = module.vpc.private_app_subnet_ids
}

output "private_data_subnet_ids" {
  description = "IDs of private data subnets"
  value       = module.vpc.private_data_subnet_ids
}

output "vpc_endpoint_security_group_id" {
  description = "Security group ID for VPC interface endpoints"
  value       = module.vpc.vpc_endpoint_security_group_id
}

# Security Group Outputs
output "sg_apigw_vpclink_id" {
  description = "Security group ID for API Gateway VPC Link"
  value       = module.security_groups.sg_apigw_vpclink_id
}

output "sg_internal_alb_id" {
  description = "Security group ID for internal Application Load Balancer"
  value       = module.security_groups.sg_internal_alb_id
}

output "sg_api_services_id" {
  description = "Security group ID for API services"
  value       = module.security_groups.sg_api_services_id
}

output "sg_worker_id" {
  description = "Security group ID for judge worker"
  value       = module.security_groups.sg_worker_id
}

output "sg_rds_id" {
  description = "Security group ID for RDS PostgreSQL"
  value       = module.security_groups.sg_rds_id
}

output "sg_redis_id" {
  description = "Security group ID for ElastiCache Redis"
  value       = module.security_groups.sg_redis_id
}

# S3 Bucket Outputs
output "frontend_bucket_name" {
  description = "Name of the frontend S3 bucket"
  value       = module.s3_buckets.frontend_bucket_name
}

output "frontend_bucket_arn" {
  description = "ARN of the frontend S3 bucket"
  value       = module.s3_buckets.frontend_bucket_arn
}

output "problem_bucket_name" {
  description = "Name of the problem assets S3 bucket"
  value       = module.s3_buckets.problem_bucket_name
}

output "problem_bucket_arn" {
  description = "ARN of the problem assets S3 bucket"
  value       = module.s3_buckets.problem_bucket_arn
}

output "submission_bucket_name" {
  description = "Name of the submission artifacts S3 bucket"
  value       = module.s3_buckets.submission_bucket_name
}

output "submission_bucket_arn" {
  description = "ARN of the submission artifacts S3 bucket"
  value       = module.s3_buckets.submission_bucket_arn
}

# SQS Outputs
output "judge_queue_url" {
  description = "URL of the judge jobs SQS queue"
  value       = module.sqs.judge_queue_url
}

output "judge_queue_arn" {
  description = "ARN of the judge jobs SQS queue"
  value       = module.sqs.judge_queue_arn
}

output "judge_dlq_url" {
  description = "URL of the judge jobs dead-letter queue"
  value       = module.sqs.judge_dlq_url
}

output "judge_dlq_arn" {
  description = "ARN of the judge jobs dead-letter queue"
  value       = module.sqs.judge_dlq_arn
}

# ECR Outputs
output "ecr_repository_name" {
  description = "ECR repository name"
  value       = module.ecr.repository_name
}

output "ecr_repository_url" {
  description = "ECR repository URL"
  value       = module.ecr.repository_url
}

output "ecr_repository_arn" {
  description = "ECR repository ARN"
  value       = module.ecr.repository_arn
}

# Client VPN Outputs
output "client_vpn_endpoint_id" {
  description = "Client VPN endpoint ID"
  value       = module.client_vpn.endpoint_id
}

output "client_vpn_dns_name" {
  description = "Client VPN DNS name"
  value       = module.client_vpn.dns_name
}

# RDS Outputs
output "db_endpoint" {
  description = "Connection endpoint for the RDS instance"
  value       = module.rds.db_endpoint
}

output "db_address" {
  description = "Address of the RDS instance"
  value       = module.rds.db_address
}

output "db_master_user_secret_arn" {
  description = "ARN of the managed master user secret"
  value       = module.rds.db_master_user_secret_arn
}

output "db_proxy_endpoint" {
  description = "Endpoint for the RDS proxy"
  value       = module.rds_proxy.proxy_endpoint
}

output "db_proxy_arn" {
  description = "ARN of the RDS proxy"
  value       = module.rds_proxy.proxy_arn
}

# ElastiCache Outputs
output "redis_primary_endpoint" {
  description = "Primary endpoint for the Redis replication group"
  value       = module.elasticache.redis_primary_endpoint
}

output "redis_reader_endpoint" {
  description = "Reader endpoint for the Redis replication group"
  value       = module.elasticache.redis_reader_endpoint
}

output "redis_port" {
  description = "Port for the Redis replication group"
  value       = module.elasticache.redis_port
}

# ECS Cluster Outputs
output "ecs_cluster_name" {
  description = "Name of the ECS cluster"
  value       = module.ecs_cluster.cluster_name
}

output "ecs_cluster_arn" {
  description = "ARN of the ECS cluster"
  value       = module.ecs_cluster.cluster_arn
}

output "problem_task_definition_arn" {
  description = "Problem service task definition ARN for one-off seed tasks"
  value       = module.ecs_services.problem_task_definition_arn
}

output "identity_task_definition_arn" {
  description = "Identity service task definition ARN for one-off admin tasks"
  value       = module.ecs_services.identity_task_definition_arn
}

# IAM Outputs
output "ecs_execution_role_arn" {
  description = "ARN of the ECS execution role"
  value       = module.iam.ecs_execution_role_arn
}

output "identity_task_role_arn" {
  description = "ARN of the identity service task role"
  value       = module.iam.identity_task_role_arn
}

output "problem_task_role_arn" {
  description = "ARN of the problem service task role"
  value       = module.iam.problem_task_role_arn
}

output "submission_task_role_arn" {
  description = "ARN of the submission service task role"
  value       = module.iam.submission_task_role_arn
}

output "worker_task_role_arn" {
  description = "ARN of the worker task role"
  value       = module.iam.worker_task_role_arn
}

# ALB Outputs
output "internal_alb_dns_name" {
  description = "DNS name of the internal ALB"
  value       = module.alb.internal_alb_dns_name
}

output "internal_alb_arn" {
  description = "ARN of the internal ALB"
  value       = module.alb.internal_alb_arn
}

output "internal_alb_listener_arn" {
  description = "ARN of the HTTP listener"
  value       = module.alb.internal_alb_listener_arn
}

output "tg_identity_arn" {
  description = "ARN of the identity service target group"
  value       = module.alb.tg_identity_arn
}

output "tg_problem_arn" {
  description = "ARN of the problem service target group"
  value       = module.alb.tg_problem_arn
}

output "tg_submission_arn" {
  description = "ARN of the submission service target group"
  value       = module.alb.tg_submission_arn
}

# Cognito Outputs
output "cognito_user_pool_id" {
  description = "ID of the Cognito user pool"
  value       = module.cognito.user_pool_id
}

output "cognito_app_client_id" {
  description = "ID of the Cognito app client"
  value       = module.cognito.app_client_id
}

output "cognito_issuer" {
  description = "OIDC issuer URL"
  value       = module.cognito.issuer
}

output "cognito_jwks_url" {
  description = "URL for the JWKS endpoint"
  value       = module.cognito.jwks_url
}

# CORS Lambda Outputs
output "cors_lambda_arn" {
  description = "ARN of the CORS preflight Lambda function"
  value       = module.cors_lambda.cors_lambda_arn
}

# Bedrock Chat Outputs
output "chat_lambda_arn" {
  description = "ARN of the Bedrock-backed chat Lambda function"
  value       = module.bedrock_chat.chat_lambda_arn
}

output "bedrock_agent_id" {
  description = "ID of the Hexacode Bedrock agent"
  value       = module.bedrock_chat.bedrock_agent_id
}

output "bedrock_agent_alias_id" {
  description = "Alias ID for the live Hexacode Bedrock agent"
  value       = module.bedrock_chat.bedrock_agent_alias_id
}

output "bedrock_knowledge_base_id" {
  description = "ID of the Hexacode Bedrock knowledge base"
  value       = module.bedrock_chat.bedrock_knowledge_base_id
}

output "bedrock_data_source_id" {
  description = "ID of the S3 data source for the Hexacode Bedrock knowledge base"
  value       = module.bedrock_chat.bedrock_data_source_id
}

# API Gateway Outputs
output "api_gateway_url" {
  description = "Endpoint URL of the HTTP API"
  value       = module.api_gateway.http_api_endpoint
}

output "api_gateway_id" {
  description = "ID of the HTTP API"
  value       = module.api_gateway.http_api_id
}

output "vpc_link_id" {
  description = "ID of the VPC Link"
  value       = module.api_gateway.vpc_link_id
}

# CloudFront Outputs
output "cloudfront_domain" {
  description = "Domain name of the CloudFront distribution"
  value       = module.cloudfront.distribution_domain_name
}

output "cloudfront_distribution_id" {
  description = "ID of the CloudFront distribution"
  value       = module.cloudfront.distribution_id
}

# ECS Services Outputs
output "identity_service_name" {
  description = "Name of the identity service"
  value       = module.ecs_services.identity_service_name
}

output "problem_service_name" {
  description = "Name of the problem service"
  value       = module.ecs_services.problem_service_name
}

output "submission_service_name" {
  description = "Name of the submission service"
  value       = module.ecs_services.submission_service_name
}

output "worker_service_name" {
  description = "Name of the worker service"
  value       = module.ecs_services.worker_service_name
}