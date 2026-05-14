output "vpc_id" {
  description = "Management VPC ID."
  value       = aws_vpc.management.id
}

output "public_subnet_ids" {
  description = "Management VPC public subnet IDs."
  value       = aws_subnet.public[*].id
}

output "bastion_instance_id" {
  description = "SSM-managed management host instance ID."
  value       = aws_instance.bastion.id
}

output "bastion_security_group_id" {
  description = "Security group ID for the SSM-managed management host."
  value       = aws_security_group.bastion.id
}

output "peering_connection_id" {
  description = "VPC peering connection ID between management and application VPCs."
  value       = aws_vpc_peering_connection.management_to_app.id
}
