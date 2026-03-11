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

variable "tags" {
  description = "Tags applied to alarm resources."
  type        = map(string)
  default     = {}
}
