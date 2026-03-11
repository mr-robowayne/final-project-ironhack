provider "aws" {
  region = var.aws_region
}

provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"
}

provider "aws" {
  alias  = "cloudfront_logs"
  region = var.aws_region
}

data "aws_caller_identity" "current" {}
data "aws_partition" "current" {}

locals {
  name_prefix                             = "${var.project_name}-${var.environment}"
  frontend_fqdn                           = format("%s.%s", var.frontend_subdomain, trimsuffix(var.route53_zone_name, "."))
  cloudfront_log_prefix_normalized        = trim(var.cloudfront_log_prefix, "/")
  cloudfront_log_destination_resource_arn = var.enable_cloudfront_access_logs ? aws_s3_bucket.cloudfront_logs[0].arn : null
  cloudfront_log_delivery_source_arn      = "arn:${data.aws_partition.current.partition}:logs:us-east-1:${data.aws_caller_identity.current.account_id}:delivery-source:*"

  existing_frontend_acm_certificate_arn = var.frontend_acm_certificate_arn != null ? var.frontend_acm_certificate_arn : (
    var.frontend_acm_certificate_id != null ? format(
      "arn:aws:acm:%s:%s:certificate/%s",
      var.frontend_acm_certificate_region,
      data.aws_caller_identity.current.account_id,
      var.frontend_acm_certificate_id
    ) : null
  )

  effective_frontend_acm_certificate_arn      = var.create_frontend_acm_certificate ? module.frontend_acm[0].certificate_arn : local.existing_frontend_acm_certificate_arn
  generated_public_access_storage_kms_key_arn = try(module.public_access_storage_kms[0].key_arn, null)
  resolved_public_access_kms_key_arn          = coalesce(var.public_access_kms_key_arn, local.generated_public_access_storage_kms_key_arn)
  generated_public_access_waf_kms_key_arn     = try(module.public_access_waf_kms[0].key_arn, null)
  resolved_frontend_bucket_kms_key_arn = coalesce(
    var.frontend_bucket_kms_key_arn,
    local.resolved_public_access_kms_key_arn
  )
  resolved_cloudfront_log_bucket_kms_key_arn = coalesce(
    var.cloudfront_log_bucket_kms_key_arn,
    local.resolved_public_access_kms_key_arn
  )
  resolved_waf_log_group_kms_key_arn = coalesce(
    var.waf_log_group_kms_key_arn,
    local.generated_public_access_waf_kms_key_arn
  )

  tags = merge(
    {
      Project     = var.project_name
      Environment = var.environment
      ManagedBy   = "terraform"
      Scope       = "public-access"
    },
    var.tags
  )
}

module "frontend_zone" {
  source = "../modules/route53"

  zone_name     = var.route53_zone_name
  private_zone  = var.route53_private_zone
  create_record = false
}

module "frontend_acm" {
  count  = var.create_frontend_acm_certificate ? 1 : 0
  source = "../modules/acm"
  providers = {
    aws = aws.us_east_1
  }

  domain_name               = local.frontend_fqdn
  subject_alternative_names = var.frontend_acm_subject_alternative_names
  zone_id                   = module.frontend_zone.zone_id
  wait_for_validation       = var.frontend_acm_wait_for_validation
  tags                      = local.tags
}

module "public_access_storage_kms" {
  count  = var.create_public_access_kms_key && var.public_access_kms_key_arn == null ? 1 : 0
  source = "../modules/kms"

  description        = "KMS key for public-access storage resources (${var.project_name}/${var.environment})."
  alias_name         = "alias/${local.name_prefix}-public-access"
  service_principals = ["cloudfront.amazonaws.com", "delivery.logs.amazonaws.com"]
  tags               = local.tags
}

module "public_access_waf_kms" {
  count  = var.create_public_access_kms_key && var.waf_log_group_kms_key_arn == null ? 1 : 0
  source = "../modules/kms"
  providers = {
    aws = aws.us_east_1
  }

  description        = "KMS key for CloudFront WAF logs (${var.project_name}/${var.environment})."
  alias_name         = "alias/${local.name_prefix}-waf-logs"
  service_principals = ["logs.us-east-1.amazonaws.com"]
  tags               = local.tags
}

resource "aws_s3_bucket" "frontend" {
  bucket        = var.frontend_bucket_name
  force_destroy = var.frontend_bucket_force_destroy
  tags = merge(
    local.tags,
    {
      Name = var.frontend_bucket_name
      Tier = "frontend-origin"
    }
  )

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_s3_bucket_public_access_block" "frontend" {
  bucket = aws_s3_bucket.frontend.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "frontend" {
  bucket = aws_s3_bucket.frontend.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "frontend" {
  bucket = aws_s3_bucket.frontend.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = local.resolved_frontend_bucket_kms_key_arn == null ? "AES256" : "aws:kms"
      kms_master_key_id = local.resolved_frontend_bucket_kms_key_arn
    }
  }
}

resource "aws_s3_bucket_versioning" "frontend" {
  bucket = aws_s3_bucket.frontend.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket" "cloudfront_logs" {
  count    = var.enable_cloudfront_access_logs ? 1 : 0
  provider = aws.cloudfront_logs

  bucket        = coalesce(var.cloudfront_log_bucket_name, "${local.name_prefix}-cloudfront-logs")
  force_destroy = var.cloudfront_log_bucket_force_destroy
  tags = merge(
    local.tags,
    {
      Name = coalesce(var.cloudfront_log_bucket_name, "${local.name_prefix}-cloudfront-logs")
      Tier = "audit"
    }
  )

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_s3_bucket_public_access_block" "cloudfront_logs" {
  count    = var.enable_cloudfront_access_logs ? 1 : 0
  provider = aws.cloudfront_logs

  bucket = aws_s3_bucket.cloudfront_logs[0].id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "cloudfront_logs" {
  count    = var.enable_cloudfront_access_logs ? 1 : 0
  provider = aws.cloudfront_logs

  bucket = aws_s3_bucket.cloudfront_logs[0].id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "cloudfront_logs" {
  count    = var.enable_cloudfront_access_logs ? 1 : 0
  provider = aws.cloudfront_logs

  bucket = aws_s3_bucket.cloudfront_logs[0].id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = local.resolved_cloudfront_log_bucket_kms_key_arn == null ? "AES256" : "aws:kms"
      kms_master_key_id = local.resolved_cloudfront_log_bucket_kms_key_arn
    }
  }
}

resource "aws_s3_bucket_versioning" "cloudfront_logs" {
  count    = var.enable_cloudfront_access_logs ? 1 : 0
  provider = aws.cloudfront_logs

  bucket = aws_s3_bucket.cloudfront_logs[0].id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "cloudfront_logs" {
  count    = var.enable_cloudfront_access_logs && var.cloudfront_log_retention_days != null ? 1 : 0
  provider = aws.cloudfront_logs

  bucket = aws_s3_bucket.cloudfront_logs[0].id

  rule {
    id     = "retention"
    status = "Enabled"

    filter {}

    expiration {
      days = var.cloudfront_log_retention_days
    }

    noncurrent_version_expiration {
      noncurrent_days = var.cloudfront_log_retention_days
    }
  }
}

data "aws_iam_policy_document" "cloudfront_logs_bucket" {
  count = var.enable_cloudfront_access_logs ? 1 : 0

  statement {
    sid    = "AllowCloudWatchLogsDeliveryWrite"
    effect = "Allow"

    principals {
      type        = "Service"
      identifiers = ["delivery.logs.amazonaws.com"]
    }

    actions = ["s3:PutObject"]
    resources = [
      "${aws_s3_bucket.cloudfront_logs[0].arn}/*"
    ]

    condition {
      test     = "StringEquals"
      variable = "s3:x-amz-acl"
      values   = ["bucket-owner-full-control"]
    }

    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [data.aws_caller_identity.current.account_id]
    }

    condition {
      test     = "ArnLike"
      variable = "aws:SourceArn"
      values   = [local.cloudfront_log_delivery_source_arn]
    }
  }

  statement {
    sid    = "AllowCloudWatchLogsDeliveryAclCheck"
    effect = "Allow"

    principals {
      type        = "Service"
      identifiers = ["delivery.logs.amazonaws.com"]
    }

    actions = [
      "s3:GetBucketAcl",
      "s3:ListBucket"
    ]

    resources = [
      aws_s3_bucket.cloudfront_logs[0].arn
    ]

    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [data.aws_caller_identity.current.account_id]
    }

    condition {
      test     = "ArnLike"
      variable = "aws:SourceArn"
      values   = [local.cloudfront_log_delivery_source_arn]
    }
  }

  statement {
    sid    = "DenyInsecureTransport"
    effect = "Deny"

    principals {
      type        = "*"
      identifiers = ["*"]
    }

    actions = ["s3:*"]
    resources = [
      aws_s3_bucket.cloudfront_logs[0].arn,
      "${aws_s3_bucket.cloudfront_logs[0].arn}/*"
    ]

    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
}

resource "aws_s3_bucket_policy" "cloudfront_logs" {
  count    = var.enable_cloudfront_access_logs ? 1 : 0
  provider = aws.cloudfront_logs

  bucket = aws_s3_bucket.cloudfront_logs[0].id
  policy = data.aws_iam_policy_document.cloudfront_logs_bucket[0].json
}

module "cloudfront" {
  source = "../modules/cloudfront"
  providers = {
    aws = aws.us_east_1
  }

  origin_bucket_regional_domain_name = aws_s3_bucket.frontend.bucket_regional_domain_name
  alb_origin_domain_name             = var.enable_alb_api_origin ? var.alb_origin_domain_name : null
  alb_origin_path_pattern            = var.alb_origin_path_pattern
  acm_certificate_arn                = local.effective_frontend_acm_certificate_arn
  aliases                            = [local.frontend_fqdn]
  distribution_comment               = "${local.name_prefix} frontend distribution"
  default_root_object                = var.default_root_object
  price_class                        = var.cloudfront_price_class
  geo_allowed_countries              = var.geo_allowed_countries
  origin_access_control_name         = "${local.name_prefix}-frontend-oac"
  web_acl_name                       = "${local.name_prefix}-frontend-web-acl"
  enable_access_logs                 = false
  logging_bucket_domain_name         = null
  log_prefix                         = var.cloudfront_log_prefix
  enable_waf_logs                    = var.enable_waf_logs
  waf_log_group_name                 = var.waf_log_group_name
  waf_log_retention_days             = var.waf_log_retention_days
  waf_log_group_kms_key_id           = local.resolved_waf_log_group_kms_key_arn
  enable_waf_rate_limit              = var.enable_waf_rate_limit
  waf_rate_limit                     = var.waf_rate_limit
  tags                               = local.tags
}

resource "aws_cloudwatch_log_delivery_source" "cloudfront_access_logs" {
  count    = var.enable_cloudfront_access_logs ? 1 : 0
  provider = aws.us_east_1

  name         = "${local.name_prefix}-cloudfront-access-logs"
  log_type     = "ACCESS_LOGS"
  resource_arn = module.cloudfront.distribution_arn
}

resource "aws_cloudwatch_log_delivery_destination" "cloudfront_access_logs" {
  count    = var.enable_cloudfront_access_logs ? 1 : 0
  provider = aws.us_east_1

  name          = "${local.name_prefix}-cloudfront-access-logs-s3"
  output_format = "w3c"

  delivery_destination_configuration {
    destination_resource_arn = local.cloudfront_log_destination_resource_arn
  }
}

resource "aws_cloudwatch_log_delivery" "cloudfront_access_logs" {
  count    = var.enable_cloudfront_access_logs ? 1 : 0
  provider = aws.us_east_1

  delivery_source_name     = aws_cloudwatch_log_delivery_source.cloudfront_access_logs[0].name
  delivery_destination_arn = aws_cloudwatch_log_delivery_destination.cloudfront_access_logs[0].arn

  dynamic "s3_delivery_configuration" {
    for_each = local.cloudfront_log_prefix_normalized == "" ? [] : [1]
    content {
      suffix_path = local.cloudfront_log_prefix_normalized
    }
  }

  depends_on = [aws_s3_bucket_policy.cloudfront_logs]
}

data "aws_iam_policy_document" "frontend_bucket" {
  statement {
    sid    = "AllowCloudFrontServicePrincipalReadOnly"
    effect = "Allow"

    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }

    actions = [
      "s3:GetObject"
    ]

    resources = [
      "${aws_s3_bucket.frontend.arn}/*"
    ]

    condition {
      test     = "StringEquals"
      variable = "aws:SourceArn"
      values   = [module.cloudfront.distribution_arn]
    }

    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [data.aws_caller_identity.current.account_id]
    }
  }

  statement {
    sid    = "DenyDirectReadAccessNotFromCloudFront"
    effect = "Deny"

    principals {
      type        = "*"
      identifiers = ["*"]
    }

    actions = [
      "s3:GetObject",
      "s3:GetObjectVersion"
    ]

    resources = [
      "${aws_s3_bucket.frontend.arn}/*"
    ]

    condition {
      test     = "ArnNotEquals"
      variable = "aws:SourceArn"
      values   = [module.cloudfront.distribution_arn]
    }
  }

  statement {
    sid    = "DenyInsecureTransport"
    effect = "Deny"

    principals {
      type        = "*"
      identifiers = ["*"]
    }

    actions = ["s3:*"]

    resources = [
      aws_s3_bucket.frontend.arn,
      "${aws_s3_bucket.frontend.arn}/*"
    ]

    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
}

resource "aws_s3_bucket_policy" "frontend" {
  bucket = aws_s3_bucket.frontend.id
  policy = data.aws_iam_policy_document.frontend_bucket.json
}

resource "aws_route53_record" "frontend_alias_a" {
  count = var.create_frontend_dns_record ? 1 : 0

  zone_id = module.frontend_zone.zone_id
  name    = var.frontend_subdomain
  type    = "A"

  alias {
    name                   = module.cloudfront.distribution_domain_name
    zone_id                = module.cloudfront.distribution_hosted_zone_id
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "frontend_alias_aaaa" {
  count = var.create_frontend_dns_record ? 1 : 0

  zone_id = module.frontend_zone.zone_id
  name    = var.frontend_subdomain
  type    = "AAAA"

  alias {
    name                   = module.cloudfront.distribution_domain_name
    zone_id                = module.cloudfront.distribution_hosted_zone_id
    evaluate_target_health = false
  }
}
