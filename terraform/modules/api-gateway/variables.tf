variable "environment" {
  description = "Environment name"
  type        = string
}

variable "frontend_domain" {
  description = "Frontend domain for CORS configuration"
  type        = string
}

variable "private_app_subnet_ids" {
  description = "IDs of private app subnets for VPC Link"
  type        = list(string)
}

variable "sg_apigw_vpclink_id" {
  description = "Security group ID for API Gateway VPC Link"
  type        = string
}

variable "internal_alb_listener_arn" {
  description = "ARN of the internal ALB listener"
  type        = string
}

variable "chat_lambda_arn" {
  description = "ARN of the chat Lambda function"
  type        = string
  default     = ""

  validation {
    condition     = !var.chat_lambda_enabled || trimspace(var.chat_lambda_arn) != ""
    error_message = "chat_lambda_arn must be set when chat_lambda_enabled is true."
  }
}

variable "chat_lambda_enabled" {
  description = "Create the chat Lambda API Gateway route"
  type        = bool
  default     = false
}

variable "chat_lambda_permission_managed" {
  description = "Whether this module should manage Lambda invoke permission for the chat Lambda"
  type        = bool
  default     = false

  validation {
    condition     = !var.chat_lambda_permission_managed || var.chat_lambda_enabled
    error_message = "chat_lambda_permission_managed can only be true when chat_lambda_enabled is true."
  }
}

variable "cognito_issuer" {
  description = "Cognito issuer URL for the chat JWT authorizer"
  type        = string
  default     = null
  nullable    = true

  validation {
    condition     = !var.chat_lambda_enabled || (var.cognito_issuer != null && trimspace(var.cognito_issuer) != "")
    error_message = "cognito_issuer must be set when chat_lambda_enabled is true."
  }
}

variable "cognito_client_id" {
  description = "Cognito app client ID accepted by the chat JWT authorizer"
  type        = string
  default     = null
  nullable    = true

  validation {
    condition     = !var.chat_lambda_enabled || (var.cognito_client_id != null && trimspace(var.cognito_client_id) != "")
    error_message = "cognito_client_id must be set when chat_lambda_enabled is true."
  }
}

variable "chat_throttle_burst_limit" {
  description = "Burst limit for POST /api/chat/messages"
  type        = number
  default     = 20
}

variable "chat_throttle_rate_limit" {
  description = "Steady-state rate limit for POST /api/chat/messages"
  type        = number
  default     = 10
}

variable "default_throttle_burst_limit" {
  description = "Default burst limit for all routes (requests per second)"
  type        = number
  default     = 200
}

variable "default_throttle_rate_limit" {
  description = "Default steady-state rate limit for all routes (requests per second)"
  type        = number
  default     = 100
}

variable "cors_lambda_arn" {
  description = "ARN of the CORS Lambda function"
  type        = string
}