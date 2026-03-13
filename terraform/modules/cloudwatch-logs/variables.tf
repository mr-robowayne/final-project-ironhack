variable "log_groups" {
  description = "Map of log group configurations. Key is a short identifier, value contains the log group name."
  type = map(object({
    log_group_name = string
    description    = optional(string, "")
  }))
}

variable "retention_in_days" {
  description = "Number of days to retain log events in each log group."
  type        = number
  default     = 90
}

variable "kms_key_arn" {
  description = "KMS key ARN for encrypting log groups. If null, logs are encrypted with CloudWatch default encryption."
  type        = string
  default     = null
}

variable "tags" {
  description = "Tags applied to all CloudWatch log resources."
  type        = map(string)
  default     = {}
}
