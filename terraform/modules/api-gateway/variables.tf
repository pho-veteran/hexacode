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
}

variable "cors_lambda_arn" {
  description = "ARN of the CORS Lambda function"
  type        = string
}