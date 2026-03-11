output "distribution_id" {
  description = "CloudFront distribution ID."
  value       = aws_cloudfront_distribution.this.id
}

output "distribution_arn" {
  description = "CloudFront distribution ARN."
  value       = aws_cloudfront_distribution.this.arn
}

output "distribution_domain_name" {
  description = "CloudFront domain name."
  value       = aws_cloudfront_distribution.this.domain_name
}

output "distribution_hosted_zone_id" {
  description = "CloudFront hosted zone ID for Route53 alias records."
  value       = aws_cloudfront_distribution.this.hosted_zone_id
}

output "origin_access_control_id" {
  description = "CloudFront Origin Access Control ID."
  value       = aws_cloudfront_origin_access_control.this.id
}

output "web_acl_arn" {
  description = "WAFv2 Web ACL ARN attached to CloudFront."
  value       = aws_wafv2_web_acl.this.arn
}

output "waf_log_group_name" {
  description = "CloudWatch log group name for WAF logs."
  value       = var.enable_waf_logs ? aws_cloudwatch_log_group.waf[0].name : null
}

output "logging_bucket_domain_name" {
  description = "Configured CloudFront log bucket domain name."
  value       = var.enable_access_logs ? var.logging_bucket_domain_name : null
}
