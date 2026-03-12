variable "project_name" {
  description = "Project name used in resource naming."
  type        = string
}

variable "environment" {
  description = "Environment name (e.g. prod, staging)."
  type        = string
}

variable "aws_region" {
  description = "AWS region where resources are created."
  type        = string

  validation {
    condition     = var.aws_region == "eu-central-2"
    error_message = "Data residency requirement: resources must be created in eu-central-2 (Zurich)."
  }
}

variable "bucket_name" {
  description = "S3 bucket name for patient documents. Must be globally unique."
  type        = string
}

variable "ssm_parameter_prefix" {
  description = "SSM Parameter Store prefix for documents metadata (e.g. /patientsync/prod/documents)."
  type        = string
}

variable "access_log_retention_days" {
  description = "Retention period in days for S3 server access logs."
  type        = number
  default     = 90
}

variable "tags" {
  description = "Additional tags to apply to all resources."
  type        = map(string)
  default     = {}
}
