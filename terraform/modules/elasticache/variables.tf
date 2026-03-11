variable "name_prefix" {
  description = "Prefix used for naming ElastiCache resources."
  type        = string
}

variable "vpc_id" {
  description = "VPC ID where ElastiCache resources are deployed."
  type        = string
}

variable "subnet_ids" {
  description = "Subnet IDs used for ElastiCache subnet group."
  type        = list(string)

  validation {
    condition     = length(var.subnet_ids) == 2
    error_message = "subnet_ids must contain exactly 2 subnet IDs."
  }
}

variable "availability_zones" {
  description = "Exactly two availability zones for primary and replica placement."
  type        = list(string)

  validation {
    condition     = length(var.availability_zones) == 2
    error_message = "availability_zones must contain exactly 2 AZs."
  }
}

variable "backend_security_group_id" {
  description = "Security group ID of backend EC2 instances allowed to connect to Valkey."
  type        = string
}

variable "kms_key_arn" {
  description = "KMS key ARN for ElastiCache at-rest encryption and secret encryption."
  type        = string
}

variable "engine_version" {
  description = "Valkey engine version."
  type        = string
  default     = "8.2"
}

variable "auto_minor_version_upgrade" {
  description = "Enable automatic minor version upgrades."
  type        = bool
  default     = true
}

variable "node_type" {
  description = "ElastiCache node type."
  type        = string
  default     = "cache.t4g.medium"
}

variable "port" {
  description = "Valkey port."
  type        = number
  default     = 6379
}

variable "auth_token" {
  description = "Optional auth token. If null, a token is generated and stored in Secrets Manager."
  type        = string
  default     = null
  sensitive   = true

  validation {
    condition     = var.auth_token == null || (length(var.auth_token) >= 16 && length(var.auth_token) <= 128)
    error_message = "auth_token must be null or between 16 and 128 characters."
  }
}

variable "snapshot_retention_limit" {
  description = "Number of days for Valkey automatic snapshots."
  type        = number
  default     = 30
}

variable "enable_cloudwatch_logs" {
  description = "Enable Valkey engine/slow log delivery to CloudWatch Logs."
  type        = bool
  default     = true
}

variable "cloudwatch_log_retention_days" {
  description = "Retention in days for Valkey CloudWatch log groups."
  type        = number
  default     = 90
}

variable "cloudwatch_log_format" {
  description = "Valkey log format for CloudWatch log delivery."
  type        = string
  default     = "json"

  validation {
    condition     = contains(["json", "text"], var.cloudwatch_log_format)
    error_message = "cloudwatch_log_format must be either json or text."
  }
}

variable "apply_immediately" {
  description = "Apply modifications immediately."
  type        = bool
  default     = false
}

variable "auth_token_secret_name" {
  description = "Optional explicit Secrets Manager secret name for Valkey auth token."
  type        = string
  default     = null
}

variable "secret_recovery_window_in_days" {
  description = "Recovery window in days for the auth token secret."
  type        = number
  default     = 30
}

variable "enable_secret_rotation" {
  description = "Enable automatic secret rotation for Valkey auth token."
  type        = bool
  default     = false

  validation {
    condition     = !var.enable_secret_rotation || (var.secret_rotation_lambda_arn != null && length(trimspace(var.secret_rotation_lambda_arn)) > 0)
    error_message = "secret_rotation_lambda_arn must be set when enable_secret_rotation is true."
  }
}

variable "secret_rotation_lambda_arn" {
  description = "Lambda ARN used by Secrets Manager for Valkey auth token rotation."
  type        = string
  default     = null
}

variable "secret_rotation_days" {
  description = "Days between automatic Valkey auth token rotations."
  type        = number
  default     = 30

  validation {
    condition     = var.secret_rotation_days >= 1
    error_message = "secret_rotation_days must be at least 1."
  }
}

variable "create_parameter_store" {
  description = "Whether to publish connection metadata to SSM Parameter Store."
  type        = bool
  default     = true
}

variable "parameter_prefix" {
  description = "Optional SSM parameter prefix for Valkey connection values."
  type        = string
  default     = null
}

variable "tags" {
  description = "Tags applied to all resources."
  type        = map(string)
  default     = {}
}
