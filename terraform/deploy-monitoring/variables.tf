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

# ─── CloudWatch Agent & Logs ───

variable "enable_cloudwatch_agent" {
  description = "Enable CloudWatch Agent IAM policies, log groups, SSM config, and custom metric alarms."
  type        = bool
  default     = false
}

variable "custom_metrics_namespace" {
  description = "Custom CloudWatch namespace used by the CloudWatch Agent."
  type        = string
  default     = "PatientSync/EC2"
}

variable "log_retention_days" {
  description = "Retention in days for CloudWatch Log Groups."
  type        = number
  default     = 90
}

variable "ec2_memory_threshold" {
  description = "Memory usage percentage threshold for backend EC2 alarm."
  type        = number
  default     = 80
}

variable "ec2_disk_threshold" {
  description = "Disk usage percentage threshold for backend EC2 alarm."
  type        = number
  default     = 85
}

variable "rds_read_latency_threshold" {
  description = "RDS read latency threshold in seconds (0.02 = 20ms)."
  type        = number
  default     = 0.02
}

variable "rds_write_latency_threshold" {
  description = "RDS write latency threshold in seconds (0.05 = 50ms)."
  type        = number
  default     = 0.05
}

variable "enable_log_based_alarms" {
  description = "Enable alarms based on CloudWatch Log metric filters (error rate). Requires CloudWatch Agent to be running."
  type        = bool
  default     = false
}

variable "tags" {
  description = "Additional tags to merge into all monitoring resources."
  type        = map(string)
  default     = {}
}
