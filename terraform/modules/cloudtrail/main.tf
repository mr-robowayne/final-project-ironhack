data "aws_caller_identity" "current" {}

data "aws_partition" "current" {}

data "aws_region" "current" {}

locals {
  resolved_cloudwatch_log_group_name = coalesce(var.cloudwatch_log_group_name, "/aws/cloudtrail/${var.name}")
  normalized_s3_data_event_arns = distinct([
    for arn in var.s3_data_event_arns : endswith(trimspace(arn), "/") ? trimspace(arn) : "${trimspace(arn)}/" if length(trimspace(arn)) > 0
  ])
  normalized_s3_key_prefix = trim(coalesce(var.s3_key_prefix, ""), "/")
  cloudtrail_source_arn    = "arn:${data.aws_partition.current.partition}:cloudtrail:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:trail/${var.name}"
  cloudtrail_s3_object_arn = local.normalized_s3_key_prefix == "" ? "${aws_s3_bucket.this.arn}/AWSLogs/${data.aws_caller_identity.current.account_id}/*" : "${aws_s3_bucket.this.arn}/${local.normalized_s3_key_prefix}/AWSLogs/${data.aws_caller_identity.current.account_id}/*"
}

#tfsec:ignore:aws-s3-enable-bucket-logging
resource "aws_s3_bucket" "this" {
  bucket        = var.s3_bucket_name
  force_destroy = var.s3_force_destroy
  tags          = var.tags

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_s3_bucket_public_access_block" "this" {
  bucket = aws_s3_bucket.this.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "this" {
  bucket = aws_s3_bucket.this.id

  rule {
    object_ownership = "BucketOwnerPreferred"
  }
}

resource "aws_s3_bucket_versioning" "this" {
  bucket = aws_s3_bucket.this.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "this" {
  bucket = aws_s3_bucket.this.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = var.s3_kms_key_arn == null ? "AES256" : "aws:kms"
      kms_master_key_id = var.s3_kms_key_arn
    }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "this" {
  count = var.s3_log_retention_days == null ? 0 : 1

  bucket = aws_s3_bucket.this.id

  rule {
    id     = "retention"
    status = "Enabled"

    filter {}

    expiration {
      days = var.s3_log_retention_days
    }

    noncurrent_version_expiration {
      noncurrent_days = var.s3_log_retention_days
    }
  }
}

data "aws_iam_policy_document" "s3_bucket_policy" {
  statement {
    sid    = "AWSCloudTrailAclCheck"
    effect = "Allow"

    principals {
      type        = "Service"
      identifiers = ["cloudtrail.amazonaws.com"]
    }

    actions = ["s3:GetBucketAcl"]
    resources = [
      aws_s3_bucket.this.arn
    ]

    condition {
      test     = "StringEquals"
      variable = "aws:SourceArn"
      values   = [local.cloudtrail_source_arn]
    }

    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [data.aws_caller_identity.current.account_id]
    }
  }

  statement {
    sid    = "AWSCloudTrailWrite"
    effect = "Allow"

    principals {
      type        = "Service"
      identifiers = ["cloudtrail.amazonaws.com"]
    }

    actions = ["s3:PutObject"]
    resources = [
      local.cloudtrail_s3_object_arn
    ]

    condition {
      test     = "StringEquals"
      variable = "s3:x-amz-acl"
      values   = ["bucket-owner-full-control"]
    }

    condition {
      test     = "StringEquals"
      variable = "aws:SourceArn"
      values   = [local.cloudtrail_source_arn]
    }

    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [data.aws_caller_identity.current.account_id]
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
      aws_s3_bucket.this.arn,
      "${aws_s3_bucket.this.arn}/*"
    ]

    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
}

resource "aws_s3_bucket_policy" "this" {
  bucket = aws_s3_bucket.this.id
  policy = data.aws_iam_policy_document.s3_bucket_policy.json
}

resource "aws_cloudwatch_log_group" "this" {
  count = var.enable_cloudwatch_logs ? 1 : 0

  name              = local.resolved_cloudwatch_log_group_name
  retention_in_days = var.cloudwatch_log_retention_days
  kms_key_id        = var.cloudwatch_kms_key_id
  tags              = var.tags
}

data "aws_iam_policy_document" "cloudtrail_assume_role" {
  count = var.enable_cloudwatch_logs ? 1 : 0

  statement {
    effect = "Allow"

    principals {
      type        = "Service"
      identifiers = ["cloudtrail.amazonaws.com"]
    }

    actions = ["sts:AssumeRole"]
  }
}

resource "aws_iam_role" "cloudtrail_to_cw" {
  count = var.enable_cloudwatch_logs ? 1 : 0

  name               = "${var.name}-cloudwatch-role"
  assume_role_policy = data.aws_iam_policy_document.cloudtrail_assume_role[0].json
  tags               = var.tags
}

data "aws_iam_policy_document" "cloudtrail_to_cw" {
  count = var.enable_cloudwatch_logs ? 1 : 0

  statement {
    effect = "Allow"

    actions = [
      "logs:CreateLogStream",
      "logs:PutLogEvents"
    ]

    resources = [
      aws_cloudwatch_log_group.this[0].arn,
      "${aws_cloudwatch_log_group.this[0].arn}:log-stream:*"
    ]
  }
}

resource "aws_iam_role_policy" "cloudtrail_to_cw" {
  count = var.enable_cloudwatch_logs ? 1 : 0

  name   = "${var.name}-cloudwatch-policy"
  role   = aws_iam_role.cloudtrail_to_cw[0].id
  policy = data.aws_iam_policy_document.cloudtrail_to_cw[0].json
}

resource "aws_cloudtrail" "this" {
  name                          = var.name
  s3_bucket_name                = aws_s3_bucket.this.id
  s3_key_prefix                 = local.normalized_s3_key_prefix == "" ? null : local.normalized_s3_key_prefix
  include_global_service_events = var.include_global_service_events
  is_multi_region_trail         = var.is_multi_region_trail
  enable_log_file_validation    = var.enable_log_file_validation
  enable_logging                = var.enable_logging
  kms_key_id                    = var.kms_key_id
  cloud_watch_logs_group_arn    = var.enable_cloudwatch_logs ? "${aws_cloudwatch_log_group.this[0].arn}:*" : null
  cloud_watch_logs_role_arn     = var.enable_cloudwatch_logs ? aws_iam_role.cloudtrail_to_cw[0].arn : null
  tags                          = var.tags

  event_selector {
    include_management_events = var.include_management_events
    read_write_type           = var.read_write_type

    dynamic "data_resource" {
      for_each = toset(local.normalized_s3_data_event_arns)
      content {
        type   = "AWS::S3::Object"
        values = [data_resource.value]
      }
    }
  }

  depends_on = [
    aws_s3_bucket_policy.this,
    aws_iam_role_policy.cloudtrail_to_cw
  ]
}
