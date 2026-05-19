# API Gateway Module
# Creates the HTTP API with VPC Link, Lambda integrations, and CORS configuration

locals {
  # Extract function name from ARN (ARN format: arn:aws:lambda:region:account:function:name)
  cors_lambda_name = var.cors_lambda_arn != "" ? element(split(":", var.cors_lambda_arn), 6) : ""
  allow_origins    = var.frontend_domain == "" ? [] : [var.frontend_domain]
}

# API-level CORS configuration
resource "aws_apigatewayv2_api" "http_api" {
  name          = "hexacode-${var.environment}-http-api"
  protocol_type = "HTTP"

  # API-level CORS configuration
  cors_configuration {
    allow_origins = local.allow_origins
    allow_methods = [
      "GET",
      "POST",
      "PUT",
      "DELETE",
      "OPTIONS"
    ]
    allow_headers = [
      "authorization",
      "content-type",
      "x-correlation-id"
    ]
    expose_headers = [
      "content-disposition",
      "x-correlation-id"
    ]
    max_age = 300
  }

  tags = {
    Name = "hexacode-${var.environment}-http-api"
  }
}

resource "aws_apigatewayv2_vpc_link" "alb_vpclink" {
  name               = "hexacode-${var.environment}-vpclink"
  security_group_ids = [var.sg_apigw_vpclink_id]
  subnet_ids         = var.private_app_subnet_ids
}

resource "aws_cloudwatch_log_group" "api_access_logs" {
  name              = "/aws/apigateway/hexacode-${var.environment}"
  retention_in_days = 30
}

# Default stage with auto deploy
resource "aws_apigatewayv2_stage" "default" {
  api_id = aws_apigatewayv2_api.http_api.id
  name   = "$default"

  auto_deploy = true

  default_route_settings {
    throttling_burst_limit = var.default_throttle_burst_limit
    throttling_rate_limit  = var.default_throttle_rate_limit
  }

  dynamic "route_settings" {
    for_each = var.chat_lambda_enabled ? [1] : []

    content {
      route_key              = aws_apigatewayv2_route.chat_messages[0].route_key
      throttling_burst_limit = var.chat_throttle_burst_limit
      throttling_rate_limit  = var.chat_throttle_rate_limit
    }
  }

  access_log_settings {
    destination_arn = aws_cloudwatch_log_group.api_access_logs.arn
    format = jsonencode({
      requestId       = "$context.requestId"
      ip              = "$context.identity.sourceIp"
      requestTime     = "$context.requestTime"
      httpMethod      = "$context.httpMethod"
      routeKey        = "$context.routeKey"
      status          = "$context.status"
      protocol        = "$context.protocol"
      responseLength  = "$context.responseLength"
      responseLatency = "$context.responseLatency"
      domainName      = "$context.domainName"
      stage           = "$context.stage"
      requestPath     = "$context.resourcePath"
    })
  }
}

# CORS Lambda Integration (preflight)
resource "aws_apigatewayv2_integration" "cors_lambda" {
  api_id = aws_apigatewayv2_api.http_api.id

  integration_type       = "AWS_PROXY"
  integration_uri        = var.cors_lambda_arn
  payload_format_version = "2.0"
}

# Lambda invoke permission for CORS lambda (needed for API Gateway to call the Lambda)
resource "aws_lambda_permission" "api_cors_lambda" {
  statement_id  = "AllowAPIGatewayInvokeCORS"
  action        = "lambda:InvokeFunction"
  function_name = local.cors_lambda_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.http_api.execution_arn}/*/*"
}

# ALB Integration via VPC Link
resource "aws_apigatewayv2_integration" "alb_integration" {
  api_id = aws_apigatewayv2_api.http_api.id

  integration_type       = "HTTP_PROXY"
  integration_uri        = var.internal_alb_listener_arn
  integration_method     = "ANY"
  connection_type        = "VPC_LINK"
  connection_id          = aws_apigatewayv2_vpc_link.alb_vpclink.id
  payload_format_version = "1.0"
}

# Chat Lambda Integration (always present, external ARN or local ARN via variable)
resource "aws_apigatewayv2_integration" "chat_lambda" {
  count = var.chat_lambda_enabled ? 1 : 0

  api_id = aws_apigatewayv2_api.http_api.id

  integration_type       = "AWS_PROXY"
  integration_uri        = var.chat_lambda_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_authorizer" "cognito_jwt" {
  count = var.chat_lambda_enabled ? 1 : 0

  api_id           = aws_apigatewayv2_api.http_api.id
  authorizer_type  = "JWT"
  identity_sources = ["$request.header.Authorization"]
  name             = "hexacode-${var.environment}-cognito-jwt"

  jwt_configuration {
    audience = [var.cognito_client_id]
    issuer   = var.cognito_issuer
  }
}

# Lambda invoke permission for chat lambda
resource "aws_lambda_permission" "api_chat_lambda" {
  count         = var.chat_lambda_enabled && var.chat_lambda_permission_managed ? 1 : 0
  statement_id  = "AllowAPIGatewayInvokeChat"
  action        = "lambda:InvokeFunction"
  function_name = element(split(":", var.chat_lambda_arn), 6)
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.http_api.execution_arn}/*/*"
}

# OPTIONS preflight route
resource "aws_apigatewayv2_route" "api_options" {
  api_id = aws_apigatewayv2_api.http_api.id

  route_key = "OPTIONS /api/{proxy+}"

  target = "integrations/${aws_apigatewayv2_integration.cors_lambda.id}"
}

# Main API proxy route via ALB
resource "aws_apigatewayv2_route" "api_any" {
  api_id = aws_apigatewayv2_api.http_api.id

  route_key = "ANY /api/{proxy+}"

  target = "integrations/${aws_apigatewayv2_integration.alb_integration.id}"
}

# Chat messages route — always present when chat_lambda_arn is set
resource "aws_apigatewayv2_route" "chat_messages" {
  count = var.chat_lambda_enabled ? 1 : 0

  api_id = aws_apigatewayv2_api.http_api.id

  route_key          = "POST /api/chat/messages"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito_jwt[0].id

  target = "integrations/${aws_apigatewayv2_integration.chat_lambda[0].id}"
}
