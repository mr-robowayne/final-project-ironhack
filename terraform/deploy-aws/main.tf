provider "aws" {
  region = var.aws_region
}

locals {
  frontend_empty_value_placeholder = "__EMPTY__"

  resolved_frontend_parameter_prefix = coalesce(
    var.frontend_parameter_prefix,
    "/${var.project_name}/${var.environment}/frontend"
  )

  frontend_parameter_store_values = {
    for key, value in var.frontend_public_env :
    "${local.resolved_frontend_parameter_prefix}/${key}" => {
      value       = trimspace(value) == "" ? local.frontend_empty_value_placeholder : value
      description = "Frontend public build variable ${key}."
      type        = "String"
      tier        = "Standard"
      overwrite   = true
    }
  }
}

module "backend" {
  source = "../modules/backend"

  project_name           = var.project_name
  environment            = var.environment
  aws_region             = var.aws_region
  backend_region         = var.backend_region
  state_bucket_name      = var.state_bucket_name
  lock_table_name        = var.lock_table_name
  role_arn               = var.role_arn
  state_key              = var.state_key
  secret_name            = var.secret_name
  secret_kms_key_id      = var.secret_kms_key_id
  create_kms_key         = var.create_kms_key
  ssm_document_name      = var.ssm_document_name
  ssm_document_content   = var.ssm_document_content
  parameter_prefix       = var.parameter_prefix
  additional_parameter_store_values = local.frontend_parameter_store_values
  create_secret_manager  = var.create_secret_manager
  create_ssm             = var.create_ssm
  create_parameter_store = var.create_parameter_store
  create_cloudtrail      = var.create_cloudtrail

  cloudtrail_name                            = var.cloudtrail_name
  cloudtrail_s3_bucket_name                  = var.cloudtrail_s3_bucket_name
  cloudtrail_s3_key_prefix                   = var.cloudtrail_s3_key_prefix
  cloudtrail_s3_force_destroy                = var.cloudtrail_s3_force_destroy
  cloudtrail_s3_kms_key_arn                  = var.cloudtrail_s3_kms_key_arn
  cloudtrail_s3_log_retention_days           = var.cloudtrail_s3_log_retention_days
  cloudtrail_enable_logging                  = var.cloudtrail_enable_logging
  cloudtrail_include_global_service_events   = var.cloudtrail_include_global_service_events
  cloudtrail_is_multi_region_trail           = var.cloudtrail_is_multi_region_trail
  cloudtrail_enable_log_file_validation      = var.cloudtrail_enable_log_file_validation
  cloudtrail_kms_key_id                      = var.cloudtrail_kms_key_id
  cloudtrail_enable_cloudwatch_logs          = var.cloudtrail_enable_cloudwatch_logs
  cloudtrail_cloudwatch_log_group_name       = var.cloudtrail_cloudwatch_log_group_name
  cloudtrail_cloudwatch_log_retention_days   = var.cloudtrail_cloudwatch_log_retention_days
  cloudtrail_cloudwatch_kms_key_id           = var.cloudtrail_cloudwatch_kms_key_id
  cloudtrail_include_management_events       = var.cloudtrail_include_management_events
  cloudtrail_read_write_type                 = var.cloudtrail_read_write_type
  cloudtrail_enable_state_bucket_data_events = var.cloudtrail_enable_state_bucket_data_events
  cloudtrail_additional_s3_data_event_arns   = var.cloudtrail_additional_s3_data_event_arns
  tags                                       = var.tags
}
