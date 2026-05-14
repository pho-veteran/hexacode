variable "environment" {
  description = "Environment name"
  type        = string
}

variable "region" {
  description = "AWS region"
  type        = string
  default     = "us-west-2"
}

variable "vpc_cidr" {
  description = "VPC CIDR block"
  type        = string
  default     = "10.20.0.0/16"
}

variable "availability_zones" {
  description = "AZ suffixes to use"
  type        = list(string)
  default     = ["a", "b"]
}

variable "network_firewall_enabled" {
  description = "Route private subnet egress through AWS Network Firewall instead of directly to NAT gateways."
  type        = bool
  default     = false
}