locals {
  name_prefix = "hexacode-${var.environment}"
}

# ============================================================================
# Security Groups (base definitions only - rules in dedicated rule resources)
# ============================================================================

# sg_apigw_vpclink - attached to VPC Link / API Gateway
resource "aws_security_group" "apigw_vpclink" {
  name        = "${local.name_prefix}-sg-apigw-vpclink"
  description = "Security group for API Gateway VPC Link"
  vpc_id      = var.vpc_id

  tags = {
    Name = "${local.name_prefix}-sg-apigw-vpclink"
  }
}

# sg_internal_alb - attached to the internal ALB
resource "aws_security_group" "internal_alb" {
  name        = "${local.name_prefix}-sg-internal-alb"
  description = "Security group for internal Application Load Balancer"
  vpc_id      = var.vpc_id

  tags = {
    Name = "${local.name_prefix}-sg-internal-alb"
  }
}

# sg_api_services - attached to ECS services (identity, problem, submission)
resource "aws_security_group" "api_services" {
  name        = "${local.name_prefix}-sg-api-services"
  description = "Security group for API services (identity, problem, submission)"
  vpc_id      = var.vpc_id

  tags = {
    Name = "${local.name_prefix}-sg-api-services"
  }
}

# sg_worker - attached to the judge worker ECS service
resource "aws_security_group" "worker" {
  name        = "${local.name_prefix}-sg-worker"
  description = "Security group for judge worker"
  vpc_id      = var.vpc_id

  tags = {
    Name = "${local.name_prefix}-sg-worker"
  }
}

# sg_rds - attached to RDS PostgreSQL
resource "aws_security_group" "rds" {
  name        = "${local.name_prefix}-sg-rds"
  description = "Security group for RDS PostgreSQL"
  vpc_id      = var.vpc_id

  tags = {
    Name = "${local.name_prefix}-sg-rds"
  }
}

# sg_rds_proxy - attached to RDS Proxy
resource "aws_security_group" "rds_proxy" {
  name        = "${local.name_prefix}-sg-rds-proxy"
  description = "Security group for RDS Proxy"
  vpc_id      = var.vpc_id

  tags = {
    Name = "${local.name_prefix}-sg-rds-proxy"
  }
}

# sg_client_vpn - attached to AWS Client VPN network interfaces
resource "aws_security_group" "client_vpn" {
  count       = var.client_vpn_enabled ? 1 : 0
  name        = "${local.name_prefix}-sg-client-vpn"
  description = "Security group for AWS Client VPN"
  vpc_id      = var.vpc_id

  tags = {
    Name = "${local.name_prefix}-sg-client-vpn"
  }
}

# sg_redis - attached to ElastiCache Redis
resource "aws_security_group" "redis" {
  name        = "${local.name_prefix}-sg-redis"
  description = "Security group for ElastiCache Redis"
  vpc_id      = var.vpc_id

  tags = {
    Name = "${local.name_prefix}-sg-redis"
  }
}

# ============================================================================
# Ingress Rules
# ============================================================================

# sg_internal_alb: HTTP from API Gateway VPC Link
resource "aws_vpc_security_group_ingress_rule" "internal_alb_from_apigw" {
  security_group_id            = aws_security_group.internal_alb.id
  referenced_security_group_id = aws_security_group.apigw_vpclink.id
  from_port                    = 80
  to_port                      = 80
  ip_protocol                  = "tcp"
  description                  = "HTTP from API Gateway VPC Link"
}

# sg_internal_alb: HTTP from API services
resource "aws_vpc_security_group_ingress_rule" "internal_alb_from_api_services" {
  security_group_id            = aws_security_group.internal_alb.id
  referenced_security_group_id = aws_security_group.api_services.id
  from_port                    = 80
  to_port                      = 80
  ip_protocol                  = "tcp"
  description                  = "HTTP from API services"
}

# sg_internal_alb: HTTP from worker
resource "aws_vpc_security_group_ingress_rule" "internal_alb_from_worker" {
  security_group_id            = aws_security_group.internal_alb.id
  referenced_security_group_id = aws_security_group.worker.id
  from_port                    = 80
  to_port                      = 80
  ip_protocol                  = "tcp"
  description                  = "HTTP from worker"
}

# sg_api_services: HTTP from internal ALB
resource "aws_vpc_security_group_ingress_rule" "api_services_from_internal_alb" {
  security_group_id            = aws_security_group.api_services.id
  referenced_security_group_id = aws_security_group.internal_alb.id
  from_port                    = 8000
  to_port                      = 8000
  ip_protocol                  = "tcp"
  description                  = "HTTP from internal ALB"
}

# sg_rds: PostgreSQL from RDS proxy
resource "aws_vpc_security_group_ingress_rule" "rds_from_proxy" {
  security_group_id            = aws_security_group.rds.id
  referenced_security_group_id = aws_security_group.rds_proxy.id
  from_port                    = 5432
  to_port                      = 5432
  ip_protocol                  = "tcp"
  description                  = "PostgreSQL from RDS proxy"
}

# sg_rds_proxy: PostgreSQL from API services
resource "aws_vpc_security_group_ingress_rule" "rds_proxy_from_api_services" {
  security_group_id            = aws_security_group.rds_proxy.id
  referenced_security_group_id = aws_security_group.api_services.id
  from_port                    = 5432
  to_port                      = 5432
  ip_protocol                  = "tcp"
  description                  = "PostgreSQL from API services"
}

# sg_redis: Redis from API services
resource "aws_vpc_security_group_ingress_rule" "redis_from_api_services" {
  security_group_id            = aws_security_group.redis.id
  referenced_security_group_id = aws_security_group.api_services.id
  from_port                    = 6379
  to_port                      = 6379
  ip_protocol                  = "tcp"
  description                  = "Redis from API services"
}

# sg_rds_proxy: PostgreSQL from Client VPN
resource "aws_vpc_security_group_ingress_rule" "rds_proxy_from_client_vpn" {
  count                        = var.client_vpn_enabled ? 1 : 0
  security_group_id            = aws_security_group.rds_proxy.id
  referenced_security_group_id = aws_security_group.client_vpn[0].id
  from_port                    = 5432
  to_port                      = 5432
  ip_protocol                  = "tcp"
  description                  = "PostgreSQL from Client VPN to RDS Proxy"
}

# ============================================================================
# Egress Rules
# ============================================================================

# sg_apigw_vpclink: HTTP to internal ALB
resource "aws_vpc_security_group_egress_rule" "apigw_vpclink_to_internal_alb" {
  security_group_id            = aws_security_group.apigw_vpclink.id
  referenced_security_group_id = aws_security_group.internal_alb.id
  from_port                    = 80
  to_port                      = 80
  ip_protocol                  = "tcp"
  description                  = "HTTP to internal ALB"
}

# sg_internal_alb: HTTP to API services
resource "aws_vpc_security_group_egress_rule" "internal_alb_to_api_services" {
  security_group_id            = aws_security_group.internal_alb.id
  referenced_security_group_id = aws_security_group.api_services.id
  from_port                    = 8000
  to_port                      = 8000
  ip_protocol                  = "tcp"
  description                  = "HTTP to API services"
}

# sg_api_services: PostgreSQL to RDS proxy
resource "aws_vpc_security_group_egress_rule" "api_services_to_rds_proxy" {
  security_group_id            = aws_security_group.api_services.id
  referenced_security_group_id = aws_security_group.rds_proxy.id
  from_port                    = 5432
  to_port                      = 5432
  ip_protocol                  = "tcp"
  description                  = "PostgreSQL to RDS proxy"
}

# sg_rds_proxy: PostgreSQL to RDS
resource "aws_vpc_security_group_egress_rule" "rds_proxy_to_rds" {
  security_group_id            = aws_security_group.rds_proxy.id
  referenced_security_group_id = aws_security_group.rds.id
  from_port                    = 5432
  to_port                      = 5432
  ip_protocol                  = "tcp"
  description                  = "PostgreSQL to RDS"
}

# sg_api_services: Redis to ElastiCache
resource "aws_vpc_security_group_egress_rule" "api_services_to_redis" {
  security_group_id            = aws_security_group.api_services.id
  referenced_security_group_id = aws_security_group.redis.id
  from_port                    = 6379
  to_port                      = 6379
  ip_protocol                  = "tcp"
  description                  = "Redis to ElastiCache"
}

# sg_api_services: HTTP to internal ALB
resource "aws_vpc_security_group_egress_rule" "api_services_to_internal_alb" {
  security_group_id            = aws_security_group.api_services.id
  referenced_security_group_id = aws_security_group.internal_alb.id
  from_port                    = 80
  to_port                      = 80
  ip_protocol                  = "tcp"
  description                  = "HTTP to internal ALB"
}

# sg_api_services: HTTPS to internet
resource "aws_vpc_security_group_egress_rule" "api_services_to_internet" {
  security_group_id = aws_security_group.api_services.id
  cidr_ipv4         = "0.0.0.0/0"
  from_port         = 443
  to_port           = 443
  ip_protocol       = "tcp"
  description       = "HTTPS to internet"
}

# sg_worker: HTTP to internal ALB
resource "aws_vpc_security_group_egress_rule" "worker_to_internal_alb" {
  security_group_id            = aws_security_group.worker.id
  referenced_security_group_id = aws_security_group.internal_alb.id
  from_port                    = 80
  to_port                      = 80
  ip_protocol                  = "tcp"
  description                  = "HTTP to internal ALB"
}

# sg_worker: HTTPS to internet
resource "aws_vpc_security_group_egress_rule" "worker_to_internet" {
  security_group_id = aws_security_group.worker.id
  cidr_ipv4         = "0.0.0.0/0"
  from_port         = 443
  to_port           = 443
  ip_protocol       = "tcp"
  description       = "HTTPS to internet"
}

# sg_client_vpn: PostgreSQL to RDS Proxy
resource "aws_vpc_security_group_egress_rule" "client_vpn_to_rds_proxy" {
  count                        = var.client_vpn_enabled ? 1 : 0
  security_group_id            = aws_security_group.client_vpn[0].id
  referenced_security_group_id = aws_security_group.rds_proxy.id
  from_port                    = 5432
  to_port                      = 5432
  ip_protocol                  = "tcp"
  description                  = "PostgreSQL to RDS Proxy"
}

# sg_rds: Restricted egress to VPC CIDR
resource "aws_vpc_security_group_egress_rule" "rds_restricted" {
  security_group_id = aws_security_group.rds.id
  cidr_ipv4         = var.vpc_cidr
  ip_protocol       = "-1"
  description       = "Restricted egress to VPC CIDR"
}

# sg_redis: Restricted egress to VPC CIDR
resource "aws_vpc_security_group_egress_rule" "redis_restricted" {
  security_group_id = aws_security_group.redis.id
  cidr_ipv4         = var.vpc_cidr
  ip_protocol       = "-1"
  description       = "Restricted egress to VPC CIDR"
}