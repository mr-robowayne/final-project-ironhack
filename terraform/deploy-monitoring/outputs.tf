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

# ─── CloudWatch Logs & Dashboard ───

output "cloudwatch_log_group_names" {
  description = "Map of CloudWatch Log Group names."
  value       = module.cloudwatch_logs.log_group_names
}

output "cloudwatch_log_group_arns" {
  description = "Map of CloudWatch Log Group ARNs."
  value       = module.cloudwatch_logs.log_group_arns
}

output "cloudwatch_dashboard_name" {
  description = "CloudWatch dashboard name."
  value       = module.cloudwatch_dashboard.dashboard_name
}

output "backend_cloudwatch_agent_policy_arn" {
  description = "IAM policy ARN for backend EC2 CloudWatch Agent. Attach this to the backend EC2 IAM role in deploy-backend."
  value       = var.enable_cloudwatch_agent ? aws_iam_policy.backend_cloudwatch_agent[0].arn : null
}

output "cloudwatch_agent_ssm_parameter_name" {
  description = "SSM Parameter Store name containing the CloudWatch Agent configuration."
  value       = var.enable_cloudwatch_agent ? aws_ssm_parameter.cloudwatch_agent_config[0].name : null
}
