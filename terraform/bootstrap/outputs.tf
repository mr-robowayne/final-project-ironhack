output "backend_config" {
  description = "Backend configuration as a map."
  value       = local.backend_config
}

output "backend_hcl" {
  description = "Backend configuration snippet for Terraform backend block."
  value       = local.backend_hcl
}

output "deploy_backend_state_key" {
  description = "Recommended state key for deploy-backend stack."
  value       = local.deploy_backend_state_key
}

output "deploy_aws_ressources_state_key" {
  description = "Recommended state key for deploy-aws-ressources stack."
  value       = local.deploy_aws_ressources_state_key
}

output "deploy_data_state_key" {
  description = "Recommended state key for deploy-data stack."
  value       = local.deploy_data_state_key
}

output "deploy_monitoring_state_key" {
  description = "Recommended state key for deploy-monitoring stack."
  value       = local.deploy_monitoring_state_key
}

output "deploy_frontend_state_key" {
  description = "Recommended state key for deploy-frontend stack."
  value       = local.deploy_frontend_state_key
}

output "deploy_backend_backend_hcl" {
  description = "Backend snippet for deploy-backend stack."
  value       = local.deploy_backend_backend_hcl
}

output "deploy_aws_ressources_backend_hcl" {
  description = "Backend snippet for deploy-aws-ressources stack."
  value       = local.deploy_aws_ressources_backend_hcl
}

output "deploy_data_backend_hcl" {
  description = "Backend snippet for deploy-data stack."
  value       = local.deploy_data_backend_hcl
}

output "deploy_monitoring_backend_hcl" {
  description = "Backend snippet for deploy-monitoring stack."
  value       = local.deploy_monitoring_backend_hcl
}

output "deploy_frontend_backend_hcl" {
  description = "Backend snippet for deploy-frontend stack."
  value       = local.deploy_frontend_backend_hcl
}

output "deploy_infra_state_key" {
  description = "Compatibility output mapped to deploy-aws-ressources state key."
  value       = local.deploy_aws_ressources_state_key
}

output "deploy_public_access_state_key" {
  description = "Compatibility output mapped to deploy-frontend state key."
  value       = local.deploy_frontend_state_key
}

output "deploy_infra_backend_hcl" {
  description = "Compatibility output mapped to deploy-aws-ressources backend snippet."
  value       = local.deploy_aws_ressources_backend_hcl
}

output "deploy_public_access_backend_hcl" {
  description = "Compatibility output mapped to deploy-frontend backend snippet."
  value       = local.deploy_frontend_backend_hcl
}

output "state_bucket_name" {
  description = "Terraform state S3 bucket name."
  value       = module.state_bucket.bucket_name
}

output "lock_table_name" {
  description = "Terraform lock DynamoDB table name."
  value       = module.lock_table.table_name
}

output "backend_role_arn" {
  description = "Terraform backend IAM role ARN."
  value       = module.state_access_role.role_arn
}

output "state_bucket_kms_key_arn" {
  description = "KMS key ARN used for Terraform state bucket encryption."
  value       = local.resolved_state_bucket_kms_key_arn
}
