output "bucket_name" {
  description = "Patient documents S3 bucket name."
  value       = module.documents_bucket.bucket_name
}

output "bucket_arn" {
  description = "Patient documents S3 bucket ARN."
  value       = module.documents_bucket.bucket_arn
}

output "kms_key_arn" {
  description = "KMS key ARN used for documents bucket encryption."
  value       = module.documents_kms.key_arn
}

output "kms_alias_name" {
  description = "KMS alias name for the documents encryption key."
  value       = "alias/${local.name_prefix}-documents"
}

output "ssm_parameter_prefix" {
  description = "SSM parameter prefix where bucket metadata is stored."
  value       = var.ssm_parameter_prefix
}

output "access_logs_bucket_name" {
  description = "S3 access logs bucket name."
  value       = module.documents_access_logs.bucket_name
}
