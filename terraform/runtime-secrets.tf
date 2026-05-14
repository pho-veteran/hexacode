resource "aws_secretsmanager_secret" "application" {
  count       = var.application_secret_arn == "" ? 1 : 0
  name        = "hexacode-${var.environment}-app"
  description = "Runtime application secret for Hexacode ${var.environment} services"
  kms_key_id  = var.kms_key_arn != "" ? var.kms_key_arn : null
}

data "aws_secretsmanager_secret_version" "application_existing" {
  count     = var.application_secret_arn != "" ? 1 : 0
  secret_id = var.application_secret_arn
}

data "aws_secretsmanager_secret_version" "rds_master" {
  secret_id = module.rds.db_master_user_secret_arn
}

locals {
  existing_application_secret      = var.application_secret_arn != "" ? jsondecode(data.aws_secretsmanager_secret_version.application_existing[0].secret_string) : {}
  rds_master_secret                = jsondecode(data.aws_secretsmanager_secret_version.rds_master.secret_string)
  effective_application_secret_arn = var.application_secret_arn != "" ? var.application_secret_arn : aws_secretsmanager_secret.application[0].arn

  generated_database_url = "postgresql://${urlencode(local.rds_master_secret.username)}:${urlencode(local.rds_master_secret.password)}@${module.rds_proxy.proxy_endpoint}:5432/hexacode"
  generated_redis_url    = "redis://${module.elasticache.redis_primary_endpoint}:${module.elasticache.redis_port}"

  application_secret_version_string = var.application_secret_arn != "" ? jsonencode(merge(local.existing_application_secret, {
    DATABASE_URL = replace(local.existing_application_secret.DATABASE_URL, module.rds.db_address, module.rds_proxy.proxy_endpoint)
    })) : jsonencode({
    DATABASE_URL = local.generated_database_url
    REDIS_URL    = local.generated_redis_url
  })
}

resource "aws_secretsmanager_secret_version" "application_runtime" {
  secret_id     = local.effective_application_secret_arn
  secret_string = local.application_secret_version_string
}
