output "frontend_domain_name" {
  description = "Public frontend domain."
  value       = local.frontend_fqdn
}

output "frontend_bucket_name" {
  description = "Private frontend S3 bucket name."
  value       = aws_s3_bucket.frontend.bucket
}

output "frontend_bucket_arn" {
  description = "Private frontend S3 bucket ARN."
  value       = aws_s3_bucket.frontend.arn
}

output "cloudfront_distribution_id" {
  description = "CloudFront distribution ID."
  value       = module.cloudfront.distribution_id
}

output "cloudfront_distribution_arn" {
  description = "CloudFront distribution ARN."
  value       = module.cloudfront.distribution_arn
}

output "cloudfront_distribution_domain_name" {
  description = "CloudFront distribution domain name."
  value       = module.cloudfront.distribution_domain_name
}

output "cloudfront_web_acl_arn" {
  description = "WAFv2 Web ACL ARN attached to CloudFront."
  value       = module.cloudfront.web_acl_arn
}

output "waf_log_group_name" {
  description = "WAF CloudWatch log group name."
  value       = module.cloudfront.waf_log_group_name
}

output "acm_certificate_arn" {
  description = "ACM certificate ARN used by CloudFront."
  value       = local.effective_frontend_acm_certificate_arn
}

output "cloudfront_log_bucket_name" {
  description = "CloudFront access log bucket name."
  value       = var.enable_cloudfront_access_logs ? aws_s3_bucket.cloudfront_logs[0].bucket : null
}

output "cloudfront_log_bucket_region" {
  description = "AWS region of CloudFront access log bucket."
  value       = var.enable_cloudfront_access_logs ? aws_s3_bucket.cloudfront_logs[0].region : null
}

output "cloudfront_log_delivery_id" {
  description = "CloudFront standard logging v2 delivery ID."
  value       = var.enable_cloudfront_access_logs ? aws_cloudwatch_log_delivery.cloudfront_access_logs[0].id : null
}

output "route53_zone_id" {
  description = "Route53 hosted zone ID."
  value       = module.frontend_zone.zone_id
}

output "route53_record_fqdn" {
  description = "Frontend DNS record FQDN."
  value       = var.create_frontend_dns_record ? aws_route53_record.frontend_alias_a[0].fqdn : null
}

output "alb_api_origin_domain_name" {
  description = "Configured ALB origin domain name for CloudFront API routing."
  value       = var.enable_alb_api_origin ? var.alb_origin_domain_name : null
}

output "alb_api_origin_path_pattern" {
  description = "CloudFront path pattern forwarded to ALB origin."
  value       = var.enable_alb_api_origin ? var.alb_origin_path_pattern : null
}

output "shield_standard_note" {
  description = "Shield protection note."
  value       = "AWS Shield Standard is automatically included for CloudFront distributions."
}

output "public_access_kms_key_arn" {
  description = "KMS key ARN used by public-access resources when managed by Terraform."
  value       = local.resolved_public_access_kms_key_arn
}

output "public_access_waf_kms_key_arn" {
  description = "KMS key ARN used for WAF CloudWatch logs when managed by Terraform."
  value       = local.resolved_waf_log_group_kms_key_arn
}
