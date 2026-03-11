output "key_id" {
  description = "KMS key ID."
  value       = aws_kms_key.this.key_id
}

output "key_arn" {
  description = "KMS key ARN."
  value       = aws_kms_key.this.arn
}

output "alias_arn" {
  description = "KMS alias ARN when alias is created."
  value       = try(aws_kms_alias.this[0].arn, null)
}
