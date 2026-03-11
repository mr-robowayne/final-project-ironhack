provider "aws" {
  region = var.aws_region
}

locals {
  name_prefix = "${var.project_name}-${var.environment}"

  tags = merge(
    {
      Project     = var.project_name
      Environment = var.environment
      ManagedBy   = "terraform"
    },
    var.tags,
    {
      DataResidency = "CH"
      PIIData       = "true"
      Compliance    = "DSGVO"
    }
  )
}

resource "aws_subnet" "data" {
  count = length(var.data_subnet_cidrs)

  vpc_id                  = var.vpc_id
  cidr_block              = var.data_subnet_cidrs[count.index]
  availability_zone       = var.data_availability_zones[count.index]
  map_public_ip_on_launch = false

  tags = merge(
    local.tags,
    {
      Name = format("%s-data-%d", local.name_prefix, count.index + 1)
      Tier = "data"
    }
  )
}

resource "aws_route_table" "data" {
  count = length(var.data_subnet_cidrs)

  vpc_id = var.vpc_id

  tags = merge(
    local.tags,
    {
      Name = format("%s-data-rt-%d", local.name_prefix, count.index + 1)
      Tier = "data"
    }
  )
}

resource "aws_route_table_association" "data" {
  count = length(var.data_subnet_cidrs)

  subnet_id      = aws_subnet.data[count.index].id
  route_table_id = aws_route_table.data[count.index].id
}

# ---------------------------------------------------------------------------
# VPC Flow Logs — data subnets (ISO 27001 A.12.4 / DSGVO Art. 32)
# ---------------------------------------------------------------------------

resource "aws_cloudwatch_log_group" "vpc_flow_logs" {
  name              = "/aws/vpc/${local.name_prefix}/data-flow-logs"
  retention_in_days = 90
  kms_key_id        = module.rds_kms.key_arn

  tags = merge(local.tags, { Name = "${local.name_prefix}-data-flow-logs" })
}

data "aws_iam_policy_document" "vpc_flow_logs_assume_role" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["vpc-flow-logs.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "vpc_flow_logs" {
  name               = "${local.name_prefix}-vpc-flow-logs-role"
  assume_role_policy = data.aws_iam_policy_document.vpc_flow_logs_assume_role.json
  tags               = local.tags
}

data "aws_iam_policy_document" "vpc_flow_logs_policy" {
  statement {
    effect = "Allow"
    actions = [
      "logs:CreateLogGroup",
      "logs:CreateLogStream",
      "logs:PutLogEvents",
      "logs:DescribeLogGroups",
      "logs:DescribeLogStreams",
    ]
    resources = ["${aws_cloudwatch_log_group.vpc_flow_logs.arn}:*"]
  }
}

resource "aws_iam_role_policy" "vpc_flow_logs" {
  name   = "${local.name_prefix}-vpc-flow-logs-policy"
  role   = aws_iam_role.vpc_flow_logs.id
  policy = data.aws_iam_policy_document.vpc_flow_logs_policy.json
}

resource "aws_flow_log" "data_subnets" {
  count = length(aws_subnet.data)

  iam_role_arn    = aws_iam_role.vpc_flow_logs.arn
  log_destination = aws_cloudwatch_log_group.vpc_flow_logs.arn
  traffic_type    = "ALL"
  subnet_id       = aws_subnet.data[count.index].id

  tags = merge(local.tags, {
    Name = format("%s-data-%d-flow-log", local.name_prefix, count.index + 1)
  })
}

# ---------------------------------------------------------------------------

module "rds_kms" {
  source = "../modules/kms"

  description = "KMS key for RDS data layer (${var.project_name}/${var.environment})."
  alias_name  = "alias/${local.name_prefix}-rds-data"
  service_principals = [
    "rds.amazonaws.com",
    "secretsmanager.amazonaws.com",
    "logs.${var.aws_region}.amazonaws.com"
  ]
  tags = local.tags
}

module "valkey_kms" {
  count  = var.enable_valkey ? 1 : 0
  source = "../modules/kms"

  description = "KMS key for Valkey data layer (${var.project_name}/${var.environment})."
  alias_name  = "alias/${local.name_prefix}-valkey-data"
  service_principals = [
    "elasticache.amazonaws.com",
    "secretsmanager.amazonaws.com",
    "logs.${var.aws_region}.amazonaws.com"
  ]
  tags = local.tags
}

module "rds" {
  source = "../modules/rds"

  name_prefix                           = local.name_prefix
  multi_az                              = var.rds_multi_az
  vpc_id                                = var.vpc_id
  subnet_ids                            = aws_subnet.data[*].id
  backend_security_group_id             = var.backend_security_group_id
  kms_key_arn                           = module.rds_kms.key_arn
  engine_version                        = var.rds_engine_version
  auto_minor_version_upgrade            = var.rds_auto_minor_version_upgrade
  instance_class                        = var.rds_instance_class
  allocated_storage                     = var.rds_allocated_storage
  max_allocated_storage                 = var.rds_max_allocated_storage
  db_name                               = var.rds_db_name
  master_username                       = var.rds_master_username
  port                                  = var.rds_port
  backup_retention_period               = var.rds_backup_retention_days
  deletion_protection                   = var.rds_deletion_protection
  skip_final_snapshot                   = var.rds_skip_final_snapshot
  final_snapshot_identifier             = var.rds_final_snapshot_identifier
  apply_immediately                     = var.rds_apply_immediately
  ca_cert_identifier                    = var.rds_ca_cert_identifier
  log_connections                       = var.rds_log_connections
  log_disconnections                    = var.rds_log_disconnections
  log_min_duration_statement_ms         = var.rds_log_min_duration_statement_ms
  shared_preload_libraries              = var.rds_shared_preload_libraries
  pgaudit_log                           = var.rds_pgaudit_log
  event_notification_sns_arn            = var.rds_event_notification_sns_arn
  cloudwatch_log_retention_days         = var.rds_cloudwatch_log_retention_days
  performance_insights_enabled          = var.rds_performance_insights_enabled
  performance_insights_retention_period = var.rds_performance_insights_retention_days
  performance_insights_kms_key_id       = var.rds_performance_insights_kms_key_arn
  enhanced_monitoring_enabled           = var.rds_enhanced_monitoring_enabled
  monitoring_interval                   = var.rds_monitoring_interval_seconds
  create_parameter_store                = var.create_parameter_store
  parameter_prefix                      = var.rds_parameter_prefix
  tags                                  = local.tags
}

module "elasticache" {
  count  = var.enable_valkey ? 1 : 0
  source = "../modules/elasticache"

  name_prefix                    = local.name_prefix
  vpc_id                         = var.vpc_id
  subnet_ids                     = aws_subnet.data[*].id
  availability_zones             = var.data_availability_zones
  backend_security_group_id      = var.backend_security_group_id
  kms_key_arn                    = module.valkey_kms[0].key_arn
  engine_version                 = var.valkey_engine_version
  auto_minor_version_upgrade     = var.valkey_auto_minor_version_upgrade
  node_type                      = var.valkey_node_type
  port                           = var.valkey_port
  auth_token                     = var.valkey_auth_token
  snapshot_retention_limit       = var.valkey_snapshot_retention_days
  enable_cloudwatch_logs         = var.valkey_enable_cloudwatch_logs
  cloudwatch_log_retention_days  = var.valkey_cloudwatch_log_retention_days
  cloudwatch_log_format          = var.valkey_cloudwatch_log_format
  apply_immediately              = var.valkey_apply_immediately
  auth_token_secret_name         = var.valkey_secret_name
  secret_recovery_window_in_days = var.secret_recovery_window_in_days
  enable_secret_rotation         = var.valkey_enable_secret_rotation
  secret_rotation_lambda_arn     = var.valkey_secret_rotation_lambda_arn
  secret_rotation_days           = var.valkey_secret_rotation_days
  create_parameter_store         = var.create_parameter_store
  parameter_prefix               = var.valkey_parameter_prefix
  tags                           = local.tags
}
