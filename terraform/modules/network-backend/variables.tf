variable "name_prefix" {
  description = "Prefix used for naming network resources."
  type        = string
}

variable "vpc_cidr" {
  description = "CIDR block for the VPC."
  type        = string
  default     = "10.50.0.0/16"
}

variable "availability_zones" {
  description = "Exactly two AZs. If empty, the first two available AZs in the region are used."
  type        = list(string)
  default     = []

  validation {
    condition     = length(var.availability_zones) == 0 || length(var.availability_zones) == 2
    error_message = "availability_zones must be empty or contain exactly 2 AZ names."
  }
}

variable "public_subnet_cidrs" {
  description = "CIDRs for two public subnets."
  type        = list(string)
  default     = ["10.50.1.0/24", "10.50.2.0/24"]

  validation {
    condition     = length(var.public_subnet_cidrs) == 2 && length(distinct(var.public_subnet_cidrs)) == 2
    error_message = "public_subnet_cidrs must contain exactly 2 distinct CIDR blocks."
  }
}

variable "private_subnet_cidrs" {
  description = "CIDRs for two private subnets."
  type        = list(string)
  default     = ["10.50.11.0/24", "10.50.12.0/24"]

  validation {
    condition     = length(var.private_subnet_cidrs) == 2 && length(distinct(var.private_subnet_cidrs)) == 2
    error_message = "private_subnet_cidrs must contain exactly 2 distinct CIDR blocks."
  }
}

variable "monitoring_subnet_cidrs" {
  description = "CIDRs for monitoring subnets. By default one subnet in the first AZ."
  type        = list(string)
  default     = ["10.50.31.0/24"]
}

variable "monitoring_subnet_availability_zones" {
  description = "Optional AZs for monitoring subnets. If empty, first selected AZ is used."
  type        = list(string)
  default     = []

  validation {
    condition     = length(var.monitoring_subnet_availability_zones) == 0 || length(var.monitoring_subnet_availability_zones) == length(var.monitoring_subnet_cidrs)
    error_message = "monitoring_subnet_availability_zones must be empty or match monitoring_subnet_cidrs length."
  }
}

variable "enable_nat_gateway" {
  description = "Whether private subnets should have outbound internet access via NAT gateway."
  type        = bool
  default     = true
}

variable "single_nat_gateway" {
  description = "Use a single NAT gateway (lower cost) instead of one per AZ."
  type        = bool
  default     = false
}

variable "enable_monitoring_nat_gateway_route" {
  description = "Whether monitoring subnets should use NAT for outbound internet access."
  type        = bool
  default     = true
}

variable "tags" {
  description = "Tags applied to all resources."
  type        = map(string)
  default     = {}
}
