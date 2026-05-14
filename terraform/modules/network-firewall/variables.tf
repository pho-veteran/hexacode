variable "environment" {
  description = "Environment name used in Network Firewall resource names."
  type        = string
}

variable "vpc_id" {
  description = "VPC ID where Network Firewall is deployed."
  type        = string
}

variable "firewall_subnet_ids" {
  description = "Dedicated firewall subnet IDs, one per Availability Zone."
  type        = list(string)

  validation {
    condition     = length(var.firewall_subnet_ids) > 0
    error_message = "firewall_subnet_ids must contain at least one subnet."
  }
}

variable "availability_zone_names" {
  description = "Full Availability Zone names corresponding to firewall_subnet_ids."
  type        = list(string)

  validation {
    condition     = length(var.availability_zone_names) > 0
    error_message = "availability_zone_names must contain at least one Availability Zone."
  }
}

variable "blocked_domains" {
  description = "Domains blocked by the W5 Network Firewall denylist rule group."
  type        = list(string)

  validation {
    condition     = length(var.blocked_domains) > 0
    error_message = "blocked_domains must contain at least one domain."
  }
}
