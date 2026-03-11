variable "name" {
  description = "Name of the SSM document."
  type        = string
}

variable "document_type" {
  description = "SSM document type."
  type        = string
  default     = "Command"
}

variable "document_format" {
  description = "SSM document format."
  type        = string
  default     = "JSON"
}

variable "target_type" {
  description = "Optional target type for the SSM document."
  type        = string
  default     = null
}

variable "content" {
  description = "SSM document content."
  type        = string
  default     = "{\"schemaVersion\":\"2.2\",\"description\":\"Backend ops placeholder document\",\"mainSteps\":[{\"action\":\"aws:runShellScript\",\"name\":\"noop\",\"inputs\":{\"runCommand\":[\"echo backend-ops\"]}}]}"
}

variable "tags" {
  description = "Tags to apply to all resources."
  type        = map(string)
  default     = {}
}
