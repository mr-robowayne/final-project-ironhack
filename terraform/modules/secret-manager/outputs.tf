output "secret_name" {
  description = "Secrets Manager secret name."
  value       = aws_secretsmanager_secret.this.name
}

output "secret_arn" {
  description = "Secrets Manager secret ARN."
  value       = aws_secretsmanager_secret.this.arn
}

output "secret_version_id" {
  description = "Secret version ID, if a secret value was provided."
  value       = try(aws_secretsmanager_secret_version.this[0].version_id, null)
}
