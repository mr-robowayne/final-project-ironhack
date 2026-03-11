data "aws_region" "current" {}

locals {
  interface_services = {
    ssm            = var.enable_ssm_endpoint
    ssmmessages    = var.enable_ssmmessages_endpoint
    ec2messages    = var.enable_ec2messages_endpoint
    logs           = var.enable_logs_endpoint
    secretsmanager = var.enable_secretsmanager_endpoint
    ecr_api        = var.enable_ecr_api_endpoint
    ecr_dkr        = var.enable_ecr_dkr_endpoint
  }
}

resource "aws_security_group" "this" {
  name        = "${var.name_prefix}-vpce-sg"
  description = "Security group for interface VPC endpoints."
  vpc_id      = var.vpc_id

  tags = merge(
    var.tags,
    {
      Name = "${var.name_prefix}-vpce-sg"
      Tier = "private"
    }
  )
}

resource "aws_vpc_security_group_ingress_rule" "https_from_allowed_sgs" {
  for_each = {
    for idx, sg_id in var.allowed_security_group_ids : tostring(idx) => sg_id
  }

  security_group_id            = aws_security_group.this.id
  referenced_security_group_id = each.value
  ip_protocol                  = "tcp"
  from_port                    = 443
  to_port                      = 443
  description                  = "Allow HTTPS to VPC endpoints from trusted security groups."
}

resource "aws_vpc_endpoint" "interface" {
  for_each = {
    for service, enabled in local.interface_services : service => service if enabled
  }

  vpc_id              = var.vpc_id
  service_name        = "com.amazonaws.${data.aws_region.current.name}.${each.value}"
  vpc_endpoint_type   = "Interface"
  subnet_ids          = var.subnet_ids
  security_group_ids  = [aws_security_group.this.id]
  private_dns_enabled = true

  tags = merge(
    var.tags,
    {
      Name = "${var.name_prefix}-vpce-${each.value}"
      Tier = "private"
    }
  )
}

resource "aws_vpc_endpoint" "s3_gateway" {
  count = var.enable_s3_gateway_endpoint ? 1 : 0

  vpc_id            = var.vpc_id
  service_name      = "com.amazonaws.${data.aws_region.current.name}.s3"
  vpc_endpoint_type = "Gateway"
  route_table_ids   = var.route_table_ids

  tags = merge(
    var.tags,
    {
      Name = "${var.name_prefix}-vpce-s3-gateway"
      Tier = "private"
    }
  )
}
