output "cors_lambda_arn" {
  description = "ARN of the CORS preflight Lambda function"
  value       = aws_lambda_function.cors_preflight.arn
}

output "cors_lambda_function_name" {
  description = "Name of the CORS preflight Lambda function"
  value       = aws_lambda_function.cors_preflight.function_name
}