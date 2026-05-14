# Cognito Module
# Creates the Cognito User Pool and SPA app client for Cognito-managed sign-up and confirmation

locals {
  issuer                     = "https://cognito-idp.${var.region}.amazonaws.com/${aws_cognito_user_pool.main.id}"
  frontend_domain            = trimspace(var.frontend_domain)
  frontend_domain_configured = local.frontend_domain != ""
  frontend_urls              = local.frontend_domain_configured ? [local.frontend_domain] : []
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
  explicit_auth_flows = [
    "ALLOW_REFRESH_TOKEN_AUTH",
    "ALLOW_USER_PASSWORD_AUTH",
    "ALLOW_USER_SRP_AUTH"
  ]

  callback_urls = local.frontend_urls

  logout_urls = local.frontend_urls

  allowed_oauth_flows                  = local.frontend_domain_configured ? ["code"] : []
  allowed_oauth_flows_user_pool_client = local.frontend_domain_configured
  allowed_oauth_scopes = local.frontend_domain_configured ? [
    "email",
    "openid",
    "profile"
  ] : []

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
