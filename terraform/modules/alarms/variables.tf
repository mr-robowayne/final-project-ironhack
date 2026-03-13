variable "name_prefix" {
  description = "Prefix used for naming alarms and SNS resources."
  type        = string
}

variable "alert_email" {
  description = "Email address subscribed to infrastructure alerts."
  type        = string
}

variable "rds_instance_identifier" {
  description = "RDS DB instance identifier for RDS alarms."
  type        = string
}

variable "valkey_replication_group_id" {
  description = "Valkey replication group ID for ElastiCache alarms."
  type        = string
}

variable "alb_arn" {
  description = "ALB ARN used for Application Load Balancer alarms."
  type        = string
}

variable "ec2_instance_ids" {
  description = "Backend EC2 instance IDs."
  type        = list(string)
}

variable "monitoring_instance_id" {
  description = "Monitoring EC2 instance ID."
  type        = string
}

variable "ec2_ebs_write_ops_threshold" {
  description = "Threshold for EC2 EBSWriteOps alarm."
  type        = number
  default     = 10000
}

variable "custom_metrics_namespace" {
  description = "Custom CloudWatch namespace used by the CloudWatch Agent for EC2 memory/disk metrics."
  type        = string
  default     = "PatientSync/EC2"
}

variable "enable_cloudwatch_agent_alarms" {
  description = "Enable alarms based on CloudWatch Agent custom metrics (memory, disk). Requires the agent to be installed and running."
  type        = bool
  default     = false
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

variable "backend_api_log_group_name" {
  description = "CloudWatch Log Group name for backend API logs (for log-based metric filters)."
  type        = string
  default     = ""
}

variable "enable_log_based_alarms" {
  description = "Enable alarms based on CloudWatch Log metric filters (error rate, etc.). Requires log groups to exist."
  type        = bool
  default     = false
}

variable "tags" {
  description = "Tags applied to alarm resources."
  type        = map(string)
  default     = {}
}
