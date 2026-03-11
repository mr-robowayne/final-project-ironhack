variable "name_prefix" {
  description = "Prefix used for naming RDS resources."
  type        = string
}

variable "vpc_id" {
  description = "VPC ID where the RDS resources are deployed."
  type        = string
}

variable "subnet_ids" {
  description = "Subnet IDs used for the RDS subnet group."
  type        = list(string)

  validation {
    condition     = length(var.subnet_ids) == 2
    error_message = "subnet_ids must contain exactly 2 subnet IDs."
  }
}

variable "backend_security_group_id" {
  description = "Security group ID of backend EC2 instances allowed to connect to PostgreSQL."
  type        = string
}

variable "kms_key_arn" {
  description = "KMS key ARN used for RDS encryption and secret encryption."
  type        = string
}

variable "engine_version" {
  description = "PostgreSQL engine version."
  type        = string
  default     = "16.11"
}

variable "auto_minor_version_upgrade" {
  description = "Enable automatic minor version upgrades."
  type        = bool
  default     = true
}

variable "instance_class" {
  description = "RDS instance class."
  type        = string
  default     = "db.t4g.medium"
}

variable "allocated_storage" {
  description = "Initial allocated storage in GiB."
  type        = number
  default     = 100
}

variable "max_allocated_storage" {
  description = "Maximum autoscaled storage in GiB."
  type        = number
  default     = 500
}

variable "db_name" {
  description = "Database name to create."
  type        = string
  default     = "patientsync"
}

variable "master_username" {
  description = "Master username for PostgreSQL."
  type        = string
  default     = "patientsync_admin"
}

variable "port" {
  description = "Database port."
  type        = number
  default     = 5432
}

variable "multi_az" {
  description = "Enable Multi-AZ deployment for high availability. Disable for Free Tier / dev environments."
  type        = bool
  default     = true
}

variable "backup_retention_period" {
  description = "Automated backup retention in days."
  type        = number
  default     = 30

  validation {
    condition     = var.backup_retention_period >= 0 && var.backup_retention_period <= 35
    error_message = "backup_retention_period must be between 0 (disabled) and 35 days."
  }
}

variable "deletion_protection" {
  description = "Enable deletion protection for the DB instance."
  type        = bool
  default     = true
}

variable "skip_final_snapshot" {
  description = "Skip final snapshot on destroy. Must be false for production safety."
  type        = bool
  default     = false
}

variable "final_snapshot_identifier" {
  description = "Optional explicit final snapshot identifier. If null, one is generated."
  type        = string
  default     = null
}

variable "apply_immediately" {
  description = "Apply modifications immediately."
  type        = bool
  default     = false
}

variable "ca_cert_identifier" {
  description = "Optional CA certificate identifier for PostgreSQL."
  type        = string
  default     = null
}

variable "performance_insights_enabled" {
  description = "Enable RDS Performance Insights."
  type        = bool
  default     = true
}

variable "performance_insights_retention_period" {
  description = "RDS Performance Insights retention in days."
  type        = number
  default     = 7

  validation {
    condition     = var.performance_insights_retention_period >= 7 && var.performance_insights_retention_period <= 731
    error_message = "performance_insights_retention_period must be between 7 and 731."
  }
}

variable "performance_insights_kms_key_id" {
  description = "Optional KMS key ARN/ID for RDS Performance Insights."
  type        = string
  default     = null
}

variable "enhanced_monitoring_enabled" {
  description = "Enable RDS Enhanced Monitoring."
  type        = bool
  default     = true
}

variable "monitoring_interval" {
  description = "RDS Enhanced Monitoring interval in seconds."
  type        = number
  default     = 60

  validation {
    condition     = contains([1, 5, 10, 15, 30, 60], var.monitoring_interval)
    error_message = "monitoring_interval must be one of: 1, 5, 10, 15, 30, 60."
  }
}

variable "cloudwatch_log_retention_days" {
  description = "CloudWatch log retention for PostgreSQL exported logs."
  type        = number
  default     = 90
}

variable "log_connections" {
  description = "Enable PostgreSQL connection logging."
  type        = bool
  default     = true
}

variable "log_disconnections" {
  description = "Enable PostgreSQL disconnection logging."
  type        = bool
  default     = true
}

variable "log_min_duration_statement_ms" {
  description = "Log statements whose runtime is at least this many milliseconds (0 logs all statements)."
  type        = number
  default     = 1000

  validation {
    condition     = var.log_min_duration_statement_ms >= 0
    error_message = "log_min_duration_statement_ms must be >= 0."
  }
}

variable "shared_preload_libraries" {
  description = "Optional PostgreSQL shared_preload_libraries value (for example: pg_stat_statements,pgaudit)."
  type        = string
  default     = null
}

variable "pgaudit_log" {
  description = "pgaudit.log categories. Applied only when pgaudit is in shared_preload_libraries. write,ddl logs all DML writes and schema changes (DSGVO Art. 32 minimum)."
  type        = string
  default     = "write,ddl"
}

variable "event_notification_sns_arn" {
  description = "Optional SNS topic ARN for RDS event notifications (failover, failure, maintenance, deletion)."
  type        = string
  default     = null
}

variable "create_parameter_store" {
  description = "Whether to publish connection metadata to SSM Parameter Store."
  type        = bool
  default     = true
}

variable "parameter_prefix" {
  description = "Optional SSM parameter prefix."
  type        = string
  default     = null
}

variable "tags" {
  description = "Tags applied to all resources."
  type        = map(string)
  default     = {}
}
