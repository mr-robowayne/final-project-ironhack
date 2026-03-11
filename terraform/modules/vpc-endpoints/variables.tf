variable "name_prefix" {
  description = "Prefix used for naming VPC endpoint resources."
  type        = string
}

variable "vpc_id" {
  description = "VPC ID where VPC endpoints are created."
  type        = string
}

variable "subnet_ids" {
  description = "Private subnet IDs used for interface endpoints."
  type        = list(string)

  validation {
    condition     = length(var.subnet_ids) > 0
    error_message = "subnet_ids must contain at least one subnet ID."
  }
}

variable "route_table_ids" {
  description = "Route table IDs used for the S3 gateway endpoint."
  type        = list(string)
  default     = []

  validation {
    condition     = var.enable_s3_gateway_endpoint ? length(var.route_table_ids) > 0 : true
    error_message = "route_table_ids must contain at least one route table when enable_s3_gateway_endpoint is true."
  }
}

variable "allowed_security_group_ids" {
  description = "Security groups allowed to connect to interface endpoints over HTTPS."
  type        = list(string)
  default     = []

  validation {
    condition     = length(var.allowed_security_group_ids) > 0
    error_message = "allowed_security_group_ids must contain at least one security group ID."
  }
}

variable "enable_ssm_endpoint" {
  description = "Create Interface endpoint for SSM."
  type        = bool
  default     = true
}

variable "enable_ssmmessages_endpoint" {
  description = "Create Interface endpoint for SSM Messages."
  type        = bool
  default     = true
}

variable "enable_ec2messages_endpoint" {
  description = "Create Interface endpoint for EC2 Messages."
  type        = bool
  default     = true
}

variable "enable_logs_endpoint" {
  description = "Create Interface endpoint for CloudWatch Logs."
  type        = bool
  default     = true
}

variable "enable_secretsmanager_endpoint" {
  description = "Create Interface endpoint for Secrets Manager."
  type        = bool
  default     = true
}

variable "enable_ecr_api_endpoint" {
  description = "Create Interface endpoint for ECR API."
  type        = bool
  default     = true
}

variable "enable_ecr_dkr_endpoint" {
  description = "Create Interface endpoint for ECR DKR."
  type        = bool
  default     = true
}

variable "enable_s3_gateway_endpoint" {
  description = "Create Gateway endpoint for S3."
  type        = bool
  default     = true
}

variable "tags" {
  description = "Tags applied to VPC endpoint resources."
  type        = map(string)
  default     = {}
}
