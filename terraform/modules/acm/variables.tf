variable "domain_name" {
  description = "Primary domain name for the ACM certificate."
  type        = string
}

variable "subject_alternative_names" {
  description = "Optional SANs for the ACM certificate."
  type        = list(string)
  default     = []
}

variable "zone_id" {
  description = "Route53 hosted zone ID used for DNS validation."
  type        = string
}

variable "wait_for_validation" {
  description = "Wait for ACM certificate validation to complete."
  type        = bool
  default     = true
}

variable "tags" {
  description = "Tags to apply to the ACM certificate."
  type        = map(string)
  default     = {}
}
