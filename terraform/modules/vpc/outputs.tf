output "vpc_id" {
  description = "VPC ID"
  value       = aws_vpc.main.id
}

output "public_subnet_ids" {
  description = "IDs of public subnets"
  value       = aws_subnet.public[*].id
}

output "availability_zone_names" {
  description = "Full Availability Zone names used by this VPC module"
  value       = local.azs
}

output "private_app_subnet_ids" {
  description = "IDs of private app subnets"
  value       = aws_subnet.private_app[*].id
}

output "private_data_subnet_ids" {
  description = "IDs of private data subnets"
  value       = aws_subnet.private_data[*].id
}

output "firewall_subnet_ids" {
  description = "IDs of dedicated Network Firewall subnets"
  value       = aws_subnet.firewall[*].id
}

output "nat_gateway_ids" {
  description = "IDs of NAT gateways, one per Availability Zone"
  value       = aws_nat_gateway.main[*].id
}

output "private_app_route_table_ids" {
  description = "Route table IDs for private app subnets"
  value       = aws_route_table.private_app[*].id
}

output "private_data_route_table_ids" {
  description = "Route table IDs for private data subnets"
  value       = aws_route_table.private_data[*].id
}

output "firewall_route_table_ids" {
  description = "Route table IDs for firewall subnets"
  value       = aws_route_table.firewall[*].id
}

output "vpc_flow_log_group_name" {
  description = "CloudWatch log group name for VPC Flow Logs"
  value       = aws_cloudwatch_log_group.vpc_flow_logs.name
}

output "vpc_endpoint_security_group_id" {
  description = "Security group ID for VPC interface endpoints"
  value       = aws_security_group.vpc_endpoints.id
}