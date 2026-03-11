output "certificate_arn" {
  description = "ARN of the ACM certificate."
  value       = var.wait_for_validation ? aws_acm_certificate_validation.this[0].certificate_arn : aws_acm_certificate.this.arn
}

output "domain_name" {
  description = "Primary certificate domain name."
  value       = aws_acm_certificate.this.domain_name
}

output "validation_record_fqdns" {
  description = "Validation DNS records created in Route53."
  value       = [for record in aws_route53_record.validation : record.fqdn]
}
