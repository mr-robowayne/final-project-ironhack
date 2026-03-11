variable "origin_bucket_regional_domain_name" {
  description = "Regional domain name of the private S3 bucket used as CloudFront origin."
  type        = string
}

variable "alb_origin_domain_name" {
  description = "Optional domain name for additional ALB-backed origin (for example API traffic)."
  type        = string
  default     = null
  nullable    = true

  validation {
    condition     = var.alb_origin_domain_name == null || length(trimspace(var.alb_origin_domain_name)) > 0
    error_message = "alb_origin_domain_name must be null or a non-empty DNS name."
  }
}

variable "alb_origin_path_pattern" {
  description = "Path pattern routed to ALB origin when alb_origin_domain_name is set."
  type        = string
  default     = "/api/*"
}

variable "acm_certificate_arn" {
  description = "ACM certificate ARN for HTTPS on CloudFront (must be in us-east-1)."
  type        = string
}

variable "aliases" {
  description = "Alternate domain names (CNAMEs) for the CloudFront distribution."
  type        = list(string)
}

variable "distribution_comment" {
  description = "Comment for the CloudFront distribution."
  type        = string
  default     = "Public frontend distribution."
}

variable "default_root_object" {
  description = "Default root object for CloudFront."
  type        = string
  default     = "index.html"
}

variable "price_class" {
  description = "CloudFront price class."
  type        = string
  default     = "PriceClass_100"
}

variable "geo_allowed_countries" {
  description = "ISO country codes allowed by CloudFront geo restriction."
  type        = list(string)

  validation {
    condition = length(var.geo_allowed_countries) > 0 && alltrue([
      for code in var.geo_allowed_countries : can(regex("^[A-Z]{2}$", code))
    ])
    error_message = "geo_allowed_countries must contain at least one ISO-3166 alpha-2 uppercase country code."
  }
}

variable "origin_access_control_name" {
  description = "Name for CloudFront Origin Access Control."
  type        = string
}

variable "web_acl_name" {
  description = "Name of the WAFv2 Web ACL."
  type        = string
}

variable "enable_access_logs" {
  description = "Enable CloudFront access logs to S3."
  type        = bool
  default     = true
}

variable "logging_bucket_domain_name" {
  description = "S3 bucket domain name for CloudFront access logs (for example: my-logs-bucket.s3.amazonaws.com)."
  type        = string
  default     = null
  nullable    = true

  validation {
    condition     = !var.enable_access_logs || (var.logging_bucket_domain_name != null && length(trimspace(var.logging_bucket_domain_name)) > 0)
    error_message = "logging_bucket_domain_name must be set when enable_access_logs is true."
  }
}

variable "log_prefix" {
  description = "Prefix for CloudFront access logs."
  type        = string
  default     = "cloudfront/"
}

variable "enable_waf_logs" {
  description = "Enable WAF logs in CloudWatch Logs."
  type        = bool
  default     = true
}

variable "waf_log_group_name" {
  description = "Optional explicit CloudWatch log group name for WAF logs. Must start with aws-waf-logs-."
  type        = string
  default     = null

  validation {
    condition     = var.waf_log_group_name == null || startswith(var.waf_log_group_name, "aws-waf-logs-")
    error_message = "waf_log_group_name must start with aws-waf-logs-."
  }
}

variable "waf_log_retention_days" {
  description = "Retention in days for WAF CloudWatch logs."
  type        = number
  default     = 365

  validation {
    condition     = var.waf_log_retention_days > 0
    error_message = "waf_log_retention_days must be greater than 0."
  }
}

variable "waf_log_group_kms_key_id" {
  description = "Optional KMS key ARN/ID for WAF CloudWatch log group encryption."
  type        = string
  default     = null
}

variable "enable_waf_rate_limit" {
  description = "Enable WAF rate limiting rule by source IP."
  type        = bool
  default     = true
}

variable "waf_rate_limit" {
  description = "Maximum requests per 5-minute period from a single IP before block."
  type        = number
  default     = 2000

  validation {
    condition     = var.waf_rate_limit >= 100
    error_message = "waf_rate_limit must be at least 100."
  }
}

variable "tags" {
  description = "Tags applied to all resources."
  type        = map(string)
  default     = {}
}
