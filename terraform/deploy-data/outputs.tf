output "rds_endpoint" {
  description = "RDS endpoint address for backend connectivity."
  value       = module.rds.endpoint
}

output "rds_port" {
  description = "RDS endpoint port."
  value       = module.rds.port
}

output "redis_primary_endpoint" {
  description = "Valkey primary endpoint for backend connectivity."
  value       = var.enable_valkey ? module.elasticache[0].primary_endpoint : null
}

output "redis_port" {
  description = "Valkey endpoint port."
  value       = var.enable_valkey ? module.elasticache[0].port : null
}

output "data_subnet_ids" {
  description = "Data subnet IDs used by RDS and optionally Valkey."
  value       = aws_subnet.data[*].id
}

output "rds_security_group_id" {
  description = "Security group ID for RDS PostgreSQL."
  value       = module.rds.security_group_id
}

output "redis_security_group_id" {
  description = "Security group ID for Valkey."
  value       = var.enable_valkey ? module.elasticache[0].security_group_id : null
}

output "rds_secret_arn" {
  description = "Secrets Manager ARN containing RDS credentials."
  value       = module.rds.secret_arn
}

output "valkey_secret_arn" {
  description = "Secrets Manager ARN containing Valkey auth token."
  value       = var.enable_valkey ? module.elasticache[0].secret_arn : null
}

output "valkey_engine_log_group_name" {
  description = "CloudWatch log group name for Valkey engine logs."
  value       = var.enable_valkey ? module.elasticache[0].engine_log_group_name : null
}

output "valkey_slow_log_group_name" {
  description = "CloudWatch log group name for Valkey slow logs."
  value       = var.enable_valkey ? module.elasticache[0].slow_log_group_name : null
}

output "rds_enhanced_monitoring_role_arn" {
  description = "IAM role ARN used by RDS Enhanced Monitoring."
  value       = module.rds.enhanced_monitoring_role_arn
}

output "rds_secret_rotation_enabled" {
  description = "Whether RDS credentials rotation is enabled."
  value       = module.rds.secret_rotation_enabled
}

output "valkey_secret_rotation_enabled" {
  description = "Whether Valkey auth token rotation is enabled."
  value       = var.enable_valkey ? module.elasticache[0].secret_rotation_enabled : false
}
