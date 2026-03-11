variable "zone_name" {
  description = "Public Route53 hosted zone name (for example: example.com)."
  type        = string
}

variable "private_zone" {
  description = "Whether to search for a private hosted zone."
  type        = bool
  default     = false
}

variable "create_record" {
  description = "Whether to create the frontend DNS CNAME record."
  type        = bool
  default     = false
}

variable "record_name" {
  description = "Record name relative to the hosted zone (for example: app)."
  type        = string
  default     = "dhpatientsync"
}

variable "record_value" {
  description = "DNS target value for the CNAME record (for example: d123.cloudfront.net)."
  type        = string
  default     = null
  nullable    = true

  validation {
    condition     = !var.create_record || (var.record_value != null && length(trimspace(var.record_value)) > 0)
    error_message = "record_value must be set when create_record is true."
  }
}

variable "record_ttl" {
  description = "TTL for the CNAME record."
  type        = number
  default     = 300
}
