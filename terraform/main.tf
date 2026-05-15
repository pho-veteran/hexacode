provider "aws" {
  region = var.region

  default_tags {
    tags = {
      Project     = "hexacode"
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}

provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"

  default_tags {
    tags = {
      Project     = "hexacode"
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}

module "vpc" {
  source                   = "./modules/vpc"
  environment              = var.environment
  region                   = var.region
  vpc_cidr                 = var.cidr_block
  availability_zones       = var.availability_zones
  network_firewall_enabled = true
}

module "security_groups" {
  source             = "./modules/security-groups"
  environment        = var.environment
  vpc_id             = module.vpc.vpc_id
  vpc_cidr           = var.cidr_block
  client_vpn_enabled = var.client_vpn_enabled
}

module "client_vpn" {
  source                     = "./modules/client-vpn"
  enabled                    = var.client_vpn_enabled
  environment                = var.environment
  vpc_id                     = module.vpc.vpc_id
  private_app_subnet_ids     = module.vpc.private_app_subnet_ids
  client_cidr_block          = var.client_vpn_cidr_block
  server_certificate_arn     = var.client_vpn_server_certificate_arn
  root_certificate_chain_arn = var.client_vpn_root_certificate_chain_arn
  security_group_id          = module.security_groups.sg_client_vpn_id
  target_network_cidr        = var.cidr_block
}

module "s3_buckets" {
  source      = "./modules/s3-buckets"
  environment = var.environment
}

module "efs" {
  source                  = "./modules/efs"
  environment             = var.environment
  private_data_subnet_ids = module.vpc.private_data_subnet_ids
  security_group_id       = module.security_groups.sg_efs_id
}

module "sqs" {
  source      = "./modules/sqs"
  environment = var.environment
}

module "ecr" {
  source          = "./modules/ecr"
  environment     = var.environment
  repository_name = var.ecr_repository_name
}

module "rds" {
  source                    = "./modules/rds"
  environment               = var.environment
  db_instance_class         = var.db_instance_class
  db_allocated_storage      = var.db_allocated_storage
  db_multi_az               = var.db_multi_az
  private_data_subnet_ids   = module.vpc.private_data_subnet_ids
  rds_security_group_id     = module.security_groups.sg_rds_id
  deletion_protection       = var.rds_deletion_protection
  skip_final_snapshot       = var.rds_skip_final_snapshot
  final_snapshot_identifier = var.rds_final_snapshot_identifier
}

module "backup" {
  source                = "./modules/backup"
  environment           = var.environment
  backup_vault_name     = "hexacode-${var.environment}-backup-vault"
  backup_plan_name      = "hexacode-${var.environment}-daily-backups"
  backup_selection_name = "hexacode-${var.environment}-protected-resources"
  rds_instance_arn      = module.rds.db_instance_arn
  efs_file_system_arns  = concat([module.efs.file_system_arn], var.backup_efs_file_system_arns)
}

module "rds_proxy" {
  source                    = "./modules/rds-proxy"
  environment               = var.environment
  private_data_subnet_ids   = module.vpc.private_data_subnet_ids
  sg_rds_proxy_id           = module.security_groups.sg_rds_proxy_id
  db_instance_identifier    = module.rds.db_instance_identifier
  db_master_user_secret_arn = module.rds.db_master_user_secret_arn
}

module "elasticache" {
  source                  = "./modules/elasticache"
  environment             = var.environment
  private_data_subnet_ids = module.vpc.private_data_subnet_ids
  redis_security_group_id = module.security_groups.sg_redis_id
}

module "management_vpc" {
  count  = var.management_vpc_enabled ? 1 : 0
  source = "./modules/management-vpc"

  environment                      = var.environment
  region                           = var.region
  availability_zones               = var.availability_zones
  management_vpc_cidr_block        = var.management_vpc_cidr_block
  app_vpc_id                       = module.vpc.vpc_id
  app_vpc_cidr_block               = var.cidr_block
  app_private_app_route_table_ids  = module.vpc.private_app_route_table_ids
  app_private_data_route_table_ids = module.vpc.private_data_route_table_ids
  application_secret_arn           = local.effective_application_secret_arn
  problem_bucket_arn               = module.s3_buckets.problem_bucket_arn
  submission_bucket_arn            = module.s3_buckets.submission_bucket_arn
  kms_key_arn                      = var.kms_key_arn
}

resource "aws_vpc_security_group_ingress_rule" "rds_proxy_from_management_bastion" {
  count = var.management_vpc_enabled ? 1 : 0

  security_group_id            = module.security_groups.sg_rds_proxy_id
  referenced_security_group_id = module.management_vpc[0].bastion_security_group_id
  from_port                    = 5432
  to_port                      = 5432
  ip_protocol                  = "tcp"
  description                  = "PostgreSQL from SSM management host"
}

resource "aws_vpc_security_group_ingress_rule" "internal_alb_from_management_bastion" {
  count = var.management_vpc_enabled ? 1 : 0

  security_group_id            = module.security_groups.sg_internal_alb_id
  referenced_security_group_id = module.management_vpc[0].bastion_security_group_id
  from_port                    = 80
  to_port                      = 80
  ip_protocol                  = "tcp"
  description                  = "HTTP smoke checks from SSM management host"
}

resource "aws_vpc_security_group_ingress_rule" "efs_from_management_bastion" {
  count = var.management_vpc_enabled ? 1 : 0

  security_group_id            = module.security_groups.sg_efs_id
  referenced_security_group_id = module.management_vpc[0].bastion_security_group_id
  from_port                    = 2049
  to_port                      = 2049
  ip_protocol                  = "tcp"
  description                  = "NFS inspection from SSM management host"
}

module "iam" {
  source                 = "./modules/iam"
  environment            = var.environment
  application_secret_arn = local.effective_application_secret_arn
  problem_bucket_arn     = module.s3_buckets.problem_bucket_arn
  submission_bucket_arn  = module.s3_buckets.submission_bucket_arn
  judge_queue_arn        = module.sqs.judge_queue_arn
  efs_file_system_arn    = module.efs.file_system_arn
  efs_access_point_arn   = module.efs.access_point_arn
  kms_key_arn            = var.kms_key_arn
}

module "ecs_cluster" {
  source      = "./modules/ecs-cluster"
  environment = var.environment
}

module "alb" {
  source                 = "./modules/alb"
  environment            = var.environment
  vpc_id                 = module.vpc.vpc_id
  private_app_subnet_ids = module.vpc.private_app_subnet_ids
  sg_internal_alb_id     = module.security_groups.sg_internal_alb_id
}

module "cognito" {
  source          = "./modules/cognito"
  environment     = var.environment
  region          = var.region
  frontend_domain = var.frontend_domain
}

module "cors_lambda" {
  source          = "./modules/cors-lambda"
  environment     = var.environment
  frontend_domain = var.frontend_domain
}

module "bedrock_chat" {
  source                      = "./modules/bedrock-chat"
  environment                 = var.environment
  region                      = var.region
  frontend_domain             = var.frontend_domain
  knowledge_source_bucket_arn = module.s3_buckets.problem_bucket_arn
  knowledge_source_bucket_id  = module.s3_buckets.problem_bucket_id
}

module "waf" {
  source      = "./modules/waf"
  environment = var.environment

  providers = {
    aws.us_east_1 = aws.us_east_1
  }
}

resource "aws_wafv2_web_acl_association" "internal_alb" {
  resource_arn = module.alb.internal_alb_arn
  web_acl_arn  = module.waf.regional_web_acl_arn
}

module "api_gateway" {
  source                         = "./modules/api-gateway"
  environment                    = var.environment
  frontend_domain                = var.frontend_domain
  private_app_subnet_ids         = module.vpc.private_app_subnet_ids
  sg_apigw_vpclink_id            = module.security_groups.sg_apigw_vpclink_id
  internal_alb_listener_arn      = module.alb.internal_alb_listener_arn
  chat_lambda_arn                = module.bedrock_chat.chat_lambda_arn
  chat_lambda_enabled            = true
  chat_lambda_permission_managed = true
  cognito_issuer                 = module.cognito.issuer
  cognito_client_id              = module.cognito.app_client_id
  cors_lambda_arn                = module.cors_lambda.cors_lambda_arn
}

module "network_firewall" {
  source                  = "./modules/network-firewall"
  environment             = var.environment
  vpc_id                  = module.vpc.vpc_id
  firewall_subnet_ids     = module.vpc.firewall_subnet_ids
  availability_zone_names = module.vpc.availability_zone_names
  blocked_domains         = var.network_firewall_blocked_domains
}

resource "aws_route" "private_app_to_firewall" {
  for_each = module.network_firewall.endpoint_ids_by_az

  route_table_id         = module.vpc.private_app_route_table_ids[index(module.vpc.availability_zone_names, each.key)]
  destination_cidr_block = "0.0.0.0/0"
  vpc_endpoint_id        = each.value
}

resource "aws_route" "private_data_to_firewall" {
  for_each = module.network_firewall.endpoint_ids_by_az

  route_table_id         = module.vpc.private_data_route_table_ids[index(module.vpc.availability_zone_names, each.key)]
  destination_cidr_block = "0.0.0.0/0"
  vpc_endpoint_id        = each.value
}

module "cloudfront" {
  source               = "./modules/cloudfront"
  environment          = var.environment
  region               = var.region
  frontend_bucket_name = module.s3_buckets.frontend_bucket_name
  frontend_bucket_arn  = module.s3_buckets.frontend_bucket_arn
  web_acl_id           = module.waf.cloudfront_web_acl_arn
}

module "ecs_services" {
  source                    = "./modules/ecs-services"
  environment               = var.environment
  region                    = var.region
  ecs_cluster_name          = module.ecs_cluster.cluster_name
  ecs_execution_role_arn    = module.iam.ecs_execution_role_arn
  identity_task_role_arn    = module.iam.identity_task_role_arn
  problem_task_role_arn     = module.iam.problem_task_role_arn
  submission_task_role_arn  = module.iam.submission_task_role_arn
  worker_task_role_arn      = module.iam.worker_task_role_arn
  tg_identity_arn           = module.alb.tg_identity_arn
  tg_problem_arn            = module.alb.tg_problem_arn
  tg_submission_arn         = module.alb.tg_submission_arn
  private_app_subnet_ids    = module.vpc.private_app_subnet_ids
  sg_api_services_id        = module.security_groups.sg_api_services_id
  sg_submission_service_id  = module.security_groups.sg_submission_service_id
  sg_worker_id              = module.security_groups.sg_worker_id
  application_secret_arn    = local.effective_application_secret_arn
  ecr_repository_url        = module.ecr.repository_url
  image_tag                 = var.image_tag
  cognito_user_pool_id      = module.cognito.user_pool_id
  cognito_app_client_id     = module.cognito.app_client_id
  cognito_issuer            = module.cognito.issuer
  cognito_jwks_url          = module.cognito.jwks_url
  problem_bucket_name       = module.s3_buckets.problem_bucket_name
  submission_bucket_name    = module.s3_buckets.submission_bucket_name
  efs_file_system_id        = module.efs.file_system_id
  efs_access_point_id       = module.efs.access_point_id
  judge_queue_url           = module.sqs.judge_queue_url
  internal_alb_dns_name     = module.alb.internal_alb_dns_name
  internal_service_base_url = "http://${module.alb.internal_alb_dns_name}"
}