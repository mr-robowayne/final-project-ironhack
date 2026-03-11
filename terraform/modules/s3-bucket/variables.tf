variable "bucket_name" {
  description = "Name of the S3 bucket for Terraform state."
  type        = string
}

variable "force_destroy" {
  description = "Whether to allow bucket deletion with objects inside."
  type        = bool
  default     = false
}

variable "kms_key_arn" {
  description = "Optional KMS key ARN for bucket encryption. If null, SSE-S3 (AES256) is used."
  type        = string
  default     = null
}

variable "tags" {
  description = "Tags to apply to all resources."
  type        = map(string)
  default     = {}
}
