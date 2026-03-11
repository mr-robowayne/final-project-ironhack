variable "name_prefix" {
  description = "Prefix used for route table names."
  type        = string
}

variable "vpc_id" {
  description = "VPC ID where route tables are created."
  type        = string
}

variable "internet_gateway_id" {
  description = "Internet gateway ID for public default route."
  type        = string
}

variable "public_subnet_ids" {
  description = "Public subnet IDs associated with the public route table."
  type        = list(string)
}

variable "private_subnet_ids" {
  description = "Private subnet IDs associated with private route tables."
  type        = list(string)
}

variable "monitoring_subnet_ids" {
  description = "Monitoring subnet IDs associated with monitoring route tables."
  type        = list(string)
  default     = []
}

variable "enable_nat_gateway" {
  description = "Whether private default routes to NAT should be created."
  type        = bool
}

variable "enable_monitoring_nat_gateway_route" {
  description = "Whether monitoring route tables should get a default route to NAT."
  type        = bool
  default     = true
}

variable "single_nat_gateway" {
  description = "Whether a single NAT gateway is shared by all private route tables."
  type        = bool
}

variable "nat_gateway_ids" {
  description = "NAT gateway IDs used by private route tables."
  type        = list(string)
  default     = []

  validation {
    condition = var.enable_nat_gateway ? (
      var.single_nat_gateway ? length(var.nat_gateway_ids) >= 1 : length(var.nat_gateway_ids) == length(var.private_subnet_ids)
    ) : true
    error_message = "nat_gateway_ids must contain one ID when single_nat_gateway=true, or match private_subnet_ids length otherwise."
  }
}

variable "tags" {
  description = "Tags applied to route tables."
  type        = map(string)
  default     = {}
}
