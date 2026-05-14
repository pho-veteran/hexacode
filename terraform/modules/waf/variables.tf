variable "environment" {
  description = "Environment name used in WAF resource names."
  type        = string
}

variable "cloudfront_rate_limit" {
  description = "Maximum requests per five-minute window per source IP for the CloudFront web ACL."
  type        = number
  default     = 2000

  validation {
    condition     = var.cloudfront_rate_limit >= 100
    error_message = "cloudfront_rate_limit must be at least 100."
  }
}

variable "regional_rate_limit" {
  description = "Maximum requests per five-minute window per source IP for the regional web ACL."
  type        = number
  default     = 1000

  validation {
    condition     = var.regional_rate_limit >= 100
    error_message = "regional_rate_limit must be at least 100."
  }
}
