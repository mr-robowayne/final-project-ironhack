data "aws_partition" "current" {}

locals {
  name_prefix               = "${var.project_name}-${var.environment}"
  resolved_backend_region   = coalesce(var.backend_region, var.aws_region)
  resolved_parameter_prefix = coalesce(var.parameter_prefix, "/${var.project_name}/${var.environment}/backend")
  generated_kms_key_arn     = try(module.backend_kms[0].key_arn, null)
  resolved_secret_kms_key_id = coalesce(
    var.secret_kms_key_id,
    local.generated_kms_key_arn
  )
  resolved_cloudtrail_s3_kms_key_arn = coalesce(
    var.cloudtrail_s3_kms_key_arn,
    local.generated_kms_key_arn
  )
  resolved_cloudtrail_kms_key_id = coalesce(
    var.cloudtrail_kms_key_id,
    local.generated_kms_key_arn
  )
  resolved_cloudtrail_cloudwatch_kms_key_id = coalesce(
    var.cloudtrail_cloudwatch_kms_key_id,
    local.generated_kms_key_arn
  )
  state_bucket_data_event_arn = "arn:${data.aws_partition.current.partition}:s3:::${var.state_bucket_name}/"
  cloudtrail_s3_data_event_arns = distinct(compact(concat(
    var.cloudtrail_enable_state_bucket_data_events ? [local.state_bucket_data_event_arn] : [],
    var.cloudtrail_additional_s3_data_event_arns
  )))
  tags = merge(
    {
      Project     = var.project_name
      Environment = var.environment
      ManagedBy   = "Terraform"
    },
    var.tags
  )
  backend_config = {
    bucket         = var.state_bucket_name
    key            = var.state_key
    dynamodb_table = var.lock_table_name
    region         = local.resolved_backend_region
    encrypt        = true
    role_arn       = var.role_arn
  }
  base_parameter_store_values = {
    "${local.resolved_parameter_prefix}/bucket" = {
      value       = var.state_bucket_name
      description = "Terraform backend S3 bucket."
    }
    "${local.resolved_parameter_prefix}/key" = {
      value       = var.state_key
      description = "Terraform backend state key."
    }
    "${local.resolved_parameter_prefix}/region" = {
      value       = local.resolved_backend_region
      description = "Terraform backend AWS region."
    }
    "${local.resolved_parameter_prefix}/dynamodb_table" = {
      value       = var.lock_table_name
      description = "Terraform backend DynamoDB lock table."
    }
    "${local.resolved_parameter_prefix}/role_arn" = {
      value       = var.role_arn
      description = "Terraform backend IAM role ARN."
    }
  }
  parameter_store_values = merge(
    local.base_parameter_store_values,
    var.additional_parameter_store_values
  )
}

module "backend_kms" {
  count = var.create_kms_key && (
    var.secret_kms_key_id == null ||
    var.cloudtrail_s3_kms_key_arn == null ||
    var.cloudtrail_kms_key_id == null ||
    var.cloudtrail_cloudwatch_kms_key_id == null
  ) ? 1 : 0
  source = "../kms"

  description = "KMS key for backend resources (${var.project_name}/${var.environment})."
  alias_name  = "alias/${local.name_prefix}-backend"
  service_principals = [
    "cloudtrail.amazonaws.com",
    "logs.${local.resolved_backend_region}.amazonaws.com",
    "secretsmanager.amazonaws.com"
  ]
  tags = local.tags
}

module "backend_secret" {
  count  = var.create_secret_manager ? 1 : 0
  source = "../secret-manager"

  name          = coalesce(var.secret_name, "${local.name_prefix}/terraform/backend")
  description   = "Terraform backend configuration for ${var.project_name} (${var.environment})."
  secret_string = jsonencode(local.backend_config)
  kms_key_id    = local.resolved_secret_kms_key_id
  tags          = local.tags
}

module "backend_ssm" {
  count  = var.create_ssm ? 1 : 0
  source = "../ssm"

  name    = coalesce(var.ssm_document_name, "${local.name_prefix}-backend-ops")
  content = var.ssm_document_content
  tags    = local.tags
}

module "backend_parameter_store" {
  count  = var.create_parameter_store ? 1 : 0
  source = "../parameter-store"

  parameters = local.parameter_store_values
  tags       = local.tags
}

module "backend_cloudtrail" {
  count  = var.create_cloudtrail ? 1 : 0
  source = "../cloudtrail"

  name                          = coalesce(var.cloudtrail_name, "${local.name_prefix}-audit-trail")
  s3_bucket_name                = coalesce(var.cloudtrail_s3_bucket_name, "${local.name_prefix}-cloudtrail-logs")
  s3_key_prefix                 = var.cloudtrail_s3_key_prefix
  s3_force_destroy              = var.cloudtrail_s3_force_destroy
  s3_kms_key_arn                = local.resolved_cloudtrail_s3_kms_key_arn
  s3_log_retention_days         = var.cloudtrail_s3_log_retention_days
  enable_logging                = var.cloudtrail_enable_logging
  include_global_service_events = var.cloudtrail_include_global_service_events
  is_multi_region_trail         = var.cloudtrail_is_multi_region_trail
  enable_log_file_validation    = var.cloudtrail_enable_log_file_validation
  kms_key_id                    = local.resolved_cloudtrail_kms_key_id
  enable_cloudwatch_logs        = var.cloudtrail_enable_cloudwatch_logs
  cloudwatch_log_group_name     = var.cloudtrail_cloudwatch_log_group_name
  cloudwatch_log_retention_days = var.cloudtrail_cloudwatch_log_retention_days
  cloudwatch_kms_key_id         = local.resolved_cloudtrail_cloudwatch_kms_key_id
  include_management_events     = var.cloudtrail_include_management_events
  read_write_type               = var.cloudtrail_read_write_type
  s3_data_event_arns            = local.cloudtrail_s3_data_event_arns
  tags                          = local.tags
}
