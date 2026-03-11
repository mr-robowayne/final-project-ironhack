output "endpoint" {
  description = "RDS endpoint address."
  value       = aws_db_instance.this.address
}

output "port" {
  description = "RDS endpoint port."
  value       = aws_db_instance.this.port
}

output "security_group_id" {
  description = "Security group ID attached to RDS."
  value       = aws_security_group.this.id
}

output "db_subnet_group_name" {
  description = "RDS DB subnet group name."
  value       = aws_db_subnet_group.this.name
}

output "secret_name" {
  description = "RDS-managed Secrets Manager secret name for DB credentials."
  value       = local.managed_secret_name
}

output "secret_arn" {
  description = "RDS-managed Secrets Manager secret ARN for DB credentials."
  value       = local.managed_secret_arn
}

output "parameter_names" {
  description = "SSM parameter names created for RDS connection metadata."
  value       = module.parameters.parameter_names
}

output "parameter_arns" {
  description = "SSM parameter ARNs created for RDS connection metadata."
  value       = module.parameters.parameter_arns
}

output "enhanced_monitoring_role_arn" {
  description = "IAM role ARN used by RDS Enhanced Monitoring."
  value       = var.enhanced_monitoring_enabled ? aws_iam_role.enhanced_monitoring[0].arn : null
}

output "secret_rotation_enabled" {
  description = "Whether explicit Secrets Manager rotation is configured by Terraform in this module."
  value       = false
}
