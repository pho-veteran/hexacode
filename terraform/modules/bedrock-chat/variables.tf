variable "environment" {
  description = "Environment name"
  type        = string
}

variable "region" {
  description = "AWS region"
  type        = string
}

variable "frontend_domain" {
  description = "Frontend origin used for CORS responses"
  type        = string
}

variable "knowledge_source_bucket_arn" {
  description = "S3 bucket ARN that stores problem/catalog documents for Bedrock ingestion"
  type        = string
}

variable "knowledge_source_prefixes" {
  description = "S3 prefixes that Bedrock should ingest into the chat knowledge base"
  type        = list(string)
  default     = ["problem/"]
}

variable "agent_foundation_model" {
  description = "Bedrock inference profile ID for the Hexacode chat agent"
  type        = string
  default     = "us.anthropic.claude-haiku-4-5-20251001-v1:0"
}

variable "embedding_model_id" {
  description = "Bedrock embedding model ID for the Hexacode knowledge base"
  type        = string
  default     = "amazon.titan-embed-text-v1"
}
