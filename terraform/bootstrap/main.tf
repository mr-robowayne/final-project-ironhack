provider "aws" {
  region = var.aws_region
}

locals {
  name_prefix = "${var.project_name}-${var.environment}"
  tags = merge(
    {
      Project     = var.project_name
      Environment = var.environment
      ManagedBy   = "terraform"
    },
    var.tags
  )
}

module "state_kms" {
  count  = var.create_state_kms_key && var.state_bucket_kms_key_arn == null ? 1 : 0
  source = "../modules/kms"

  description = "KMS key for Terraform state bucket encryption (${var.project_name}/${var.environment})."
  alias_name  = "alias/${local.name_prefix}-tfstate"
  tags        = local.tags
}

module "state_bucket" {
  source = "../modules/s3-bucket"

  bucket_name   = coalesce(var.state_bucket_name, "${local.name_prefix}-tfstate")
  force_destroy = var.bucket_force_destroy
  kms_key_arn   = local.resolved_state_bucket_kms_key_arn
  tags          = local.tags
}

module "lock_table" {
  source = "../modules/dynamo-db"

  table_name                  = coalesce(var.lock_table_name, "${local.name_prefix}-tf-locks")
  billing_mode                = var.dynamodb_billing_mode
  read_capacity               = var.dynamodb_read_capacity
  write_capacity              = var.dynamodb_write_capacity
  point_in_time_recovery      = var.dynamodb_point_in_time_recovery
  deletion_protection_enabled = var.dynamodb_deletion_protection_enabled
  tags                        = local.tags
}

module "state_access_role" {
  source = "../modules/iam-role"

  role_name                  = coalesce(var.role_name, "${local.name_prefix}-tf-backend-role")
  state_bucket_arn           = module.state_bucket.bucket_arn
  state_bucket_kms_key_arn   = local.resolved_state_bucket_kms_key_arn
  lock_table_arn             = module.lock_table.table_arn
  trusted_principal_arns     = var.trusted_principal_arns
  allowed_state_prefixes     = var.allowed_state_prefixes
  assume_role_external_id    = var.assume_role_external_id
  allow_delete_state_objects = var.allow_delete_state_objects
  tags                       = local.tags
}

locals {
  resolved_state_bucket_kms_key_arn = coalesce(
    var.state_bucket_kms_key_arn,
    try(module.state_kms[0].key_arn, null)
  )

  deploy_backend_state_key        = "deploy-backend/terraform.tfstate"
  deploy_aws_ressources_state_key = "deploy-aws-ressources/terraform.tfstate"
  deploy_data_state_key           = "deploy-data/terraform.tfstate"
  deploy_monitoring_state_key     = "deploy-monitoring/terraform.tfstate"
  deploy_frontend_state_key       = "deploy-frontend/terraform.tfstate"

  backend_config = {
    bucket         = module.state_bucket.bucket_name
    key            = var.state_key
    region         = var.aws_region
    dynamodb_table = module.lock_table.table_name
    encrypt        = true
    assume_role = {
      role_arn = module.state_access_role.role_arn
    }
  }

  backend_hcl = <<-EOT
  bucket         = "${module.state_bucket.bucket_name}"
  key            = "${var.state_key}"
  region         = "${var.aws_region}"
  dynamodb_table = "${module.lock_table.table_name}"
  encrypt        = true
  assume_role = {
    role_arn = "${module.state_access_role.role_arn}"
  }
  EOT

  deploy_backend_backend_hcl = <<-EOT
  bucket         = "${module.state_bucket.bucket_name}"
  key            = "${local.deploy_backend_state_key}"
  region         = "${var.aws_region}"
  dynamodb_table = "${module.lock_table.table_name}"
  encrypt        = true
  assume_role = {
    role_arn = "${module.state_access_role.role_arn}"
  }
  EOT

  deploy_aws_ressources_backend_hcl = <<-EOT
  bucket         = "${module.state_bucket.bucket_name}"
  key            = "${local.deploy_aws_ressources_state_key}"
  region         = "${var.aws_region}"
  dynamodb_table = "${module.lock_table.table_name}"
  encrypt        = true
  assume_role = {
    role_arn = "${module.state_access_role.role_arn}"
  }
  EOT

  deploy_data_backend_hcl = <<-EOT
  bucket         = "${module.state_bucket.bucket_name}"
  key            = "${local.deploy_data_state_key}"
  region         = "${var.aws_region}"
  dynamodb_table = "${module.lock_table.table_name}"
  encrypt        = true
  assume_role = {
    role_arn = "${module.state_access_role.role_arn}"
  }
  EOT

  deploy_monitoring_backend_hcl = <<-EOT
  bucket         = "${module.state_bucket.bucket_name}"
  key            = "${local.deploy_monitoring_state_key}"
  region         = "${var.aws_region}"
  dynamodb_table = "${module.lock_table.table_name}"
  encrypt        = true
  assume_role = {
    role_arn = "${module.state_access_role.role_arn}"
  }
  EOT

  deploy_frontend_backend_hcl = <<-EOT
  bucket         = "${module.state_bucket.bucket_name}"
  key            = "${local.deploy_frontend_state_key}"
  region         = "${var.aws_region}"
  dynamodb_table = "${module.lock_table.table_name}"
  encrypt        = true
  assume_role = {
    role_arn = "${module.state_access_role.role_arn}"
  }
  EOT
}
