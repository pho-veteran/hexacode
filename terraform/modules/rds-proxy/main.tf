resource "aws_iam_role" "proxy" {
  name = "hexacode-${var.environment}-rds-proxy"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Service = "rds.amazonaws.com"
        }
        Action = "sts:AssumeRole"
      }
    ]
  })
}

resource "aws_iam_role_policy" "proxy_secrets" {
  name = "hexacode-${var.environment}-rds-proxy-secrets"
  role = aws_iam_role.proxy.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "secretsmanager:GetSecretValue"
        ]
        Resource = var.db_master_user_secret_arn
      }
    ]
  })
}

resource "aws_db_proxy" "main" {
  name                   = "hexacode-${var.environment}-db-proxy"
  engine_family          = "POSTGRESQL"
  role_arn               = aws_iam_role.proxy.arn
  require_tls            = true
  idle_client_timeout    = 1800
  debug_logging          = false
  vpc_subnet_ids         = var.private_data_subnet_ids
  vpc_security_group_ids = [var.sg_rds_proxy_id]

  auth {
    auth_scheme = "SECRETS"
    secret_arn  = var.db_master_user_secret_arn
    iam_auth    = "DISABLED"
  }
}

resource "aws_db_proxy_default_target_group" "main" {
  db_proxy_name = aws_db_proxy.main.name
}

resource "aws_db_proxy_target" "main" {
  db_proxy_name          = aws_db_proxy.main.name
  target_group_name      = aws_db_proxy_default_target_group.main.name
  db_instance_identifier = var.db_instance_identifier
}
