variable "project_name" {
  description = "Project name used in backend resource naming."
  type        = string
}

variable "environment" {
  description = "Environment name (e.g. dev, stage, prod)."
  type        = string
}

variable "aws_region" {
  description = "AWS region where backend resources are created."
  type        = string
}

variable "state_key" {
  description = "Terraform state object key used in backend configuration."
  type        = string
  default     = "bootstrap/terraform.tfstate"
}

variable "state_bucket_name" {
  description = "Optional explicit S3 bucket name for Terraform state."
  type        = string
  default     = null
}

variable "lock_table_name" {
  description = "Optional explicit DynamoDB lock table name."
  type        = string
  default     = null
}

variable "role_name" {
  description = "Optional explicit IAM role name for backend access."
  type        = string
  default     = null
}

variable "trusted_principal_arns" {
  description = "AWS principal ARNs allowed to assume the backend role."
  type        = list(string)
}

variable "allowed_state_prefixes" {
  description = "Allowed S3 object key prefixes for Terraform state files."
  type        = list(string)
  default = [
    "bootstrap",
    "deploy-backend",
    "deploy-aws-ressources",
    "deploy-data",
    "deploy-monitoring",
    "deploy-frontend",
    "deploy-infra",
    "deploy-public-access"
  ]
}

variable "assume_role_external_id" {
  description = "Optional ExternalId condition to protect role assumption."
  type        = string
  default     = null
}

variable "allow_delete_state_objects" {
  description = "Allow backend role to delete state objects."
  type        = bool
  default     = false
}

variable "bucket_force_destroy" {
  description = "Whether deleting non-empty state bucket is allowed."
  type        = bool
  default     = false
}

variable "state_bucket_kms_key_arn" {
  description = "Optional KMS key ARN for state bucket encryption."
  type        = string
  default     = null
}

variable "create_state_kms_key" {
  description = "Create a dedicated KMS key for Terraform state bucket encryption when no key ARN is provided."
  type        = bool
  default     = true
}

variable "dynamodb_billing_mode" {
  description = "Billing mode for DynamoDB lock table."
  type        = string
  default     = "PAY_PER_REQUEST"
}

variable "dynamodb_read_capacity" {
  description = "Read capacity for PROVISIONED lock table."
  type        = number
  default     = 1
}

variable "dynamodb_write_capacity" {
  description = "Write capacity for PROVISIONED lock table."
  type        = number
  default     = 1
}

variable "dynamodb_point_in_time_recovery" {
  description = "Enable point-in-time recovery on lock table."
  type        = bool
  default     = true
}

variable "dynamodb_deletion_protection_enabled" {
  description = "Enable DynamoDB deletion protection."
  type        = bool
  default     = true
}

variable "tags" {
  description = "Additional tags to apply to all resources."
  type        = map(string)
  default     = {}
}
