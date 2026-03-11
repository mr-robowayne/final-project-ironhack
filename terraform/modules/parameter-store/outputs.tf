output "parameter_names" {
  description = "Names of created parameters."
  value       = keys(aws_ssm_parameter.this)
}

output "parameter_arns" {
  description = "ARNs of created parameters."
  value       = { for k, v in aws_ssm_parameter.this : k => v.arn }
}
