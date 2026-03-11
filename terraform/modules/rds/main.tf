locals {
  identifier                = "${var.name_prefix}-postgres"
  resolved_parameter_prefix = coalesce(var.parameter_prefix, "/${var.name_prefix}/data/rds")
  managed_secret_arn        = try(aws_db_instance.this.master_user_secret[0].secret_arn, null)
  managed_secret_name       = local.managed_secret_arn == null ? null : split(":secret:", local.managed_secret_arn)[1]

  parameter_store_values = var.create_parameter_store ? {
    "${local.resolved_parameter_prefix}/endpoint" = {
      value       = aws_db_instance.this.address
      description = "RDS PostgreSQL endpoint."
    }
    "${local.resolved_parameter_prefix}/port" = {
      value       = tostring(aws_db_instance.this.port)
      description = "RDS PostgreSQL port."
    }
    "${local.resolved_parameter_prefix}/database" = {
      value       = var.db_name
      description = "RDS database name."
    }
    "${local.resolved_parameter_prefix}/sslmode" = {
      value       = "verify-full"
      description = "Required PostgreSQL SSL mode for clients."
    }
    "${local.resolved_parameter_prefix}/username" = {
      value       = var.master_username
      description = "RDS master username."
    }
    "${local.resolved_parameter_prefix}/secret_arn" = {
      value       = local.managed_secret_arn
      description = "Secrets Manager ARN with database credentials."
    }
  } : {}
}

resource "aws_db_subnet_group" "this" {
  name       = "${local.identifier}-subnet-group"
  subnet_ids = var.subnet_ids

  tags = merge(
    var.tags,
    {
      Name = "${local.identifier}-subnet-group"
      Tier = "data"
    }
  )
}

resource "aws_security_group" "this" {
  name                   = "${local.identifier}-sg"
  description            = "Security group for ${local.identifier} PostgreSQL database."
  vpc_id                 = var.vpc_id
  revoke_rules_on_delete = true
  ingress                = []
  egress                 = []

  tags = merge(
    var.tags,
    {
      Name = "${local.identifier}-sg"
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
  description                  = "Allow PostgreSQL access from backend EC2 security group."
}

resource "aws_db_parameter_group" "this" {
  name        = "${local.identifier}-pg"
  family      = "postgres16"
  description = "Parameter group enforcing TLS for ${local.identifier}."

  parameter {
    name         = "rds.force_ssl"
    value        = "1"
    apply_method = "pending-reboot"
  }

  parameter {
    name         = "log_connections"
    value        = var.log_connections ? "1" : "0"
    apply_method = "immediate"
  }

  parameter {
    name         = "log_disconnections"
    value        = var.log_disconnections ? "1" : "0"
    apply_method = "immediate"
  }

  parameter {
    name         = "log_min_duration_statement"
    value        = tostring(var.log_min_duration_statement_ms)
    apply_method = "immediate"
  }

  dynamic "parameter" {
    for_each = var.shared_preload_libraries == null || trimspace(var.shared_preload_libraries) == "" ? [] : [1]
    content {
      name         = "shared_preload_libraries"
      value        = var.shared_preload_libraries
      apply_method = "pending-reboot"
    }
  }

  dynamic "parameter" {
    for_each = var.shared_preload_libraries != null && can(regex("pgaudit", var.shared_preload_libraries)) ? [1] : []
    content {
      name         = "pgaudit.log"
      value        = var.pgaudit_log
      apply_method = "pending-reboot"
    }
  }

  tags = merge(
    var.tags,
    {
      Name = "${local.identifier}-pg"
      Tier = "data"
    }
  )
}

resource "aws_cloudwatch_log_group" "postgresql" {
  name              = "/aws/rds/instance/${local.identifier}/postgresql"
  retention_in_days = var.cloudwatch_log_retention_days
  kms_key_id        = var.kms_key_arn
  tags              = var.tags
}

resource "aws_cloudwatch_log_group" "upgrade" {
  name              = "/aws/rds/instance/${local.identifier}/upgrade"
  retention_in_days = var.cloudwatch_log_retention_days
  kms_key_id        = var.kms_key_arn
  tags              = var.tags
}

data "aws_iam_policy_document" "enhanced_monitoring_assume_role" {
  count = var.enhanced_monitoring_enabled ? 1 : 0

  statement {
    effect = "Allow"
    actions = [
      "sts:AssumeRole"
    ]

    principals {
      type        = "Service"
      identifiers = ["monitoring.rds.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "enhanced_monitoring" {
  count = var.enhanced_monitoring_enabled ? 1 : 0

  name               = "${local.identifier}-enhanced-monitoring-role"
  assume_role_policy = data.aws_iam_policy_document.enhanced_monitoring_assume_role[0].json
  tags               = var.tags
}

resource "aws_iam_role_policy_attachment" "enhanced_monitoring" {
  count = var.enhanced_monitoring_enabled ? 1 : 0

  role       = aws_iam_role.enhanced_monitoring[0].name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonRDSEnhancedMonitoringRole"
}

resource "aws_db_instance" "this" {
  identifier                            = local.identifier
  engine                                = "postgres"
  engine_version                        = var.engine_version
  auto_minor_version_upgrade            = var.auto_minor_version_upgrade
  instance_class                        = var.instance_class
  allocated_storage                     = var.allocated_storage
  max_allocated_storage                 = var.max_allocated_storage
  storage_encrypted                     = true
  kms_key_id                            = var.kms_key_arn
  db_name                               = var.db_name
  username                              = var.master_username
  manage_master_user_password           = true
  master_user_secret_kms_key_id         = var.kms_key_arn
  port                                  = var.port
  multi_az                              = var.multi_az
  db_subnet_group_name                  = aws_db_subnet_group.this.name
  vpc_security_group_ids                = [aws_security_group.this.id]
  publicly_accessible                   = false
  backup_retention_period               = var.backup_retention_period
  deletion_protection                   = var.deletion_protection
  enabled_cloudwatch_logs_exports       = ["postgresql", "upgrade"]
  parameter_group_name                  = aws_db_parameter_group.this.name
  copy_tags_to_snapshot                 = true
  apply_immediately                     = var.apply_immediately
  ca_cert_identifier                    = var.ca_cert_identifier
  skip_final_snapshot                   = var.skip_final_snapshot
  final_snapshot_identifier             = var.skip_final_snapshot ? null : coalesce(var.final_snapshot_identifier, "${local.identifier}-final")
  performance_insights_enabled          = var.performance_insights_enabled
  performance_insights_kms_key_id       = var.performance_insights_enabled ? coalesce(var.performance_insights_kms_key_id, var.kms_key_arn) : null
  performance_insights_retention_period = var.performance_insights_enabled ? var.performance_insights_retention_period : null
  monitoring_interval                   = var.enhanced_monitoring_enabled ? var.monitoring_interval : 0
  monitoring_role_arn                   = var.enhanced_monitoring_enabled ? aws_iam_role.enhanced_monitoring[0].arn : null

  tags = merge(
    var.tags,
    {
      Name = local.identifier
      Tier = "data"
    }
  )

  depends_on = [
    aws_cloudwatch_log_group.postgresql,
    aws_cloudwatch_log_group.upgrade,
    aws_iam_role_policy_attachment.enhanced_monitoring
  ]
}

module "parameters" {
  source = "../parameter-store"

  parameters = local.parameter_store_values
  tags       = var.tags
}

resource "aws_db_event_subscription" "this" {
  count = var.event_notification_sns_arn != null ? 1 : 0

  name      = "${local.identifier}-events"
  sns_topic = var.event_notification_sns_arn

  source_type = "db-instance"
  source_ids  = [aws_db_instance.this.id]

  event_categories = [
    "availability",
    "deletion",
    "failover",
    "failure",
    "maintenance",
    "notification",
    "recovery",
    "restoration",
  ]

  tags = var.tags
}
