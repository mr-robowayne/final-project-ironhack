resource "aws_cloudwatch_log_group" "this" {
  for_each = var.log_groups

  name              = each.value.log_group_name
  retention_in_days = var.retention_in_days
  kms_key_id        = var.kms_key_arn

  tags = merge(
    var.tags,
    {
      Name = each.value.log_group_name
    }
  )
}
