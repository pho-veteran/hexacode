output "http_api_endpoint" {
  description = "Endpoint URL of the HTTP API"
  value       = aws_apigatewayv2_api.http_api.api_endpoint
}

output "http_api_id" {
  description = "ID of the HTTP API"
  value       = aws_apigatewayv2_api.http_api.id
}

output "vpc_link_id" {
  description = "ID of the VPC Link"
  value       = aws_apigatewayv2_vpc_link.alb_vpclink.id
}

output "stage_name" {
  description = "Name of the default stage"
  value       = aws_apigatewayv2_stage.default.name
}