data "aws_secretsmanager_secret_version" "application" {
  count     = var.application_secret_arn != "" ? 1 : 0
  secret_id = var.application_secret_arn
}

locals {
  application_secret = var.application_secret_arn != "" ? jsondecode(data.aws_secretsmanager_secret_version.application[0].secret_string) : {}

  application_secret_version_string = var.application_secret_arn != "" ? jsonencode(merge(local.application_secret, {
    DATABASE_URL = replace(local.application_secret.DATABASE_URL, module.rds.db_address, module.rds_proxy.proxy_endpoint)
  })) : null
}

resource "aws_secretsmanager_secret_version" "application_runtime" {
  count         = var.application_secret_arn != "" ? 1 : 0
  secret_id     = var.application_secret_arn
  secret_string = local.application_secret_version_string
}
