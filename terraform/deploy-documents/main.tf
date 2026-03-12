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
    var.tags,
    {
      DataResidency = "CH"
      PIIData       = "true"
      Compliance    = "DSGVO"
    }
  )
}

# ---------------------------------------------------------------------------
# KMS key for patient documents bucket encryption
# ---------------------------------------------------------------------------

module "documents_kms" {
  source = "../modules/kms"

  description             = "KMS key for ${local.name_prefix} patient documents S3 bucket"
  alias_name              = "alias/${local.name_prefix}-documents"
  enable_key_rotation     = true
  deletion_window_in_days = 30

  # Allow S3 to call KMS on behalf of IAM principals that have s3:PutObject/GetObject
  service_principals = ["s3.amazonaws.com"]

  tags = local.tags
}

# ---------------------------------------------------------------------------
# Access-log bucket (server access logging target)
# ---------------------------------------------------------------------------

module "documents_access_logs" {
  source = "../modules/s3-bucket"

  bucket_name   = "${local.name_prefix}-documents-access-logs"
  force_destroy = false
  kms_key_arn   = null # Access logs must use SSE-S3, not SSE-KMS
  tags          = merge(local.tags, { Purpose = "access-logs" })
}

resource "aws_s3_bucket_lifecycle_configuration" "access_logs" {
  bucket = module.documents_access_logs.bucket_id

  rule {
    id     = "expire-access-logs"
    status = "Enabled"

    filter {}

    expiration {
      days = var.access_log_retention_days
    }
  }
}

# ---------------------------------------------------------------------------
# Patient documents bucket
# ---------------------------------------------------------------------------

module "documents_bucket" {
  source = "../modules/s3-bucket"

  bucket_name   = var.bucket_name
  force_destroy = false
  kms_key_arn   = module.documents_kms.key_arn
  tags          = merge(local.tags, { Purpose = "patient-documents" })
}

resource "aws_s3_bucket_logging" "documents" {
  bucket        = module.documents_bucket.bucket_id
  target_bucket = module.documents_access_logs.bucket_id
  target_prefix = "s3-access-logs/${var.bucket_name}/"
}

resource "aws_s3_bucket_lifecycle_configuration" "documents_versions" {
  bucket = module.documents_bucket.bucket_id

  rule {
    id     = "expire-noncurrent-versions"
    status = "Enabled"

    filter {}

    noncurrent_version_expiration {
      noncurrent_days = 90
    }
  }
}

# ---------------------------------------------------------------------------
# SSM Parameters — consumed by deploy-backend
# ---------------------------------------------------------------------------

resource "aws_ssm_parameter" "bucket_name" {
  name  = "${var.ssm_parameter_prefix}/bucket_name"
  type  = "String"
  value = module.documents_bucket.bucket_name
  tags  = local.tags
}

resource "aws_ssm_parameter" "bucket_arn" {
  name  = "${var.ssm_parameter_prefix}/bucket_arn"
  type  = "String"
  value = module.documents_bucket.bucket_arn
  tags  = local.tags
}

resource "aws_ssm_parameter" "kms_key_arn" {
  name  = "${var.ssm_parameter_prefix}/kms_key_arn"
  type  = "String"
  value = module.documents_kms.key_arn
  tags  = local.tags
}

resource "aws_ssm_parameter" "kms_alias_name" {
  name  = "${var.ssm_parameter_prefix}/kms_alias_name"
  type  = "String"
  value = "alias/${local.name_prefix}-documents"
  tags  = local.tags
}
