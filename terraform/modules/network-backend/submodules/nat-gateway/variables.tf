variable "name_prefix" {
  description = "Prefix used for NAT gateway resource names."
  type        = string
}

variable "enable_nat_gateway" {
  description = "Whether NAT gateway resources should be created."
  type        = bool
}

variable "single_nat_gateway" {
  description = "Whether only one NAT gateway should be created."
  type        = bool
}

variable "public_subnet_ids" {
  description = "Public subnet IDs used for NAT gateway placement."
  type        = list(string)

  validation {
    condition     = length(var.public_subnet_ids) >= 1
    error_message = "public_subnet_ids must contain at least one subnet ID."
  }
}

variable "tags" {
  description = "Tags applied to NAT resources."
  type        = map(string)
  default     = {}
}
