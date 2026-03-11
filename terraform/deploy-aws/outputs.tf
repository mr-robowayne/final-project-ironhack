output "backend_config" {
  description = "Backend configuration map."
  value       = module.backend.backend_config
}

output "secret_name" {
  description = "Secrets Manager secret name."
  value       = module.backend.secret_name
}

output "secret_arn" {
  description = "Secrets Manager secret ARN."
  value       = module.backend.secret_arn
}

output "ssm_document_name" {
  description = "SSM document name."
  value       = module.backend.ssm_document_name
}

output "ssm_document_arn" {
  description = "SSM document ARN."
  value       = module.backend.ssm_document_arn
}

output "parameter_names" {
  description = "Parameter Store names."
  value       = module.backend.parameter_names
}

output "parameter_arns" {
  description = "Parameter Store ARNs."
  value       = module.backend.parameter_arns
}

output "frontend_parameter_names" {
  description = "Frontend Parameter Store names."
  value = [
    for name in module.backend.parameter_names :
    name if startswith(name, "${local.resolved_frontend_parameter_prefix}/")
  ]
}

output "frontend_parameter_prefix" {
  description = "Frontend Parameter Store prefix."
  value       = local.resolved_frontend_parameter_prefix
}

output "cloudtrail_name" {
  description = "CloudTrail trail name."
  value       = module.backend.cloudtrail_name
}

output "cloudtrail_arn" {
  description = "CloudTrail trail ARN."
  value       = module.backend.cloudtrail_arn
}

output "cloudtrail_log_bucket_name" {
  description = "CloudTrail S3 log bucket name."
  value       = module.backend.cloudtrail_log_bucket_name
}

output "cloudtrail_cloudwatch_log_group_name" {
  description = "CloudTrail CloudWatch log group name."
  value       = module.backend.cloudtrail_cloudwatch_log_group_name
}

output "backend_kms_key_arn" {
  description = "KMS key ARN used by backend resources when managed by Terraform."
  value       = module.backend.kms_key_arn
}
