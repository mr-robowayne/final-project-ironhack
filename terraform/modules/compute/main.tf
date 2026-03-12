locals {
  private_subnet_map = {
    for idx, subnet_id in var.private_subnet_ids :
    format("%02d", idx + 1) => {
      subnet_id = subnet_id
      az        = try(var.availability_zones[idx], null)
    }
  }
  egress_https_cidrs_ipv4_map = {
    for idx, cidr in var.egress_https_cidrs_ipv4 : tostring(idx) => cidr
  }
  private_egress_ports_map = {
    for port in var.private_egress_tcp_ports_to_vpc : tostring(port) => port
  }
  vpc_resolver_ip = cidrhost(var.vpc_cidr, 2)

  enable_data_access_policy = var.enable_ssm_profile && (
    length(var.backend_secret_arns) > 0 ||
    length(var.backend_kms_key_arns) > 0 ||
    length(var.backend_ssm_parameter_paths) > 0 ||
    length(var.backend_s3_document_bucket_arns) > 0
  )
}

data "aws_ami" "ubuntu" {
  most_recent = true
  owners      = [var.ami_owner]

  filter {
    name   = "name"
    values = [var.ami_name_pattern]
  }

  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }

  filter {
    name   = "root-device-type"
    values = ["ebs"]
  }

  filter {
    name   = "architecture"
    values = ["x86_64"]
  }
}

resource "aws_security_group" "private_instances" {
  name        = "${var.name_prefix}-private-ec2-sg"
  description = "Security group for private EC2 instances."
  vpc_id      = var.vpc_id
  tags = merge(
    var.tags,
    {
      Name = "${var.name_prefix}-private-ec2-sg"
      Tier = "private"
    }
  )
}

resource "aws_vpc_security_group_egress_rule" "private_instances_https_ipv4" {
  for_each = local.egress_https_cidrs_ipv4_map

  security_group_id = aws_security_group.private_instances.id
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
  cidr_ipv4         = each.value
  description       = "Allow outbound HTTPS to ${each.value}."
}

resource "aws_vpc_security_group_egress_rule" "private_instances_to_vpc_tcp" {
  for_each = local.private_egress_ports_map

  security_group_id = aws_security_group.private_instances.id
  ip_protocol       = "tcp"
  from_port         = each.value
  to_port           = each.value
  cidr_ipv4         = var.vpc_cidr
  description       = "Allow outbound TCP ${each.value} to VPC internal resources."
}

resource "aws_vpc_security_group_egress_rule" "private_instances_dns_udp" {
  count = var.allow_dns_to_vpc_resolver ? 1 : 0

  security_group_id = aws_security_group.private_instances.id
  ip_protocol       = "udp"
  from_port         = 53
  to_port           = 53
  cidr_ipv4         = "${local.vpc_resolver_ip}/32"
  description       = "Allow outbound DNS UDP to the VPC resolver."
}

resource "aws_vpc_security_group_egress_rule" "private_instances_dns_tcp" {
  count = var.allow_dns_to_vpc_resolver ? 1 : 0

  security_group_id = aws_security_group.private_instances.id
  ip_protocol       = "tcp"
  from_port         = 53
  to_port           = 53
  cidr_ipv4         = "${local.vpc_resolver_ip}/32"
  description       = "Allow outbound DNS TCP to the VPC resolver."
}

data "aws_region" "current" {}
data "aws_caller_identity" "current" {}

data "aws_iam_policy_document" "private_instances_assume_role" {
  count = var.enable_ssm_profile ? 1 : 0

  statement {
    effect = "Allow"
    actions = [
      "sts:AssumeRole"
    ]

    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "private_instances_ssm" {
  count = var.enable_ssm_profile ? 1 : 0

  name               = "${var.name_prefix}-private-ec2-ssm-role"
  assume_role_policy = data.aws_iam_policy_document.private_instances_assume_role[0].json
  tags               = var.tags
}

resource "aws_iam_role_policy_attachment" "private_instances_ssm_core" {
  count = var.enable_ssm_profile ? 1 : 0

  role       = aws_iam_role.private_instances_ssm[0].name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_instance_profile" "private_instances" {
  count = var.enable_ssm_profile ? 1 : 0

  name = "${var.name_prefix}-private-ec2-instance-profile"
  role = aws_iam_role.private_instances_ssm[0].name
}

data "aws_iam_policy_document" "backend_data_access" {
  count = local.enable_data_access_policy ? 1 : 0

  dynamic "statement" {
    for_each = length(var.backend_secret_arns) > 0 ? [1] : []
    content {
      sid       = "SecretsManagerAccess"
      effect    = "Allow"
      actions   = ["secretsmanager:GetSecretValue", "secretsmanager:DescribeSecret"]
      resources = var.backend_secret_arns
    }
  }

  dynamic "statement" {
    for_each = length(var.backend_kms_key_arns) > 0 ? [1] : []
    content {
      sid    = "KmsDecryptAccess"
      effect = "Allow"
      actions = [
        "kms:Decrypt",
        "kms:DescribeKey",
        "kms:GenerateDataKey*",
      ]
      resources = var.backend_kms_key_arns
    }
  }

  dynamic "statement" {
    for_each = length(var.backend_ssm_parameter_paths) > 0 ? [1] : []
    content {
      sid    = "SsmParameterAccess"
      effect = "Allow"
      actions = [
        "ssm:GetParameter",
        "ssm:GetParameters",
        "ssm:GetParametersByPath",
      ]
      resources = [
        for path in var.backend_ssm_parameter_paths :
        "arn:aws:ssm:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:parameter${path}/*"
      ]
    }
  }

  dynamic "statement" {
    for_each = length(var.backend_s3_document_bucket_arns) > 0 ? [1] : []
    content {
      sid    = "S3DocumentsObjects"
      effect = "Allow"
      actions = [
        "s3:PutObject",
        "s3:GetObject",
        "s3:DeleteObject",
        "s3:HeadObject",
      ]
      resources = [for arn in var.backend_s3_document_bucket_arns : "${arn}/*"]
    }
  }

  dynamic "statement" {
    for_each = length(var.backend_s3_document_bucket_arns) > 0 ? [1] : []
    content {
      sid       = "S3DocumentsListBucket"
      effect    = "Allow"
      actions   = ["s3:ListBucket"]
      resources = var.backend_s3_document_bucket_arns
    }
  }
}

resource "aws_iam_role_policy" "backend_data_access" {
  count = local.enable_data_access_policy ? 1 : 0

  name   = "${var.name_prefix}-backend-data-access"
  role   = aws_iam_role.private_instances_ssm[0].id
  policy = data.aws_iam_policy_document.backend_data_access[0].json
}

resource "aws_instance" "private" {
  for_each = local.private_subnet_map

  ami                         = data.aws_ami.ubuntu.id
  instance_type               = var.instance_type
  subnet_id                   = each.value.subnet_id
  vpc_security_group_ids      = [aws_security_group.private_instances.id]
  associate_public_ip_address = false
  monitoring                  = var.enable_detailed_monitoring
  iam_instance_profile        = var.enable_ssm_profile ? aws_iam_instance_profile.private_instances[0].name : null

  root_block_device {
    encrypted   = true
    volume_type = var.root_volume_type
    volume_size = var.root_volume_size
  }

  metadata_options {
    http_endpoint               = "enabled"
    http_tokens                 = "required"
    http_put_response_hop_limit = 2
    instance_metadata_tags      = "enabled"
  }

  tags = merge(
    var.tags,
    {
      Name = "${var.name_prefix}-private-ec2-${each.key}"
      Tier = "private"
      AZ   = each.value.az
    }
  )
}
