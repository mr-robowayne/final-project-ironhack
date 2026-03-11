variable "project_name" {
  description = "Project name used for naming resources."
  type        = string
}

variable "environment" {
  description = "Environment name (e.g. dev, stage, prod)."
  type        = string
}

variable "aws_region" {
  description = "AWS region where backend service resources are created."
  type        = string
}

variable "backend_region" {
  description = "Optional backend state region override."
  type        = string
  default     = null
}

variable "state_bucket_name" {
  description = "Existing state bucket name from bootstrap."
  type        = string
}

variable "lock_table_name" {
  description = "Existing lock table name from bootstrap."
  type        = string
}

variable "role_arn" {
  description = "Existing backend IAM role ARN from bootstrap."
  type        = string
}

variable "state_key" {
  description = "Terraform state object key."
  type        = string
  default     = "deploy-backend/terraform.tfstate"
}

variable "secret_name" {
  description = "Optional explicit name for Secrets Manager secret."
  type        = string
  default     = null
}

variable "secret_kms_key_id" {
  description = "Optional KMS key ID or ARN for Secrets Manager."
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
  description = "Optional prefix for SSM Parameter Store values."
  type        = string
  default     = null
}

variable "frontend_parameter_prefix" {
  description = "Optional prefix for frontend public build variables in Parameter Store."
  type        = string
  default     = null
}

variable "frontend_public_env" {
  description = "Frontend public build variables written to Parameter Store. Keys must be REACT_APP_*."
  type        = map(string)
  default     = {}

  validation {
    condition = alltrue([
      for key in keys(var.frontend_public_env) :
      can(regex("^REACT_APP_[A-Z0-9_]+$", key))
    ])
    error_message = "All frontend_public_env keys must match REACT_APP_[A-Z0-9_]+."
  }

  validation {
    condition = alltrue([
      for key in keys(var.frontend_public_env) :
      !can(regex("(SECRET|TOKEN|PASSWORD|PRIVATE_KEY)", key))
    ])
    error_message = "frontend_public_env must not contain secret-like keys (SECRET, TOKEN, PASSWORD, PRIVATE_KEY)."
  }
}

variable "create_secret_manager" {
  description = "Whether to deploy Secret Manager resources."
  type        = bool
  default     = true
}

variable "create_ssm" {
  description = "Whether to deploy SSM document resources."
  type        = bool
  default     = true
}

variable "create_parameter_store" {
  description = "Whether to deploy Parameter Store resources."
  type        = bool
  default     = true
}

variable "create_cloudtrail" {
  description = "Whether to deploy CloudTrail audit resources."
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
  description = "Whether CloudTrail log bucket can be destroyed with objects."
  type        = bool
  default     = false
}

variable "cloudtrail_s3_kms_key_arn" {
  description = "Optional KMS key ARN for CloudTrail log bucket encryption."
  type        = string
  default     = null
}

variable "cloudtrail_s3_log_retention_days" {
  description = "Days to retain CloudTrail S3 logs. Set null to disable expiration."
  type        = number
  default     = 365
  nullable    = true

  validation {
    condition     = var.cloudtrail_s3_log_retention_days == null || var.cloudtrail_s3_log_retention_days > 0
    error_message = "cloudtrail_s3_log_retention_days must be null or greater than 0."
  }
}

variable "cloudtrail_enable_logging" {
  description = "Enable CloudTrail logging."
  type        = bool
  default     = true
}

variable "cloudtrail_include_global_service_events" {
  description = "Include global service events in CloudTrail."
  type        = bool
  default     = true
}

variable "cloudtrail_is_multi_region_trail" {
  description = "Enable multi-region CloudTrail."
  type        = bool
  default     = true
}

variable "cloudtrail_enable_log_file_validation" {
  description = "Enable CloudTrail log file validation."
  type        = bool
  default     = true
}

variable "cloudtrail_kms_key_id" {
  description = "Optional KMS key ARN/ID used by CloudTrail."
  type        = string
  default     = null
}

variable "cloudtrail_enable_cloudwatch_logs" {
  description = "Enable CloudTrail delivery to CloudWatch Logs."
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
  description = "Capture management events."
  type        = bool
  default     = true
}

variable "cloudtrail_read_write_type" {
  description = "Management event capture mode: All, ReadOnly, WriteOnly."
  type        = string
  default     = "All"

  validation {
    condition     = contains(["All", "ReadOnly", "WriteOnly"], var.cloudtrail_read_write_type)
    error_message = "cloudtrail_read_write_type must be All, ReadOnly, or WriteOnly."
  }
}

variable "cloudtrail_enable_state_bucket_data_events" {
  description = "Capture object-level data events for Terraform state bucket."
  type        = bool
  default     = true
}

variable "cloudtrail_additional_s3_data_event_arns" {
  description = "Additional S3 data-event ARNs (for example arn:aws:s3:::bucket/)."
  type        = list(string)
  default     = []
}

variable "tags" {
  description = "Additional tags to apply to all resources."
  type        = map(string)
  default     = {}
}
