variable "environment" {
  description = "Environment name"
  type        = string
}

variable "vpc_id" {
  description = "VPC ID"
  type        = string
}

variable "private_app_subnet_ids" {
  description = "Private app subnet IDs associated with the Client VPN endpoint"
  type        = list(string)
}

variable "client_cidr_block" {
  description = "Client VPN CIDR block"
  type        = string
}

variable "server_certificate_arn" {
  description = "ACM ARN for the Client VPN server certificate"
  type        = string
}

variable "root_certificate_chain_arn" {
  description = "ACM ARN for mutual-auth root client certificate"
  type        = string
}

variable "security_group_id" {
  description = "Security group attached to Client VPN network interfaces"
  type        = string
}

variable "target_network_cidr" {
  description = "CIDR authorized for VPN clients"
  type        = string
}

variable "enabled" {
  description = "Whether to create Client VPN resources"
  type        = bool
  default     = false
}
