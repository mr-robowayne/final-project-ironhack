variable "project_name" {
  description = "Project name used for naming resources."
  type        = string
}

variable "environment" {
  description = "Environment name (e.g. dev, stage, prod)."
  type        = string
}

variable "aws_region" {
  description = "AWS region for backend service resources."
  type        = string
}

variable "backend_region" {
  description = "Optional backend state region override (S3/Dynamo backend region)."
  type        = string
  default     = null
}

variable "state_bucket_name" {
  description = "Existing Terraform backend S3 bucket name."
  type        = string
}

variable "lock_table_name" {
  description = "Existing Terraform backend DynamoDB lock table name."
  type        = string
}

variable "role_arn" {
  description = "Existing Terraform backend IAM role ARN."
  type        = string
}

variable "state_key" {
  description = "Terraform state object key."
  type        = string
  default     = "deploy-backend/terraform.tfstate"
}

variable "secret_name" {
  description = "Optional explicit name for the backend Secrets Manager secret."
  type        = string
  default     = null
}

variable "secret_kms_key_id" {
  description = "Optional KMS key ID or ARN for secret encryption."
  type        = string
  default     = null
}

variable "create_kms_key" {
  description = "Create a shared KMS key for backend resources when dedicated KMS values are not provided."
  type        = bool
  default     = true
}

variable "ssm_document_name" {
  description = "Optional explicit SSM document name."
  type        = string
  default     = null
}

variable "ssm_document_content" {
  description = "Content for the backend SSM document."
  type        = string
  default     = "{\"schemaVersion\":\"2.2\",\"description\":\"Backend ops placeholder document\",\"mainSteps\":[{\"action\":\"aws:runShellScript\",\"name\":\"noop\",\"inputs\":{\"runCommand\":[\"echo backend-ops\"]}}]}"
}

variable "parameter_prefix" {
  description = "Optional Parameter Store path prefix."
  type        = string
  default     = null
}

variable "additional_parameter_store_values" {
  description = "Additional Parameter Store entries merged into module-managed parameters."
  type = map(object({
    value       = string
    type        = optional(string, "String")
    description = optional(string)
    tier        = optional(string, "Standard")
    key_id      = optional(string)
    overwrite   = optional(bool, true)
  }))
  default = {}
}

variable "create_secret_manager" {
  description = "Whether to create/update the backend secret in Secrets Manager."
  type        = bool
  default     = true
}

variable "create_ssm" {
  description = "Whether to create/update the backend SSM document."
  type        = bool
  default     = true
}

variable "create_parameter_store" {
  description = "Whether to create/update backend values in Parameter Store."
  type        = bool
  default     = true
}

variable "create_cloudtrail" {
  description = "Whether to create CloudTrail audit logging resources."
  type        = bool
  default     = true
}

variable "cloudtrail_name" {
  description = "Optional explicit CloudTrail trail name."
  type        = string
  default     = null
}

variable "cloudtrail_s3_bucket_name" {
  description = "Optional explicit S3 bucket name for CloudTrail logs."
  type        = string
  default     = null
}

variable "cloudtrail_s3_key_prefix" {
  description = "S3 key prefix for CloudTrail logs."
  type        = string
  default     = "cloudtrail"
}

variable "cloudtrail_s3_force_destroy" {
  description = "Allow deleting CloudTrail S3 bucket with objects."
  type        = bool
  default     = false
}

variable "cloudtrail_s3_kms_key_arn" {
  description = "Optional KMS key ARN for CloudTrail S3 bucket encryption."
  type        = string
  default     = null
}

variable "cloudtrail_s3_log_retention_days" {
  description = "Days to retain CloudTrail S3 objects. Set null to disable expiration."
  type        = number
  default     = 365
  nullable    = true

  validation {
    condition     = var.cloudtrail_s3_log_retention_days == null || var.cloudtrail_s3_log_retention_days > 0
    error_message = "cloudtrail_s3_log_retention_days must be null or greater than 0."
  }
}

variable "cloudtrail_enable_logging" {
  description = "Enable CloudTrail event logging."
  type        = bool
  default     = true
}

variable "cloudtrail_include_global_service_events" {
  description = "Include global service events in CloudTrail."
  type        = bool
  default     = true
}

variable "cloudtrail_is_multi_region_trail" {
  description = "Capture events from all AWS regions."
  type        = bool
  default     = true
}

variable "cloudtrail_enable_log_file_validation" {
  description = "Enable CloudTrail log integrity validation."
  type        = bool
  default     = true
}

variable "cloudtrail_kms_key_id" {
  description = "Optional KMS key ARN/ID used by CloudTrail."
  type        = string
  default     = null
}

variable "cloudtrail_enable_cloudwatch_logs" {
  description = "Send CloudTrail events to CloudWatch Logs."
  type        = bool
  default     = true
}

variable "cloudtrail_cloudwatch_log_group_name" {
  description = "Optional explicit CloudWatch log group name for CloudTrail."
  type        = string
  default     = null
}

variable "cloudtrail_cloudwatch_log_retention_days" {
  description = "Retention in days for CloudTrail CloudWatch logs."
  type        = number
  default     = 365

  validation {
    condition     = var.cloudtrail_cloudwatch_log_retention_days > 0
    error_message = "cloudtrail_cloudwatch_log_retention_days must be greater than 0."
  }
}

variable "cloudtrail_cloudwatch_kms_key_id" {
  description = "Optional KMS key ARN/ID for CloudTrail CloudWatch log group encryption."
  type        = string
  default     = null
}

variable "cloudtrail_include_management_events" {
  description = "Capture management events in CloudTrail."
  type        = bool
  default     = true
}

variable "cloudtrail_read_write_type" {
  description = "Management event capture mode (All, ReadOnly, WriteOnly)."
  type        = string
  default     = "All"

  validation {
    condition     = contains(["All", "ReadOnly", "WriteOnly"], var.cloudtrail_read_write_type)
    error_message = "cloudtrail_read_write_type must be All, ReadOnly, or WriteOnly."
  }
}

variable "cloudtrail_enable_state_bucket_data_events" {
  description = "Capture S3 object-level data events for the Terraform state bucket."
  type        = bool
  default     = true
}

variable "cloudtrail_additional_s3_data_event_arns" {
  description = "Additional S3 object-level data event ARNs (for example arn:aws:s3:::bucket/)."
  type        = list(string)
  default     = []
}

variable "tags" {
  description = "Additional tags to apply to all resources."
  type        = map(string)
  default     = {}
}
