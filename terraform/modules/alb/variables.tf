variable "name_prefix" {
  description = "Prefix used for naming ALB resources."
  type        = string
}

variable "vpc_id" {
  description = "VPC ID where the ALB is created."
  type        = string
}

variable "public_subnet_ids" {
  description = "Public subnet IDs for ALB placement."
  type        = list(string)

  validation {
    condition     = length(var.public_subnet_ids) >= 2
    error_message = "public_subnet_ids must contain at least 2 subnets in different AZs."
  }
}

variable "target_instance_ids" {
  description = "Private EC2 instance IDs to register in the target group."
  type        = list(string)

  validation {
    condition     = length(var.target_instance_ids) > 0
    error_message = "target_instance_ids must contain at least one EC2 instance ID."
  }
}

variable "target_port" {
  description = "Application port on EC2 targets."
  type        = number
  default     = 80
}

variable "health_check_path" {
  description = "HTTP path used for target group health checks."
  type        = string
  default     = "/"
}

variable "health_check_matcher" {
  description = "Expected HTTP status codes for health checks."
  type        = string
  default     = "200-399"
}

variable "deregistration_delay" {
  description = "Deregistration delay in seconds for the target group."
  type        = number
  default     = 30
}

variable "certificate_arn" {
  description = "Optional ACM certificate ARN (same region as ALB) for HTTPS listener."
  type        = string
  default     = null

  validation {
    condition     = !var.enforce_https || (var.certificate_arn != null && length(trimspace(var.certificate_arn)) > 0)
    error_message = "certificate_arn must be set when enforce_https is true."
  }
}

variable "enforce_https" {
  description = "Require HTTPS listener configuration for the ALB."
  type        = bool
  default     = true
}

variable "redirect_http_to_https" {
  description = "Redirect HTTP listener traffic to HTTPS when certificate_arn is set."
  type        = bool
  default     = true
}

variable "ssl_policy" {
  description = "SSL policy for HTTPS listener."
  type        = string
  default     = "ELBSecurityPolicy-TLS13-1-2-2021-06"
}

variable "allowed_ingress_cidrs_ipv4" {
  description = "IPv4 CIDRs allowed to access ALB listener ports."
  type        = list(string)
  default     = []
}

variable "allowed_ingress_cidrs_ipv6" {
  description = "IPv6 CIDRs allowed to access ALB listener ports."
  type        = list(string)
  default     = []
}

variable "allowed_ingress_prefix_list_ids" {
  description = "Prefix list IDs allowed to access ALB listener ports."
  type        = list(string)
  default     = []

  validation {
    condition = (
      length(var.allowed_ingress_cidrs_ipv4) +
      length(var.allowed_ingress_cidrs_ipv6) +
      length(var.allowed_ingress_prefix_list_ids)
    ) > 0
    error_message = "At least one ALB ingress source must be configured (IPv4, IPv6, or prefix list)."
  }
}

variable "tags" {
  description = "Tags applied to all ALB resources."
  type        = map(string)
  default     = {}
}
