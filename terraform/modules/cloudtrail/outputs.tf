output "trail_name" {
  description = "CloudTrail trail name."
  value       = aws_cloudtrail.this.name
}

output "trail_arn" {
  description = "CloudTrail trail ARN."
  value       = aws_cloudtrail.this.arn
}

output "trail_home_region" {
  description = "CloudTrail home region."
  value       = aws_cloudtrail.this.home_region
}

output "log_bucket_name" {
  description = "S3 bucket name used for CloudTrail logs."
  value       = aws_s3_bucket.this.bucket
}

output "log_bucket_arn" {
  description = "S3 bucket ARN used for CloudTrail logs."
  value       = aws_s3_bucket.this.arn
}

output "cloudwatch_log_group_name" {
  description = "CloudWatch log group name used for CloudTrail logs."
  value       = var.enable_cloudwatch_logs ? aws_cloudwatch_log_group.this[0].name : null
}

output "cloudwatch_role_arn" {
  description = "IAM role ARN assumed by CloudTrail for CloudWatch Logs delivery."
  value       = var.enable_cloudwatch_logs ? aws_iam_role.cloudtrail_to_cw[0].arn : null
}
