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

variable "knowledge_source_bucket_id" {
  description = "S3 bucket ID/name that stores problem/catalog documents for Bedrock ingestion"
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

variable "reserved_concurrent_executions" {
  description = "Reserved concurrency for the chat Lambda"
  type        = number
  default     = 5
}

variable "chat_lambda_timeout_seconds" {
  description = "Timeout for the chat Lambda in seconds"
  type        = number
  default     = 30

  validation {
    condition     = var.chat_lambda_timeout_seconds > 0
    error_message = "chat_lambda_timeout_seconds must be greater than 0."
  }
}

variable "chat_lambda_error_threshold" {
  description = "Alarm threshold for chat Lambda Errors"
  type        = number
  default     = 0
}

variable "chat_lambda_throttle_threshold" {
  description = "Alarm threshold for chat Lambda Throttles"
  type        = number
  default     = 0
}

variable "chat_lambda_duration_threshold_ms" {
  description = "Alarm threshold in milliseconds for high chat Lambda Duration. Keep this below the configured Lambda timeout."
  type        = number
  default     = 25000

  validation {
    condition     = var.chat_lambda_duration_threshold_ms > 0 && var.chat_lambda_duration_threshold_ms < (var.chat_lambda_timeout_seconds * 1000)
    error_message = "chat_lambda_duration_threshold_ms must be greater than 0 and lower than chat_lambda_timeout_seconds converted to milliseconds."
  }
}
