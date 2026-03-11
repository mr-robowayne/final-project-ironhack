resource "aws_ssm_parameter" "this" {
  for_each = var.parameters

  name        = each.key
  description = try(each.value.description, null)
  type        = try(each.value.type, "String")
  value       = each.value.value
  key_id      = try(each.value.key_id, null)
  tier        = try(each.value.tier, "Standard")
  overwrite   = try(each.value.overwrite, true)
  tags        = var.tags
}
