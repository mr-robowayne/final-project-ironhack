variable "name_prefix" {
  description = "Prefix used for subnet names."
  type        = string
}

variable "vpc_id" {
  description = "VPC ID where subnets are created."
  type        = string
}

variable "availability_zones" {
  description = "Availability zones aligned to subnet CIDR arrays."
  type        = list(string)

  validation {
    condition     = length(var.availability_zones) >= 2
    error_message = "availability_zones must contain at least 2 AZ names."
  }
}

variable "public_subnet_cidrs" {
  description = "CIDR blocks for public subnets."
  type        = list(string)

  validation {
    condition     = length(var.public_subnet_cidrs) == length(var.availability_zones)
    error_message = "public_subnet_cidrs length must match availability_zones length."
  }
}

variable "private_subnet_cidrs" {
  description = "CIDR blocks for private subnets."
  type        = list(string)

  validation {
    condition     = length(var.private_subnet_cidrs) == length(var.availability_zones)
    error_message = "private_subnet_cidrs length must match availability_zones length."
  }
}

variable "monitoring_subnet_cidrs" {
  description = "CIDR blocks for monitoring subnets."
  type        = list(string)
  default     = []
}

variable "monitoring_subnet_availability_zones" {
  description = "Availability zones aligned to monitoring subnet CIDR array."
  type        = list(string)
  default     = []

  validation {
    condition     = length(var.monitoring_subnet_availability_zones) == 0 || length(var.monitoring_subnet_availability_zones) == length(var.monitoring_subnet_cidrs)
    error_message = "monitoring_subnet_availability_zones must be empty or match monitoring_subnet_cidrs length."
  }
}

variable "tags" {
  description = "Tags applied to subnet resources."
  type        = map(string)
  default     = {}
}
