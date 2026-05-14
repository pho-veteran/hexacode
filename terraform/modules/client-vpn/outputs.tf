output "endpoint_id" {
  description = "Client VPN endpoint ID"
  value       = try(aws_ec2_client_vpn_endpoint.main[0].id, null)
}

output "dns_name" {
  description = "Client VPN DNS name"
  value       = try(aws_ec2_client_vpn_endpoint.main[0].dns_name, null)
}

output "self_service_portal_url" {
  description = "Client VPN self-service portal URL"
  value       = try(aws_ec2_client_vpn_endpoint.main[0].self_service_portal_url, null)
}
