variable "name" {
  description = "Name of the secret."
  type        = string
}

variable "description" {
  description = "Description of the secret."
  type        = string
  default     = "Terraform backend configuration."
}

variable "secret_string" {
  description = "Optional plaintext secret value to store."
  type        = string
  default     = null
  sensitive   = true
}

variable "create_secret_version" {
  description = "Whether to create a secret version resource."
  type        = bool
  default     = true
}

variable "kms_key_id" {
  description = "Optional KMS key ID or ARN for secret encryption."
  type        = string
  default     = null
}

variable "recovery_window_in_days" {
  description = "Number of days before permanent deletion."
  type        = number
  default     = 30
}

variable "tags" {
  description = "Tags to apply to all resources."
  type        = map(string)
  default     = {}
}
