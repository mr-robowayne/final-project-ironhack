variable "name_prefix" {
  description = "Prefix used for naming dashboard resources."
  type        = string
}

variable "aws_region" {
  description = "AWS region for metric queries."
  type        = string
  default     = "eu-central-2"
}

variable "ec2_instance_ids" {
  description = "Backend EC2 instance IDs to monitor."
  type        = list(string)
}

variable "monitoring_instance_id" {
  description = "Monitoring EC2 instance ID."
  type        = string
}

variable "rds_instance_identifier" {
  description = "RDS DB instance identifier."
  type        = string
}

variable "alb_arn" {
  description = "ALB ARN for load balancer metrics."
  type        = string
}

variable "log_group_names" {
  description = "Map of log group identifiers to their CloudWatch Log Group names."
  type        = map(string)
  default     = {}
}

variable "custom_metrics_namespace" {
  description = "Custom CloudWatch namespace used by the CloudWatch Agent for EC2 memory/disk metrics."
  type        = string
  default     = "PatientSync/EC2"
}

variable "alarm_arns" {
  description = "List of CloudWatch alarm ARNs to display in the alarm status widget."
  type        = list(string)
  default     = []
}

variable "tags" {
  description = "Tags applied to dashboard resources."
  type        = map(string)
  default     = {}
}
