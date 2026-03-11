variable "parameters" {
  description = "Map of SSM Parameter Store entries keyed by parameter name."
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

variable "tags" {
  description = "Tags to apply to all resources."
  type        = map(string)
  default     = {}
}
