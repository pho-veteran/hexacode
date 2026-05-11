variable "environment" {
  description = "Environment name"
  type        = string
}

variable "region" {
  description = "AWS region"
  type        = string
}

variable "frontend_domain" {
  description = "Frontend domain used for Cognito callbacks and CORS"
  type        = string
}