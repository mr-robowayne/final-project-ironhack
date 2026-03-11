output "document_name" {
  description = "SSM document name."
  value       = aws_ssm_document.this.name
}

output "document_arn" {
  description = "SSM document ARN."
  value       = aws_ssm_document.this.arn
}

output "document_version" {
  description = "Current SSM document version."
  value       = aws_ssm_document.this.document_version
}
