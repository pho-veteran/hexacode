locals {
  azs = [for suffix in var.availability_zones : "${var.region}${suffix}"]
  public_cidrs = [
    for index in range(length(var.availability_zones)) :
    cidrsubnet(var.management_vpc_cidr_block, 8, index)
  ]
  name_prefix = "hexacode-${var.environment}-management"

  interface_endpoints = {
    ec2messages    = "com.amazonaws.${var.region}.ec2messages"
    logs           = "com.amazonaws.${var.region}.logs"
    secretsmanager = "com.amazonaws.${var.region}.secretsmanager"
    ssm            = "com.amazonaws.${var.region}.ssm"
    ssmmessages    = "com.amazonaws.${var.region}.ssmmessages"
  }
}

data "aws_ssm_parameter" "amazon_linux_2023" {
  name = "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64"
}

resource "aws_vpc" "management" {
  cidr_block           = var.management_vpc_cidr_block
  enable_dns_hostnames = true
  enable_dns_support   = true

  tags = {
    Name = "${local.name_prefix}-vpc"
  }
}

resource "aws_internet_gateway" "management" {
  vpc_id = aws_vpc.management.id

  tags = {
    Name = "${local.name_prefix}-igw"
  }
}

resource "aws_subnet" "public" {
  count = length(var.availability_zones)

  vpc_id                  = aws_vpc.management.id
  cidr_block              = local.public_cidrs[count.index]
  availability_zone       = local.azs[count.index]
  map_public_ip_on_launch = true

  tags = {
    Name = "${local.name_prefix}-public-subnet-${var.availability_zones[count.index]}"
    Type = "management-public"
  }
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.management.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.management.id
  }

  tags = {
    Name = "${local.name_prefix}-public-rt"
  }
}

resource "aws_route_table_association" "public" {
  count = length(var.availability_zones)

  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

resource "aws_security_group" "bastion" {
  name        = "${local.name_prefix}-sg-bastion"
  description = "Security group for SSM-managed management host"
  vpc_id      = aws_vpc.management.id

  tags = {
    Name = "${local.name_prefix}-sg-bastion"
  }
}

resource "aws_security_group" "vpc_endpoints" {
  name        = "${local.name_prefix}-sg-vpc-endpoints"
  description = "Security group for management VPC interface endpoints"
  vpc_id      = aws_vpc.management.id

  tags = {
    Name = "${local.name_prefix}-sg-vpc-endpoints"
  }
}

resource "aws_vpc_security_group_ingress_rule" "vpc_endpoints_from_bastion" {
  security_group_id            = aws_security_group.vpc_endpoints.id
  referenced_security_group_id = aws_security_group.bastion.id
  from_port                    = 443
  to_port                      = 443
  ip_protocol                  = "tcp"
  description                  = "HTTPS from SSM management host"
}

resource "aws_vpc_security_group_egress_rule" "vpc_endpoints_to_vpc" {
  security_group_id = aws_security_group.vpc_endpoints.id
  cidr_ipv4         = var.management_vpc_cidr_block
  ip_protocol       = "-1"
  description       = "Endpoint responses to management VPC"
}

resource "aws_vpc_security_group_egress_rule" "bastion_to_management_endpoints" {
  security_group_id            = aws_security_group.bastion.id
  referenced_security_group_id = aws_security_group.vpc_endpoints.id
  from_port                    = 443
  to_port                      = 443
  ip_protocol                  = "tcp"
  description                  = "HTTPS to management VPC endpoints"
}

resource "aws_vpc_security_group_egress_rule" "bastion_to_app_vpc" {
  security_group_id = aws_security_group.bastion.id
  cidr_ipv4         = var.app_vpc_cidr_block
  ip_protocol       = "-1"
  description       = "Operator access to peered application VPC"
}

resource "aws_vpc_security_group_egress_rule" "bastion_to_internet_https" {
  security_group_id = aws_security_group.bastion.id
  cidr_ipv4         = "0.0.0.0/0"
  from_port         = 443
  to_port           = 443
  ip_protocol       = "tcp"
  description       = "HTTPS for package and ops artifact retrieval"
}

resource "aws_vpc_endpoint" "interface" {
  for_each = local.interface_endpoints

  vpc_id              = aws_vpc.management.id
  vpc_endpoint_type   = "Interface"
  service_name        = each.value
  subnet_ids          = aws_subnet.public[*].id
  private_dns_enabled = true
  security_group_ids  = [aws_security_group.vpc_endpoints.id]

  tags = {
    Name = "${local.name_prefix}-${each.key}-endpoint"
  }
}

resource "aws_vpc_endpoint" "s3" {
  vpc_id          = aws_vpc.management.id
  service_name    = "com.amazonaws.${var.region}.s3"
  route_table_ids = [aws_route_table.public.id]

  tags = {
    Name = "${local.name_prefix}-s3-gateway-endpoint"
  }
}

resource "aws_iam_role" "bastion" {
  name = "${local.name_prefix}-bastion-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Service = "ec2.amazonaws.com"
        }
        Action = "sts:AssumeRole"
      }
    ]
  })

  tags = {
    Name = "${local.name_prefix}-bastion-role"
  }
}

resource "aws_iam_role_policy_attachment" "bastion_ssm" {
  role       = aws_iam_role.bastion.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_role_policy" "bastion_ops" {
  name = "${local.name_prefix}-bastion-ops"
  role = aws_iam_role.bastion.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "secretsmanager:GetSecretValue",
          "secretsmanager:DescribeSecret"
        ]
        Resource = var.application_secret_arn
      },
      {
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:PutObject",
          "s3:DeleteObject"
        ]
        Resource = [
          "${var.problem_bucket_arn}/*",
          "${var.submission_bucket_arn}/*"
        ]
      },
      {
        Effect = "Allow"
        Action = [
          "s3:ListBucket"
        ]
        Resource = [
          var.problem_bucket_arn,
          var.submission_bucket_arn
        ]
      }
    ]
  })
}

resource "aws_iam_role_policy" "bastion_kms" {
  count = var.kms_key_arn == "" ? 0 : 1

  name = "${local.name_prefix}-bastion-kms"
  role = aws_iam_role.bastion.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "kms:Decrypt"
        ]
        Resource = var.kms_key_arn
      }
    ]
  })
}

resource "aws_iam_instance_profile" "bastion" {
  name = "${local.name_prefix}-bastion-profile"
  role = aws_iam_role.bastion.name
}

resource "aws_instance" "bastion" {
  ami                         = data.aws_ssm_parameter.amazon_linux_2023.value
  instance_type               = var.instance_type
  iam_instance_profile        = aws_iam_instance_profile.bastion.name
  subnet_id                   = aws_subnet.public[0].id
  vpc_security_group_ids      = [aws_security_group.bastion.id]
  associate_public_ip_address = true

  metadata_options {
    http_endpoint = "enabled"
    http_tokens   = "required"
  }

  root_block_device {
    encrypted   = true
    volume_size = 8
    volume_type = "gp3"
  }

  tags = {
    Name = "${local.name_prefix}-ssm-bastion"
  }
}

resource "aws_vpc_peering_connection" "management_to_app" {
  vpc_id      = aws_vpc.management.id
  peer_vpc_id = var.app_vpc_id
  auto_accept = true

  requester {
    allow_remote_vpc_dns_resolution = true
  }

  accepter {
    allow_remote_vpc_dns_resolution = true
  }

  tags = {
    Name = "${local.name_prefix}-to-app-peering"
  }
}

resource "aws_route" "management_to_app" {
  route_table_id            = aws_route_table.public.id
  destination_cidr_block    = var.app_vpc_cidr_block
  vpc_peering_connection_id = aws_vpc_peering_connection.management_to_app.id
}

resource "aws_route" "app_private_app_to_management" {
  count = length(var.app_private_app_route_table_ids)

  route_table_id            = var.app_private_app_route_table_ids[count.index]
  destination_cidr_block    = var.management_vpc_cidr_block
  vpc_peering_connection_id = aws_vpc_peering_connection.management_to_app.id
}

resource "aws_route" "app_private_data_to_management" {
  count = length(var.app_private_data_route_table_ids)

  route_table_id            = var.app_private_data_route_table_ids[count.index]
  destination_cidr_block    = var.management_vpc_cidr_block
  vpc_peering_connection_id = aws_vpc_peering_connection.management_to_app.id
}
