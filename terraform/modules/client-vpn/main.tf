resource "aws_cloudwatch_log_group" "client_vpn" {
  count             = var.enabled ? 1 : 0
  name              = "/aws/clientvpn/hexacode-${var.environment}"
  retention_in_days = 30
}

resource "aws_cloudwatch_log_stream" "client_vpn" {
  count          = var.enabled ? 1 : 0
  name           = "connections"
  log_group_name = aws_cloudwatch_log_group.client_vpn[0].name
}

resource "aws_ec2_client_vpn_endpoint" "main" {
  count                  = var.enabled ? 1 : 0
  description            = "hexacode-${var.environment}-client-vpn"
  server_certificate_arn = var.server_certificate_arn
  client_cidr_block      = var.client_cidr_block
  split_tunnel           = true
  security_group_ids     = [var.security_group_id]
  vpc_id                 = var.vpc_id

  authentication_options {
    type                       = "certificate-authentication"
    root_certificate_chain_arn = var.root_certificate_chain_arn
  }

  connection_log_options {
    enabled               = true
    cloudwatch_log_group  = aws_cloudwatch_log_group.client_vpn[0].name
    cloudwatch_log_stream = aws_cloudwatch_log_stream.client_vpn[0].name
  }

  tags = {
    Name = "hexacode-${var.environment}-client-vpn"
  }
}

resource "aws_ec2_client_vpn_network_association" "private_app" {
  for_each               = var.enabled ? toset(var.private_app_subnet_ids) : []
  client_vpn_endpoint_id = aws_ec2_client_vpn_endpoint.main[0].id
  subnet_id              = each.value
}

resource "aws_ec2_client_vpn_authorization_rule" "vpc" {
  count                  = var.enabled ? 1 : 0
  client_vpn_endpoint_id = aws_ec2_client_vpn_endpoint.main[0].id
  target_network_cidr    = var.target_network_cidr
  authorize_all_groups   = true
  description            = "Allow approved VPN clients to access Hexacode VPC resources"
}
