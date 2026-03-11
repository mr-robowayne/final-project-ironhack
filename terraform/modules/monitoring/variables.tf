variable "name_prefix" {
  description = "Prefix used for naming monitoring resources."
  type        = string
}

variable "vpc_id" {
  description = "VPC ID where monitoring resources are created."
  type        = string
}

variable "monitoring_subnet_id" {
  description = "Monitoring subnet ID for the monitoring EC2 instance."
  type        = string
}

variable "backend_security_group_id" {
  description = "Backend security group ID to allow metrics scraping from monitoring SG."
  type        = string
}

variable "vpc_endpoint_security_group_id" {
  description = "Security group ID attached to VPC interface endpoints."
  type        = string
}

variable "kms_key_arn" {
  description = "KMS key ARN used for monitoring EC2 root volume encryption."
  type        = string
}

variable "instance_type" {
  description = "Monitoring EC2 instance type."
  type        = string
  default     = "t3.small"
}

variable "root_volume_size" {
  description = "Root volume size (GiB) for monitoring EC2 instance."
  type        = number
  default     = 20
}

variable "allow_https_egress_to_internet" {
  description = "Allow outbound HTTPS to internet destinations (via NAT) for updates and image pulls."
  type        = bool
  default     = true
}

variable "tags" {
  description = "Tags applied to monitoring resources."
  type        = map(string)
  default     = {}
}
