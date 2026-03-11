variable "name" {
  description = "Name of the CloudTrail trail."
  type        = string
}

variable "s3_bucket_name" {
  description = "S3 bucket name used for CloudTrail log delivery."
  type        = string
}

variable "s3_key_prefix" {
  description = "Optional key prefix inside the CloudTrail S3 bucket."
  type        = string
  default     = "cloudtrail"
}

variable "s3_force_destroy" {
  description = "Whether deleting a non-empty CloudTrail log bucket is allowed."
  type        = bool
  default     = false
}

variable "s3_kms_key_arn" {
  description = "Optional KMS key ARN for CloudTrail S3 bucket encryption."
  type        = string
  default     = null
}

variable "s3_log_retention_days" {
  description = "Days to retain CloudTrail logs in S3. Set null to disable object expiration."
  type        = number
  default     = 365
  nullable    = true

  validation {
    condition     = var.s3_log_retention_days == null || var.s3_log_retention_days > 0
    error_message = "s3_log_retention_days must be null or greater than 0."
  }
}

variable "enable_logging" {
  description = "Enable CloudTrail logging."
  type        = bool
  default     = true
}

variable "include_global_service_events" {
  description = "Include global service events in CloudTrail."
  type        = bool
  default     = true
}

variable "is_multi_region_trail" {
  description = "Whether the trail captures events in all regions."
  type        = bool
  default     = true
}

variable "enable_log_file_validation" {
  description = "Enable CloudTrail log file integrity validation."
  type        = bool
  default     = true
}

variable "kms_key_id" {
  description = "Optional KMS key ARN/ID for CloudTrail log file encryption."
  type        = string
  default     = null
}

variable "enable_cloudwatch_logs" {
  description = "Enable forwarding CloudTrail events to CloudWatch Logs."
  type        = bool
  default     = true
}

variable "cloudwatch_log_group_name" {
  description = "Optional CloudWatch log group name for CloudTrail logs."
  type        = string
  default     = null
}

variable "cloudwatch_log_retention_days" {
  description = "CloudWatch log retention in days for CloudTrail logs."
  type        = number
  default     = 365

  validation {
    condition     = var.cloudwatch_log_retention_days > 0
    error_message = "cloudwatch_log_retention_days must be greater than 0."
  }
}

variable "cloudwatch_kms_key_id" {
  description = "Optional KMS key ARN/ID for CloudWatch log group encryption."
  type        = string
  default     = null
}

variable "include_management_events" {
  description = "Capture management events in CloudTrail."
  type        = bool
  default     = true
}

variable "read_write_type" {
  description = "Management event read/write capture mode."
  type        = string
  default     = "All"

  validation {
    condition     = contains(["All", "ReadOnly", "WriteOnly"], var.read_write_type)
    error_message = "read_write_type must be All, ReadOnly or WriteOnly."
  }
}

variable "s3_data_event_arns" {
  description = "S3 object data event ARNs (for example arn:aws:s3:::bucket/)."
  type        = list(string)
  default     = []
}

variable "tags" {
  description = "Tags applied to all resources."
  type        = map(string)
  default     = {}
}
