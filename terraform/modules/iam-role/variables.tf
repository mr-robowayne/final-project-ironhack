variable "role_name" {
  description = "Name of the IAM role used for Terraform backend access."
  type        = string
}

variable "state_bucket_arn" {
  description = "ARN of the S3 bucket containing Terraform state."
  type        = string
}

variable "lock_table_arn" {
  description = "ARN of the DynamoDB table used for Terraform state locking."
  type        = string
}

variable "state_bucket_kms_key_arn" {
  description = "Optional KMS key ARN used for Terraform state bucket encryption."
  type        = string
  default     = null
}

variable "trusted_principal_arns" {
  description = "List of AWS principal ARNs allowed to assume this role."
  type        = list(string)

  validation {
    condition     = length(var.trusted_principal_arns) > 0
    error_message = "trusted_principal_arns must contain at least one principal ARN."
  }
}

variable "allowed_state_prefixes" {
  description = "List of allowed S3 key prefixes for Terraform state objects."
  type        = list(string)

  validation {
    condition     = length(var.allowed_state_prefixes) > 0 && alltrue([for p in var.allowed_state_prefixes : length(trim(p, "/")) > 0])
    error_message = "allowed_state_prefixes must contain at least one non-empty prefix."
  }
}

variable "assume_role_external_id" {
  description = "Optional ExternalId condition for sts:AssumeRole."
  type        = string
  default     = null
}

variable "allow_delete_state_objects" {
  description = "Whether backend role can delete state objects in S3."
  type        = bool
  default     = false
}

variable "tags" {
  description = "Tags to apply to all resources."
  type        = map(string)
  default     = {}
}
