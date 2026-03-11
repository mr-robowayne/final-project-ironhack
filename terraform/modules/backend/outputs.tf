output "backend_config" {
  description = "Backend configuration map shared across backend service modules."
  value       = local.backend_config
}

output "secret_name" {
  description = "Secrets Manager secret name."
  value       = try(module.backend_secret[0].secret_name, null)
}

output "secret_arn" {
  description = "Secrets Manager secret ARN."
  value       = try(module.backend_secret[0].secret_arn, null)
}

output "ssm_document_name" {
  description = "SSM document name."
  value       = try(module.backend_ssm[0].document_name, null)
}

output "ssm_document_arn" {
  description = "SSM document ARN."
  value       = try(module.backend_ssm[0].document_arn, null)
}

output "parameter_names" {
  description = "Parameter Store parameter names."
  value       = try(module.backend_parameter_store[0].parameter_names, [])
}

output "parameter_arns" {
  description = "Parameter Store parameter ARNs."
  value       = try(module.backend_parameter_store[0].parameter_arns, {})
}

output "cloudtrail_name" {
  description = "CloudTrail trail name."
  value       = try(module.backend_cloudtrail[0].trail_name, null)
}

output "cloudtrail_arn" {
  description = "CloudTrail trail ARN."
  value       = try(module.backend_cloudtrail[0].trail_arn, null)
}

output "cloudtrail_log_bucket_name" {
  description = "S3 bucket name used for CloudTrail logs."
  value       = try(module.backend_cloudtrail[0].log_bucket_name, null)
}

output "cloudtrail_cloudwatch_log_group_name" {
  description = "CloudWatch log group for CloudTrail."
  value       = try(module.backend_cloudtrail[0].cloudwatch_log_group_name, null)
}

output "kms_key_arn" {
  description = "KMS key ARN used by backend resources when managed in this module."
  value       = try(module.backend_kms[0].key_arn, null)
}
