output "monitoring_ec2_instance_id" {
  description = "Monitoring EC2 instance ID."
  value       = module.monitoring.instance_id
}

output "monitoring_security_group_id" {
  description = "Monitoring security group ID."
  value       = module.monitoring.security_group_id
}

output "cloudwatch_alarm_arns" {
  description = "Map of CloudWatch alarm ARNs."
  value       = module.alarms.cloudwatch_alarm_arns
}

output "sns_topic_arns" {
  description = "SNS topic ARNs for infrastructure alerts."
  value = {
    infrastructure_alerts = module.alarms.sns_topic_arn
  }
}
