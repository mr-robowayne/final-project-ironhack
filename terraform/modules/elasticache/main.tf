locals {
  replication_group_id      = "${var.name_prefix}-valkey"
  resolved_auth_token       = coalesce(var.auth_token, random_password.auth_token.result)
  resolved_secret_name      = coalesce(var.auth_token_secret_name, "${var.name_prefix}/data/valkey")
  resolved_parameter_prefix = coalesce(var.parameter_prefix, "/${var.name_prefix}/data/valkey")
  log_delivery_destinations = var.enable_cloudwatch_logs ? {
    "engine-log" = aws_cloudwatch_log_group.engine[0].name
    "slow-log"   = aws_cloudwatch_log_group.slow[0].name
  } : {}

  parameter_store_values = var.create_parameter_store ? {
    "${local.resolved_parameter_prefix}/primary_endpoint" = {
      value       = aws_elasticache_replication_group.this.primary_endpoint_address
      description = "Valkey primary endpoint."
    }
    "${local.resolved_parameter_prefix}/port" = {
      value       = tostring(aws_elasticache_replication_group.this.port)
      description = "Valkey port."
    }
    "${local.resolved_parameter_prefix}/secret_arn" = {
      value       = module.auth_token_secret.secret_arn
      description = "Secrets Manager ARN containing Valkey auth token."
    }
  } : {}
}

resource "random_password" "auth_token" {
  length  = 32
  special = false
}

resource "aws_security_group" "this" {
  name                   = "${local.replication_group_id}-sg"
  description            = "Security group for ${local.replication_group_id} Valkey replication group."
  vpc_id                 = var.vpc_id
  revoke_rules_on_delete = true
  ingress                = []
  egress                 = []

  tags = merge(
    var.tags,
    {
      Name = "${local.replication_group_id}-sg"
      Tier = "data"
    }
  )
}

resource "aws_vpc_security_group_ingress_rule" "from_backend" {
  security_group_id            = aws_security_group.this.id
  referenced_security_group_id = var.backend_security_group_id
  ip_protocol                  = "tcp"
  from_port                    = var.port
  to_port                      = var.port
  description                  = "Allow Valkey access from backend EC2 security group."
}

resource "aws_elasticache_subnet_group" "this" {
  name       = "${local.replication_group_id}-subnet-group"
  subnet_ids = var.subnet_ids

  tags = merge(
    var.tags,
    {
      Name = "${local.replication_group_id}-subnet-group"
      Tier = "data"
    }
  )
}

resource "aws_cloudwatch_log_group" "engine" {
  count = var.enable_cloudwatch_logs ? 1 : 0

  name              = "/aws/elasticache/${local.replication_group_id}/engine-log"
  retention_in_days = var.cloudwatch_log_retention_days
  kms_key_id        = var.kms_key_arn
  tags              = var.tags
}

resource "aws_cloudwatch_log_group" "slow" {
  count = var.enable_cloudwatch_logs ? 1 : 0

  name              = "/aws/elasticache/${local.replication_group_id}/slow-log"
  retention_in_days = var.cloudwatch_log_retention_days
  kms_key_id        = var.kms_key_arn
  tags              = var.tags
}

resource "aws_elasticache_replication_group" "this" {
  replication_group_id       = local.replication_group_id
  description                = "Valkey replication group for ${var.name_prefix}."
  engine                     = "valkey"
  engine_version             = var.engine_version
  auto_minor_version_upgrade = var.auto_minor_version_upgrade
  node_type                  = var.node_type
  port                       = var.port

  subnet_group_name           = aws_elasticache_subnet_group.this.name
  security_group_ids          = [aws_security_group.this.id]
  preferred_cache_cluster_azs = var.availability_zones

  num_cache_clusters         = 2
  automatic_failover_enabled = true
  multi_az_enabled           = true

  transit_encryption_enabled = true
  transit_encryption_mode    = "required"
  at_rest_encryption_enabled = true
  auth_token                 = local.resolved_auth_token
  auth_token_update_strategy = "SET"
  kms_key_id                 = var.kms_key_arn

  snapshot_retention_limit = var.snapshot_retention_limit
  apply_immediately        = var.apply_immediately

  dynamic "log_delivery_configuration" {
    for_each = local.log_delivery_destinations
    content {
      destination_type = "cloudwatch-logs"
      destination      = log_delivery_configuration.value
      log_format       = var.cloudwatch_log_format
      log_type         = log_delivery_configuration.key
    }
  }

  tags = merge(
    var.tags,
    {
      Name = local.replication_group_id
      Tier = "data"
    }
  )
}

module "auth_token_secret" {
  source = "../secret-manager"

  name        = local.resolved_secret_name
  description = "Valkey auth token and endpoint for ${local.replication_group_id}."
  secret_string = jsonencode({
    engine           = "valkey"
    host             = aws_elasticache_replication_group.this.primary_endpoint_address
    port             = aws_elasticache_replication_group.this.port
    auth_token       = local.resolved_auth_token
    transit_tls_mode = "required"
  })
  kms_key_id              = var.kms_key_arn
  recovery_window_in_days = var.secret_recovery_window_in_days
  create_secret_version   = true
  tags                    = var.tags
}

resource "aws_secretsmanager_secret_rotation" "auth_token" {
  count = var.enable_secret_rotation ? 1 : 0

  secret_id           = module.auth_token_secret.secret_arn
  rotation_lambda_arn = var.secret_rotation_lambda_arn

  rotation_rules {
    automatically_after_days = var.secret_rotation_days
  }
}

module "parameters" {
  source = "../parameter-store"

  parameters = local.parameter_store_values
  tags       = var.tags
}
