variable "project_name" {
  description = "Project name used in monitoring resource naming."
  type        = string
}

variable "environment" {
  description = "Environment name."
  type        = string
  default     = "production"
}

variable "aws_region" {
  description = "AWS region for monitoring resources."
  type        = string
  default     = "eu-central-2"

  validation {
    condition     = var.aws_region == "eu-central-2"
    error_message = "aws_region must be eu-central-2."
  }
}

variable "vpc_id" {
  description = "VPC ID."
  type        = string
}

variable "monitoring_subnet_id" {
  description = "Monitoring subnet ID in eu-central-2a."
  type        = string
}

variable "backend_security_group_id" {
  description = "Backend EC2 security group ID."
  type        = string
}

variable "vpc_endpoint_security_group_id" {
  description = "Security group ID attached to VPC interface endpoints."
  type        = string
}

variable "kms_key_arn" {
  description = "KMS key ARN for encrypted resources."
  type        = string
}

variable "rds_instance_identifier" {
  description = "RDS DB instance identifier used for alarms."
  type        = string
}

variable "valkey_replication_group_id" {
  description = "Valkey replication group ID used for alarms."
  type        = string
}

variable "alb_arn" {
  description = "ALB ARN."
  type        = string
}

variable "ec2_instance_ids" {
  description = "Backend EC2 instance IDs."
  type        = list(string)
}

variable "alert_email" {
  description = "Email for infrastructure alarms."
  type        = string
}

variable "monitoring_instance_type" {
  description = "Monitoring EC2 instance type."
  type        = string
  default     = "t3.small"
}

variable "monitoring_root_volume_size" {
  description = "Monitoring EC2 root volume size in GiB."
  type        = number
  default     = 20
}

variable "ec2_ebs_write_ops_threshold" {
  description = "Threshold for backend EC2 EBSWriteOps alarm."
  type        = number
  default     = 10000
}

variable "tags" {
  description = "Additional tags to merge into all monitoring resources."
  type        = map(string)
  default     = {}
}
