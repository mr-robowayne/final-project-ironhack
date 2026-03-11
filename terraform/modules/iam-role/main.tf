locals {
  normalized_state_prefixes = [
    for prefix in var.allowed_state_prefixes : "${trim(prefix, "/")}/*"
  ]
  list_bucket_prefixes = distinct(concat(
    [""],
    [for prefix in var.allowed_state_prefixes : trim(prefix, "/")],
    [for prefix in var.allowed_state_prefixes : "${trim(prefix, "/")}/*"]
  ))
}

data "aws_iam_policy_document" "assume_role" {
  statement {
    effect = "Allow"

    actions = [
      "sts:AssumeRole"
    ]

    principals {
      type        = "AWS"
      identifiers = var.trusted_principal_arns
    }

    dynamic "condition" {
      for_each = var.assume_role_external_id == null ? [] : [1]
      content {
        test     = "StringEquals"
        variable = "sts:ExternalId"
        values   = [var.assume_role_external_id]
      }
    }
  }
}

resource "aws_iam_role" "this" {
  name               = var.role_name
  assume_role_policy = data.aws_iam_policy_document.assume_role.json
  tags               = var.tags

  lifecycle {
    prevent_destroy = true
  }
}

data "aws_iam_policy_document" "state_access" {
  statement {
    sid    = "S3BucketAccess"
    effect = "Allow"

    actions = [
      "s3:ListBucket",
      "s3:GetBucketLocation"
    ]

    resources = [
      var.state_bucket_arn
    ]

    condition {
      test     = "StringLike"
      variable = "s3:prefix"
      values   = local.list_bucket_prefixes
    }
  }

  statement {
    sid    = "S3ObjectAccess"
    effect = "Allow"

    actions = concat(
      [
        "s3:GetObject",
        "s3:GetObjectVersion",
        "s3:PutObject"
      ],
      var.allow_delete_state_objects ? ["s3:DeleteObject"] : []
    )

    resources = [for prefix in local.normalized_state_prefixes : "${var.state_bucket_arn}/${prefix}"]
  }

  dynamic "statement" {
    for_each = var.state_bucket_kms_key_arn == null ? [] : [1]
    content {
      sid    = "S3StateKmsAccess"
      effect = "Allow"

      actions = [
        "kms:Encrypt",
        "kms:Decrypt",
        "kms:ReEncrypt*",
        "kms:GenerateDataKey*",
        "kms:DescribeKey"
      ]

      resources = [var.state_bucket_kms_key_arn]
    }
  }

  statement {
    sid    = "DynamoDbLockAccess"
    effect = "Allow"

    actions = [
      "dynamodb:DescribeTable",
      "dynamodb:GetItem",
      "dynamodb:PutItem",
      "dynamodb:DeleteItem",
      "dynamodb:UpdateItem"
    ]

    resources = [
      var.lock_table_arn
    ]
  }
}

resource "aws_iam_role_policy" "state_access" {
  name   = "${var.role_name}-state-access"
  role   = aws_iam_role.this.id
  policy = data.aws_iam_policy_document.state_access.json
}
