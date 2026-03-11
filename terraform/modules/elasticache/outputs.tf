output "primary_endpoint" {
  description = "Valkey primary endpoint address."
  value       = aws_elasticache_replication_group.this.primary_endpoint_address
}

output "port" {
  description = "Valkey port."
  value       = aws_elasticache_replication_group.this.port
}

output "security_group_id" {
  description = "Security group ID attached to ElastiCache."
  value       = aws_security_group.this.id
}

output "subnet_group_name" {
  description = "ElastiCache subnet group name."
  value       = aws_elasticache_subnet_group.this.name
}

output "secret_name" {
  description = "Secrets Manager secret name containing Valkey auth token."
  value       = module.auth_token_secret.secret_name
}

output "secret_arn" {
  description = "Secrets Manager secret ARN containing Valkey auth token."
  value       = module.auth_token_secret.secret_arn
}

output "parameter_names" {
  description = "SSM parameter names created for Valkey connection metadata."
  value       = module.parameters.parameter_names
}

output "parameter_arns" {
  description = "SSM parameter ARNs created for Valkey connection metadata."
  value       = module.parameters.parameter_arns
}

output "engine_log_group_name" {
  description = "CloudWatch log group name for Valkey engine logs."
  value       = var.enable_cloudwatch_logs ? aws_cloudwatch_log_group.engine[0].name : null
}

output "slow_log_group_name" {
  description = "CloudWatch log group name for Valkey slow logs."
  value       = var.enable_cloudwatch_logs ? aws_cloudwatch_log_group.slow[0].name : null
}

output "secret_rotation_enabled" {
  description = "Whether Valkey auth token secret rotation is enabled."
  value       = var.enable_secret_rotation
}
