# Cognito Module
# Creates the Cognito User Pool, SPA app client, and pre-sign-up Lambda for auto-confirm/auto-verify

locals {
  issuer = "https://cognito-idp.${var.region}.amazonaws.com/${aws_cognito_user_pool.main.id}"
}

# =============================================================================
# Pre-Sign-Up Lambda Function (auto-confirm + auto-verify email)
# =============================================================================
resource "aws_iam_role" "presignup_lambda" {
  name = "hexacode-${var.environment}-presignup-lambda"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Service = "lambda.amazonaws.com"
        }
        Action = "sts:AssumeRole"
      }
    ]
  })
}

resource "aws_iam_role_policy" "presignup_lambda_logging" {
  name = "hexacode-${var.environment}-presignup-lambda-logging"

  role = aws_iam_role.presignup_lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents"
        ]
        Resource = "arn:aws:logs:*:*:*"
      }
    ]
  })
}

data "archive_file" "presignup_zip" {
  type        = "zip"
  source_file = "${path.module}/lambda/presignup_auto_confirm.py"
  output_path = "${path.module}/lambda/presignup_auto_confirm.zip"
}

resource "aws_lambda_function" "presignup_auto_confirm" {
  filename         = data.archive_file.presignup_zip.output_path
  function_name    = "hexacode-${var.environment}-presignup-auto-confirm"
  role             = aws_iam_role.presignup_lambda.arn
  handler          = "presignup_auto_confirm.handler"
  runtime          = "python3.12"
  source_code_hash = data.archive_file.presignup_zip.output_base64sha256
  timeout          = 3
  memory_size      = 128

  tags = {
    Name = "hexacode-${var.environment}-presignup-auto-confirm"
  }
}

# =============================================================================
# Cognito User Pool
# =============================================================================
resource "aws_cognito_user_pool" "main" {
  name = "hexacode-${var.environment}-user-pool"

  alias_attributes = ["email"]

  # Email sign-in configuration
  email_configuration {
    email_sending_account = "COGNITO_DEFAULT"
  }

  # Auto-verify email address
  auto_verified_attributes = ["email"]

  # Password policy
  password_policy {
    minimum_length    = 8
    require_lowercase = true
    require_numbers   = true
    require_symbols   = false
    require_uppercase = true
  }

  # Pre-sign-up Lambda trigger for auto-confirm
  lambda_config {
    pre_sign_up = aws_lambda_function.presignup_auto_confirm.arn
  }

  tags = {
    Name = "hexacode-${var.environment}-user-pool"
  }
}

resource "aws_cognito_user_pool_domain" "main" {
  domain       = "hexacode-${var.environment}"
  user_pool_id = aws_cognito_user_pool.main.id
}

resource "aws_cognito_user_pool_client" "spa" {
  name         = "hexacode-${var.environment}-spa-client"
  user_pool_id = aws_cognito_user_pool.main.id

  # No client secret for PKCE flow
  generate_secret = false

  # PKCE-capable authorization code flow
  auth_session_validity = 3

  callback_urls = [
    var.frontend_domain
  ]

  logout_urls = [
    var.frontend_domain
  ]

  allowed_oauth_flows                  = ["code"]
  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_scopes = [
    "email",
    "openid",
    "profile"
  ]

  refresh_token_validity = 30
  access_token_validity  = 1
  id_token_validity      = 1

  token_validity_units {
    access_token  = "hours"
    id_token      = "hours"
    refresh_token = "days"
  }

  # Explicit write permissions for attributes
  write_attributes = ["email"]
  read_attributes  = ["email", "preferred_username", "name", "picture"]
}
