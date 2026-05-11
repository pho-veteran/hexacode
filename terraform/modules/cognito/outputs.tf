output "user_pool_id" {
  description = "ID of the Cognito user pool"
  value       = aws_cognito_user_pool.main.id
}

output "user_pool_domain" {
  description = "Domain of the Cognito user pool"
  value       = aws_cognito_user_pool_domain.main.domain
}

output "app_client_id" {
  description = "ID of the SPA app client"
  value       = aws_cognito_user_pool_client.spa.id
}

output "issuer" {
  description = "OIDC issuer URL"
  value       = local.issuer
}

output "jwks_url" {
  description = "URL for the JWKS endpoint"
  value       = "${local.issuer}/.well-known/jwks.json"
}