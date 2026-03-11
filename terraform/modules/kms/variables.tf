variable "description" {
  description = "Description of the KMS key."
  type        = string
}

variable "alias_name" {
  description = "Optional alias for the KMS key (for example alias/my-key)."
  type        = string
  default     = null
}

variable "enable_key_rotation" {
  description = "Enable annual rotation for the KMS key."
  type        = bool
  default     = true
}

variable "deletion_window_in_days" {
  description = "Waiting period before KMS key deletion."
  type        = number
  default     = 30
}

variable "service_principals" {
  description = "Optional AWS service principals allowed to use this KMS key."
  type        = list(string)
  default     = []
}

variable "tags" {
  description = "Tags applied to KMS resources."
  type        = map(string)
  default     = {}
}
