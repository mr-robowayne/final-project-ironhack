output "log_group_arns" {
  description = "Map of log group identifiers to their ARNs."
  value       = { for k, v in aws_cloudwatch_log_group.this : k => v.arn }
}

output "log_group_names" {
  description = "Map of log group identifiers to their names."
  value       = { for k, v in aws_cloudwatch_log_group.this : k => v.name }
}
