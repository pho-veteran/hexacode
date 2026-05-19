output "chat_lambda_arn" {
  description = "ARN of the Bedrock-backed chat Lambda function"
  value       = aws_lambda_function.chat.arn
}

output "chat_lambda_invoke_arn" {
  description = "Invoke ARN for API Gateway (uses alias when provisioned concurrency is enabled)"
  value       = var.provisioned_concurrent_executions > 0 ? aws_lambda_alias.chat_live[0].invoke_arn : aws_lambda_function.chat.invoke_arn
}

output "chat_lambda_name" {
  description = "Name of the Bedrock-backed chat Lambda function"
  value       = aws_lambda_function.chat.function_name
}

output "bedrock_agent_id" {
  description = "ID of the Hexacode Bedrock agent"
  value       = aws_bedrockagent_agent.hexacode.agent_id
}

output "bedrock_agent_alias_id" {
  description = "Alias ID for the live Hexacode Bedrock agent"
  value       = aws_bedrockagent_agent_alias.live_profile.agent_alias_id
}

output "bedrock_knowledge_base_id" {
  description = "ID of the Hexacode Bedrock knowledge base"
  value       = aws_bedrockagent_knowledge_base.hexacode.id
}

output "bedrock_data_source_id" {
  description = "ID of the S3 data source for the Hexacode Bedrock knowledge base"
  value       = aws_bedrockagent_data_source.problem_assets.data_source_id
}
