variable "project_name" {
  description = "Project name used in resource naming."
  type        = string
}

variable "environment" {
  description = "Environment name (e.g. dev, stage, prod)."
  type        = string
}

variable "aws_region" {
  description = "AWS region for data layer resources. Must be eu-central-2 (Zurich)."
  type        = string

  validation {
    condition     = var.aws_region == "eu-central-2"
    error_message = "aws_region must be eu-central-2 for Swiss data residency requirements."
  }
}

variable "vpc_id" {
  description = "Existing VPC ID where data subnets and data services are created."
  type        = string

  validation {
    condition     = length(trimspace(var.vpc_id)) > 0
    error_message = "vpc_id must not be empty."
  }
}

variable "backend_security_group_id" {
  description = "Backend EC2 security group ID allowed to connect to RDS and Valkey."
  type        = string

  validation {
    condition     = length(trimspace(var.backend_security_group_id)) > 0
    error_message = "backend_security_group_id must not be empty."
  }
}

variable "data_availability_zones" {
  description = "Exactly two AZs for data subnets and HA data services."
  type        = list(string)
  default     = ["eu-central-2a", "eu-central-2b"]

  validation {
    condition     = length(var.data_availability_zones) == 2 && length(distinct(var.data_availability_zones)) == 2
    error_message = "data_availability_zones must contain exactly two distinct AZs."
  }

  validation {
    condition     = contains(var.data_availability_zones, "eu-central-2a") && contains(var.data_availability_zones, "eu-central-2b")
    error_message = "data_availability_zones must include eu-central-2a and eu-central-2b."
  }
}

variable "data_subnet_cidrs" {
  description = "Two dedicated /24 data subnets without internet routes."
  type        = list(string)
  default     = ["10.50.21.0/24", "10.50.22.0/24"]

  validation {
    condition     = length(var.data_subnet_cidrs) == 2 && length(distinct(var.data_subnet_cidrs)) == 2
    error_message = "data_subnet_cidrs must contain exactly 2 distinct CIDR blocks."
  }

  validation {
    condition     = alltrue([for cidr in var.data_subnet_cidrs : can(regex("/24$", cidr))])
    error_message = "All data_subnet_cidrs must be /24 networks."
  }
}

variable "rds_multi_az" {
  description = "Enable Multi-AZ for RDS. Set false for Free Tier / dev. Default true for production."
  type        = bool
  default     = true
}

variable "rds_engine_version" {
  description = "PostgreSQL engine version."
  type        = string
  default     = "16.11"
}

variable "rds_auto_minor_version_upgrade" {
  description = "Enable automatic minor version upgrades for RDS."
  type        = bool
  default     = true
}

variable "rds_instance_class" {
  description = "RDS instance class."
  type        = string
  default     = "db.t4g.medium"
}

variable "rds_allocated_storage" {
  description = "Initial RDS storage in GiB."
  type        = number
  default     = 100
}

variable "rds_max_allocated_storage" {
  description = "Maximum autoscaled RDS storage in GiB."
  type        = number
  default     = 500
}

variable "rds_db_name" {
  description = "PostgreSQL database name."
  type        = string
  default     = "patientsync"
}

variable "rds_master_username" {
  description = "RDS master username."
  type        = string
  default     = "patientsync_admin"
}

variable "rds_port" {
  description = "RDS PostgreSQL port."
  type        = number
  default     = 5432
}

variable "rds_backup_retention_days" {
  description = "RDS automated backup retention in days."
  type        = number
  default     = 30

  validation {
    condition     = var.rds_backup_retention_days >= 0 && var.rds_backup_retention_days <= 35
    error_message = "rds_backup_retention_days must be between 0 (disabled) and 35."
  }
}

variable "rds_deletion_protection" {
  description = "Enable deletion protection on RDS instance."
  type        = bool
  default     = true
}

variable "rds_skip_final_snapshot" {
  description = "Skip final RDS snapshot on destroy. Should remain false for production."
  type        = bool
  default     = false
}

variable "rds_final_snapshot_identifier" {
  description = "Optional explicit final snapshot identifier for RDS destroy operations."
  type        = string
  default     = null
}

variable "rds_apply_immediately" {
  description = "Apply RDS changes immediately."
  type        = bool
  default     = false
}

variable "rds_ca_cert_identifier" {
  description = "Optional CA certificate identifier for RDS."
  type        = string
  default     = null
}

variable "rds_log_connections" {
  description = "Enable PostgreSQL connection logging."
  type        = bool
  default     = true
}

variable "rds_log_disconnections" {
  description = "Enable PostgreSQL disconnection logging."
  type        = bool
  default     = true
}

variable "rds_log_min_duration_statement_ms" {
  description = "Log PostgreSQL statements taking at least this many ms."
  type        = number
  default     = 1000

  validation {
    condition     = var.rds_log_min_duration_statement_ms >= 0
    error_message = "rds_log_min_duration_statement_ms must be >= 0."
  }
}

variable "rds_shared_preload_libraries" {
  description = "Optional shared_preload_libraries for PostgreSQL parameter group."
  type        = string
  default     = "pg_stat_statements,pgaudit"
}

variable "rds_pgaudit_log" {
  description = "pgaudit.log categories for SQL-level audit logging (DSGVO Art. 32)."
  type        = string
  default     = "write,ddl"
}

variable "rds_event_notification_sns_arn" {
  description = "Optional SNS topic ARN for RDS event notifications."
  type        = string
  default     = null
}

variable "rds_performance_insights_enabled" {
  description = "Enable RDS Performance Insights."
  type        = bool
  default     = true
}

variable "rds_performance_insights_retention_days" {
  description = "RDS Performance Insights retention in days."
  type        = number
  default     = 7

  validation {
    condition     = var.rds_performance_insights_retention_days >= 7 && var.rds_performance_insights_retention_days <= 731
    error_message = "rds_performance_insights_retention_days must be between 7 and 731."
  }
}

variable "rds_performance_insights_kms_key_arn" {
  description = "Optional KMS key ARN for RDS Performance Insights."
  type        = string
  default     = null
}

variable "rds_enhanced_monitoring_enabled" {
  description = "Enable RDS Enhanced Monitoring."
  type        = bool
  default     = true
}

variable "rds_monitoring_interval_seconds" {
  description = "RDS Enhanced Monitoring interval in seconds."
  type        = number
  default     = 60

  validation {
    condition     = contains([1, 5, 10, 15, 30, 60], var.rds_monitoring_interval_seconds)
    error_message = "rds_monitoring_interval_seconds must be one of: 1, 5, 10, 15, 30, 60."
  }
}

variable "rds_cloudwatch_log_retention_days" {
  description = "Retention period for RDS CloudWatch logs."
  type        = number
  default     = 90
}

variable "rds_parameter_prefix" {
  description = "Optional SSM parameter prefix for RDS metadata."
  type        = string
  default     = null
}

variable "enable_valkey" {
  description = "Enable Valkey (ElastiCache) deployment. Set false to deploy only RDS."
  type        = bool
  default     = true
}

variable "valkey_engine_version" {
  description = "Valkey engine version."
  type        = string
  default     = "8.2"
}

variable "valkey_auto_minor_version_upgrade" {
  description = "Enable automatic minor version upgrades for Valkey."
  type        = bool
  default     = true
}

variable "valkey_node_type" {
  description = "Valkey node type."
  type        = string
  default     = "cache.t4g.medium"
}

variable "valkey_port" {
  description = "Valkey port."
  type        = number
  default     = 6379
}

variable "valkey_auth_token" {
  description = "Optional Valkey auth token. If null, a secure token is generated and stored in Secrets Manager."
  type        = string
  default     = null
  sensitive   = true
}

variable "valkey_snapshot_retention_days" {
  description = "Automatic snapshot retention for Valkey in days."
  type        = number
  default     = 30
}

variable "valkey_enable_cloudwatch_logs" {
  description = "Enable Valkey engine/slow log delivery to CloudWatch."
  type        = bool
  default     = true
}

variable "valkey_cloudwatch_log_retention_days" {
  description = "Retention in days for Valkey CloudWatch logs."
  type        = number
  default     = 90
}

variable "valkey_cloudwatch_log_format" {
  description = "Valkey CloudWatch log format (json or text)."
  type        = string
  default     = "json"
}

variable "valkey_apply_immediately" {
  description = "Apply Valkey changes immediately."
  type        = bool
  default     = false
}

variable "valkey_secret_name" {
  description = "Optional explicit secret name for Valkey auth token."
  type        = string
  default     = null
}

variable "valkey_enable_secret_rotation" {
  description = "Enable automatic rotation for Valkey auth token secret."
  type        = bool
  default     = false

  validation {
    condition     = !var.valkey_enable_secret_rotation || (var.valkey_secret_rotation_lambda_arn != null && length(trimspace(var.valkey_secret_rotation_lambda_arn)) > 0)
    error_message = "valkey_secret_rotation_lambda_arn must be set when valkey_enable_secret_rotation is true."
  }
}

variable "valkey_secret_rotation_lambda_arn" {
  description = "Lambda ARN used for Valkey auth token secret rotation."
  type        = string
  default     = null
}

variable "valkey_secret_rotation_days" {
  description = "Days between automatic Valkey secret rotations."
  type        = number
  default     = 30

  validation {
    condition     = var.valkey_secret_rotation_days >= 1
    error_message = "valkey_secret_rotation_days must be at least 1."
  }
}

variable "valkey_parameter_prefix" {
  description = "Optional SSM parameter prefix for Valkey metadata."
  type        = string
  default     = null
}

variable "create_parameter_store" {
  description = "Create SSM Parameter Store entries for non-sensitive connection metadata."
  type        = bool
  default     = true
}

variable "secret_recovery_window_in_days" {
  description = "Recovery window for created secrets."
  type        = number
  default     = 30
}

variable "tags" {
  description = "Additional tags for all resources."
  type        = map(string)
  default     = {}
}
