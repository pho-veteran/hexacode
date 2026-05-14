output "firewall_arn" {
  description = "ARN of the AWS Network Firewall."
  value       = aws_networkfirewall_firewall.main.arn
}

output "firewall_name" {
  description = "Name of the AWS Network Firewall."
  value       = aws_networkfirewall_firewall.main.name
}

output "flow_log_group_name" {
  description = "CloudWatch log group for Network Firewall flow logs."
  value       = aws_cloudwatch_log_group.flow.name
}

output "alert_log_group_name" {
  description = "CloudWatch log group for Network Firewall alert logs."
  value       = aws_cloudwatch_log_group.alert.name
}

output "endpoint_ids_by_az" {
  description = "Network Firewall endpoint IDs keyed by Availability Zone."
  value = {
    for az in var.availability_zone_names :
    az => one([
      for sync_state in aws_networkfirewall_firewall.main.firewall_status[0].sync_states :
      sync_state.attachment[0].endpoint_id
      if sync_state.availability_zone == az
    ])
  }
}
